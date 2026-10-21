import { describe, it, expect, afterEach } from "vitest";
import { Context, ServiceBroker } from "moleculer";
import ApiGateway from "moleculer-web";
import { McpServerMixin } from "../src/index.js";
import type { McpServerMixinOptions } from "../src/index.js";
import { createMcpClient, closeMcpClient, callTool } from "./mcp-client.js";
import type { Server } from "http";
import type { AddressInfo } from "net";

describe("Security", () => {
	let broker: ServiceBroker;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let apiService: any;
	let receivedEvents: unknown[];

	afterEach(async () => {
		if (broker?.started) await broker.stop();
	});

	// API gateway whose MCP route authenticates the `Authorization: Bearer <name>` header
	async function start(options: McpServerMixinOptions = {}) {
		receivedEvents = [];
		broker = new ServiceBroker({ logger: false });
		apiService = broker.createService({
			name: "api",
			mixins: [
				ApiGateway,
				McpServerMixin({ ...options, routeOptions: { authentication: true } })
			],
			settings: { port: 0, routes: [] },
			methods: {
				authenticate(ctx: Context<unknown, Record<string, unknown>>, route, req) {
					const auth = req.headers["authorization"] as string | undefined;
					ctx.meta.tenant = "acme";
					return auth ? { name: auth.replace("Bearer ", "") } : null;
				}
			}
		});
		broker.createService({
			name: "whoami",
			actions: {
				get: {
					handler: (ctx: Context<unknown, Record<string, unknown>>) => ({
						user: ctx.meta.user ?? null,
						tenant: ctx.meta.tenant ?? null
					})
				}
			},
			events: {
				"user.seen"(ctx: Context<unknown, Record<string, unknown>>) {
					receivedEvents.push(ctx.meta.user);
				}
			}
		});
		await broker.start();
	}

	function connect(headers?: Record<string, string>) {
		const address = (apiService.server as Server).address() as AddressInfo;
		return createMcpClient(`http://localhost:${address.port}/mcp`, headers);
	}

	function parse(result: Awaited<ReturnType<typeof callTool>>) {
		return JSON.parse(result.content[0].text as string);
	}

	describe("ctx.meta forwarding", () => {
		it("should forward the authenticated user to auto-discovered tools", async () => {
			await start();
			const mcpClient = await connect({ Authorization: "Bearer john" });
			try {
				const result = parse(await callTool(mcpClient, "whoami_get", {}));
				expect(result.user).toEqual({ name: "john" });
				// Only the `forwardMeta` keys are forwarded
				expect(result.tenant).toBeNull();
			} finally {
				await closeMcpClient(mcpClient);
			}
		});

		it("should use the user of each request, not of the session", async () => {
			await start();
			const john = await connect({ Authorization: "Bearer john" });
			const anonymous = await connect();
			try {
				expect(parse(await callTool(john, "whoami_get", {})).user).toEqual({
					name: "john"
				});
				expect(parse(await callTool(anonymous, "whoami_get", {})).user).toBeNull();
			} finally {
				await closeMcpClient(john);
				await closeMcpClient(anonymous);
			}
		});

		it("should forward the configured meta keys", async () => {
			await start({ forwardMeta: ["user", "tenant"] });
			const mcpClient = await connect({ Authorization: "Bearer john" });
			try {
				const result = parse(await callTool(mcpClient, "whoami_get", {}));
				expect(result).toEqual({ user: { name: "john" }, tenant: "acme" });
			} finally {
				await closeMcpClient(mcpClient);
			}
		});

		it("should forward the user to the generic tools and custom tools", async () => {
			await start({
				tools: [
					{ name: "via_action", description: "whoami", handler: "whoami.get" },
					{
						name: "via_function",
						description: "whoami",
						handler: (params, broker, meta) => ({ user: meta.user })
					}
				]
			});
			const mcpClient = await connect({ Authorization: "Bearer john" });
			try {
				const call = await callTool(mcpClient, "moleculer_call_action", {
					action: "whoami.get"
				});
				expect(parse(call).user).toEqual({ name: "john" });
				expect(parse(await callTool(mcpClient, "via_action", {})).user).toEqual({
					name: "john"
				});
				expect(parse(await callTool(mcpClient, "via_function", {})).user).toEqual({
					name: "john"
				});

				await callTool(mcpClient, "moleculer_emit_event", { event: "user.seen" });
				expect(receivedEvents).toEqual([{ name: "john" }]);
			} finally {
				await closeMcpClient(mcpClient);
			}
		});
	});
});

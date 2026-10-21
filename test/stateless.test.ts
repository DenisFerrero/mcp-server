import { describe, it, expect, afterEach } from "vitest";
import { Context, ServiceBroker } from "moleculer";
import ApiGateway from "moleculer-web";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { McpServerMixin } from "../src/index.js";
import { createMcpClient, closeMcpClient, callTool, listTools } from "./mcp-client.js";
import type { Server } from "http";
import type { AddressInfo } from "net";

describe("Stateless mode", () => {
	let broker: ServiceBroker;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let apiService: any;
	let url: string;

	afterEach(async () => {
		if (broker?.started) await broker.stop();
	});

	async function start() {
		broker = new ServiceBroker({ logger: false });
		apiService = broker.createService({
			name: "api",
			mixins: [
				ApiGateway,
				McpServerMixin({ stateless: true, routeOptions: { authentication: true } })
			],
			settings: { port: 0, routes: [] },
			methods: {
				authenticate(ctx, route, req) {
					const auth = req.headers["authorization"] as string | undefined;
					return auth ? { name: auth.replace("Bearer ", "") } : null;
				}
			}
		});
		broker.createService({
			name: "greeter",
			actions: {
				hello: { handler: () => "Hello" },
				whoami: { handler: (ctx: Context<unknown, { user?: unknown }>) => ctx.meta.user }
			}
		});
		await broker.start();
		const address = (apiService.server as Server).address() as AddressInfo;
		url = `http://localhost:${address.port}/mcp`;
	}

	// Raw JSON-RPC request with fetch, without any previous initialization
	async function rpc(method: string, params: unknown, init: RequestInit = {}) {
		return fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream"
			},
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
			...init
		});
	}

	it("should work with the MCP SDK client without keeping sessions", async () => {
		await start();
		const mcpClient = await createMcpClient(url);
		try {
			const toolNames = (await listTools(mcpClient)).map((t: Tool) => t.name);
			expect(toolNames).toContain("greeter_hello");

			const result = await callTool(mcpClient, "greeter_hello", {});
			expect(result.content[0].text).toContain("Hello");

			expect(apiService.transports.size).toBe(0);
			expect(apiService.mcpSessions.size).toBe(0);
		} finally {
			await closeMcpClient(mcpClient);
		}
	});

	it("should serve requests without a session (any gateway instance can answer)", async () => {
		await start();
		const res = await rpc("tools/call", { name: "greeter_hello", arguments: {} });
		expect(res.status).toBe(200);
		expect(res.headers.get("mcp-session-id")).toBeNull();
		expect(await res.text()).toContain("Hello");
	});

	it("should forward the authenticated user", async () => {
		await start();
		const mcpClient = await createMcpClient(url, { Authorization: "Bearer john" });
		try {
			const result = await callTool(mcpClient, "greeter_whoami", {});
			expect(JSON.parse(result.content[0].text as string)).toEqual({ name: "john" });
		} finally {
			await closeMcpClient(mcpClient);
		}
	});

	it("should reject GET and DELETE with 405", async () => {
		await start();
		for (const method of ["GET", "DELETE"]) {
			const res = await fetch(url, { method, headers: { Accept: "text/event-stream" } });
			expect(res.status, method).toBe(405);
			expect(res.headers.get("allow")).toBe("POST");
		}
	});
});

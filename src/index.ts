/*
 * @moleculer/mcp-server
 * Copyright (c) 2026 MoleculerJS (https://github.com/moleculerjs/mcp-server)
 * MIT Licensed
 */

import { VERSION } from "./version.js";

import { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import Moleculer, { ActionSchema, ServiceBroker, ServiceSchema } from "moleculer";
import type {
	ApiRouteSchema,
	ApiSettingsSchema,
	CorsOptions,
	GatewayResponse,
	IncomingRequest
} from "moleculer-web";
import _ from "lodash";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpCustomTool, McpServerMixinOptions } from "./types.js";
import {
	isActionExposed,
	registerAutoDiscoveryTools,
	withGatewayExclusions
} from "./tool-generator.js";
import { registerCustomTools } from "./custom-tools.js";
import { BoundedEventStore } from "./event-store.js";
import {
	getCallOptions,
	getForwardedMeta,
	MCP_META_KEY,
	registerTool,
	toErrorResult,
	toTextResult
} from "./utils.js";
import "./moleculer-types.js";

export type { McpCustomTool, McpServerMixinOptions };

const { match } = Moleculer.Utils;

/**
 * The registry list methods used by the broker tools. Typed here because the Moleculer 0.14
 * typings don't declare `getNodeList` and `getEventList` (they exist at runtime).
 */
interface RegistryLists {
	getNodeList(opts?: object): unknown;
	getServiceList(opts?: object): unknown;
	getActionList(opts?: object): Array<{ name: string; action?: ActionSchema }>;
	getEventList(opts?: object): unknown;
}

function getRegistry(broker: ServiceBroker): RegistryLists {
	return broker.registry as unknown as RegistryLists;
}

/** An open MCP session: its server and the auto-discovered tools registered on it */
interface McpSession {
	server: McpServer;
	transport?: StreamableHTTPServerTransport;
	autoTools: RegisteredTool[];
	/** Timestamp of the last request, used to close idle sessions */
	lastActivity: number;
	/** Requests in progress, incl. open SSE (GET) streams: a busy session is never idle */
	openStreams: number;
}

/** A moleculer-web request, with the `auth` read by the MCP SDK transport */
type McpRequest = IncomingRequest & { auth?: AuthInfo };

const DEFAULT_OPTIONS: McpServerMixinOptions = {
	exposeBrokerTools: true,
	exposeGenericTools: true,
	toolNamePrefix: "",
	tools: [],
	refreshDebounceTime: 1000,
	forwardMeta: ["user"],
	sessionTimeout: 30 * 60 * 1000,
	maxSessions: 100,
	maxStoredEvents: 1000
};

/** Headers the MCP Streamable HTTP transport needs in the CORS configuration */
const CORS_METHODS = ["GET", "POST", "DELETE", "OPTIONS"];
const CORS_ALLOWED_HEADERS = [
	"Content-Type",
	"mcp-session-id",
	"mcp-protocol-version",
	"Last-Event-ID"
];
const CORS_EXPOSED_HEADERS = ["mcp-session-id"];

function toList(value: string | string[] | undefined): string[] {
	if (value == null) return [];
	return Array.isArray(value) ? value : [value];
}

/**
 * The CORS options of the MCP route: the user options, with the methods and headers needed by
 * the transport always added (a user `allowedHeaders: ["Authorization"]` must not drop
 * `Content-Type`). `cors: false` disables CORS.
 */
function buildCors(
	userCors: boolean | CorsOptions | undefined,
	allowedOrigins: string[] | undefined
): false | CorsOptions {
	if (userCors === false) return false;
	const cors: CorsOptions = typeof userCors === "object" ? userCors : {};
	return {
		// Without `allowedOrigins` any origin is accepted (e.g. the MCP Inspector)
		origin: allowedOrigins?.length ? allowedOrigins : "*",
		...cors,
		methods: _.uniq([...CORS_METHODS, ...toList(cors.methods)]),
		allowedHeaders: _.uniq([...CORS_ALLOWED_HEADERS, ...toList(cors.allowedHeaders)]),
		exposedHeaders: _.uniq([...CORS_EXPOSED_HEADERS, ...toList(cors.exposedHeaders)])
	};
}

function jsonRpcError(code: number, message: string) {
	return { jsonrpc: "2.0", error: { code, message }, id: null };
}

function parseJsonParams(jsonParams: unknown): unknown {
	if (!jsonParams) return {};
	try {
		return JSON.parse(jsonParams as string);
	} catch (err) {
		throw new Error(
			"The 'jsonParams' must be a valid JSON object string: " +
				(err instanceof Error ? err.message : String(err)),
			{ cause: err }
		);
	}
}

export function McpServerMixin(
	mixinOptions?: McpServerMixinOptions
): Partial<ServiceSchema<ApiSettingsSchema>> {
	// Shallow defaults: the user object is not modified, and user arrays (e.g. an empty
	// `forwardMeta`) are not merged with the default ones
	const options: McpServerMixinOptions = _.defaults({}, mixinOptions, DEFAULT_OPTIONS);

	function createServer(broker: ServiceBroker, options: McpServerMixinOptions): McpSession {
		const logger = broker.getLogger("MCP");

		logger.debug("Creating MCP server...");

		const server = new McpServer(
			{
				name: "Moleculer MCP Server",
				version: VERSION
			},
			{
				capabilities: {
					tools: { listChanged: true }
				},
				// Registering or removing many tools (e.g. on a refresh) sends one notification
				debouncedNotificationMethods: ["notifications/tools/list_changed"]
			}
		);

		if (options.exposeBrokerTools !== false) {
			registerTool(
				server,
				"moleculer_list_nodes",
				{
					title: "List Moleculer nodes",
					description: "List all Moleculer nodes",
					inputSchema: {
						onlyAvailable: z
							.boolean()
							.optional()
							.default(false)
							.describe("List only available (online) nodes"),
						withServices: z
							.boolean()
							.optional()
							.default(false)
							.describe("Include service schemas")
					},
					annotations: {
						readOnlyHint: true,
						destructiveHint: false,
						idempotentHint: true,
						openWorldHint: false
					}
				},
				async params => {
					logger.debug("Listing Moleculer nodes...", params);
					const nodes = getRegistry(broker).getNodeList(params);
					return toTextResult(nodes, options.maxResultLength);
				}
			);

			registerTool(
				server,
				"moleculer_list_services",
				{
					title: "List Moleculer services",
					description: "List all Moleculer services",
					inputSchema: {
						onlyLocal: z
							.boolean()
							.optional()
							.default(false)
							.describe("List only local node services"),
						onlyAvailable: z
							.boolean()
							.optional()
							.default(false)
							.describe("List only available (online) services"),
						skipInternal: z
							.boolean()
							.optional()
							.default(false)
							.describe("Skip internal services (prefixed with '$')"),
						withActions: z
							.boolean()
							.optional()
							.default(false)
							.describe("Include service actions definitions"),
						withEvents: z
							.boolean()
							.optional()
							.default(false)
							.describe("Include service events definitions"),
						grouping: z
							.boolean()
							.optional()
							.default(true)
							.describe("Group services by name and version")
					},
					annotations: {
						readOnlyHint: true,
						destructiveHint: false,
						idempotentHint: true,
						openWorldHint: false
					}
				},
				async params => {
					logger.debug("Listing Moleculer services...", params);
					const services = getRegistry(broker).getServiceList(params);
					return toTextResult(services, options.maxResultLength);
				}
			);

			registerTool(
				server,
				"moleculer_list_actions",
				{
					title: "List Moleculer actions",
					description:
						"List the Moleculer actions that can be called through MCP (e.g. with `moleculer_call_action`)",
					inputSchema: {
						onlyLocal: z
							.boolean()
							.optional()
							.default(false)
							.describe("List only local node actions"),
						onlyAvailable: z
							.boolean()
							.optional()
							.default(false)
							.describe("List only available (online) actions"),
						skipInternal: z
							.boolean()
							.optional()
							.default(false)
							.describe("Skip internal actions (prefixed with '$')"),
						withEndpoints: z
							.boolean()
							.optional()
							.default(false)
							.describe("Include node endpoint information of actions")
					},
					annotations: {
						readOnlyHint: true,
						destructiveHint: false,
						idempotentHint: true,
						openWorldHint: false
					}
				},
				async params => {
					logger.debug("Listing Moleculer actions...", params);
					// Same filters of `moleculer_call_action`: don't list what can't be called
					const exposure = withGatewayExclusions(broker, options);
					const actions = getRegistry(broker)
						.getActionList(params)
						.filter(entry => isActionExposed(entry, exposure));
					return toTextResult(actions, options.maxResultLength);
				}
			);

			registerTool(
				server,
				"moleculer_list_events",
				{
					title: "List Moleculer events",
					description: "List all Moleculer events",
					inputSchema: {
						onlyLocal: z
							.boolean()
							.optional()
							.default(false)
							.describe("List only local node events"),
						onlyAvailable: z
							.boolean()
							.optional()
							.default(false)
							.describe("List only available (online) events"),
						skipInternal: z
							.boolean()
							.optional()
							.default(false)
							.describe("Skip internal events (prefixed with '$')"),
						withEndpoints: z
							.boolean()
							.optional()
							.default(false)
							.describe("Include node endpoint information of event listeners")
					},
					annotations: {
						readOnlyHint: true,
						destructiveHint: false,
						idempotentHint: true,
						openWorldHint: false
					}
				},
				async params => {
					logger.debug("Listing Moleculer events...", params);
					const events = getRegistry(broker).getEventList(params);
					return toTextResult(events, options.maxResultLength);
				}
			);
		} // end exposeBrokerTools

		if (options.exposeGenericTools !== false) {
			registerTool(
				server,
				"moleculer_call_action",
				{
					title: "Call Action",
					description: "Call a Moleculer action",
					inputSchema: {
						action: z.string().describe("Action name"),
						jsonParams: z
							.string()
							.describe(
								'Actions parameters as a JSON object string. E.g. \'{"name":"John"}\'\nIf you don\'t know the parameters of the action, call the `moleculer_list_actions` tool first.'
							)
							.optional()
					},
					annotations: {
						readOnlyHint: false,
						destructiveHint: false,
						idempotentHint: false,
						openWorldHint: true
					}
				},
				async (params, extra) => {
					logger.debug("Calling Moleculer action...", params);
					if (!params.action) {
						throw new Error("action parameter is required");
					}
					const action = params.action as string;

					// The generic tool must not bypass the filters of the auto-discovered tools.
					// Unknown actions are still called, to get the usual ServiceNotFoundError.
					const entry = getRegistry(broker)
						.getActionList({})
						.find(a => a.name === action);
					if (entry && !isActionExposed(entry, withGatewayExclusions(broker, options))) {
						return toErrorResult(
							new Error(`Action '${action}' is not exposed via MCP`)
						);
					}

					const actionParams = parseJsonParams(params.jsonParams);
					try {
						const result = await broker.call(
							action,
							actionParams,
							getCallOptions(options, extra)
						);
						return toTextResult(result, options.maxResultLength);
					} catch (err) {
						logger.error("Error calling action:", err);
						return toErrorResult(err);
					}
				}
			);

			registerTool(
				server,
				"moleculer_emit_event",

				{
					title: "Emit (or broadcast) an Event",
					description: "Emit a Moleculer event",
					inputSchema: {
						event: z.string().describe("Event name"),
						jsonParams: z
							.string()
							.describe(
								'Event parameters as a JSON object string. E.g. \'{"name":"John"}\'\nIf you don\'t know the parameters of the event, call the `moleculer_list_events` tool first.'
							)
							.optional(),
						broadcast: z
							.boolean()
							.optional()
							.default(false)
							.describe("Set to true to broadcast the event to all nodes")
					},
					annotations: {
						readOnlyHint: false,
						destructiveHint: false,
						idempotentHint: false,
						openWorldHint: true
					}
				},
				async (params, extra) => {
					logger.debug("Emitting Moleculer event...", params);
					if (!params.event) {
						throw new Error("event parameter is required");
					}
					const event = params.event as string;

					// Internal events (e.g. `$services.changed`, `$node.disconnected`) drive the
					// broker and the services: they can be emitted only if explicitly allowed
					const allowedEvents = options.allowedEvents;
					const allowed = allowedEvents
						? allowedEvents.some(pattern => match(event, pattern))
						: !event.startsWith("$");
					if (!allowed) {
						return toErrorResult(new Error(`Event '${event}' is not allowed via MCP`));
					}

					const eventParams = parseJsonParams(params.jsonParams);
					try {
						const opts = { meta: getForwardedMeta(extra) };
						if (params.broadcast) {
							await broker.broadcast(event, eventParams, opts);
						} else {
							await broker.emit(event, eventParams, opts);
						}
						return {
							content: [
								{
									type: "text",
									text: `Event '${event}' emitted successfully`
								}
							]
						};
					} catch (err) {
						logger.error("Error emitting event:", err);
						return toErrorResult(err);
					}
				}
			);
		} // end exposeGenericTools

		// Custom tools take precedence over the auto-discovered ones
		registerCustomTools(server, broker, options);

		// Auto-discovery: register per-action tools (after the other tools, so a clashing
		// action tool name is skipped instead of breaking the session)
		const autoTools = registerAutoDiscoveryTools(server, broker, options);

		return { server, autoTools, lastActivity: Date.now(), openStreams: 0 };
	}

	return {
		events: {
			"$services.changed"() {
				this.debouncedRefreshMcpTools?.();
			}
		},

		methods: {
			/**
			 * Protection against DNS rebinding attacks, as required by the MCP specification:
			 * reject requests with a `Host` or `Origin` header not in `allowedHosts` /
			 * `allowedOrigins`. Requests without `Origin` (non-browser clients) are accepted.
			 * @returns true if the request has been rejected
			 */
			async rejectInvalidMcpHeaders(req: McpRequest, res: GatewayResponse): Promise<boolean> {
				const options: McpServerMixinOptions = this.mcpOptions;
				let error: string | null = null;

				const allowedHosts = options.allowedHosts;
				if (allowedHosts?.length) {
					const host = req.headers.host;
					// Entries can be given with or without the port
					const hostname = host?.replace(/:\d+$/, "");
					if (
						!host ||
						!(allowedHosts.includes(host) || allowedHosts.includes(hostname!))
					) {
						error = `Invalid Host header: ${host}`;
					}
				}

				const allowedOrigins = options.allowedOrigins;
				const origin = req.headers.origin;
				if (
					!error &&
					allowedOrigins?.length &&
					origin &&
					!allowedOrigins.includes(origin)
				) {
					error = `Invalid Origin header: ${origin}`;
				}

				if (!error) return false;

				this.logger.warn(`Rejected MCP request: ${error}`);
				await this.sendMcpError(req, res, 403, jsonRpcError(-32000, error));
				return true;
			},

			/** Send a JSON-RPC error response, unless the response has already been started */
			async sendMcpError(
				req: McpRequest,
				res: GatewayResponse,
				statusCode: number,
				body: ReturnType<typeof jsonRpcError>
			) {
				if (res.headersSent) return;
				res.statusCode = statusCode;
				await this.sendResponse(req, res, body, {});
			},

			/**
			 * Make the forwarded `ctx.meta` fields of the HTTP request (e.g. the user set by the
			 * route `authenticate` method) available to the tool handlers, through the
			 * `authInfo` that the MCP SDK passes in the handler `extra` argument.
			 */
			attachMcpMeta(req: McpRequest) {
				const options: McpServerMixinOptions = this.mcpOptions;
				const meta = _.pick(
					(req.$ctx?.meta as Record<string, unknown>) ?? {},
					options.forwardMeta ?? []
				);
				if (_.isEmpty(meta)) return;
				req.auth = {
					token: "",
					clientId: "",
					scopes: [],
					...req.auth,
					extra: { ...req.auth?.extra, [MCP_META_KEY]: meta }
				};
			},

			async handleMcpPost(req: McpRequest, res: GatewayResponse) {
				const options: McpServerMixinOptions = this.mcpOptions;
				this.logger.debug("Received MCP POST request");
				if (await this.rejectInvalidMcpHeaders(req, res)) return;
				if (options.stateless) return this.handleStatelessMcpRequest(req, res);
				try {
					const sessionId = req.headers["mcp-session-id"] as string | undefined;

					if (sessionId && this.transports.has(sessionId)) {
						// Existing session: its transport is already connected to its server
						const transport: StreamableHTTPServerTransport =
							this.transports.get(sessionId);
						this.trackMcpRequest(sessionId, res);
						this.attachMcpMeta(req);
						await transport.handleRequest(req, res);
						return;
					}

					// New initialization request (no session ID or unknown session ID).
					// `maxSessions` counts also the sessions being initialized right now.
					const maxSessions = options.maxSessions;
					if (
						maxSessions != null &&
						this.mcpSessions.size + this.mcpPendingSessions >= maxSessions
					) {
						this.logger.warn(
							`Rejected MCP session: the limit of ${maxSessions} sessions is reached`
						);
						await this.sendMcpError(
							req,
							res,
							503,
							jsonRpcError(-32000, "Too many MCP sessions, retry later")
						);
						return;
					}

					this.mcpPendingSessions++;
					let pending = true;
					const settle = () => {
						if (pending) this.mcpPendingSessions--;
						pending = false;
					};
					try {
						const session = createServer(this.broker, options);
						const eventStore = new BoundedEventStore(options.maxStoredEvents!);
						const transport: StreamableHTTPServerTransport =
							new StreamableHTTPServerTransport({
								sessionIdGenerator: () => randomUUID(),
								eventStore, // Enable resumability
								onsessioninitialized: (sessionId: string) => {
									// Store the session as soon as it is initialized, before the
									// response is sent, so the next requests of the client find it
									this.logger.info(`Session initialized with ID: ${sessionId}`);
									this.transports.set(sessionId, transport);
									this.mcpSessions.set(sessionId, session);
									settle();
								}
							});
						session.transport = transport;

						// Remove the session when its transport is closed (DELETE, idle, shutdown)
						session.server.server.onclose = () => {
							const sid = transport.sessionId;
							if (!sid) return;
							this.mcpSessions.delete(sid);
							if (this.transports.delete(sid)) {
								this.logger.info(`Transport closed for session ${sid}`);
							}
						};

						// Connect the transport to the MCP server BEFORE handling the request
						// so responses can flow back through the same transport
						await session.server.connect(transport);

						this.attachMcpMeta(req);
						await transport.handleRequest(req, res);

						// Not an initialization request (e.g. an expired session ID): the
						// transport has rejected it and no session was created, release the server
						if (!transport.sessionId) {
							await session.server.close();
						}
					} finally {
						settle();
					}
				} catch (error) {
					this.logger.error("Error handling MCP request:", error);
					await this.sendMcpError(
						req,
						res,
						500,
						jsonRpcError(-32603, "Internal server error")
					);
				}
			},

			async handleMcpGet(req: McpRequest, res: GatewayResponse) {
				const options: McpServerMixinOptions = this.mcpOptions;
				this.logger.debug("Received MCP GET request");
				if (await this.rejectInvalidMcpHeaders(req, res)) return;
				if (options.stateless) return this.rejectStatelessMcpMethod(req, res);
				const sessionId = req.headers["mcp-session-id"] as string | undefined;
				if (!sessionId || !this.transports.has(sessionId)) {
					await this.sendMcpError(
						req,
						res,
						400,
						jsonRpcError(-32000, "Bad Request: No valid session ID provided")
					);
					return;
				}

				// Last-Event-ID header: the client resumes the stream
				const lastEventId = req.headers["last-event-id"] as string | undefined;
				if (lastEventId) {
					this.logger.debug(`Client reconnecting with Last-Event-ID: ${lastEventId}`);
				} else {
					this.logger.debug(`Establishing new MCP SSE stream for session ${sessionId}`);
				}

				try {
					const transport: StreamableHTTPServerTransport = this.transports.get(sessionId);
					this.trackMcpRequest(sessionId, res);
					this.attachMcpMeta(req);
					await transport.handleRequest(req, res);
				} catch (error) {
					this.logger.error("Error handling MCP SSE stream:", error);
					await this.sendMcpError(
						req,
						res,
						500,
						jsonRpcError(-32603, "Internal server error")
					);
				}
			},

			async handleMcpDelete(req: McpRequest, res: GatewayResponse) {
				const options: McpServerMixinOptions = this.mcpOptions;
				if (await this.rejectInvalidMcpHeaders(req, res)) return;
				if (options.stateless) return this.rejectStatelessMcpMethod(req, res);
				const sessionId = req.headers["mcp-session-id"] as string | undefined;
				if (!sessionId || !this.transports.has(sessionId)) {
					await this.sendMcpError(
						req,
						res,
						400,
						jsonRpcError(-32000, "Bad Request: No valid session ID provided")
					);
					return;
				}

				this.logger.info(`Received session termination request for session ${sessionId}`);

				try {
					const transport: StreamableHTTPServerTransport = this.transports.get(sessionId);
					this.attachMcpMeta(req);
					await transport.handleRequest(req, res);
				} catch (error) {
					this.logger.error("Error handling session termination:", error);
					await this.sendMcpError(
						req,
						res,
						500,
						jsonRpcError(-32603, "Error handling session termination")
					);
				}
			},

			/**
			 * Stateless mode: a new server and transport for each request, closed when the
			 * response ends. No session is kept, so any gateway instance can serve any request.
			 */
			async handleStatelessMcpRequest(req: McpRequest, res: GatewayResponse) {
				const { server } = createServer(this.broker, this.mcpOptions);
				const transport = new StreamableHTTPServerTransport({
					sessionIdGenerator: undefined
				});
				res.once("close", () => {
					transport.close().catch(() => {});
					server.close().catch(() => {});
				});
				try {
					await server.connect(transport);
					this.attachMcpMeta(req);
					await transport.handleRequest(req, res);
				} catch (error) {
					this.logger.error("Error handling stateless MCP request:", error);
					await this.sendMcpError(
						req,
						res,
						500,
						jsonRpcError(-32603, "Internal server error")
					);
				}
			},

			/** In stateless mode there are no SSE streams (GET) or sessions to terminate (DELETE) */
			async rejectStatelessMcpMethod(req: McpRequest, res: GatewayResponse) {
				res.setHeader("Allow", "POST");
				await this.sendMcpError(
					req,
					res,
					405,
					jsonRpcError(-32000, "Method not allowed in stateless mode")
				);
			},

			/**
			 * Re-generate the auto-discovered tools of every open session, so the clients
			 * see the actions of services started (or stopped) after the session was opened.
			 * The SDK notifies the clients with `notifications/tools/list_changed`.
			 */
			refreshMcpTools() {
				for (const session of (this.mcpSessions as Map<string, McpSession>).values()) {
					for (const tool of session.autoTools) tool.remove();
					session.autoTools = registerAutoDiscoveryTools(
						session.server,
						this.broker,
						this.mcpOptions
					);
				}
			},

			/** Close all the open MCP sessions (their transports and SSE streams) */
			async closeMcpSessions() {
				const transports = this.transports as Map<string, StreamableHTTPServerTransport>;
				for (const [sessionId, transport] of transports) {
					try {
						this.logger.info(`Closing transport for session ${sessionId}`);
						await transport.close();
					} catch (error) {
						this.logger.error(
							`Error closing transport for session ${sessionId}:`,
							error
						);
					}
					transports.delete(sessionId);
					this.mcpSessions.delete(sessionId);
				}
			},

			/**
			 * Track a request of a session until its response is closed (for SSE streams,
			 * until the client disconnects), so busy sessions are not closed as idle.
			 */
			trackMcpRequest(sessionId: string, res: GatewayResponse) {
				const session: McpSession | undefined = this.mcpSessions.get(sessionId);
				if (!session) return;
				session.openStreams++;
				session.lastActivity = Date.now();
				res.once("close", () => {
					session.openStreams--;
					session.lastActivity = Date.now();
				});
			},

			/**
			 * Close the sessions without open SSE streams and without requests for
			 * `sessionTimeout` ms, e.g. clients gone away without a DELETE request.
			 */
			async closeIdleMcpSessions() {
				const options: McpServerMixinOptions = this.mcpOptions;
				const now = Date.now();
				for (const [sessionId, session] of this.mcpSessions as Map<string, McpSession>) {
					if (session.openStreams > 0) continue;
					if (now - session.lastActivity < (options.sessionTimeout as number)) continue;

					this.logger.info(`Closing idle MCP session ${sessionId}`);
					try {
						// Triggers `server.onclose`, which removes the session
						await session.transport!.close();
					} catch (error) {
						this.logger.error(`Error closing idle session ${sessionId}:`, error);
					}
				}
			}
		},

		created() {
			this.transports = new Map<string, StreamableHTTPServerTransport>();
			this.mcpSessions = new Map<string, McpSession>();
			// New sessions whose initialization request is being handled (see `maxSessions`)
			this.mcpPendingSessions = 0;

			// The options of this service: the gateway's own actions (e.g. the moleculer-web
			// `listAliases`, which lists all the routes) are infrastructure, never tools
			this.mcpOptions = {
				...options,
				excludeActions: _.uniq([...(options.excludeActions ?? []), `${this.fullName}.*`])
			} satisfies McpServerMixinOptions;

			if (options.refreshDebounceTime !== false) {
				this.debouncedRefreshMcpTools = _.debounce(
					() => this.refreshMcpTools(),
					options.refreshDebounceTime
				);
			}

			const userRoute = options.routeOptions ?? {};
			const route: ApiRouteSchema = {
				mappingPolicy: "restrict",
				...userRoute,
				path: userRoute.path ?? "/mcp",
				aliases: {
					...userRoute.aliases,
					"POST /": (req: McpRequest, res: GatewayResponse) =>
						this.handleMcpPost(req, res),
					"GET /": (req: McpRequest, res: GatewayResponse) => this.handleMcpGet(req, res),
					"DELETE /": (req: McpRequest, res: GatewayResponse) =>
						this.handleMcpDelete(req, res)
				},
				// The moleculer-web 0.10 typings don't accept `cors: false` (supported at runtime)
				cors: buildCors(userRoute.cors, options.allowedOrigins) as CorsOptions,
				bodyParsers: {
					...(typeof userRoute.bodyParsers === "object" ? userRoute.bodyParsers : {}),
					// The transport reads the raw body itself
					json: false
				}
			};

			(this.settings.routes ??= []).unshift(route);
		},

		started() {
			const options: McpServerMixinOptions = this.mcpOptions;
			if (options.sessionTimeout !== false) {
				const timeout = options.sessionTimeout!;
				this.mcpIdleTimer = setInterval(
					() => this.closeIdleMcpSessions(),
					Math.min(timeout, 60 * 1000)
				);
				this.mcpIdleTimer.unref?.();
			}

			// moleculer-web closes the HTTP server in its own `stopped` hook, which runs before
			// this one when ApiGateway comes first in `mixins`: an open SSE stream would keep
			// `server.close()` waiting forever. Close the MCP sessions before the server.
			const server = this.server;
			if (server && !server.mcpCloseWrapped) {
				const close = server.close.bind(server);
				server.close = (callback?: (err?: Error) => void) => {
					this.closeMcpSessions().finally(() => {
						// Keep-alive connections left by the closed streams
						server.closeIdleConnections?.();
						close(callback);
					});
					return server;
				};
				// The service can be restarted: wrap only once
				server.mcpCloseWrapped = true;
			}
		},

		async stopped() {
			this.logger.info("Shutting down server...");

			clearInterval(this.mcpIdleTimer);

			this.debouncedRefreshMcpTools?.cancel();

			await this.closeMcpSessions();

			this.logger.info("Server shutdown complete");
		}
	};
}

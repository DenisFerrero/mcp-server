/*
 * @moleculer/mcp-server
 * Copyright (c) 2026 MoleculerJS (https://github.com/moleculerjs/mcp-server)
 * MIT Licensed
 */

"use strict";

import { VERSION } from "./version.js";

import { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import Moleculer, { ServiceBroker, ServiceSchema } from "moleculer";
import type { ApiSettingsSchema } from "moleculer-web";
import _ from "lodash";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpCustomTool, McpServerMixinOptions } from "./types.js";
import { isActionExposed, registerAutoDiscoveryTools } from "./tool-generator.js";
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

/** Options of the registry list methods (`getNodeList`, `getActionList`, ...) */
type RegistryListOptions<
	M extends "getNodeList" | "getServiceList" | "getActionList" | "getEventList"
> = Parameters<ServiceBroker["registry"][M]>[0];

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

export function McpServerMixin(
	mixinOptions?: McpServerMixinOptions
): Partial<ServiceSchema<ApiSettingsSchema>> {
	mixinOptions = _.defaultsDeep(mixinOptions, {
		routeOptions: {
			path: "/mcp"
		},
		exposeBrokerTools: true,
		exposeGenericTools: true,
		toolNamePrefix: "",
		tools: [],
		refreshDebounceTime: 1000,
		forwardMeta: ["user"],
		sessionTimeout: 30 * 60 * 1000,
		maxStoredEvents: 1000
	});

	function createServer(broker: ServiceBroker) {
		const logger = broker.getLogger("MCP");

		logger.info("Creating MCP server...");

		const server = new McpServer(
			{
				name: "Moleculer MCP Server",
				version: VERSION
			},
			{
				capabilities: {
					tools: { listChanged: true }
				}
			}
		);

		if (mixinOptions!.exposeBrokerTools !== false) {
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
					const nodes = broker.registry.getNodeList(
						params as RegistryListOptions<"getNodeList">
					);
					return toTextResult(nodes, mixinOptions!.maxResultLength);
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
					const services = broker.registry.getServiceList(
						params as RegistryListOptions<"getServiceList">
					);
					return toTextResult(services, mixinOptions!.maxResultLength);
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
					const actions = broker.registry
						.getActionList(params as RegistryListOptions<"getActionList">)
						.filter(entry => isActionExposed(entry, mixinOptions!));
					return toTextResult(actions, mixinOptions!.maxResultLength);
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
					const events = broker.registry.getEventList(
						params as RegistryListOptions<"getEventList">
					);
					return toTextResult(events, mixinOptions!.maxResultLength);
				}
			);
		} // end exposeBrokerTools

		if (mixinOptions!.exposeGenericTools !== false) {
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
					const entry = broker.registry.getActionList({}).find(a => a.name === action);
					if (entry && !isActionExposed(entry, mixinOptions!)) {
						return toErrorResult(
							new Error(`Action '${action}' is not exposed via MCP`)
						);
					}

					let actionParams = {};
					if (params.jsonParams) {
						try {
							actionParams = JSON.parse(params.jsonParams as string);
						} catch (err) {
							throw new Error(
								"The 'jsonParams' must be a valid JSON object string: " +
									err.message,
								{ cause: err }
							);
						}
					}
					try {
						const result = await broker.call(
							action,
							actionParams,
							getCallOptions(mixinOptions!, extra)
						);
						return toTextResult(result, mixinOptions!.maxResultLength);
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

					const allowedEvents = mixinOptions!.allowedEvents;
					if (allowedEvents && !allowedEvents.some(pattern => match(event, pattern))) {
						return toErrorResult(new Error(`Event '${event}' is not allowed via MCP`));
					}

					let eventParams = {};
					if (params.jsonParams) {
						try {
							eventParams = JSON.parse(params.jsonParams as string);
						} catch (err) {
							throw new Error(
								"The 'jsonParams' must be a valid JSON object string: " +
									err.message,
								{ cause: err }
							);
						}
					}
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
		registerCustomTools(server, broker, mixinOptions!);

		// Auto-discovery: register per-action tools (after the other tools, so a clashing
		// action tool name is skipped instead of breaking the session)
		const autoTools = registerAutoDiscoveryTools(server, broker, mixinOptions!);

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
			 * Make the forwarded `ctx.meta` fields of the HTTP request (e.g. the user set by the
			 * route `authenticate` method) available to the tool handlers, through the
			 * `authInfo` that the MCP SDK passes in the handler `extra` argument.
			 */
			/**
			 * Protection against DNS rebinding attacks, as required by the MCP specification:
			 * reject requests with a `Host` or `Origin` header not in `allowedHosts` /
			 * `allowedOrigins`. Requests without `Origin` (non-browser clients) are accepted.
			 * @returns true if the request has been rejected
			 */
			async rejectInvalidMcpHeaders(req, res): Promise<boolean> {
				let error: string | null = null;

				const allowedHosts = mixinOptions!.allowedHosts;
				if (allowedHosts?.length) {
					const host = req.headers.host as string | undefined;
					// Entries can be given with or without the port
					const hostname = host?.replace(/:\d+$/, "");
					if (
						!host ||
						!(allowedHosts.includes(host) || allowedHosts.includes(hostname!))
					) {
						error = `Invalid Host header: ${host}`;
					}
				}

				const allowedOrigins = mixinOptions!.allowedOrigins;
				const origin = req.headers.origin as string | undefined;
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
				res.statusCode = 403;
				await this.sendResponse(
					req,
					res,
					{ jsonrpc: "2.0", error: { code: -32000, message: error }, id: null },
					{}
				);
				return true;
			},

			/**
			 * Stateless mode: a new server and transport for each request, closed when the
			 * response ends. No session is kept, so any gateway instance can serve any request.
			 */
			async handleStatelessMcpRequest(req, res) {
				const { server } = createServer(this.broker);
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
					if (!res.headersSent) {
						res.statusCode = 500;
						await this.sendResponse(
							req,
							res,
							{
								jsonrpc: "2.0",
								error: { code: -32603, message: "Internal server error" },
								id: null
							},
							{}
						);
					}
				}
			},

			/** In stateless mode there are no SSE streams (GET) or sessions to terminate (DELETE) */
			async rejectStatelessMcpMethod(req, res) {
				res.statusCode = 405;
				res.setHeader("Allow", "POST");
				await this.sendResponse(
					req,
					res,
					{
						jsonrpc: "2.0",
						error: { code: -32000, message: "Method not allowed in stateless mode" },
						id: null
					},
					{}
				);
			},

			attachMcpMeta(req) {
				const meta = _.pick(req.$ctx?.meta ?? {}, mixinOptions!.forwardMeta ?? []);
				if (_.isEmpty(meta)) return;
				req.auth = {
					token: "",
					clientId: "",
					scopes: [],
					...req.auth,
					extra: { ...req.auth?.extra, [MCP_META_KEY]: meta }
				};
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
						mixinOptions!
					);
				}
			},

			/**
			 * Track a request of a session until its response is closed (for SSE streams,
			 * until the client disconnects), so busy sessions are not closed as idle.
			 */
			trackMcpRequest(sessionId: string, res) {
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
				const now = Date.now();
				for (const [sessionId, session] of this.mcpSessions as Map<string, McpSession>) {
					if (session.openStreams > 0) continue;
					if (now - session.lastActivity < (mixinOptions!.sessionTimeout as number))
						continue;

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

			if (mixinOptions!.refreshDebounceTime !== false) {
				this.debouncedRefreshMcpTools = _.debounce(
					() => this.refreshMcpTools(),
					mixinOptions!.refreshDebounceTime
				);
			}

			const route = _.defaultsDeep(mixinOptions?.routeOptions, {
				aliases: {
					async "POST /"(req, res) {
						this.logger.debug("Received MCP POST request");
						if (await this.rejectInvalidMcpHeaders(req, res)) return;
						if (mixinOptions!.stateless)
							return this.handleStatelessMcpRequest(req, res);
						try {
							// Check for existing session ID
							const sessionId = req.headers["mcp-session-id"] as string | undefined;
							let transport: StreamableHTTPServerTransport;

							if (sessionId && this.transports.has(sessionId)) {
								// Reuse existing transport
								transport = this.transports.get(sessionId)!;
								this.trackMcpRequest(sessionId, res);
							} else {
								const session: McpSession = createServer(this.broker);
								const { server } = session.server;

								// New initialization request (no session ID or unknown session ID)
								const eventStore = new BoundedEventStore(
									mixinOptions!.maxStoredEvents!
								);
								transport = new StreamableHTTPServerTransport({
									sessionIdGenerator: () => randomUUID(),
									eventStore, // Enable resumability
									onsessioninitialized: (sessionId: string) => {
										// Store the transport by session ID when session is initialized
										// This avoids race conditions where requests might come in before the session is stored
										this.logger.info(
											`Session initialized with ID: ${sessionId}`
										);
										this.transports.set(sessionId, transport);
										this.mcpSessions.set(sessionId, session);
									}
								});

								// Set up onclose handler to clean up transport when closed
								session.transport = transport;

								server.onclose = async () => {
									const sid = transport.sessionId;
									if (sid) this.mcpSessions.delete(sid);
									if (sid && this.transports.has(sid)) {
										this.logger.info(
											`Transport closed for session ${sid}, removing from transports map`
										);
										this.transports.delete(sid);
									}
								};

								// Connect the transport to the MCP server BEFORE handling the request
								// so responses can flow back through the same transport
								await server.connect(transport);

								this.attachMcpMeta(req);
								await transport.handleRequest(req, res);

								return; // Already handled
							}

							// Handle the request with existing transport - no need to reconnect
							// The existing transport is already connected to the server
							this.attachMcpMeta(req);
							await transport.handleRequest(req, res);
						} catch (error) {
							this.logger.error("Error handling MCP request:", error);
							if (!res.headersSent) {
								res.statusCode = 500;
								await this.sendResponse(
									req,
									res,
									{
										jsonrpc: "2.0",
										error: {
											code: -32603,
											message: "Internal server error"
										},
										id: req?.body?.id
									},
									{}
								);
								return;
							}
						}
					},

					async "GET /"(req, res) {
						this.logger.debug("Received MCP GET request");
						if (await this.rejectInvalidMcpHeaders(req, res)) return;
						if (mixinOptions!.stateless) return this.rejectStatelessMcpMethod(req, res);
						const sessionId = req.headers["mcp-session-id"] as string | undefined;
						if (!sessionId || !this.transports.has(sessionId)) {
							res.statusCode = 400;
							await this.sendResponse(
								req,
								res,
								{
									jsonrpc: "2.0",
									error: {
										code: -32000,
										message: "Bad Request: No valid session ID provided"
									},
									id: req?.body?.id
								},
								{}
							);
							return;
						}

						// Check for Last-Event-ID header for resumability
						const lastEventId = req.headers["last-event-id"] as string | undefined;
						if (lastEventId) {
							this.logger.info(
								`Client reconnecting with Last-Event-ID: ${lastEventId}`
							);
						} else {
							this.logger.info(
								`Establishing new MCP SSE stream for session ${sessionId}`
							);
						}

						const transport = this.transports.get(sessionId);
						this.trackMcpRequest(sessionId, res);
						this.attachMcpMeta(req);
						await transport!.handleRequest(req, res);
					},

					async "DELETE /"(req, res) {
						if (await this.rejectInvalidMcpHeaders(req, res)) return;
						if (mixinOptions!.stateless) return this.rejectStatelessMcpMethod(req, res);
						const sessionId = req.headers["mcp-session-id"] as string | undefined;
						if (!sessionId || !this.transports.has(sessionId)) {
							res.statusCode = 400;
							await this.sendResponse(
								req,
								res,
								{
									jsonrpc: "2.0",
									error: {
										code: -32000,
										message: "Bad Request: No valid session ID provided"
									},
									id: req?.body?.id
								},
								{}
							);
							return;
						}

						this.logger.info(
							`Received session termination request for session ${sessionId}`
						);

						try {
							const transport = this.transports.get(sessionId);
							this.attachMcpMeta(req);
							await transport!.handleRequest(req, res);
						} catch (error) {
							this.logger.error("Error handling session termination:", error);
							if (!res.headersSent) {
								res.statusCode = 500;
								await this.sendResponse(
									req,
									res,
									{
										jsonrpc: "2.0",
										error: {
											code: -32603,
											message: "Error handling session termination"
										},
										id: req?.body?.id
									},
									{}
								);
								return;
							}
						}
					}
				},

				mappingPolicy: "restrict",

				cors: {
					// Without `allowedOrigins` any origin is accepted (e.g. the MCP Inspector)
					origin: mixinOptions!.allowedOrigins?.length
						? mixinOptions!.allowedOrigins
						: "*",
					methods: ["GET", "POST", "DELETE", "OPTIONS"],
					allowedHeaders: [
						"Content-Type",
						"mcp-session-id",
						"mcp-protocol-version",
						"Last-Event-ID"
					],
					exposedHeaders: ["mcp-session-id"]
				},

				bodyParsers: {
					json: false // The mcp server will read the raw body itself
				}
			});

			// Add route
			this.settings.routes.unshift(route);
		},

		started() {
			if (mixinOptions!.sessionTimeout !== false) {
				const timeout = mixinOptions!.sessionTimeout!;
				this.mcpIdleTimer = setInterval(
					() => this.closeIdleMcpSessions(),
					Math.min(timeout, 60 * 1000)
				);
				this.mcpIdleTimer.unref?.();
			}
		},

		async stopped() {
			this.logger.info("Shutting down server...");

			clearInterval(this.mcpIdleTimer);

			this.debouncedRefreshMcpTools?.cancel();

			// Close all active transports to properly clean up resources
			for (const [sessionId, transport] of this.transports) {
				try {
					this.logger.info(`Closing transport for session ${sessionId}`);
					await transport.close();
					this.transports.delete(sessionId);
				} catch (error) {
					this.logger.error(`Error closing transport for session ${sessionId}:`, error);
				}
			}

			this.logger.info("Server shutdown complete");
		}
	};
}

/*
 * @moleculer/mcp-server
 * Copyright (c) 2025 MoleculerJS (https://github.com/moleculerjs/mcp-server)
 * MIT Licensed
 */

"use strict";

import pkg from "../package.json";

import { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { InMemoryEventStore } from "@modelcontextprotocol/sdk/examples/shared/inMemoryEventStore.js";
import { ActionSchema, ServiceBroker, ServiceSchema, Utils } from "moleculer";
import type { ApiRouteSchema, ApiSettingsSchema } from "moleculer-web";
import _ from "lodash";
import { randomUUID } from "node:crypto";
import { McpServerSettings } from "./index.type.ts";
import { ZodParser } from "./validators/validators.types.ts";
import getParser from "./validators/index.ts";
import { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { ZodRawShape } from "zod";

export interface McpServerMixinOptions {
	routeOptions?: ApiRouteSchema;
}

export function McpServerMixin(
	mixinOptions?: McpServerMixinOptions
): Partial<ServiceSchema<ApiSettingsSchema>> {
	mixinOptions = _.defaultsDeep(mixinOptions, {
		routeOptions: {
			path: "/mcp"
		}
	});

	function createServer(broker: ServiceBroker): McpServer {
		const logger = broker.getLogger("MCP");

		logger.info("Creating MCP server...");

		const server = new McpServer(
			{
				name: "Moleculer MCP Server",
				version: pkg.version
			},
			{
				capabilities: {
					// resources: {},
					tools: { listChanged: true }
					// prompts: {}
				}
			}
		);

		return server;
	}

	const mcp: McpServerSettings = {
		whitelist: [],
		tools: [],
		regenerationDebounceTime: 1000,
		cache: {
			tools: []
		}
	};

	return {
		settings: {
			mcp,
			server: null,

			$secureSettings: ["mcp.server", "mcp.cache"]
		},

		methods: {
			/**
			 * Check whatever a target action can be called using a MCP tool.
			 * Match the action using the whitelist, exclude the action using a blacklist
			 * @param {ActionSchema} action Action name
			 * @returns {boolean} True if the action can be a tool, false otherwise
			 */
			isTool(action: ActionSchema): boolean {
				// Whitelist check
				let inWhitelist = false;
				for (const mask of (this.settings.mcp as McpServerSettings).whitelist ?? []) {
					if (mask instanceof RegExp) {
						if (mask.test(action.name)) {
							inWhitelist = true;
							break;
						}
					} else if (typeof mask === "string") {
						if (Utils.match(action.name, mask)) {
							inWhitelist = true;
							break;
						}
					}
				}

				if (!inWhitelist) return false;

				// Blacklist check
				let inBlacklist = false;
				for (const mask of (this.settings.mcp as McpServerSettings).blacklist ?? []) {
					if (mask instanceof RegExp) {
						if (mask.test(action.name)) {
							inBlacklist = true;
							break;
						}
					} else if (typeof mask === "string") {
						if (Utils.match(action.name, mask)) {
							inBlacklist = true;
							break;
						}
					}
				}

				if (inBlacklist) return false;

				if (typeof action.visibility === "string" && action.visibility !== "published")
					return false;

				return true;
			},
			/**
			 * Normalize action name to MCP ready name:
			 * - Replace . with _
			 * - Replace uppercase letters with _ + lowercase value
			 * @param {string} action Action name
			 * @returns {string} Normalized action name
			 */
			normalizeMcpActionName(action: string): string {
				return action.replace(/\./g, "_").replace(/([A-Z])/g, m => "_" + m.toLowerCase());
			},
			/**
			 * Humanize action name to MCP ready title:
			 * - Replace . with " "
			 * - Replace uppercase letters with " " + lowercase value
			 * - Capitalize first letter of the string if applicable
			 * @param {string} action Action name
			 * @returns {string} Humanized action name
			 */
			humanizeMcpActionName(action: string): string {
				return action
					.replace(/\./g, " ")
					.replace(/([A-Z])/g, m => " " + m.toLocaleLowerCase())
					.replace(/^([a-z])/, m => m.toLocaleUpperCase());
			},
			/**
			 * Regenerate the tools based on the available actions in the registry
			 */
			_regenerateMcpHandlers() {
				const actions = (this.broker as ServiceBroker).registry.getActionList({
					onlyAvailable: true
				});

				// Remove old tools
				for (const tool of this.settings.mcp.cache.tools as Array<RegisteredTool>) {
					tool.remove();
				}
				this.settings.mcp.cache.tools = [];

				// TODO Find a way to detect the validator used for each service's action
				const parser: ZodParser = getParser("FastestValidator");

				for (const action of actions) {
					if (this.isTool(action.action)) {
						const toolName: string = this.normalizeMcpActionName(action.name);
						const toolTitle: string =
							(action.action["metadata"]?.title as string) ??
							this.humanizeMcpActionName(action.name);
						const toolDescription: string =
							(action.action["metadata"]?.description as string) ?? toolTitle;

						const toolConfig: {
							title?: string;
							description?: string;
							inputSchema?: ZodRawShape;
							outputSchema?: ZodRawShape;
							annotations?: ToolAnnotations;
							_meta?: Record<string, unknown>;
						} = {
							title: toolTitle,
							description: toolDescription,
							inputSchema: parser.parse(action.action.params ?? {})
						};

						const tool = (this.settings.mcp.server as McpServer).registerTool(
							toolName,
							toolConfig,
							async params => {
								this.logger.debug("Calling action: " + action.name);

								// Params handling for $$root parameters
								let actionParams = params;
								if (action.action.params.$$root === true) {
									actionParams = params.$$root;
								}

								const result = await (this.broker as ServiceBroker).call(
									action.name,
									actionParams
								);

								return {
									content: [
										{
											type: "text",
											text: JSON.stringify(result, null, 2)
										}
									]
								};
							}
						);

						this.logger.info(`[MCP tool] ${toolConfig.title} => ${action.name}`);

						this.settings.mcp.cache.tools.push(tool);
					}
				}
			}
		},
		events: {
			"$services.changed"() {
				this.regenerateMcpHandlers();
			}
		},
		created() {
			this.transports = new Map<string, StreamableHTTPServerTransport>();
			this.settings.mcp.server = createServer(this.broker);

			const route = _.defaultsDeep(mixinOptions?.routeOptions, {
				aliases: {
					async "POST /"(req, res) {
						this.logger.info("Received MCP POST request");
						try {
							// Check for existing session ID
							const sessionId = req.headers["mcp-session-id"] as string | undefined;
							let transport: StreamableHTTPServerTransport;

							if (sessionId && this.transports.has(sessionId)) {
								// Reuse existing transport
								transport = this.transports.get(sessionId)!;
							} else if (!sessionId) {
								const { server } = this.settings.mcp.server;

								// New initialization request
								const eventStore = new InMemoryEventStore();
								transport = new StreamableHTTPServerTransport({
									sessionIdGenerator: () => randomUUID(),
									eventStore, // Enable reusability
									onsessioninitialized: (sessionId: string) => {
										// Store the transport by session ID when session is initialized
										// This avoids race conditions where requests might come in before the session is stored
										this.logger.info(
											`Session initialized with ID: ${sessionId}`
										);
										this.transports.set(sessionId, transport);
									}
								});

								// Set up onclose handler to clean up transport when closed
								server.onclose = async () => {
									const sid = transport.sessionId;
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

								await transport.handleRequest(req, res);

								return; // Already handled
							} else {
								// Invalid request - no session ID or not initialization request
								this.logger.warn("Invalid MCP request:", req.headers);
								res.statusCode = 400;
								await this.sendResponse(req, res, 400, {
									jsonrpc: "2.0",
									error: {
										code: -32000,
										message: "Bad Request: No valid session ID provided"
									},
									id: req?.body?.id
								});
								return;
							}

							// Handle the request with existing transport - no need to reconnect
							// The existing transport is already connected to the server
							await transport.handleRequest(req, res);
						} catch (error) {
							this.logger.error("Error handling MCP request:", error);
							if (!res.headersSent) {
								res.statusCode = 500;
								await this.sendResponse(req, res, {
									jsonrpc: "2.0",
									error: {
										code: -32603,
										message: "Internal server error"
									},
									id: req?.body?.id
								});
								return;
							}
						}
					},

					async "GET /"(req, res) {
						this.logger.info("Received MCP GET request");
						const sessionId = req.headers["mcp-session-id"] as string | undefined;
						if (!sessionId || !this.transports.has(sessionId)) {
							res.statusCode = 400;
							await this.sendResponse(req, res, {
								jsonrpc: "2.0",
								error: {
									code: -32000,
									message: "Bad Request: No valid session ID provided"
								},
								id: req?.body?.id
							});
							return;
						}

						// Check for Last-Event-ID header for reusability
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
						await transport!.handleRequest(req, res);
					},

					async "DELETE /"(req, res) {
						const sessionId = req.headers["mcp-session-id"] as string | undefined;
						if (!sessionId || !this.transports.has(sessionId)) {
							res.statusCode = 400;
							await this.sendResponse(req, res, {
								jsonrpc: "2.0",
								error: {
									code: -32000,
									message: "Bad Request: No valid session ID provided"
								},
								id: req?.body?.id
							});
							return;
						}

						this.logger.info(
							`Received session termination request for session ${sessionId}`
						);

						try {
							const transport = this.transports.get(sessionId);
							await transport!.handleRequest(req, res);
						} catch (error) {
							this.logger.error("Error handling session termination:", error);
							if (!res.headersSent) {
								res.statusCode = 500;
								await this.sendResponse(req, res, {
									jsonrpc: "2.0",
									error: {
										code: -32603,
										message: "Error handling session termination"
									},
									id: req?.body?.id
								});
								return;
							}
						}
					}
				},

				mappingPolicy: "restrict",

				bodyParsers: {
					json: false // The mcp server will read the raw body itself
				}
			});

			// Add route
			this.settings.routes.unshift(route);

			// Create debounced version of the regenerate method
			this.regenerateMcpHandlers = _.debounce(
				this._regenerateMcpHandlers,
				this.settings.mcp.regenerationDebounceTime
			);
		},

		started() {
			this.regenerateMcpHandlers();
		},

		async stopped() {
			this.logger.info("Shutting down server...");

			// Close all active transports to properly clean up resources
			for (const sessionId in this.transports) {
				try {
					this.logger.info(`Closing transport for session ${sessionId}`);
					await this.transports.get(sessionId)!.close();
					this.transports.delete(sessionId);
				} catch (error) {
					this.logger.error(`Error closing transport for session ${sessionId}:`, error);
				}
			}

			this.logger.info("Server shutdown complete");
		}
	};
}

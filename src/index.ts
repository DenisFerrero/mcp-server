/*
 * @moleculer/mcp-server
 * Copyright (c) 2025 MoleculerJS (https://github.com/moleculerjs/mcp-server)
 * MIT Licensed
 */

"use strict";

import pkg from "../package.json" with { type: "json" };

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { InMemoryEventStore } from "@modelcontextprotocol/sdk/examples/shared/inMemoryEventStore.js";
import { ServiceSchema } from "moleculer";
import type { ApiRouteSchema, ApiSettingsSchema } from "moleculer-web";
import _ from "lodash";
import { randomUUID } from "node:crypto";

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

	function createServer(broker) {
		const server = new McpServer(
			{
				name: "Moleculer MCP Server",
				version: pkg.version
			},
			{
				capabilities: {
					resources: {},
					tools: {},
					prompts: {}
				}
			}
		);

		server.resource(
			"actions",
			"moleculer://actions",
			{
				description: "Get all Moleculer actions",
				title: "Moleculer Actions",
				mimeType: "application/json"
			},
			async uri => {
				// console.log("Fetching Moleculer actions...", uri);
				return {
					contents: [
						{
							uri: uri.href,
							mimeType: "application/json",
							text: JSON.stringify([{ name: "greeter.hello" }])
						}
					]
				};
			}
		);

		server.resource(
			"action-details",
			new ResourceTemplate("moleculer://actions/{actionName}", {
				list: undefined
			}),
			{
				description: "Get details of a specific Moleculer action",
				title: "Moleculer Action Details",
				mimeType: "application/json"
			},
			async (uri, params: { actionName: string }) => {
				// console.log("Fetching Moleculer action details...", uri);
				return {
					contents: [
						{
							uri: uri.href,
							mimeType: "application/json",
							text: JSON.stringify({
								name: params.actionName,
								params: { name: { type: "string" } }
							})
						}
					]
				};
			}
		);

		server.tool(
			"moleculer_list_actions",
			"List all Moleculer actions",
			{
				title: "List Moleculer actions",
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false
			},
			async params => {
				// console.log("Listing Moleculer actions...", params);
				return {
					content: []
				};
			}
		);

		return server;
	}

	return {
		created() {
			this.transports = new Map<string, StreamableHTTPServerTransport>();

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
								const { server } = createServer(this.broker);

								// New initialization request
								const eventStore = new InMemoryEventStore();
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
								res.status(400).json({
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
								res.status(500).json({
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
							res.status(400).json({
								jsonrpc: "2.0",
								error: {
									code: -32000,
									message: "Bad Request: No valid session ID provided"
								},
								id: req?.body?.id
							});
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
								`Establishing new SSE stream for session ${sessionId}`
							);
						}

						const transport = this.transports.get(sessionId);
						await transport!.handleRequest(req, res);
					},

					async "DELETE /"(req, res) {
						const sessionId = req.headers["mcp-session-id"] as string | undefined;
						if (!sessionId || !this.transports.has(sessionId)) {
							res.status(400).json({
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
								res.status(500).json({
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
					json: true
				}
			});

			// Add route
			this.settings.routes.unshift(route);
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

/*
async function main() {
	const transport = new StdioServerTransport();
	// https://github.com/modelcontextprotocol/servers/blob/main/src/everything/streamableHttp.ts
	//const transporter = new StreamableHTTPServerTransport({})
	await server.connect(transport);
	// console.log("MCP Server started.");
}

main().catch(err => {
	// this.logger.error("Error starting MCP Server:", err);
	process.exit(1);
});
*/

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceBroker } from "moleculer";
import type { McpCustomTool } from "./types.js";
import { toErrorResult, toTextResult } from "./utils.js";

/**
 * Register the manually declared tools.
 * Tools whose name is already registered on the server are skipped with a warning.
 */
export function registerCustomTools(
	server: McpServer,
	broker: ServiceBroker,
	tools: McpCustomTool[]
): void {
	const logger = broker.getLogger("MCP-CustomTools");

	for (const def of tools) {
		const handler = async (params: Record<string, unknown>) => {
			try {
				let result: unknown;
				if (typeof def.handler === "function") {
					result = await def.handler(params, broker);
				} else if (typeof def.handler === "string") {
					result = await broker.call(def.handler, params);
				} else {
					throw new Error(`Invalid handler for tool '${def.name}'`);
				}

				const response = toTextResult(result);
				// With an output schema the SDK requires (and validates) the structured content
				if (def.output) {
					response.structuredContent = result as Record<string, unknown>;
				}
				return response;
			} catch (err: unknown) {
				logger.error(`Error calling custom tool ${def.name}:`, err);
				return toErrorResult(err);
			}
		};

		try {
			server.registerTool(
				def.name,
				{
					title: def.title,
					description: def.description,
					inputSchema: def.input,
					outputSchema: def.output,
					annotations: def.annotations
				} as any, // Zod 3.25 deep type inference issue with MCP SDK registerTool
				handler
			);
		} catch (err) {
			logger.warn(`Skipping custom tool '${def.name}':`, err);
			continue;
		}

		logger.info(
			`Registered custom tool: ${def.name} → ${typeof def.handler === "string" ? def.handler : "<function>"}`
		);
	}
}

import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { ZodRawShape } from "zod";

/** Configuration of a MCP tool */
export interface ToolConfig {
	title?: string;
	description?: string;
	inputSchema?: ZodRawShape;
	outputSchema?: ZodRawShape;
	annotations?: ToolAnnotations;
}

/** Handler of a MCP tool: validated params and the SDK request `extra` */
export type ToolHandler = (
	params: Record<string, unknown>,
	extra: { authInfo?: AuthInfo }
) => CallToolResult | Promise<CallToolResult>;

/**
 * Register a tool on the MCP server.
 * Wraps `McpServer.registerTool`, whose typings hit the Zod 3.25 deep type inference
 * limit ("Type instantiation is excessively deep") with dynamic schemas.
 */
export function registerTool(
	server: McpServer,
	name: string,
	config: ToolConfig,
	handler: ToolHandler
): RegisteredTool {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return server.registerTool(name, config as any, handler as any);
}

/** Key of `AuthInfo.extra` where the mixin stores the meta forwarded from the HTTP request */
export const MCP_META_KEY = "moleculerMeta";

/**
 * Get the meta forwarded from the HTTP request (e.g. the authenticated `user`) from the
 * `extra` argument of a MCP tool handler.
 */
export function getForwardedMeta(extra?: { authInfo?: AuthInfo }): Record<string, unknown> {
	return (extra?.authInfo?.extra?.[MCP_META_KEY] as Record<string, unknown>) ?? {};
}

/**
 * Wrap a value into a successful MCP tool result (JSON text content).
 */
export function toTextResult(result: unknown): CallToolResult {
	return {
		content: [
			{
				type: "text",
				text: result === undefined ? "null" : JSON.stringify(result, null, 2)
			}
		]
	};
}

/**
 * Wrap an error into an MCP tool error result (`isError: true`), so the LLM can see
 * what went wrong. Stack traces are not included to avoid leaking server internals.
 */
export function toErrorResult(err: unknown): CallToolResult {
	let errorInfo: Record<string, unknown>;
	if (err instanceof Error) {
		const { code, type, data } = err as Error & {
			code?: unknown;
			type?: unknown;
			data?: unknown;
		};
		errorInfo = { name: err.name, message: err.message, code, type, data };
	} else {
		errorInfo = { name: "UnknownError", message: String(err) };
	}

	return {
		isError: true,
		content: [
			{
				type: "text",
				text: `Error ${errorInfo.name}: ${errorInfo.message}\n${JSON.stringify(errorInfo, null, 2)}`
			}
		]
	};
}

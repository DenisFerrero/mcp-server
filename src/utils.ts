import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

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

/**
 * Simple MCP Client for testing
 */

import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export interface TestMcpClient {
	client: Client;
	transport: StreamableHTTPClientTransport;
	sessionId: string;
}

export async function createMcpClient(
	serverUrl: string,
	headers?: Record<string, string>
): Promise<TestMcpClient> {
	const client = new Client(
		{
			name: "test-client",
			version: "1.0.0"
		},
		{
			capabilities: {
				tools: {}
			}
		}
	);

	const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {
		requestInit: headers ? { headers } : undefined
	});
	await client.connect(transport);

	// Get session ID from the transport
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const sessionId = (transport as any).sessionId;

	return {
		client,
		transport,
		sessionId: sessionId || "test-session"
	};
}

/**
 * Close the client. By default the session is terminated with a DELETE request, as a well
 * behaved client does; otherwise the SDK client reconnects its SSE stream when the server
 * closes it and the keep-alive connection delays the server shutdown.
 * Use `{ terminate: false }` to simulate a client gone away.
 */
export async function closeMcpClient(
	mcpClient: TestMcpClient,
	{ terminate = true }: { terminate?: boolean } = {}
): Promise<void> {
	try {
		if (terminate) await mcpClient.transport.terminateSession();
		await mcpClient.client.close();
		await mcpClient.transport.close();
	} catch {
		// Ignore cleanup errors
	}
}

export async function listTools(mcpClient: TestMcpClient): Promise<Tool[]> {
	const result = await mcpClient.client.listTools();
	return result.tools || [];
}

export async function callTool(
	mcpClient: TestMcpClient,
	toolName: string,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	arguments_: Record<string, any>
): Promise<CallToolResult> {
	const result = await mcpClient.client.callTool({
		name: toolName,
		arguments: arguments_
	});
	return result;
}

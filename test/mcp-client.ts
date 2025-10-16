/**
 * Simple MCP Client for testing
 */

import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface TestMcpClient {
	client: Client;
	transport: StreamableHTTPClientTransport;
	sessionId: string;
}

export async function createMcpClient(serverUrl: string): Promise<TestMcpClient> {
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

	const transport = new StreamableHTTPClientTransport(new URL(serverUrl));
	await client.connect(transport);

	// Get session ID from the transport
	const sessionId = transport.sessionId;

	return {
		client,
		transport,
		sessionId: sessionId || "test-session"
	};
}

export async function closeMcpClient(mcpClient: TestMcpClient): Promise<void> {
	try {
		await mcpClient.client.close();
		await mcpClient.transport.close();
	} catch {
		// Ignore cleanup errors
	}
}

export async function listTools(mcpClient: TestMcpClient): Promise<unknown[]> {
	const result = await mcpClient.client.listTools();
	return result.tools || [];
}

export async function callTool(
	mcpClient: TestMcpClient,
	toolName: string,
	arguments_: Record<string, unknown>
): Promise<unknown> {
	const result = await mcpClient.client.callTool({
		name: toolName,
		arguments: arguments_
	});
	return result;
}

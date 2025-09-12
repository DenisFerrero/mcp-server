import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const mcp = new Client(
	{
		name: "test-client",
		version: "0.1.0"
	},
	{
		capabilities: {
			sampling: {}
		}
	}
);

const transport = new StdioClientTransport({
	command: "npm run start"
});

async function main() {
	await mcp.connect(transport);
	const { tools } = await mcp.listTools();
	console.log("Tools:", tools);

	const { resources } = await mcp.listResources();
	console.log("Resources:", resources);

	const res = await mcp.callTool({
		name: "moleculer_list_actions",
		parameters: {}
	});
	console.log("moleculer_list_actions result:", await res);

	await mcp.close();
}

main().catch(err => {
	console.error("Error in MCP client:", err);
	process.exit(1);
});

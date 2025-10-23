import { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { ServiceBroker, ServiceSchema } from "moleculer";
import { ApiRouteSchema, ApiSettingsSchema } from "moleculer-web";
import z from "zod";

// Convert a moleculer action into a tool
export interface McpServerSetting_CustomTool {
	// Name of the tool
	name: string;
	// Brief title
	title?: string;
	// Deep description
	description: string;
	// Action or function to call
	handler: string | ((broker: ServiceBroker, params: object) => object);
	// Parameters validation, if none compile the action parameters
	input?: Record<string, z.ZodTypeAny>;
	// Output format
	output?: z.ZodRawShape;
	// Annotations
	annotations: ToolAnnotations;
}

export interface McpServerSettings {
	/**
	 * Whitelist of the allowed actions to be included as tools in MCP server
	 */
	whitelist?: Array<string | RegExp>;
	/**
	 * Blacklist of not allowed actions to be included as tools in MCP server
	 */
	blacklist?: Array<string | RegExp>;

	tools?: Array<McpServerSetting_CustomTool>;
	/**
	 * Regeneration is debounced for X time to prevent continuous update to the MCP server
	 */
	regenerationDebounceTime: number;

	cache: {
		tools: Array<RegisteredTool>;
	};
}

export interface McpServerMixinOptions {
	routeOptions?: ApiRouteSchema;
}

export type McpServerMixinSchema = Partial<
	ServiceSchema<ApiSettingsSchema> & {
		merged?: (data: McpServerMixinSchema) => void;
	}
>;

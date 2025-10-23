import { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ServiceSchema } from "moleculer";
import { ApiRouteSchema, ApiSettingsSchema } from "moleculer-web";
import z from "zod";

// Convert a moleculer action into a tool
export interface McpServerSetting_ActionTool {
	// Name of the tool
	name: string;
	// Brief title
	title: string;
	// Deep description, if not provided use the one declared in the action (if any)
	description?: string;
	// Action to call
	action: string;
	// Parameters validation, if none compile the action parameters
	input?: Record<string, z.ZodTypeAny>;
	// Output format
	output?: z.ZodTypeAny;
}

// Declare a custom function as handler for a tool
export interface McpServerSetting_CustomTool {
	// Name of the tool
	name: string;
	// Brief title
	title: string;
	// Deep description
	description: string;
	// Parameters validation
	input: Record<string, z.ZodTypeAny>;
	// Output format
	output?: z.ZodTypeAny;
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

	tools?: Array<McpServerSetting_ActionTool | McpServerSetting_CustomTool>;
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

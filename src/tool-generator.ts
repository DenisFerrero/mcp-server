import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import Moleculer from "moleculer";
import type { ActionSchema, ServiceBroker } from "moleculer";
import type { McpServerMixinOptions } from "./types.js";
import { convertActionParamsToZod } from "./schema-converter.js";
import { getForwardedMeta, toErrorResult, toTextResult } from "./utils.js";
import "./moleculer-types.js";

const { match } = Moleculer.Utils;

interface ActionEntry {
	name: string;
	action?: ActionSchema;
}

function getRestMethod(rest: unknown): string | null {
	if (!rest) return null;
	if (typeof rest === "string") {
		const parts = rest.trim().split(/\s+/);
		if (parts.length >= 2) return parts[0].toUpperCase();
		return null;
	}
	if (
		typeof rest === "object" &&
		!Array.isArray(rest) &&
		(rest as Record<string, unknown>).method
	) {
		return ((rest as Record<string, unknown>).method as string).toUpperCase();
	}
	if (Array.isArray(rest) && rest.length > 0) {
		return getRestMethod(rest[0]);
	}
	return null;
}

function detectAnnotations(restMethod: string | null): Record<string, boolean> {
	const annotations: Record<string, boolean> = { openWorldHint: false };

	if (restMethod === "GET") {
		annotations.readOnlyHint = true;
		annotations.destructiveHint = false;
		annotations.idempotentHint = true;
	} else if (restMethod === "DELETE") {
		annotations.readOnlyHint = false;
		annotations.destructiveHint = true;
		annotations.idempotentHint = true;
	} else if (restMethod === "PUT") {
		annotations.readOnlyHint = false;
		annotations.destructiveHint = false;
		annotations.idempotentHint = true;
	} else {
		annotations.readOnlyHint = false;
		annotations.destructiveHint = false;
		annotations.idempotentHint = false;
	}

	return annotations;
}

/**
 * Check whether an action can be called through MCP, applying the same rules to the
 * auto-discovered tools and to the generic `moleculer_call_action` tool.
 */
export function isActionExposed(actionEntry: ActionEntry, options: McpServerMixinOptions): boolean {
	const actionName = actionEntry.name;

	// Internal actions (e.g. `$node.*`)
	if (actionName.startsWith("$")) return false;
	const serviceName = actionName.split(".").slice(0, -1).join(".");
	const actionDef = actionEntry.action;

	// Like the API gateway, only "published" actions (the default visibility) are exposed
	if (actionDef?.visibility && actionDef.visibility !== "published") return false;

	// Check mcp: false
	if (actionDef?.mcp === false) return false;
	if (typeof actionDef?.mcp === "object" && actionDef.mcp.enabled === false) return false;

	// Check services filter
	if (options.services) {
		if (typeof options.services === "string") {
			if (!match(serviceName, options.services)) return false;
		} else if (Array.isArray(options.services)) {
			if (!options.services.some(s => match(serviceName, s))) return false;
		}
	}

	// Check excludeActions
	if (options.excludeActions) {
		for (const pattern of options.excludeActions) {
			if (match(actionName, pattern)) return false;
		}
	}

	return true;
}

/**
 * Register a MCP tool for each discovered action.
 * Tools whose name is already registered on the server are skipped with a warning.
 * @returns The registered tools, so they can be removed when the registry changes.
 */
export function registerAutoDiscoveryTools(
	server: McpServer,
	broker: ServiceBroker,
	options: McpServerMixinOptions
): RegisteredTool[] {
	const logger = broker.getLogger("MCP-AutoDiscovery");
	const registered: RegisteredTool[] = [];
	const actions: ActionEntry[] = broker.registry.getActionList({
		skipInternal: true,
		withEndpoints: false
	});

	const prefix = options.toolNamePrefix || "";

	for (const actionEntry of actions) {
		if (!isActionExposed(actionEntry, options)) continue;

		const actionName = actionEntry.name;
		const actionDef = actionEntry.action || {};
		const mcpMeta = typeof actionDef.mcp === "object" ? actionDef.mcp : {};

		// Tool name
		const toolName = mcpMeta.name || prefix + actionName.replace(/\./g, "_");

		// Description
		const description =
			mcpMeta.description ||
			actionDef.description ||
			`Call the ${actionName} Moleculer action`;

		// Input schema
		const inputSchema = convertActionParamsToZod(actionDef.params);

		// Annotations: merge auto-detected with explicit overrides
		const detectedAnnotations = detectAnnotations(getRestMethod(actionDef.rest));
		const annotations = {
			...detectedAnnotations,
			...(mcpMeta.annotations || {})
		};

		// `$$root` params are wrapped in an object by the converter, unwrap them before the call
		const isRootParams = inputSchema.$$root !== undefined;

		try {
			const tool = server.registerTool(
				toolName,
				{
					title: mcpMeta.title || `Call ${actionName}`,
					description,
					inputSchema,
					annotations
				} as any, // Zod 3.25 deep type inference issue with MCP SDK registerTool
				async (params: Record<string, unknown>, extra) => {
					try {
						const result = await broker.call(
							actionName,
							isRootParams ? params.$$root : params,
							{ meta: getForwardedMeta(extra) }
						);
						return toTextResult(result);
					} catch (err: unknown) {
						logger.error(`Error calling action ${actionName}:`, err);
						return toErrorResult(err);
					}
				}
			);
			registered.push(tool);
		} catch (err) {
			// e.g. two actions with the same `mcp.name`, or a name clashing with a broker tool
			logger.warn(`Skipping tool '${toolName}' for action ${actionName}:`, err);
			continue;
		}

		logger.info(`Registered tool: ${toolName} → ${actionName}`);
	}

	return registered;
}

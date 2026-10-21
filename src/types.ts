import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { ServiceBroker } from "moleculer";
import type { ApiRouteSchema } from "moleculer-web";
import type { ZodRawShape } from "zod";

/** A tool declared manually instead of being generated from an action */
export interface McpCustomTool {
	/** Tool name (snake_case recommended) */
	name: string;

	/** Brief human readable title */
	title?: string;

	/** Detailed description, used by the LLM to decide when to call the tool */
	description: string;

	/** Input parameters as a Zod raw shape, e.g. `{ a: z.number() }` */
	input?: ZodRawShape;

	/** Output structure as a Zod raw shape. When set, the result is also sent as `structuredContent` */
	output?: ZodRawShape;

	/** Hints for the client about the tool behavior */
	annotations?: ToolAnnotations;

	/**
	 * Action name to call with the tool params, or a function returning the result.
	 * `meta` contains the fields forwarded from the HTTP request (see `forwardMeta`).
	 */
	handler:
		| string
		| ((
				params: Record<string, unknown>,
				broker: ServiceBroker,
				meta: Record<string, unknown>
		  ) => unknown);
}

export interface McpServerMixinOptions {
	routeOptions?: ApiRouteSchema;

	/** Whitelist of service names (array) or glob pattern (string) */
	services?: string | string[];

	/** Action name patterns to exclude from auto-discovery */
	excludeActions?: string[];

	/** Whether to expose broker tools (list_nodes, list_services, etc.). Default: true */
	exposeBrokerTools?: boolean;

	/** Prefix for auto-generated tool names. Default: "" */
	toolNamePrefix?: string;

	/** Manually declared tools, registered in addition to the auto-discovered ones */
	tools?: McpCustomTool[];

	/**
	 * Debounce time (ms) for refreshing the auto-discovered tools of the open sessions
	 * when the services change. Set `false` to disable the refresh. Default: 1000
	 */
	refreshDebounceTime?: number | false;

	/**
	 * Fields of the HTTP request `ctx.meta` forwarded to the called actions and events, e.g. the
	 * `user` set by the moleculer-web `authenticate` method of the route. Default: ["user"]
	 */
	forwardMeta?: string[];
}

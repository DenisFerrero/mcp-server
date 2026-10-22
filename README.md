![Moleculer logo](http://moleculer.services/images/banner.png)

[![Integration & Unit Test](https://github.com/moleculerjs/mcp-server/actions/workflows/test.yml/badge.svg)](https://github.com/moleculerjs/mcp-server/actions/workflows/test.yml)
[![NPM version](https://badgen.net/npm/v/@moleculer/mcp-server)](https://www.npmjs.com/package/@moleculer/mcp-server)

# @moleculer/mcp-server
MCP server mixin for Moleculer API Gateway (moleculer-web).

Expose your Moleculer microservices to AI assistants (Claude, GPT, etc.) via the [Model Context Protocol](https://modelcontextprotocol.io/).

<video controls src="docs/Code_PIxZeLiRX3.mp4" title="Introduction to MCP Server"></video>

## Features

- **Auto-discovery** — Moleculer actions are automatically registered as MCP tools with proper schemas
- **Schema conversion** — fastest-validator params are converted to Zod schemas automatically
- **Tool annotations** — REST method-based auto-detection of `readOnlyHint`, `destructiveHint`, `idempotentHint`
- **Service filtering** — Whitelist services or exclude specific actions via glob patterns
- **MCP metadata** — Fine-grained control over tool name, title, description, and annotations per action
- **Custom tools** — Declare extra tools with Zod input/output schemas, backed by an action or a function
- **Dynamic refresh** — Open sessions get the tools of services started after they connected
- **Built-in broker tools** — List nodes, services, actions, events + generic call/emit tools
- **Streamable HTTP transport** — Standards-compliant MCP server with session management and resumability

## Install

```bash
npm i @moleculer/mcp-server moleculer-web
```

Both Moleculer 0.14 and 0.15 are supported, with the matching moleculer-web version:

| Moleculer | moleculer-web |
|---|---|
| `^0.15.0` | `^0.11.0` |
| `^0.14.12` | `^0.10.0` |

## Quick Start

Add the MCP server mixin to your API Gateway service:

```javascript
import ApiGateway from "moleculer-web";
import { McpServerMixin } from "@moleculer/mcp-server";

// api.service.js
export default {
  name: "api",
  mixins: [ApiGateway, McpServerMixin()],
  settings: {
    port: 3000
  }
};
```

That's it! The MCP server is available at `http://localhost:3000/mcp`. All your Moleculer actions are automatically exposed as MCP tools.

> `McpServerMixin` must come **after** `ApiGateway` in `mixins`: it adds its route to the gateway.

Before exposing the server outside localhost, read [Security](#security).

## Auto-discovery

When the broker starts, the mixin scans the service registry and registers each action as an individual MCP tool. This means AI assistants get dedicated, well-typed tools instead of a single generic "call action" tool.

**Example:** A `weather.forecast` action becomes a `weather_forecast` MCP tool with its own input schema and description.

```javascript
// weather.service.js
export default {
  name: "weather",
  actions: {
    forecast: {
      description: "Get weather forecast for a city",
      params: {
        city: "string",
        days: { type: "number", default: 3 }
      },
      rest: "GET /forecast",
      handler(ctx) {
        return { city: ctx.params.city, forecast: "sunny" };
      }
    }
  }
};
```

This automatically generates an MCP tool:
- **Name:** `weather_forecast`
- **Description:** `"Get weather forecast for a city"`
- **Input schema:** `{ city: z.string(), days: z.number().default(3) }`
- **Annotations:** `{ readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false }` (auto-detected from `GET`)

Tool names are derived from the action name by replacing dots with underscores: `service.action` → `service_action`.

Internal actions (prefixed with `$`) are always excluded, and so are actions whose `visibility` is not `"published"` (the default), as in the API gateway, and the actions of the gateway service itself (e.g. the moleculer-web `api.listAliases`).

Params declared with `$$root: true` are exposed as a single `$$root` argument and unwrapped before calling the action.

### Dynamic refresh

When services join or leave the cluster (`$services.changed`), the auto-discovered tools of every open MCP session are regenerated and the clients receive a `notifications/tools/list_changed` notification. The refresh is debounced by `refreshDebounceTime` (default `1000` ms); set it to `false` to keep the tools fixed for the whole session.

## Configuration Options

```javascript
McpServerMixin({
  // Route options for moleculer-web (default path: /mcp)
  routeOptions: {
    path: "/mcp"
  },

  // Whitelist specific services (array or glob pattern string)
  services: ["weather", "products"],
  // OR: services: "tools.*",

  // Exclude specific actions by glob pattern
  excludeActions: ["admin.*"],

  // Show/hide built-in broker tools (list_nodes, list_services, etc.)
  // Default: true
  exposeBrokerTools: true,

  // Show/hide the generic moleculer_call_action and moleculer_emit_event tools
  // Default: true
  exposeGenericTools: true,

  // Prefix for auto-generated tool names
  // Default: "" (no prefix)
  // Example: "mol_" → tool name: "mol_weather_forecast"
  toolNamePrefix: "",

  // Manually declared tools (see "Custom tools")
  tools: [],

  // Debounce time (ms) of the tools refresh when services change, false to disable
  // Default: 1000
  refreshDebounceTime: 1000,

  // ctx.meta fields of the HTTP request forwarded to actions and events (see "Security")
  // Default: ["user"]
  forwardMeta: ["user"],

  // Close sessions idle for this time (ms), false to disable
  // Default: 30 minutes
  sessionTimeout: 30 * 60 * 1000,

  // SSE events kept in memory per session for resumability
  // Default: 1000
  maxStoredEvents: 1000,

  // Run without sessions, for several gateway instances (see "Sessions")
  // Default: false
  stateless: false,

  // DNS rebinding protection: allowed Origin and Host headers
  // Default: any
  allowedOrigins: ["https://app.example.com"],
  allowedHosts: ["localhost", "mcp.example.com"],

  // Events that moleculer_emit_event can emit
  // Default: any
  allowedEvents: ["orders.*"],

  // Calling options of the actions called by the tools
  callOptions: { timeout: 10000 },

  // Truncate tool results longer than this (characters)
  // Default: no limit
  maxResultLength: 50000
})
```

| Option | Type | Default | Description |
|---|---|---|---|
| `routeOptions` | `Partial<ApiRouteSchema>` | `{ path: "/mcp" }` | moleculer-web route configuration. The MCP aliases, the CORS methods/headers needed by MCP and `bodyParsers.json: false` are always added |
| `services` | `string \| string[]` | `undefined` | Whitelist of service names or glob pattern |
| `excludeActions` | `string[]` | `undefined` | Action name patterns to exclude |
| `exposeBrokerTools` | `boolean` | `true` | Whether to register built-in broker tools |
| `exposeGenericTools` | `boolean` | `true` | Whether to register `moleculer_call_action` and `moleculer_emit_event` |
| `toolNamePrefix` | `string` | `""` | Prefix for auto-generated tool names |
| `tools` | `McpCustomTool[]` | `[]` | Manually declared tools |
| `refreshDebounceTime` | `number \| false` | `1000` | Debounce of the tools refresh on `$services.changed`, `false` to disable |
| `forwardMeta` | `string[]` | `["user"]` | `ctx.meta` fields of the HTTP request forwarded to the called actions and events |
| `sessionTimeout` | `number \| false` | `1800000` (30 min) | Close sessions with no requests and no open SSE stream for this time |
| `maxStoredEvents` | `number` | `1000` | SSE events kept in memory per session to resume interrupted streams |
| `stateless` | `boolean` | `false` | No sessions: a new MCP server per request (multi-instance gateways) |
| `allowedOrigins` | `string[]` | any | Allowed `Origin` headers (also used for the route CORS) |
| `allowedHosts` | `string[]` | any | Allowed `Host` headers, with or without port |
| `allowedEvents` | `string[]` | any | Event name patterns allowed in `moleculer_emit_event` |
| `callOptions` | `CallingOptions` | `{}` | Moleculer calling options (e.g. `timeout`) of the actions called by the tools |
| `maxResultLength` | `number` | no limit | Max characters of a tool result; longer results are truncated with a note |

If two tools end up with the same name (e.g. two actions with the same `mcp.name`), the first registered one wins and the others are skipped with a warning. Registration order: broker tools, custom tools, auto-discovered tools.

## Security

### Authentication

The MCP route is a regular moleculer-web route, so it can be protected with the usual `authentication`/`authorization` route options. The `ctx.meta` fields listed in `forwardMeta` (by default the `user` returned by `authenticate`) are forwarded to every action called by a tool and to every emitted event, so the actions can check who is calling them. They are taken from each HTTP request, not from the session.

```javascript
export default {
  name: "api",
  mixins: [ApiGateway, McpServerMixin({ routeOptions: { authentication: true } })],
  methods: {
    async authenticate(ctx, route, req) {
      const token = req.headers["authorization"]?.replace("Bearer ", "");
      if (!token) return null;
      return await ctx.call("users.resolveToken", { token }); // → ctx.meta.user
    }
  }
};
```

Custom tools with a function handler receive the forwarded meta as third argument: `handler(params, broker, meta)`.

### What the LLM can call

- Auto-discovered tools are generated only for actions that pass all the filters: not internal (`$`), `published` visibility, not `mcp: false`, not an action of the gateway itself, matching `services` and not matching `excludeActions`.
- `moleculer_call_action` and `moleculer_list_actions` apply the same filters: a filtered action returns a `not exposed via MCP` error and is not listed.
- `moleculer_emit_event` can emit any event except the internal ones (`$services.changed`, `$node.*`, ...), unless `allowedEvents` is set: then only the matching events, internal ones included. Set `exposeGenericTools: false` if the LLM must not emit events or call actions by name.
- `moleculer_list_nodes`/`_services`/`_events` describe the whole cluster: set `exposeBrokerTools: false` if that must stay private.
- Use `callOptions` (e.g. `{ timeout: 10000 }`) to bound the calls: Moleculer calls can't be aborted when the client cancels a request.

### DNS rebinding protection

The MCP specification requires servers to validate the `Origin` header, so that a web page can't reach a local MCP server from the browser. Set `allowedOrigins` (and `allowedHosts` for local servers): requests with other values are rejected with `403`, and the route CORS allows only the listed origins. Requests without `Origin` (non-browser clients such as Claude Code) are always accepted.

```javascript
McpServerMixin({
  allowedOrigins: ["http://localhost:6274"], // e.g. the MCP Inspector
  allowedHosts: ["localhost", "127.0.0.1"]
})
```

### Sessions

Each MCP session lives in the memory of the gateway process. Sessions are closed on `DELETE` requests or after `sessionTimeout` without activity, and keep at most `maxStoredEvents` SSE events to resume interrupted streams.

With several gateway instances behind a load balancer, either use sticky sessions or set `stateless: true`: every POST request gets a new MCP server, no session ID is issued and `GET`/`DELETE` answer `405`. In this mode server-to-client notifications (e.g. `tools/list_changed`) and stream resumability are not available.

## Custom tools

Tools that don't map 1:1 to an action can be declared with the `tools` option. `input` and `output` are Zod raw shapes; `handler` is either an action name (called with the tool params) or a function `(params, broker)`.

```javascript
import { z } from "zod";

McpServerMixin({
  tools: [
    {
      name: "sum",
      title: "Sum",
      description: "Sum two numbers",
      input: {
        a: z.number().describe("First number"),
        b: z.number().describe("Second number")
      },
      output: {
        total: z.number().describe("Result")
      },
      handler: params => ({ total: params.a + params.b }),
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    {
      name: "create_product",
      description: "Create a new product",
      input: { name: z.string(), price: z.number() },
      handler: "products.create"
    }
  ]
})
```

When `output` is set, the result is also returned as `structuredContent` (required by the MCP spec) and must match the schema. Errors thrown by the handler are returned as tool errors (`isError: true`).

## Action Description & MCP Metadata

### Description field

Add a `description` field to your actions. It will be used as the MCP tool description, helping AI assistants understand what the tool does:

```javascript
actions: {
  forecast: {
    description: "Get weather forecast for a city by name",
    params: { city: "string" },
    handler(ctx) { /* ... */ }
  }
}
```

If no description is provided, a default is generated: `"Call the weather.forecast Moleculer action"`.

### MCP metadata

Use the `mcp` field in your action schema for fine-grained control:

```javascript
actions: {
  forecast: {
    params: { city: "string" },
    mcp: {
      // Override the tool description
      description: "Get detailed weather forecast",
      // Override the tool name (default: service_action)
      name: "get_forecast",
      // Override the tool title (default: "Call service.action")
      title: "Weather forecast",
      // Explicit annotations (overrides auto-detection)
      annotations: { readOnlyHint: true },
      // Enable/disable this tool (default: true)
      enabled: true
    },
    handler(ctx) { /* ... */ }
  }
}
```

You can also use shorthand:
- `mcp: true` — register with default settings (same as omitting the field)
- `mcp: false` — exclude this action from MCP tools

## Tool Annotations

MCP tool annotations help AI assistants understand the behavior of each tool. The mixin auto-detects annotations based on the action's REST method or, for actions without `rest`, on the verb at the start of the action name:

| REST Method | `readOnlyHint` | `destructiveHint` | `idempotentHint` | `openWorldHint` |
|---|---|---|---|---|
| `GET` | `true` | `false` | `true` | `false` |
| `PUT` | `false` | `false` | `true` | `false` |
| `DELETE` | `false` | `true` | `true` | `false` |
| `POST` (or no REST) | `false` | `false` | `false` | `false` |

| Action name (without `rest`) | Detected as |
|---|---|
| `get*`, `find*`, `list*`, `count*`, `search*`, `query*`, `fetch*`, `read*`, `resolve*`, `show*`, `describe*`, `exists*`, `has*`, `is*` | `GET` |
| `remove*`, `delete*`, `destroy*`, `purge*`, `drop*`, `clear*` | `DELETE` |
| `replace*`, `set*`, `put*`, `upsert*` | `PUT` |
| anything else (e.g. `create`, `update`, `send`) | `POST` |

Only whole verbs match: `getById` is `GET`, `getaway` is not.

You can override auto-detected annotations using the `mcp.annotations` field:

```javascript
actions: {
  dangerousReset: {
    rest: "POST /reset",
    mcp: {
      annotations: {
        destructiveHint: true,
        idempotentHint: false
      }
    },
    handler(ctx) { /* ... */ }
  }
}
```

## Schema Conversion

The mixin automatically converts fastest-validator parameter schemas to Zod schemas for MCP tool input validation. The following mappings are supported:

| fastest-validator | Zod equivalent |
|---|---|
| `"string"` | `z.string()` |
| `"number"` | `z.number()` |
| `"boolean"` | `z.boolean()` |
| `"date"` | `z.string()` |
| `"email"` | `z.string().email()` |
| `"url"` | `z.string().url()` |
| `"any"` | `z.any()` |
| `{ type: "string", min: 3, max: 100 }` | `z.string().min(3).max(100)` |
| `{ type: "string", pattern: "^[a-z]+$" }` | `z.string().regex(...)` (`patternFlags` supported) |
| `{ type: "string", enum: ["a", "b"] }` | `z.enum(["a", "b"])` |
| `{ type: "number", positive: true, integer: true }` | `z.number().positive().int()` |
| `{ type: "number", min: 0, max: 100 }` | `z.number().min(0).max(100)` |
| `{ type: "array", items: "string" }` | `z.array(z.string())` |
| `{ type: "object", props: { name: "string" } }` | `z.object({ name: z.string() }).passthrough()` (unknown properties are kept, as in fastest-validator) |
| `{ type: "object", strict: true, props: { ... } }` | `z.object({ ... }).strict()` (`strict: "remove"` strips the unknown properties) |
| `{ type: "object" }` | `z.object({}).passthrough()` (any object) |
| `{ $$type: "object|optional", city: "string" }` | `z.object({ city: z.string() }).passthrough().optional()` |
| `{ type: "enum", values: ["a", "b"] }` | `z.enum(["a", "b"])` |
| `{ type: "string", optional: true }` | `z.string().optional()` |
| `{ type: "number", default: 5 }` | `z.number().default(5)` |
| `{ type: "number", default: () => Date.now() }` | `z.number().optional()` (the action applies the dynamic default) |
| `"number\|integer\|positive"` (pipe syntax) | `z.number().int().positive()` |
| `"string\|min:3\|max:10"` (pipe syntax with options) | `z.string().min(3).max(10)` |
| `"uuid"` | `z.string().uuid()` |
| `{ type: "string", nullable: true }` | `z.string().nullable()` |
| `{ type: "string", description: "..." }` | `z.string().describe("...")` |
| `{ type: "string", length: 3 }` / `empty: false` | `z.string().length(3)` / `.min(1)` |
| `{ type: "array", items: "string", min: 1, max: 5 }` | `z.array(z.string()).min(1).max(5)` |
| `{ type: "object", properties: { ... } }` | same as `props` |
| `{ type: "multi", rules: ["string", "number"] }` or `["string", "number"]` | `z.union([z.string(), z.number()])` |
| `{ type: "string", alpha: true }` (also `numeric`, `alphanum`, `alphadash`, `hex`, `base64`, `singleLine`) | `z.string().regex(...)` with the fastest-validator pattern |
| `"mac"` | `z.string().regex(...)` (MAC address formats) |
| `{ type: "currency", currencySymbol: "$", ... }` | `z.string().regex(...)` built like fastest-validator (`customRegex` supported) |
| `"luhn"` | `z.string()` with a description of the checksum |
| `{ type: "tuple", items: ["number", "string"] }` | `z.tuple([z.number(), z.string()])` |
| `{ type: "record", key: "string", value: "number" }` | `z.record(z.string(), z.number())` |
| `{ type: "equal", value: "yes" }` | `z.literal("yes")` (`field` comparisons are not converted) |
| Unknown/custom type | `z.any()` |

The Zod schema describes the tool to the LLM (as JSON Schema) and the MCP SDK validates the tool arguments with it before calling the action, whose validator then runs as usual. Rules that can't be expressed in JSON Schema (e.g. `trim`, `convert`, custom `check` functions) are not converted: they are left to the action's validator.

## Built-in Tools

When `exposeBrokerTools` is `true` (default), the following broker-level tools are registered:

| Tool | Description |
|---|---|
| `moleculer_list_nodes` | List all Moleculer nodes in the cluster |
| `moleculer_list_services` | List all registered services |
| `moleculer_list_actions` | List all available actions |
| `moleculer_list_events` | List all event listeners |

These tools are registered regardless of `exposeBrokerTools`, unless `exposeGenericTools` is `false`:

| Tool | Description |
|---|---|
| `moleculer_call_action` | Call an exposed Moleculer action by name (generic fallback, same filters as auto-discovery) |
| `moleculer_emit_event` | Emit or broadcast a Moleculer event |

## MCP Client Setup

### Claude Code

```bash
claude mcp add --transport http moleculer http://127.0.0.1:3000/mcp
```

### Claude Desktop

Add to your Claude Desktop configuration (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "moleculer": {
      "url": "http://localhost:3000/mcp",
      "type": "http"
    }
  }
}
```

### Generic MCP Client

```json
{
  "servers": {
    "moleculer": {
      "url": "http://localhost:3000/mcp",
      "type": "http"
    }
  }
}
```

## License
The project is available under the [MIT license](https://tldrlegal.com/license/mit-license).

## Contact
Copyright (c) 2026 MoleculerJS

[![@MoleculerJS](https://img.shields.io/badge/github-moleculerjs-green.svg)](https://github.com/moleculerjs) [![@MoleculerJS](https://img.shields.io/badge/twitter-MoleculerJS-blue.svg)](https://twitter.com/MoleculerJS)

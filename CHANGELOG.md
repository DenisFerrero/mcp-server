# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

### Breaking changes

- **Node.js 22.12 or newer is required** (it was 20, which reached its end of life on 2026-04-30). Moleculer 0.15 and moleculer-web 0.11 already require Node 22. CI runs the tests on Node 22, 24 and 26.
- **`moleculer-web` is a peer dependency** (`^0.10.0 || ^0.11.0`). The mixin already needed it to work, and the published type declarations import its types.
- **Only `published` actions are auto-discovered.** Actions with `visibility: "public" | "protected" | "private"` are no longer exposed as MCP tools, consistently with the API gateway.
- **Tool errors are flagged with `isError: true`** and no longer include the stack trace. The payload now contains `name`, `message`, `code`, `type`, `data`.
- **`moleculer_call_action` applies the auto-discovery filters.** Internal (`$`), not published, `mcp: false` actions and the ones filtered by `services`/`excludeActions` return a `not exposed via MCP` error.
- **Sessions are closed after 30 minutes of inactivity** (no requests, no open SSE stream). See `sessionTimeout`.
- **Tool params are logged at `debug` level** (they were logged at `info`).
- **The gateway's own actions are never exposed** (e.g. the moleculer-web `api.listAliases`, which lists all the routes).
- **`moleculer_list_actions` lists only the actions callable through MCP.**
- **Actions without `rest` get annotations from their name** (e.g. `find` is read-only, `remove` destructive) instead of the POST ones.

### New features

- **Moleculer 0.14 support** — The peer dependency is `^0.14.12 || ^0.15.0` again (0.2.0 required `^0.15.0`); use moleculer-web `^0.10.0` with Moleculer 0.14. CI runs the tests on both.
- **Custom tools** — New `tools` option to declare tools with Zod `input`/`output` schemas, annotations and a handler (action name or function). With `output` the result is also returned as `structuredContent`.
- **Dynamic tools refresh** — On `$services.changed` the auto-discovered tools of every open session are regenerated and clients are notified with `tools/list_changed`. Debounced by the new `refreshDebounceTime` option (default `1000`, `false` to disable).
- **`mcp.title`** — Custom title for auto-discovered tools.
- **Authenticated user forwarding** — The `forwardMeta` fields (default `["user"]`) of the HTTP request `ctx.meta`, e.g. the user set by the route `authenticate` method, are forwarded as `meta` to the actions and events called by the tools.
- **`exposeGenericTools` option** — Hides `moleculer_call_action` and `moleculer_emit_event`.
- **Idle sessions cleanup** — New `sessionTimeout` option (default 30 minutes, `false` to disable).
- **Bounded event store** — New `maxStoredEvents` option (default `1000`) for the SSE resumability store.
- **DNS rebinding protection** — New `allowedOrigins` (also used for the route CORS) and `allowedHosts` options.
- **`allowedEvents` option** — Event name patterns that `moleculer_emit_event` can emit.
- **`callOptions` option** — Moleculer calling options (e.g. `timeout`) for the actions called by the tools.
- **`maxResultLength` option** — Truncates long tool results with a note for the LLM.
- **Stateless mode** — New `stateless` option for gateways running in several instances without sticky sessions.
- **Schema converter** — Full pipe syntax with options (`"string|min:3|max:10"`), `description` forwarded to the schema, `nullable`, `uuid`, `multi` (also as array shorthand), `properties` alias, string `length`/`empty` and array `min`/`max`/`length`/`empty`. String format flags (`alpha`, `numeric`, `alphanum`, `alphadash`, `hex`, `base64`, `singleLine`) and the `mac`, `currency`, `luhn`, `tuple`, `record`, `equal` types are converted too: their patterns are exported to the JSON Schema, so the LLM knows the expected format.

### Fixed issues

- **Package entry points** — The 0.2.0 build output was emitted in `dist/*/src/` while `main`/`exports` pointed to `dist/*/index.js`, and the ESM build imported `package.json` without an import attribute. The version is now in `src/version.ts` and CI smoke-tests the built package.
- **`$$root` params** — Auto-discovered tools passed `{ $$root: value }` to the action instead of `value`.
- **Duplicated tool names** — A tool name clash (e.g. two actions with the same `mcp.name`) threw while creating the session; the duplicate is now skipped with a warning.
- **Unbounded memory usage** — Sessions of clients gone away without a `DELETE` request were never released, and the SDK example `InMemoryEventStore` kept every SSE event forever.
- **SSE resumability of the standalone stream** — The SDK example store could not resume the `_GET_stream`, because it extracted the stream ID splitting the event ID on `_`.
- **Custom tools without `input`** — The handler received the SDK `extra` object in place of the params.
- **Shutdown hanging with connected clients** — An open SSE stream kept the moleculer-web `server.close()` waiting forever, so `broker.stop()` never returned while a MCP client was connected.
- **Cross-platform npm scripts** — `dev`, `inspect` and `build` only worked on Windows or only on POSIX shells.

## 0.2.0 (2026-03-28)

### Breaking changes

- **`McpServerMixinOptions` interface moved** to a separate `types.ts` module. If you imported it directly from `src/index.ts`, update your import path.
- **`sendResponse` call signature changed** to the standard moleculer-web 4-argument format `(req, res, data, opts)` instead of the previous 4-arg `(req, res, statusCode, data)`. This aligns with moleculer-web v0.10+ conventions.

### New features

- **Auto-discovery tool generation** — The mixin now automatically discovers Moleculer actions from the broker registry and registers per-action MCP tools with proper Zod input schemas. LLMs get dedicated, well-typed tools instead of relying solely on the generic `moleculer_call_action`.
- **fastest-validator → Zod schema converter** (`src/schema-converter.ts`) — Converts Moleculer's fastest-validator param definitions to Zod schemas, supporting: string, number, boolean, enum, array, object, nested objects, optional/required fields, and default values.
- **Service whitelist filtering** — New `services` option accepts a string glob pattern or an array of service names to control which services' actions get auto-discovered. Uses Moleculer's `Utils.match()` for full glob support (`*`, `**`, `?`).
- **Action exclusion patterns** — New `excludeActions` option to exclude specific action name patterns from auto-discovery (e.g. `["$node.*"]`).
- **`exposeBrokerTools` option** — Controls whether generic broker tools (`moleculer_list_nodes`, `moleculer_list_services`, `moleculer_list_actions`, `moleculer_list_events`) are registered. Default: `true`. When `false`, `moleculer_call_action` and `moleculer_emit_event` are still available.
- **`toolNamePrefix` option** — Adds a prefix to auto-generated tool names (e.g. `prefix_greeter_hello` instead of `greeter_hello`).
- **MCP annotation detection** — Auto-discovered tools get automatic `readOnlyHint`/`destructiveHint`/`idempotentHint` annotations based on the action REST method (`GET` → readOnly; `DELETE` → destructive; `PUT` → idempotent). Custom annotations via `action.mcp.annotations` are merged on top. _(This entry originally described a detection based on action names, which was not implemented in 0.2.0.)_
- **CI/CD publish workflow** — `.github/workflows/publish.yml` for automated npm publishing with provenance on GitHub releases (trusted publisher).

### Fixed issues

- **`stopped()` lifecycle Map iteration bug** — Used `for...in` on a `Map`, which doesn't iterate entries. Fixed to `for...of` with proper destructuring.
- **`sendResponse` inconsistency** — Some calls used a non-standard argument order. Standardized all `sendResponse` calls to the moleculer-web 4-arg format.
- **Dead code cleanup** — Removed commented-out resource handlers, hardcoded tool registrations, and unused code blocks.
- **`getNodeList` ignoring params** — The handler didn't pass through `params` to the registry call; now properly forwards `withServices` and `onlyAvailable` parameters.
- **`z.enum` crash on empty/non-string arrays** — Added guard for non-empty string array check before calling `z.enum()`, falling back to `z.union(z.literal(...))` for mixed types.
- **`JSON.stringify(undefined)` in call_action response** — Added undefined guard with null fallback to prevent silent empty responses.
- **Error serialization losing details** — Error responses now explicitly extract `name`, `message`, and `stack` properties instead of relying on `JSON.stringify(err)` which loses non-enumerable fields.
- **MCP annotations merge** — Detected annotations and user-defined `mcp.annotations` are now properly spread-merged instead of one overwriting the other.
- **Internal `$node.*` actions filtered** — Auto-discovery automatically excludes internal Moleculer actions (starting with `$`) to avoid exposing infrastructure tools to LLMs.
- **CORS support for MCP Inspector** — Added CORS configuration to the route, allowing the MCP Inspector and other browser-based clients to connect cross-origin. Allowed headers include `mcp-session-id`, `mcp-protocol-version`, and `Last-Event-ID`.
- **Unknown session ID handling** — POST requests with an unknown `mcp-session-id` now create a new session instead of returning 400. This fixes reconnection issues with MCP SDK v1.28+ clients.

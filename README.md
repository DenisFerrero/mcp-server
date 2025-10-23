![Moleculer logo](http://moleculer.services/images/banner.png)

[![Integration & Unit Test](https://github.com/moleculerjs/mcp-server/actions/workflows/test.yml/badge.svg)](https://github.com/moleculerjs/mcp-server/actions/workflows/test.yml)
[![NPM version](https://badgen.net/npm/v/@moleculer/mcp-server)](https://www.npmjs.com/package/@moleculer/mcp-server)

# @moleculer/mcp-server

MCP server mixin for Moleculer API Gateway (moleculer-web)

<video controls src="docs/Code_PIxZeLiRX3.mp4" title="Introduction to MCP Server"></video>

## Install

To install the package, use the following command:

```bash
npm i @moleculer/mcp-server
```

## Usage

### Add MCP server mixin to your API Gateway service

```javascript
import { McpServerMixin } from "../../src/index.js";

// api.service.js
export default {
    name: "api",
    mixins: [McpServerMixin()],
    settings: {
        mcp: {
            whitelist: ["**"]
        }
    }
};
```

The API gateway with MCP server will be available at: `http://localhost:3000/mcp`

### Settings

It's necessary to declare a set of settings to make the mcp server work correctly:

- **Whitelist**: whitelist of the accessible actions through the MCP. The pattern for the matching has the same format of [moleculer-web](https://moleculer.services/docs/0.14/moleculer-web#Whitelist)
- **Blacklist**: blacklist of the not accessible actions through the MCP. Same pattern of the whitelist. *Optional*
- **Tools**, list of manually declared tools rather than using the automatic register feature. Each item has to respect the McpServerSetting_CustomTool class format. *Optional*
- **Regeneration debounce time**, Apply a [debounce rule](https://lodash.com/docs/4.17.15#debounce) when it's necessary to regenerate the tools after the list of services changed. *Optional, default = 1000ms*

#### Automatic tool definition

It's possibile to set some metadata for the MCP actions to prevent their redefinition inside the ``api`` service

```js
{
    name: "users"
    actions: {
        list: {
            metadata: {
                name: "users_listing"
                title: "Users listing",
                description: "List the users registered in the system. The request is paginated"
            },
            handler (ctx) {
                ...
            }
        }
    }
}
```

The *name*, *title*, and *description* properties will be used to populate the tool's name, title, and description.
If the name is not provided the action name will be normalised (e.g *users.list = users_list*).
If the title is not provided the action name will be humanized (e.g *users.list = Users list*).
If the description is not provided the title will be used.

It's possibile to apply a custom logic on the parsing methods by overriding **normalizeMcpActionName** and **humanizeMcpActionName**:

```js
{
    ...
    methods: {
        normalizeMcpActionName (action: string): string {
            ...
        }
        humanizeMcpActionName (action: string): string {
            ...
        }
    }
}
```

#### Custom tool definition

```js
{
    ...
    settings: {
        mcp: {
            tools: [
                {
                    name: "sum",
                    title: "Sum",
                    description: "Sum 2 numbers",
                    input: {
                        a: z.number().describe("Fist number"),
                        b: z.number().describe("Second number")
                    },
                    output: {
                        total: z.number().describe("Final result")
                    }
                    handler (args) {
                        return { total: args.a + args.b };
                    },
                    annotations: {
                        readOnlyHint: true,
                        destructiveHint: false,
                        idempotentHint: true,
                        openWorldHint: false
                    }
                }
            ]
        }
    }
    ...
}
```

- **name**, name of the tool. *Required*
- **title**, human readable brief summary. *Optional*
- **description**, human readable deep description. *Required*
- **input**, object where each key's value is a zod validation for the requested params. *Optional*
- **output**, object that explain how the output is structured using zod validation. *Optional*
- **handler**, function that handles the request or an action name that can be called to handle the request. *Required*
- **annotations**, useful suggestions for the LLM or client in deciding when and how to invoke a tool
  - **readOnlyHint**, the action performs read only data without updating/deleting resources
  - **destructiveHint**, the action performs destructive or irreversible updates, set only if *readOnlyHint = false*
  - **idempotentHint**, calling the same action multiple times the same result is provided
  - **openWorldHint**, the action when called interacts with an external environment

#### Full settings example

Below a full settings example

```js
import { McpServerMixin } from "../../src/index.js";
import z from "zod";

// api.service.js
export default {
    name: "api",
    mixins: [McpServerMixin()],
    settings: {
        mcp: {
            whitelist: ["users.*", "cars.*"],
            blacklist: ["users.resetPassword"],
            tools: [
                {
                    name: "sum",
                    title: "Sum",
                    description: "Sum 2 numbers",
                    input: {
                        a: z.number().describe("Fist number"),
                        b: z.number().describe("Second number")
                    },
                    output: {
                        total: z.number().describe("Final result")
                    }
                    handler (args) {
                        return { total: args.a + args.b };
                    },
                    annotations: {
                        readOnlyHint: true,
                        destructiveHint: false,
                        idempotentHint: true,
                        openWorldHint: false
                    }
                },
                {
                    name: "subtract",
                    description: "Subtract 2 numbers",
                    input: {
                        a: z.number().describe("Fist number"),
                        b: z.number().describe("Second number")
                    },
                    handler: "calculator.subtract"
                }
            ],
            regenerationDebounceTime: 5000
        }
    }
};
```

### Install into MCP Client

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

### Install to Claude Code

```bash
claude mcp add --transport http moleculer http://127.0.0.1:3000/mcp
```

## License

The project is available under the [MIT license](https://tldrlegal.com/license/mit-license).

## Contact

Copyright (c) 2025 MoleculerJS

[![@MoleculerJS](https://img.shields.io/badge/github-moleculerjs-green.svg)](https://github.com/moleculerjs) [![@MoleculerJS](https://img.shields.io/badge/twitter-MoleculerJS-blue.svg)](https://twitter.com/MoleculerJS)

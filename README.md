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

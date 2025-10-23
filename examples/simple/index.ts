"use strict";

/**
 * It's a simple example which demonstrates how to
 * use the MCP server
 */

import { ServiceBroker } from "moleculer";
import { McpServerMixin } from "../../src/index.ts";
import url from "url";
import path from "path";

let dirname = import.meta.dirname;
if (!dirname) {
	dirname = path.dirname(url.fileURLToPath(import.meta.url));
}

import process from "node:process";
import { ProductEntity } from "./products.service.ts";

// Create broker
const broker = new ServiceBroker();

broker.createService({
	name: "api",
	mixins: [McpServerMixin()],
	settings: {
		port: 3300,
		mcp: {
			whitelist: ["products.*"],
			tools: [
				{
					name: "get_total_products",
					title: "Get total quantities of products",
					description: "Get total amount of products in stock",
					async handler(broker: ServiceBroker, params: object) {
						const products: Array<ProductEntity> = await broker.call("products.find");
						return products.reduce((acc, curr) => acc + curr.quantity, 0);
					}
				}
			]
		}
	}
});

broker.createService({
	name: "greeter",
	actions: {
		hello: {
			rest: {
				method: "GET",
				path: "/hello"
			},
			async handler() {
				return "Hello Moleculer";
			}
		},

		/**
		 * Welcome, a username
		 *
		 * @param {String} name - User name
		 */
		welcome: {
			rest: "POST /welcome",
			params: {
				name: "string"
			},
			async handler(ctx) {
				return `Welcome, ${ctx.params.name}`;
			}
		}
	}
});

broker.loadService(dirname + "/products.service.ts");

// Start server
broker
	.start()
	.then(async () => {
		// broker.wf.run("test.wf1", { name: "John Doe" }, { jobId: "1111" });
	})
	.then(() => broker.repl())
	.catch(err => {
		broker.logger.error(err);
		process.exit(1);
	});

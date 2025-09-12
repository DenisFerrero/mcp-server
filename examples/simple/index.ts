"use strict";

/**
 * It's a simple example which demonstrates how to
 * use the MCP server
 */

import { ServiceBroker } from "moleculer";

import { inspect } from "node:util";
import process from "node:process";
import _ from "lodash";

// Create broker
const broker = new ServiceBroker({
	logger: {
		type: "Console",
		options: {
			formatter: "short",
			level: {
				MCPSERVER: "debug",
				"*": "info"
			},
			objectPrinter: obj =>
				inspect(obj, {
					breakLength: 50,
					colors: true,
					depth: 3
				})
		}
	}
});

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

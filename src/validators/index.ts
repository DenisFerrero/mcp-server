import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { ZodParser } from "./validators.types.ts";

const validators: Record<string, unknown> = {};

// Resolve the directory of this file so we read the actual validators folder
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const files = fs
	.readdirSync(__dirname)
	// ignore this index file, types file and hidden files (like .claude)
	.filter(file => file !== "index.ts" && file !== "validators.types.ts" && !file.startsWith("."));

for (const file of files) {
	// only import .ts or .js files
	if (!file.endsWith(".ts") && !file.endsWith(".js")) continue;
	const fullPath = path.join(__dirname, file);
	// import via file URL to avoid treating the string as a package specifier
	const mod = await import(pathToFileURL(fullPath).href);
	// store by basename (without extension)
	validators[path.parse(file).name] = new (mod.default ?? mod)();
}

export default function getParser(type: string): ZodParser {
	const v = validators[type];
	if (!v) throw new Error("Invalid validator provided");

	return v as ZodParser;
}

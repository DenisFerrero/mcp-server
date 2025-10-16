import { ZodRawShape } from "zod";

// Common validator interface
export abstract class ZodParser {
	abstract parse(schema: unknown): ZodRawShape;
}

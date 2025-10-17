import { ZodParser } from "./validators.types.ts";
import ZodParser_FastestValidator from "./FastestValidator.ts";

const validators: Record<string, ZodParser> = {
	FastestValidator: new ZodParser_FastestValidator()
};

export default function getParser(type: string): ZodParser {
	const v = validators[type];
	if (!v) throw new Error("Invalid validator provided");

	return v as ZodParser;
}

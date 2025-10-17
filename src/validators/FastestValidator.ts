import z, { ZodRawShape } from "zod";
import { ValidationRule, ValidationRuleObject, ValidationSchema } from "fastest-validator";
import Validator from "fastest-validator";
import { ZodParser } from "./validators.types.ts";

// TODO @Icebob how we fix it?
const v = new (Validator as any)();

export default class ZodParser_FastestValidator implements ZodParser {
	constructor() {}

	parse(schema: ValidationSchema<ValidationRule>): ZodRawShape {
		if (!schema) return {};

		const result: ZodRawShape = {};

		// In case of $$root, to respect the ZodRawShape definition the value is wrapped inside an object
		if (schema.$$root === true) {
			return {
				$$root: this.convert(schema, schema.$$strict === true, schema.$$strict === "remove")
			};
		}

		for (const [key, value] of Object.entries(schema)) {
			// Skip internal keys
			if (key.startsWith("$$")) {
				continue;
			}

			const validationSchema = this.convert(
				value,
				schema.$$strict === true,
				schema.$$strict === "remove"
			);
			if (validationSchema) {
				result[key] = validationSchema;
			}
		}

		return result;
	}

	convert(_schema: ValidationRule, $$strict: boolean, $$remove: boolean): z.ZodType {
		const value = v.normalize(_schema) as ValidationRuleObject;

		const pipelines = [];

		// PRIMITIVES

		// String type
		if (value.type === "string") {
			// Convert, nullable, optional and default value
			let valueSet:
				| z.ZodString
				| z.ZodNullable<z.ZodString>
				| z.ZodOptional<z.ZodTypeAny>
				| z.ZodDefault<z.ZodTypeAny> = z.string();
			// - Convert
			if (value.convert === true) {
				valueSet = z.coerce.string();
			}
			// - Nullable
			if (value.nullable === true) {
				valueSet = valueSet.nullable();
			}
			// - Optional
			if (value.optional === true) {
				valueSet = valueSet.optional();
			}
			// - Default value
			if (typeof value.default === "string" || typeof value.default === "function") {
				valueSet = valueSet.default(value.default);
			}

			pipelines.push(valueSet);

			// Pre-process rules
			let preProcess: z.ZodEffects<z.ZodTypeAny, string, string>;
			// - Trim string
			if (value.trim === true) {
				preProcess = (preProcess ?? z.string()).transform((str: string) => str.trim());
			}
			// - Trim left
			if (value.trimLeft === true) {
				preProcess = (preProcess ?? z.string()).transform((str: string) => str.trimStart());
			}
			// - Trim right
			if (value.trimRight === true) {
				preProcess = (preProcess ?? z.string()).transform((str: string) => str.trimEnd());
			}
			// - Lowercase string
			if (value.lowercase === true) {
				preProcess = (preProcess ?? z.string()).transform((str: string) =>
					str.toLowerCase()
				);
			}
			// - Uppercase string
			if (value.uppercase === true) {
				preProcess = (preProcess ?? z.string()).transform((str: string) =>
					str.toUpperCase()
				);
			}

			if (preProcess) {
				pipelines.push(preProcess);
			}

			// Validation rules
			let validation: z.ZodString;
			// - Empty
			if (value.empty === false) {
				validation = (validation ?? z.string()).trim().min(1);
			}
			// - Min length
			if (typeof value.min === "number") {
				validation = (validation ?? z.string()).min(value.min);
			}
			// - Max length
			if (typeof value.max === "number") {
				validation = (validation ?? z.string()).max(value.max);
			}
			// - Length
			if (typeof value.length === "number") {
				validation = (validation ?? z.string()).length(value.length);
			}
			// - Regex pattern
			if (typeof value.pattern === "string") {
				validation = (validation ?? z.string()).regex(new RegExp(value.pattern));
			} else if (value.pattern instanceof RegExp) {
				validation = (validation ?? z.string()).regex(value.pattern);
			}
			// - Contains string
			if (typeof value.contains === "string") {
				validation = (validation ?? z.string()).includes(value.includes);
			}
			// - Alphabetic string validation (a-zA-Z)
			if (value.alpha === true) {
				validation = (validation ?? z.string()).regex(/^[A-Za-z]+$/, {
					message: "Value must contain only alphabetic characters"
				});
			}
			// - Numeric string validation (0-9)
			if (value.numeric === true) {
				validation = (validation ?? z.string()).regex(/^[0-9]+$/, {
					message: "Value must contain only alphanumeric characters"
				});
			}
			// - Alphanumeric string validation (a-zA-Z0-9)
			if (value.alphanum === true) {
				validation = (validation ?? z.string()).regex(/^[A-Za-z0-9]+$/, {
					message: "Value must contain only alphanumeric characters"
				});
			}
			// - Alpha-dash string validation (a-zA-Z0-9-_)
			if (value.alphadash === true) {
				validation = (validation ?? z.string()).regex(/^[A-Za-z0-9_-]+$/, {
					message:
						"Value must contain only alphanumeric characters, dashes or underscores"
				});
			}
			// - Hex string validation
			if (value.hex === true) {
				validation = (validation ?? z.string()).regex(/^[0-9a-fA-F]+$/, {
					message: "Value must be a valid hexadecimal string"
				});
			}
			// - Single line string validation
			if (value.singleLine === true) {
				validation = (validation ?? z.string()).regex(/^[^\r\n]*$/, {
					message: "Value must be a single line string"
				});
			}
			// - Base 64 string validation
			if (value.base64 === true) {
				validation = (validation ?? z.string()).regex(
					/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
					{ message: "Value must be a valid base64 string" }
				);
			}
			// Enum value
			if (Array.isArray(value.enum) && value.enum.length > 0) {
				// Dynamically create a regex pattern
				const pattern = value.enum
					.map(v => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
					.join("|");
				const regex = new RegExp(`(?:${pattern})`);
				validation = (validation ?? z.string()).regex(regex, {
					message: `Value must be a valid value among ${value.enum.join(", ")}`
				});
			}

			if (validation) {
				pipelines.push(validation);
			}

			// No refinements rules

			// Manipulation rules
			let manipulation: z.ZodEffects<z.ZodTypeAny, string, string>;
			// - Pad start
			if (typeof value.padStart === "number" && value.padStart > 0) {
				const char = value.padChar ?? " ";
				manipulation = (manipulation ?? z.string()).transform((str: string) =>
					str.padStart(value.padStart, char)
				);
				// - Pad end
			} else if (typeof value.padEnd === "number" && value.padEnd > 0) {
				const char = value.padChar ?? " ";
				manipulation = (manipulation ?? z.string()).transform((str: string) =>
					str.padEnd(value.padEnd, char)
				);
			}

			if (manipulation) {
				pipelines.push(manipulation);
			}
		}
		// Number type
		if (value.type === "number") {
			// Convert, nullable, optional and default value
			let valueSet:
				| z.ZodNumber
				| z.ZodNullable<z.ZodNumber>
				| z.ZodOptional<z.ZodTypeAny>
				| z.ZodDefault<z.ZodTypeAny> = z.number();
			// - Convert
			if (value.convert === true) {
				valueSet = z.coerce.number();
			}
			// - Nullable
			if (value.nullable === true) {
				valueSet = valueSet.nullable();
			}
			// - Optional
			if (value.optional === true) {
				valueSet = valueSet.optional();
			}
			// - Default value
			if (typeof value.default === "number" || typeof value.default === "function") {
				valueSet = valueSet.default(value.default);
			}

			pipelines.push(valueSet);

			// No pre-process rules

			// Validation rules
			let validation: z.ZodNumber;
			// - Equal
			if (typeof value.equal === "number") {
				validation = (validation ?? z.number()).min(value.equal).max(value.equal);
			} else if (typeof value.min === "number" || typeof value.max === "number") {
				// - Min
				if (typeof value.min === "number") {
					validation = (validation ?? z.number()).min(value.min);
				}
				// - Max
				if (typeof value.max === "number") {
					validation = (validation ?? z.number()).max(value.max);
				}
			}
			// - Integer
			if (value.integer === true) {
				validation = (validation ?? z.number()).int();
			}
			// - Positive
			if (value.positive === true) {
				validation = (validation ?? z.number()).positive();
				// - Negative
			} else if (value.negative === true) {
				validation = (validation ?? z.number()).negative();
			}

			if (validation) {
				pipelines.push(validation);
			}

			// Refinements rules
			let refinements: z.ZodEffects<z.ZodTypeAny, number, number>;
			// - Not equal
			if (typeof value.notEqual === "number") {
				refinements = (refinements ?? z.number()).refine(
					(num: number) => num !== value.notEqual,
					{ message: `Value cannot be equal to ${value.notEqual}` }
				);
			}

			if (refinements) {
				pipelines.push(refinements);
			}

			// No manipulation rules
		}
		// Boolean type
		if (value.type === "boolean") {
			// Convert, nullable, optional and default value
			let valueSet:
				| z.ZodBoolean
				| z.ZodNullable<z.ZodBoolean>
				| z.ZodOptional<z.ZodTypeAny>
				| z.ZodDefault<z.ZodTypeAny> = z.boolean();
			// - Convert
			if (value.convert === true) {
				valueSet = z.coerce.boolean();
			}
			// - Nullable
			if (value.nullable === true) {
				valueSet = valueSet.nullable();
			}
			// - Optional
			if (value.optional === true) {
				valueSet = valueSet.optional();
			}
			// - Default value
			if (typeof value.default === "boolean" || typeof value.default === "function") {
				valueSet = valueSet.default(value.default);
			}

			pipelines.push(valueSet);

			// No pre-process rules

			// No validation rules

			// No refinements rules

			// No manipulation rules
		}
		// Date type
		if (value.type === "date") {
			// Convert, nullable, optional and default value
			let valueSet: z.ZodTypeAny = z.instanceof(Date);
			// - Convert
			if (value.convert === true) {
				valueSet = z
					.union([z.string(), z.number(), z.instanceof(Date)])
					.transform((arg: string | number | Date) => new Date(arg))
					.refine((arg: Date) => !isNaN(arg.getTime()), {
						message: "Invalid date provided"
					});
			}
			// - Nullable
			if (value.nullable === true) {
				valueSet = valueSet.nullable();
			}
			// - Optional
			if (value.optional === true) {
				valueSet = valueSet.optional();
			}
			// - Default value
			if (typeof value.default === "string" || typeof value.default === "function") {
				valueSet = valueSet.default(value.default);
			}

			pipelines.push(valueSet);

			// No pre-process rules

			// No validation rules

			// No refinements rules

			// No manipulation rules
		}
		// Any type
		if (value.type === "any") {
			// Nullable, optional and default value
			let valueSet:
				| z.ZodAny
				| z.ZodNullable<z.ZodTypeAny>
				| z.ZodOptional<z.ZodTypeAny>
				| z.ZodDefault<z.ZodTypeAny> = z.any();
			// - Nullable
			if (value.nullable === true) {
				valueSet = valueSet.nullable();
			}
			// - Optional
			if (value.optional === true) {
				valueSet = valueSet.optional();
			}
			// - Default value
			if (typeof value.default !== "undefined") {
				valueSet = valueSet.default(value.default);
			}

			pipelines.push(valueSet);

			// No pre-process rules

			// No validation rules

			// No refinements rules

			// No manipulation rules
		}

		// ADVANCED

		// Email
		if (value.type === "email") {
			// Convert, nullable, optional and default value
			let valueSet:
				| z.ZodString
				| z.ZodNullable<z.ZodString>
				| z.ZodOptional<z.ZodTypeAny>
				| z.ZodDefault<z.ZodTypeAny> = z.string().email();
			// - Convert
			if (value.convert === true) {
				valueSet = z.coerce.string().email();
			}
			// - Nullable
			if (value.nullable === true) {
				valueSet = valueSet.nullable();
			}
			// - Optional
			if (value.optional === true) {
				valueSet = valueSet.optional();
			}
			// - Default value
			if (typeof value.default === "string" || typeof value.default === "function") {
				valueSet = valueSet.default(value.default);
			}

			pipelines.push(valueSet);

			// Pre-process rules
			let preProcess: z.ZodEffects<z.ZodTypeAny, string, string> | z.ZodString;
			// - Normalize value
			if (value.normalize === true) {
				preProcess = z.string().email().trim().toLowerCase();
			}

			if (preProcess) {
				pipelines.push(preProcess);
			}

			// Validation rules
			let validation: z.ZodString;
			// - Empty
			if (value.empty === false) {
				validation = (validation ?? z.string()).trim().min(1);
			}
			// - Min length
			if (typeof value.min === "number") {
				validation = (validation ?? z.string()).min(value.min);
			}
			// - Max length
			if (typeof value.max === "number") {
				validation = (validation ?? z.string()).max(value.max);
			}

			if (validation) {
				pipelines.push(validation);
			}

			// No refinements rules

			// No manipulation rules
		}
		// Currency
		if (value.type === "currency") {
			// Convert, nullable, optional and default value
			let valueSet:
				| z.ZodString
				| z.ZodNullable<z.ZodString>
				| z.ZodOptional<z.ZodTypeAny>
				| z.ZodDefault<z.ZodTypeAny> = z.string();
			// - Convert
			if (value.convert === true) {
				valueSet = z.coerce.string();
			}
			// - Nullable
			if (value.nullable === true) {
				valueSet = valueSet.nullable();
			}
			// - Optional
			if (value.optional === true) {
				valueSet = valueSet.optional();
			}
			// - Default value
			if (typeof value.default === "string" || typeof value.default === "function") {
				valueSet = valueSet.default(value.default);
			}

			pipelines.push(valueSet);

			// No pre-process rules

			// Validation rules
			let validation: z.ZodString;

			if (value.customRegex) {
				validation = z.string().regex(value.customRegex, {
					message: "The value does not match the custom currency pattern"
				});
				// Original validation from fastest-validator (https://github.com/icebob/fastest-validator/blob/master/lib/rules/currency.js)
			} else {
				const CURRENCY_REGEX =
					"(?=.*\\d)^(-?~1|~1-?)(([0-9]\\d{0,2}(~2\\d{3})*)|0)?(\\~3\\d{1,2})?$";
				const currencySymbol = value.currencySymbol || null;
				const thousandSeparator = value.thousandSeparator ?? ",";
				const decimalSeparator = value.decimalSeparator ?? ".";
				const isCurrencySymbolMandatory = !value.symbolOptional;
				const finalRegex = CURRENCY_REGEX.replace(
					/~1/g,
					currencySymbol
						? `\\${currencySymbol}${isCurrencySymbolMandatory ? "" : "?"}`
						: ""
				)
					.replace("~2", thousandSeparator)
					.replace("~3", decimalSeparator);

				validation = z.string().regex(new RegExp(finalRegex), {
					message: "The value does not match the currency pattern"
				});
			}

			if (validation) {
				pipelines.push(validation);
			}

			// No refinements rules

			// No manipulation rules
		}
		// Class
		if (value.type === "class") {
			// Nullable, optional and default value
			let valueSet:
				| z.ZodTypeAny
				| z.ZodNullable<z.ZodTypeAny>
				| z.ZodOptional<z.ZodTypeAny>
				| z.ZodDefault<z.ZodTypeAny> = z.instanceof(value.instanceof);
			// - Nullable
			if (value.nullable === true) {
				valueSet = valueSet.nullable();
			}
			// - Optional
			if (value.optional === true) {
				valueSet = valueSet.optional();
			}
			// - Default value
			if (value.default instanceof value.instanceof || typeof value.default === "function") {
				valueSet = valueSet.default(value.default);
			}

			pipelines.push(valueSet);

			// No pre-process rules

			// No validation rules

			// No refinements rules

			// No manipulation rules
		}
		// Enum
		if (value.type === "enum") {
			// Nullable, optional and default value
			let valueSet:
				| z.ZodTypeAny
				| z.ZodNullable<z.ZodTypeAny>
				| z.ZodOptional<z.ZodTypeAny>
				| z.ZodDefault<z.ZodTypeAny> = z.any();
			// - Nullable
			if (value.nullable === true) {
				valueSet = valueSet.nullable();
			}
			// - Optional
			if (value.optional === true) {
				valueSet = valueSet.optional();
			}
			// - Default value
			if (typeof value.default !== "undefined") {
				valueSet = valueSet.default(value.default);
			}

			pipelines.push(valueSet.refine((arg: unknown) => value.values.find(v => v === arg)));

			// No pre-process rules

			// No validation rules

			// No refinements rules

			// No manipulation rules
		}
		// Equal
		if (value.type === "equal") {
			// Nullable, optional and default value
			let valueSet:
				| z.ZodTypeAny
				| z.ZodNullable<z.ZodTypeAny>
				| z.ZodOptional<z.ZodTypeAny>
				| z.ZodDefault<z.ZodTypeAny> = z.any();
			// - Nullable
			if (value.nullable === true) {
				valueSet = valueSet.nullable();
			}
			// - Optional
			if (value.optional === true) {
				valueSet = valueSet.optional();
			}
			// - Default value
			if (typeof value.default !== "undefined") {
				valueSet = valueSet.default(value.default);
			}

			pipelines.push(valueSet);

			// No pre-process rules

			// No validation rules

			// Refinements rules
			// NOTE: Cannot verify the ``field`` property
			let refinements: z.ZodEffects<z.ZodTypeAny, unknown, unknown>;
			if (value.strict) {
				refinements = z.any().refine((arg: unknown) => arg === value.value);
			} else {
				refinements = z.any().refine((arg: unknown) => arg == value.value);
			}

			pipelines.push(refinements);

			// No manipulation rules
		}
		// Forbidden
		if (value.type === "forbidden") {
			let pipe: z.ZodTypeAny = z.any();

			// Remove the field as forbidden
			if (value.remove === true) {
				// eslint-disable-next-line @typescript-eslint/no-unused-vars
				pipe = pipe.transform((arg: unknown) => undefined);
			}

			pipe = pipe.refine((arg: unknown) => typeof arg === "undefined");

			pipelines.push(pipe);

			// No pre-process rules

			// No validation rules

			// No refinements rules

			// No manipulation rules
		}
		// Function
		if (value.type === "function") {
			// Nullable, optional and default value
			let valueSet:
				| z.ZodFunction<z.ZodTuple<[], z.ZodUnknown>, z.ZodTypeAny>
				| z.ZodNullable<z.ZodTypeAny>
				| z.ZodOptional<z.ZodTypeAny>
				| z.ZodDefault<z.ZodTypeAny> = z.function();
			// - Nullable
			if (value.nullable === true) {
				valueSet = valueSet.nullable();
			}
			// - Optional
			if (value.optional === true) {
				valueSet = valueSet.optional();
			}
			// - Default value
			if (typeof value.default === "function") {
				valueSet = valueSet.default(value.default);
			}

			pipelines.push(valueSet);

			// No pre-process rules

			// No validation rules

			// No refinements rules

			// No manipulation rules
		}
		// Luhn algorithm
		if (value.type === "luhn") {
			// Convert, nullable, optional and default value
			let valueSet:
				| z.ZodString
				| z.ZodNullable<z.ZodString>
				| z.ZodOptional<z.ZodTypeAny>
				| z.ZodDefault<z.ZodTypeAny> = z.string();
			// - Convert
			if (value.convert === true) {
				valueSet = z.coerce.string();
			}
			// - Nullable
			if (value.nullable === true) {
				valueSet = valueSet.nullable();
			}
			// - Optional
			if (value.optional === true) {
				valueSet = valueSet.optional();
			}
			// - Default value
			if (typeof value.default === "string" || typeof value.default === "function") {
				valueSet = valueSet.default(value.default);
			}

			pipelines.push(valueSet);

			// No pre-process rules

			// No validation rules

			// Refinements rules
			const refinements: z.ZodEffects<z.ZodString, string, string> = z
				.string()
				// Original implementation from fastest-validator (https://github.com/icebob/fastest-validator/blob/master/lib/rules/luhn.js)
				.refine(function (arg: string) {
					const val = arg.replace(/\\D+/g, "");

					const array = [0, 2, 4, 6, 8, 1, 3, 5, 7, 9];
					let len = val ? val.length : 0,
						bit = 1,
						sum = 0;
					while (len--) {
						sum += !(bit ^= 1) ? parseInt(val[len], 10) : array[val[len]];
					}

					return sum % 10 === 0 && sum > 0;
				});

			if (refinements) {
				pipelines.push(refinements);
			}

			// No manipulation rules
		}
		// Mac address
		if (value.type === "mac") {
			// Convert, nullable, optional and default value
			let valueSet:
				| z.ZodString
				| z.ZodNullable<z.ZodString>
				| z.ZodOptional<z.ZodTypeAny>
				| z.ZodDefault<z.ZodTypeAny> = z.string();
			// - Convert
			if (value.convert === true) {
				valueSet = z.coerce.string();
			}
			// - Nullable
			if (value.nullable === true) {
				valueSet = valueSet.nullable();
			}
			// - Optional
			if (value.optional === true) {
				valueSet = valueSet.optional();
			}
			// - Default value
			if (typeof value.default === "string" || typeof value.default === "function") {
				valueSet = valueSet.default(value.default);
			}

			pipelines.push(valueSet);

			// No pre-process rules

			// Validation rules
			const validation: z.ZodString = z
				.string()
				.regex(
					/^((([a-f0-9][a-f0-9]+[-]){5}|([a-f0-9][a-f0-9]+[:]){5})([a-f0-9][a-f0-9])$)|(^([a-f0-9][a-f0-9][a-f0-9][a-f0-9]+[.]){2}([a-f0-9][a-f0-9][a-f0-9][a-f0-9]))$/i,
					{ message: "Invalid MAC address provided" }
				);

			if (validation) {
				pipelines.push(validation);
			}

			// No refinements rules

			// No manipulation rules
		}
		// Array type
		if (value.type === "array") {
			// Convert, nullable, optional and default value
			let valueSet:
				| z.ZodTypeAny
				| z.ZodNullable<z.ZodTypeAny>
				| z.ZodOptional<z.ZodTypeAny>
				| z.ZodDefault<z.ZodTypeAny> = this.convert(value.items, $$strict, $$remove);
			// - Convert
			if (value.convert === true) {
				valueSet = valueSet
					.transform((item: unknown) => (Array.isArray(item) ? item : [item]))
					.array();
			} else {
				valueSet = valueSet.array();
			}
			// - Nullable
			if (value.nullable === true) {
				valueSet = valueSet.nullable();
			}
			// - Optional
			if (value.optional === true) {
				valueSet = valueSet.optional();
			}
			// - Default value
			if (Array.isArray(value.default) || typeof value.default === "function") {
				valueSet = valueSet.default(value.default);
			}

			pipelines.push(valueSet);

			// No pre-process rules

			// Validation rules
			let validation: z.ZodArray<z.ZodTypeAny, "many" | "atleastone"> = this.convert(
				value.items,
				$$strict,
				$$remove
			).array();
			// - Non empty
			if (typeof value.empty === "undefined" || value.empty === true) {
				validation = validation.nonempty();
			}
			// - Fixed length
			if (typeof value.length === "number") {
				validation = validation.length(value.length);
			}
			if (typeof value.min === "number" || typeof value.max === "number") {
				// - Min items
				if (typeof value.min === "number") {
					validation = validation.min(value.min);
				}
				// - Max items
				if (typeof value.max === "number") {
					validation = validation.max(value.max);
				}
			}

			if (validation) {
				pipelines.push(validation);
			}

			// Refinements rules
			let refinements: z.ZodEffects<z.ZodTypeAny, unknown[], unknown[]>;
			// - Contains
			if (Array.isArray(value.contains)) {
				refinements = (refinements || z.any().array()).refine(
					(data: Array<unknown>) => value.contains.every(x => data.find(d => d === x)),
					{
						message: `Value must contains all this elements: ${value.contains.join(", ")}`
					}
				);
			} else if (typeof value.contains !== "undefined") {
				refinements = (refinements || z.any().array()).refine(
					(data: Array<unknown>) => data.find(d => d === value.contains),
					{ message: `Value must contain this element: ${value.contains}` }
				);
			}
			// - Unique
			if (value.unique === true) {
				refinements = (refinements || z.any().array()).refine(
					(data: Array<unknown>) =>
						data.every((v, index, array) => array.findIndex(d => d === v) === index),
					{ message: "Value must contain unique elements" }
				);
			}
			// - Enum
			if (Array.isArray(value.enum)) {
				refinements = (refinements || z.any().array()).refine(
					(data: Array<unknown>) => data.every(d => value.enum.find(v => v === d)),
					{
						message: `Value must contains only enum requested values: ${value.enum.join(", ")}`
					}
				);
			}

			if (refinements) {
				pipelines.push(refinements);
			}

			// No manipulation rules
		}
		// Object type
		if (value.type === "object") {
			const properties = {};
			const source = value.props ?? value.properties ?? {};
			for (const prop in source) {
				properties[prop] = this.convert(source[prop], $$strict, $$remove);
			}

			// Additional keys, nullable, optional and default value
			let valueSet:
				| z.ZodObject<z.ZodRawShape>
				| z.ZodNullable<z.ZodObject<z.ZodRawShape>>
				| z.ZodOptional<z.ZodTypeAny>
				| z.ZodDefault<z.ZodTypeAny> = z.object(properties as Record<string, z.ZodTypeAny>);
			// Remove additional keys if not required or throw error
			if (value.strict === true || $$strict === true) {
				valueSet = valueSet.strict();
				// - Remove transformation
			} else if (value.strict === "remove" || $$remove === true) {
				valueSet = valueSet.passthrough();
			}
			// - Nullable
			if (value.nullable === true) {
				valueSet = valueSet.nullable();
			}
			// - Optional
			if (value.optional === true) {
				valueSet = valueSet.optional();
			}
			// - Default value
			if (typeof value.default === "object" || typeof value.default === "function") {
				valueSet = valueSet.default(value.default);
			}

			pipelines.push(valueSet);

			// No pre-process rules

			// No validation rules

			// Refinements rules
			let refinements: z.ZodEffects<z.ZodTypeAny, object, object>;
			// - Min props
			if (typeof value.minProps === "number") {
				refinements = (refinements ?? z.object(properties)).refine(
					(arg: object) => Object.keys(arg).length >= value.minProps,
					{ message: `The object must contain at least ${value.minProps} properties` }
				);
			}
			// - Max props
			if (typeof value.maxProps === "number") {
				refinements = (refinements ?? z.object(properties)).refine(
					(arg: object) => Object.keys(arg).length <= value.maxProps,
					{ message: `The object must contain at most ${value.minProps} properties` }
				);
			}

			if (refinements) {
				pipelines.push(refinements);
			}

			// No manipulation rules
		}
		// Multi type
		if (value.type === "multi") {
			// Convert, nullable, optional and default value
			let valueSet:
				| z.ZodTypeAny
				| z.ZodNullable<z.ZodTypeAny>
				| z.ZodOptional<z.ZodTypeAny>
				| z.ZodDefault<z.ZodTypeAny> = this.convert(value.rules[0], $$strict, $$remove);

			for (let i = 1; i < value.rules.length; i++) {
				valueSet = valueSet.or(this.convert(value.rules[i], $$strict, $$remove));
			}

			// - Nullable
			if (value.nullable === true) {
				valueSet = valueSet.nullable();
			}
			// - Optional
			if (value.optional === true) {
				valueSet = valueSet.optional();
			}
			// - Default value
			if (typeof value.default !== "undefined" || typeof value.default === "function") {
				valueSet = valueSet.default(value.default);
			}

			pipelines.push(valueSet);

			// No pre-process rules

			// No validation rules

			// No refinements rules

			// No manipulation rules
		}
		// Tuple type
		if (value.type === "tuple") {
			const items: Array<z.ZodTypeAny> = [];
			for (const item of value.items) {
				items.push(this.convert(item, $$strict, $$remove));
			}

			// Convert, nullable, optional and default value
			let valueSet:
				| z.ZodTuple
				| z.ZodNullable<z.ZodTuple>
				| z.ZodOptional<z.ZodTypeAny>
				| z.ZodDefault<z.ZodTypeAny> = z.tuple(items as z.ZodTupleItems);
			// - Nullable
			if (value.nullable === true) {
				valueSet = valueSet.nullable();
			}
			// - Optional
			if (value.optional === true) {
				valueSet = valueSet.optional();
			}
			// - Default value
			if (Array.isArray(value.default) || typeof value.default === "function") {
				valueSet = valueSet.default(value.default);
			}

			pipelines.push(valueSet);

			// No pre-process rules

			// No validation rules

			// No refinements rules

			// No manipulation rules
		}
		// URL type
		if (value.type === "url") {
			// Convert, nullable, optional and default value
			let valueSet:
				| z.ZodString
				| z.ZodNullable<z.ZodString>
				| z.ZodOptional<z.ZodTypeAny>
				| z.ZodDefault<z.ZodTypeAny> = z.string().url();
			// - Convert
			if (value.convert === true) {
				valueSet = z.coerce.string().url();
			}
			// - Nullable
			if (value.nullable === true) {
				valueSet = valueSet.nullable();
			}
			// - Optional
			if (value.optional === true) {
				valueSet = valueSet.optional();
			}
			// - Default value
			if (typeof value.default === "string" || typeof value.default === "function") {
				valueSet = valueSet.default(value.default);
			}

			pipelines.push(valueSet);

			// No pre-process rules

			// Validation rules
			let validation: z.ZodString;
			// - Empty
			if (value.empty === false) {
				validation = (validation ?? z.string().url()).trim().min(1);
			}

			if (validation) {
				pipelines.push(validation);
			}

			// No refinements rules

			// No manipulation rules
		}
		// UUID type
		if (value.type === "uuid") {
			// Convert, nullable, optional and default value
			let valueSet:
				| z.ZodString
				| z.ZodNullable<z.ZodString>
				| z.ZodOptional<z.ZodTypeAny>
				| z.ZodDefault<z.ZodTypeAny> = z.string().uuid();
			// - Convert
			if (value.convert === true) {
				valueSet = z.coerce.string().uuid();
			}
			// - Nullable
			if (value.nullable === true) {
				valueSet = valueSet.nullable();
			}
			// - Optional
			if (value.optional === true) {
				valueSet = valueSet.optional();
			}
			// - Default value
			if (typeof value.default === "string" || typeof value.default === "function") {
				valueSet = valueSet.default(value.default);
			}

			pipelines.push(valueSet);

			// No pre-process rules

			// Validation rules
			let validation: z.ZodString;
			// - Empty
			if (value.empty === false) {
				validation = (validation ?? z.string().uuid()).trim().min(1);
			}

			if (validation) {
				pipelines.push(validation);
			}

			// No refinements rules

			// No manipulation rules
		}
		// MongoDB ObjectID type
		if (value.type === "objectID") {
			// Convert, nullable, optional and default value
			let valueSet:
				| z.ZodString
				| z.ZodTypeAny
				| z.ZodNullable<z.ZodString>
				| z.ZodOptional<z.ZodTypeAny>
				| z.ZodDefault<z.ZodTypeAny> = z.string().or(z.instanceof(value.ObjectID));
			// - Nullable
			if (value.nullable === true) {
				valueSet = valueSet.nullable();
			}
			// - Optional
			if (value.optional === true) {
				valueSet = valueSet.optional();
			}
			// - Default value
			if (
				typeof value.default === "string" ||
				value.default instanceof value.ObjectID ||
				typeof value.default === "function"
			) {
				valueSet = valueSet.default(value.default);
			}

			pipelines.push(valueSet);

			// No pre-process rules

			// No validation rules

			// Refinements rules
			const refinements: z.ZodEffects<
				z.ZodUnion<[z.ZodString, z.ZodType]>,
				number,
				number
			> = z
				.string()
				.or(z.instanceof(value.ObjectID))
				.refine((arg: unknown) => value.ObjectID.isValid(arg), {
					message: `Value is not a valid ObjectID`
				});

			if (refinements) {
				pipelines.push(refinements);
			}

			// Manipulation rules
			let manipulation: z.ZodEffects<z.ZodTypeAny, unknown, unknown>;
			// - Convert to class
			if (value.convert === true) {
				manipulation = (manipulation ?? z.string()).transform(
					(arg: string) => new value.ObjectID(arg)
				);
			}
			// - Convert to hexString
			if (value.convert === "hexString") {
				manipulation = (manipulation ?? z.instanceof(value.ObjectID)).transform(
					(arg: unknown) => arg.toString()
				);
			}

			if (manipulation) {
				pipelines.push(manipulation);
			}
		}
		// Record type
		if (value.type === "record") {
			// Convert, nullable, optional and default value
			const dataKey: z.ZodTypeAny = this.convert(value.key, $$strict, $$remove);
			const dataValue: z.ZodTypeAny = this.convert(value.value, $$strict, $$remove);

			let valueSet:
				| z.ZodRecord<z.ZodTypeAny, z.ZodTypeAny>
				| z.ZodNullable<z.ZodRecord<z.ZodTypeAny, z.ZodTypeAny>>
				| z.ZodOptional<z.ZodTypeAny>
				| z.ZodDefault<z.ZodTypeAny> = z.record(dataKey, dataValue);
			// - Nullable
			if (value.nullable === true) {
				valueSet = valueSet.nullable();
			}
			// - Optional
			if (value.optional === true) {
				valueSet = valueSet.optional();
			}
			// - Default value
			if (typeof value.default === "object" || typeof value.default === "function") {
				valueSet = valueSet.default(value.default);
			}

			pipelines.push(valueSet);

			// No pre-process rules

			// No validation rules

			// No refinements rules

			// No manipulation rules
		}

		if (pipelines.length === 0) return null;

		let result = pipelines[0];

		// Set the description if any
		if (typeof value.description === "string") {
			result = result.describe(value.description);
		}

		for (let i = 1; i < pipelines.length; i++) {
			result.pipe(pipelines[i]);
		}

		return result;
	}
}

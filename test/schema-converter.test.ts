import { describe, it, expect } from "vitest";
import { convertFastestValidatorToZod, convertActionParamsToZod } from "../src/schema-converter";

describe("convertFastestValidatorToZod", () => {
	describe("basic types", () => {
		it("string shorthand", () => {
			const result = convertFastestValidatorToZod({ name: "string" });
			expect(result.name.parse("hello")).toBe("hello");
			expect(() => result.name.parse(123)).toThrow();
		});

		it("number shorthand", () => {
			const result = convertFastestValidatorToZod({ age: "number" });
			expect(result.age.parse(25)).toBe(25);
			expect(() => result.age.parse("abc")).toThrow();
		});

		it("boolean shorthand", () => {
			const result = convertFastestValidatorToZod({ active: "boolean" });
			expect(result.active.parse(true)).toBe(true);
			expect(() => result.active.parse("yes")).toThrow();
		});

		it("any type", () => {
			const result = convertFastestValidatorToZod({ data: { type: "any" } });
			expect(result.data.parse("anything")).toBe("anything");
			expect(result.data.parse(42)).toBe(42);
		});
	});

	describe("string constraints", () => {
		it("min and max", () => {
			const result = convertFastestValidatorToZod({
				name: { type: "string", min: 3, max: 100 }
			});
			expect(result.name.parse("hello")).toBe("hello");
			expect(() => result.name.parse("ab")).toThrow();
			expect(() => result.name.parse("x".repeat(101))).toThrow();
		});

		it("pattern", () => {
			const result = convertFastestValidatorToZod({
				code: { type: "string", pattern: "^[A-Z]+$" }
			});
			expect(result.code.parse("ABC")).toBe("ABC");
			expect(() => result.code.parse("abc")).toThrow();
		});

		it("enum values on string", () => {
			const result = convertFastestValidatorToZod({
				color: { type: "string", enum: ["red", "green", "blue"] }
			});
			expect(result.color.parse("red")).toBe("red");
			expect(() => result.color.parse("yellow")).toThrow();
		});

		it("email", () => {
			const result = convertFastestValidatorToZod({ email: { type: "email" } });
			expect(result.email.parse("test@test.com")).toBe("test@test.com");
			expect(() => result.email.parse("notanemail")).toThrow();
		});

		it("url", () => {
			const result = convertFastestValidatorToZod({ url: { type: "url" } });
			expect(result.url.parse("https://example.com")).toBe("https://example.com");
			expect(() => result.url.parse("notaurl")).toThrow();
		});
	});

	describe("number constraints", () => {
		it("positive and integer", () => {
			const result = convertFastestValidatorToZod({
				count: { type: "number", positive: true, integer: true }
			});
			expect(result.count.parse(5)).toBe(5);
			expect(() => result.count.parse(-1)).toThrow();
			expect(() => result.count.parse(1.5)).toThrow();
		});

		it("min and max", () => {
			const result = convertFastestValidatorToZod({
				score: { type: "number", min: 0, max: 100 }
			});
			expect(result.score.parse(50)).toBe(50);
			expect(() => result.score.parse(-1)).toThrow();
			expect(() => result.score.parse(101)).toThrow();
		});

		it("negative", () => {
			const result = convertFastestValidatorToZod({
				temp: { type: "number", negative: true }
			});
			expect(result.temp.parse(-5)).toBe(-5);
			expect(() => result.temp.parse(5)).toThrow();
		});
	});

	describe("array", () => {
		it("array with string items", () => {
			const result = convertFastestValidatorToZod({
				tags: { type: "array", items: "string" }
			});
			expect(result.tags.parse(["a", "b"])).toEqual(["a", "b"]);
			expect(() => result.tags.parse([1, 2])).toThrow();
		});

		it("array with object items", () => {
			const result = convertFastestValidatorToZod({
				items: { type: "array", items: { type: "object", props: { id: "number" } } }
			});
			expect(result.items.parse([{ id: 1 }])).toEqual([{ id: 1 }]);
		});
	});

	describe("object", () => {
		it("object with props", () => {
			const result = convertFastestValidatorToZod({
				address: { type: "object", props: { city: "string", zip: "number" } }
			});
			const parsed = result.address.parse({ city: "NYC", zip: 10001 });
			expect(parsed).toEqual({ city: "NYC", zip: 10001 });
		});

		it("nested objects", () => {
			const result = convertFastestValidatorToZod({
				user: {
					type: "object",
					props: {
						name: "string",
						address: {
							type: "object",
							props: {
								street: "string",
								city: "string"
							}
						}
					}
				}
			});
			const parsed = result.user.parse({
				name: "John",
				address: { street: "123 Main", city: "NYC" }
			});
			expect(parsed.name).toBe("John");
			expect(parsed.address.city).toBe("NYC");
		});
	});

	describe("enum type", () => {
		it("enum with values", () => {
			const result = convertFastestValidatorToZod({
				status: { type: "enum", values: ["active", "inactive"] }
			});
			expect(result.status.parse("active")).toBe("active");
			expect(() => result.status.parse("unknown")).toThrow();
		});
	});

	describe("date type", () => {
		it("date converts to string", () => {
			const result = convertFastestValidatorToZod({ created: { type: "date" } });
			expect(result.created.parse("2024-01-01")).toBe("2024-01-01");
		});
	});

	describe("optional and default", () => {
		it("optional field", () => {
			const result = convertFastestValidatorToZod({
				name: { type: "string", optional: true }
			});
			expect(result.name.parse(undefined)).toBeUndefined();
			expect(result.name.parse("hello")).toBe("hello");
		});

		it("default value", () => {
			const result = convertFastestValidatorToZod({
				count: { type: "number", default: 5 }
			});
			expect(result.count.parse(undefined)).toBe(5);
			expect(result.count.parse(10)).toBe(10);
		});
	});

	describe("pipe syntax", () => {
		it("number|integer|positive", () => {
			const result = convertFastestValidatorToZod({
				id: "number|integer|positive"
			});
			expect(result.id.parse(5)).toBe(5);
			expect(() => result.id.parse(-1)).toThrow();
			expect(() => result.id.parse(1.5)).toThrow();
		});

		it("string|optional", () => {
			const result = convertFastestValidatorToZod({
				name: "string|optional"
			});
			expect(result.name.parse(undefined)).toBeUndefined();
			expect(result.name.parse("hello")).toBe("hello");
		});
	});

	describe("unknown/custom type", () => {
		it("unknown type becomes z.any()", () => {
			const result = convertFastestValidatorToZod({
				custom: { type: "customValidator" }
			});
			expect(result.custom.parse("anything")).toBe("anything");
			expect(result.custom.parse(42)).toBe(42);
		});
	});

	describe("$$root handling", () => {
		it("$$root: true wraps as root schema", () => {
			const result = convertFastestValidatorToZod({
				$$root: true,
				type: "string"
			});
			expect(result.$$root).toBeDefined();
			expect(result.$$root.parse("hello")).toBe("hello");
		});

		it("$$root: true with object type", () => {
			const result = convertFastestValidatorToZod({
				$$root: true,
				type: "object",
				props: { name: "string" }
			});
			expect(result.$$root.parse({ name: "John" })).toEqual({ name: "John" });
		});
	});
});

describe("convertActionParamsToZod", () => {
	it("undefined params returns empty object", () => {
		expect(convertActionParamsToZod(undefined)).toEqual({});
	});

	it("null params returns empty object", () => {
		expect(convertActionParamsToZod(null)).toEqual({});
	});

	it("string shorthand", () => {
		const result = convertActionParamsToZod("string");
		expect(result.$$root).toBeDefined();
		expect(result.$$root.parse("hello")).toBe("hello");
	});

	it("object params", () => {
		const result = convertActionParamsToZod({
			name: "string",
			age: { type: "number", optional: true }
		});
		expect(result.name.parse("John")).toBe("John");
		expect(result.age.parse(undefined)).toBeUndefined();
	});
});

describe("fork additions", () => {
	it("pipe syntax with key:value options", () => {
		const result = convertFastestValidatorToZod({
			name: "string|min:3|max:5",
			age: "number|integer|min:18",
			nick: "string|nullable|optional"
		});
		expect(result.name.parse("abcd")).toBe("abcd");
		expect(() => result.name.parse("ab")).toThrow();
		expect(() => result.name.parse("abcdef")).toThrow();
		expect(result.age.parse(18)).toBe(18);
		expect(() => result.age.parse(17)).toThrow();
		expect(result.nick.parse(null)).toBeNull();
		expect(result.nick.parse(undefined)).toBeUndefined();
	});

	it("$$root with pipe syntax", () => {
		const result = convertActionParamsToZod("string|min:3");
		expect(result.$$root.parse("abc")).toBe("abc");
		expect(() => result.$$root.parse("ab")).toThrow();
	});

	it("description is forwarded to the schema", () => {
		const result = convertFastestValidatorToZod({
			city: { type: "string", description: "Name of the city" }
		});
		expect(result.city.description).toBe("Name of the city");
	});

	it("nullable", () => {
		const result = convertFastestValidatorToZod({ value: { type: "number", nullable: true } });
		expect(result.value.parse(null)).toBeNull();
		expect(() => result.value.parse(undefined)).toThrow();
	});

	it("uuid", () => {
		const result = convertFastestValidatorToZod({ id: "uuid" });
		expect(result.id.parse("2f1e6a1c-6a3b-4c1e-9a7f-1b2c3d4e5f60")).toBeDefined();
		expect(() => result.id.parse("not-a-uuid")).toThrow();
	});

	it("multi rule (explicit and array shorthand)", () => {
		const result = convertFastestValidatorToZod({
			a: { type: "multi", rules: ["string", "number"] },
			b: [{ type: "string" }, { type: "boolean" }]
		});
		expect(result.a.parse("x")).toBe("x");
		expect(result.a.parse(1)).toBe(1);
		expect(() => result.a.parse(true)).toThrow();
		expect(result.b.parse(true)).toBe(true);
		expect(() => result.b.parse(1)).toThrow();
	});

	it("object with `properties` alias", () => {
		const result = convertFastestValidatorToZod({
			user: { type: "object", properties: { name: "string" } }
		});
		expect(result.user.parse({ name: "John" })).toEqual({ name: "John" });
		expect(() => result.user.parse({ name: 1 })).toThrow();
	});

	it("array and string length constraints", () => {
		const result = convertFastestValidatorToZod({
			tags: { type: "array", items: "string", min: 1, max: 2 },
			code: { type: "string", length: 3 },
			text: { type: "string", empty: false }
		});
		expect(() => result.tags.parse([])).toThrow();
		expect(() => result.tags.parse(["a", "b", "c"])).toThrow();
		expect(result.tags.parse(["a"])).toEqual(["a"]);
		expect(() => result.code.parse("ab")).toThrow();
		expect(() => result.text.parse("")).toThrow();
	});
});

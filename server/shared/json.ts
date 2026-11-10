import type { JsonValue } from "./types/contracts.js";
import { isObject } from "./types/contracts.js";
import { requireValue } from "./errors/business-error.js";

export function jsonDocument(
  input: unknown,
  label: string,
): { value: JsonValue; text: string } {
  try {
    const parsed: unknown =
      typeof input === "string" ? JSON.parse(input) : input;
    const text = JSON.stringify(parsed, (_key, value: unknown) => {
      if (typeof value === "number")
        requireValue(Number.isFinite(value), `${label}包含无效数字`);
      if (isObject(value))
        return Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, value[key]]),
        );
      return value;
    });
    requireValue(typeof text === "string", `${label}格式无效`);
    return { value: JSON.parse(text) as JsonValue, text };
  } catch (error) {
    if (error instanceof Error && "status" in error) throw error;
    requireValue(false, `${label}JSON格式错误`);
  }
}

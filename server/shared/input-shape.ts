import { requireValue } from "./errors/business-error.js";

export function str(value: unknown, label: string): string {
  requireValue(typeof value === "string" && value.trim().length > 0, label + "不能为空");
  return value;
}
export function optStr(value: unknown, label: string): string | undefined {
  requireValue(value === undefined || value === null || typeof value === "string",
    label + "必须为文本");
  return typeof value === "string" ? value : undefined;
}
export function optNullableStr(value: unknown, label: string): string | null | undefined {
  requireValue(value === undefined || value === null || typeof value === "string",
    label + "必须为文本");
  return value;
}
export function num(value: unknown, label: string): number {
  requireValue(typeof value === "number" && Number.isSafeInteger(value), label + "必须为安全整数");
  return value;
}
export function optNum(value: unknown, label: string): number | undefined {
  requireValue(value === undefined || value === null ||
    (typeof value === "number" && Number.isSafeInteger(value)), label + "必须为安全整数");
  return typeof value === "number" ? value : undefined;
}
export function optNullableNum(value: unknown, label: string): number | null | undefined {
  requireValue(value === undefined || value === null ||
    (typeof value === "number" && Number.isSafeInteger(value)), label + "必须为安全整数");
  return value;
}

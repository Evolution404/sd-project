import { requireValue, integer } from "./errors/business-error.js";

export function scaledDecimal(value: unknown, places: number, label: string): number {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(String(value).trim());
  requireValue(match && (!match[2] || match[2].length <= places), `${label}最多保留${places}位小数`);
  const result = BigInt(match[1]) * 10n ** BigInt(places) + BigInt((match[2] || "").padEnd(places, "0"));
  requireValue(result <= BigInt(Number.MAX_SAFE_INTEGER), `${label}超出安全整数范围`);
  return integer(Number(result), label);
}

export function decimalText(value: number | bigint, places: number): string {
  const number = BigInt(value), factor = 10n ** BigInt(places);
  return `${number / factor}.${(number % factor).toString().padStart(places, "0")}`;
}

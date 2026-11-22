/** Compare the business amount entered in a list filter with its stored integer. */
export function fixedListValue(value: string, places: number): number | null {
  const parts = /^(-?)(?:[¥￥]\s*)?(\d+|\d{1,3}(?:,\d{3})+)(?:\.(\d+))?$/.exec(value.trim());
  if (!parts) return null;
  const fractional = (parts[3] || "").replace(/0+$/, "");
  if (fractional.length > places) return null;
  const magnitude = BigInt(parts[2].replaceAll(",", "")) * 10n ** BigInt(places) +
    BigInt(fractional.padEnd(places, "0") || "0");
  if (magnitude > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(parts[1] ? -magnitude : magnitude);
}

export function listDisplayScale(key: string): number | null {
  if (key.endsWith("_fen")) return 2;
  if (key.endsWith("_scaled")) return 4;
  return key === "transmission_center_length_mm" ? 3 : null;
}

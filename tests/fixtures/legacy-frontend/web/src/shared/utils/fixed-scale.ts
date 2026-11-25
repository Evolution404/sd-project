/**
 * Convert a user-entered decimal into an exact fixed-scale safe integer.
 * Never round or truncate business quantities/amounts. Return null when
 * the exact decimal cannot be represented at the requested scale.
 */
export function exactScaledInteger(value: number, places: number): number | null {
  if (!Number.isFinite(value) || !Number.isInteger(places) || places < 0 || places > 4)
    return null;
  const text = value.toString();
  const parts = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!parts) return null;
  const fractional = parts[3] ?? "";
  const exponent = Number(parts[4] ?? "0");
  // Input longer than any safe decimal exponent cannot become a safe fixed integer.
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 40)
    return null;
  const digits = BigInt((parts[2] ?? "0") + fractional);
  const shift = places + exponent - fractional.length;
  const magnitude = shift >= 0
    ? digits * 10n ** BigInt(shift)
    : (digits % (10n ** BigInt(-shift)) === 0n
      ? digits / (10n ** BigInt(-shift)) : null);
  if (magnitude === null) return null;
  const signed = parts[1] === "-" ? -magnitude : magnitude;
  if (signed > BigInt(Number.MAX_SAFE_INTEGER) ||
      signed < BigInt(Number.MIN_SAFE_INTEGER)) return null;
  return Number(signed);
}

export function quantityFitsUnitPrecision(quantityScaled: number, precision: number): boolean {
  return Number.isSafeInteger(quantityScaled) && Number.isInteger(precision) &&
    precision >= 0 && precision <= 4 &&
    quantityScaled % 10 ** (4 - precision) === 0;
}

/** Parse decimal text exactly; never let an input widget coerce 0.2501 to 0.25. */
export function exactScaledDecimalText(text: string, places: number): number | null {
  if (!Number.isInteger(places) || places < 0 || places > 4) return null;
  // No user input can represent a safe fixed-scale integer with >64 digits.
  // Reject before BigInt/large exponent work.
  if (text.length > 64) return null;
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (!match) return null;
  const decimals = match[3] || "";
  const value = BigInt(match[2] + decimals);
  const shift = places - decimals.length;
  const power = 10n ** BigInt(Math.abs(shift));
  const magnitude = shift >= 0
    ? value * power
    : value % power === 0n ? value / power : null;
  if (magnitude === null) return null;
  const signed = match[1] === "-" ? -magnitude : magnitude;
  return signed <= BigInt(Number.MAX_SAFE_INTEGER) &&
    signed >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(signed) : null;
}

/** Display monetary, quantity and measured-length integers without float artifacts. */
export function formatScaledDecimal(value: number | null | undefined, places: number): string {
  if (value === null || value === undefined) return "";
  if (!Number.isSafeInteger(value) || !Number.isInteger(places) || places < 0 || places > 4)
    return "";
  const scaled = BigInt(value);
  const positive = scaled < 0n ? -scaled : scaled;
  const unit = 10n ** BigInt(places);
  const fractional = places ? "." + String(positive % unit).padStart(places, "0").replace(/0+$/, "") : "";
  return (scaled < 0n ? "-" : "") + String(positive / unit) +
    (fractional === "." ? "" : fractional);
}

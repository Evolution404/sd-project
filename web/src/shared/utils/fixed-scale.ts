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

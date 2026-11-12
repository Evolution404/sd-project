/**
 * Deterministic, string-valued natural sort key. Used by a SQLite scalar
 * function so sorting happens before LIMIT/OFFSET, never on one local page.
 * Pure numeric IDs sort first; every numeric segment sorts by integer value.
 * This also preserves lexical ordering for letters, punctuation and Chinese.
 */
export function naturalTowerSortKey(input: unknown): string {
  if (typeof input !== "string" || !input) return "\uffff";
  const segments = input.normalize("NFKC").match(/\d+|\D+/g) ?? [];
  const parts = segments.map(segment => {
    if (!/^\d+$/.test(segment)) return "T" + segment.toLocaleLowerCase("en-US");
    const digits = segment.replace(/^0+/, "") || "0";
    return "N" + String(digits.length).padStart(5, "0") + digits;
  });
  return (/^\d/.test(input) ? "0" : "1") + parts.join("\u0001");
}


/** Use the smallest associated natural pole number for shared physical towers,
 * never GROUP_CONCAT's arbitrary text order. Identical keys stay id-stable.
 */
export function naturalRelatedTowerSortKey(input: unknown): string {
  if (typeof input !== "string" || !input.trim()) return "\uffff";
  const values = input.split(/[,、，]/).map(x => x.trim()).filter(Boolean);
  return values.length
    ? values.map(naturalTowerSortKey).sort()[0]
    : "\uffff";
}

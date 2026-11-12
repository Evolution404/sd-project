/** Presentation-only Chinese names; canonical equipment fields/history remain unchanged. */
const towerTypeNames = Object.freeze({
  angle: "角钢塔",
  pipe: "钢管塔",
  suspension: "悬垂塔",
});
/** @param {unknown} value */
export function towerTypeLabel(value) {
  if (typeof value !== "string" || !value.trim()) return "待核实";
  const original = value.trim();
  return Object.hasOwn(towerTypeNames, original.toLowerCase())
    ? towerTypeNames[original.toLowerCase()] : original;
}
/** @param {unknown} value */
export function towerNatureLabel(value) {
  if (value === "straight") return "直线塔";
  if (value === "tension") return "耐张塔";
  return "待核实";
}

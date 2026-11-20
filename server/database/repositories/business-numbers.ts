import type { createStore } from "./store.js";

const registers = {
  demands: ["demands", "demand_no", "XQ"],
  projects: ["projects", "code", "XM"],
  settlements: ["settlements", "number", "JS"],
  changes: ["project_change_orders", "code", "BG"],
  frameworks: ["frameworks", "code", "ND"],
  agreements: ["agreements", "code", "XY"],
  materials: ["materials", "code", "WZ"],
  objects: ["work_objects", "code", "DZ"],
  operations: ["operations", "code", "CZ"],
  prices: ["reference_price_catalog", "code", "JG"],
  lines: ["transmission_lines", "line_code", "XL"],
  physical: ["physical_towers", "tower_code", "ST"],
  towers: ["logical_towers", "logical_code", "HT"],
  voltages: ["voltage_levels", "code", "DY"],
  organizations: ["organizational_units", "code", "ZZ"],
  units: ["dictionary_items", "code", "DW"],
  priorities: ["dictionary_items", "code", "YX"],
  categories: ["dictionary_items", "code", "LB"],
  tower_natures: ["dictionary_items", "code", "XZ"],
  tower_materials: ["dictionary_items", "code", "CZL"],
} as const;
type Register = keyof typeof registers;

/** Called inside the same IMMEDIATE write transaction that creates the identity.
 * The write lock protects allocation and insertion together; the existing unique
 * index and archived identities also prevent reuse of an issued number. */
export function nextBusinessNumber(store: Pick<ReturnType<typeof createStore>, "get">, register: Register) {
  const [table, column, prefix] = registers[register];
  const base = prefix + "-";
  for (let width = 6; ; width++) {
    const lowest = width === 6 ? "000000" : "1" + "0".repeat(width - 1);
    const ceiling = "9".repeat(width);
    const last = store.get<{ code: string }>(
      `SELECT ${column} AS code FROM ${table}
       WHERE ${column} BETWEEN ? AND ? AND ${column} GLOB ?
       ORDER BY ${column} DESC LIMIT 1`,
      base + lowest, base + ceiling, base + "[0-9]".repeat(width),
    );
    const lastDigits = last?.code.slice(base.length);
    if (lastDigits === ceiling) continue;
    const next = lastDigits ? BigInt(lastDigits) + 1n : width === 6 ? 1n : BigInt(lowest);
    return base + next.toString().padStart(width, "0");
  }
}

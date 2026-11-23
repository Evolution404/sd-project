import { requireValue } from "../../shared/errors/business-error.js";

export type DetailKind = "work_locations" | "materials" | "items" | "resolutions";
export type DetailRow = Record<string, unknown>;

export function cleanRow(row: DetailRow): DetailRow {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith("_")));
}

// The stable matching identity is an adopted business reference, never an
// imported editable display label or the spreadsheet's physical row number.
export function detailIdentity(kind: DetailKind, row: DetailRow): unknown {
  if (kind === "work_locations")
    return `${row.location_kind}/${row.logical_tower_id || row.physical_tower_id || row.span_id}`;
  if (kind === "materials") return row.material_id;
  if (kind === "items")
    return `${row.cost_node_id}/${row.project_scope_id || ""}`;
  return `${row.project_scope_id}/${row.location_item_no}`;
}

/**
 * A missing maintenance row leaves its previous formal detail unchanged.
 * An explicit delete removes only the matching detail; an upsert updates in
 * place, preserving stable ordering and fields absent from the workbook.
 * Indexed lookup scales linearly even for 25,000 detail rows.
 */
export function mergeDetails(
  kind: DetailKind,
  old: DetailRow[],
  updates: DetailRow[],
): DetailRow[] {
  const order = old.map(row => ({ value: { ...row }, active: true }));
  const positions = new Map<unknown, number>();
  order.forEach((row, index) => {
    const key = detailIdentity(kind, row.value);
    if (!positions.has(key)) positions.set(key, index);
  });
  for (const row of updates) {
    const entry = cleanRow(row);
    const key = detailIdentity(kind, entry);
    const position = positions.get(key);
    delete entry.action;
    if (row.action === "delete") {
      requireValue(position !== undefined, "删除明细不存在");
      order[position].active = false;
      positions.delete(key);
    } else {
      requireValue(!row.action || row.action === "upsert", "未知明细动作");
      if (position !== undefined) {
        order[position].value = { ...order[position].value, ...entry };
      } else {
        positions.set(key, order.length);
        order.push({ value: entry, active: true });
      }
    }
  }
  return order.filter(row => row.active).map(row => row.value);
}

export interface ExchangeDifference {
  field: string;
  before: unknown;
  after: unknown;
}
export function differences(
  before: DetailRow | null | undefined,
  after: DetailRow | null | undefined,
  path = "",
): ExchangeDifference[] {
  const result: ExchangeDifference[] = [];
  for (const key of new Set([
    ...Object.keys(before || {}),
    ...Object.keys(after || {}),
  ])) {
    if (["_sheet", "_row"].includes(key)) continue;
    const a = before?.[key];
    const b = after?.[key];
    if (JSON.stringify(a) !== JSON.stringify(b))
      result.push({ field: path + key, before: a ?? null, after: b ?? null });
  }
  return result;
}

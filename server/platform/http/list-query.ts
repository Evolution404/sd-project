import { isObject, type ListQuery } from "../../shared/types/contracts.js";
import { requireValue } from "../../shared/errors/business-error.js";

function positiveInteger(value: string | null, fallback: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

export function parseListQuery(search: URLSearchParams): ListQuery {
  let filters: Record<string, string> = {};
  try {
    const parsed: unknown = JSON.parse(search.get("filters") || "{}");
    if (isObject(parsed)) {
      filters = Object.fromEntries(Object.entries(parsed)
        .filter((entry): entry is [string, string] =>
          /^[a-z_]{1,60}$/.test(entry[0]) && typeof entry[1] === "string" && entry[1].length <= 128)
        .slice(0, 20));
    }
  } catch {
    // Invalid optional view preferences fall back to an unfiltered list.
  }
  const gridFilters: NonNullable<ListQuery["grid_filters"]> = {};
  const gridSource = search.get("grid_filters");
  if (gridSource !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(gridSource);
    } catch {
      requireValue(false, "表格筛选条件不是有效JSON，请重新选择", 400);
    }
    requireValue(isObject(parsed), "表格筛选条件必须为字段与候选值列表", 400);
    const entries = Object.entries(parsed);
    requireValue(entries.length <= 16, "最多允许同时筛选16列", 400);
    for (const [key, raw] of entries) {
      requireValue(/^[a-z_]{1,60}$/.test(key) && Array.isArray(raw) && raw.length <= 256
        && raw.every(item => item === null || (typeof item === "string" && item.length <= 128)),
        "表格筛选字段或候选值无效：" + key, 400);
      gridFilters[key] = [...new Set(raw)];
    }
  }
  return {
    page: positiveInteger(search.get("page"), 1, 1_000_000),
    page_size: positiveInteger(search.get("page_size"), 30, 200),
    q: (search.get("q") || "").trim().slice(0, 160),
    sort: search.get("sort") || "created_at",
    direction: search.get("direction") === "asc" ? "asc" : "desc",
    filters,
    grid_filters: gridFilters,
    deleted: search.get("deleted") === "true",
  };
}

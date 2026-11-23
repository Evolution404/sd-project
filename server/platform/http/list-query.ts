import { isObject, type GridFilter, type ListQuery } from "../../shared/types/contracts.js";
import { requireValue } from "../../shared/errors/business-error.js";

function positiveInteger(value: string | null, fallback: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function validFacetValue(value: unknown) {
  return value === null || (typeof value === "string" && value.length <= 1024);
}

export function parseGridSelection(value: unknown): GridFilter {
  if (Array.isArray(value)) {
    requireValue(value.length <= 256 && value.every(validFacetValue), "表格候选值无效", 400);
    return [...new Set(value)];
  }
  requireValue(isObject(value) && typeof value.all === "boolean" &&
    typeof value.term === "string" && value.term.length <= 128 &&
    Array.isArray(value.rules) && value.rules.length <= 256 && value.rules.every(rule =>
      isObject(rule) && typeof rule.checked === "boolean" && ("value" in rule
        ? validFacetValue(rule.value)
        : typeof rule.term === "string" && rule.term.length > 0 && rule.term.length <= 128 &&
          (rule.outside === undefined || typeof rule.outside === "boolean"))),
  "表格候选选择无效", 400);
  return { all: value.all, term: value.term, rules: value.rules };
}

export function parseGridJSON(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    requireValue(false, "表格筛选条件不是有效JSON，请重新选择", 400);
  }
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
    const parsed = parseGridJSON(gridSource);
    requireValue(isObject(parsed), "表格筛选条件必须为字段与候选值列表", 400);
    const entries = Object.entries(parsed);
    requireValue(entries.length <= 16, "最多允许同时筛选16列", 400);
    for (const [key, raw] of entries) {
      requireValue(/^[a-z_]{1,60}$/.test(key), "表格筛选字段无效：" + key, 400);
      gridFilters[key] = parseGridSelection(raw);
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

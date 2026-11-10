import { isObject, type ListQuery } from "../../shared/types/contracts.js";

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
  return {
    page: positiveInteger(search.get("page"), 1, 1_000_000),
    page_size: positiveInteger(search.get("page_size"), 30, 200),
    q: (search.get("q") || "").trim().slice(0, 160),
    sort: search.get("sort") || "created_at",
    direction: search.get("direction") === "asc" ? "asc" : "desc",
    filters,
    deleted: search.get("deleted") === "true",
  };
}

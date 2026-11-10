import type { Page } from "../../shared/types/contracts.js";
import { parseListQuery } from "./list-query.js";

// Reserved for bounded configuration lists. High-volume business lists use SQL queries.
export function memoryPage<T extends object>(rows: T[], search: URLSearchParams): Page<T> {
  const query = parseListQuery(search);
  const direction = query.direction === "asc" ? 1 : -1;
  const filtered = rows.filter(row => !query.q || JSON.stringify(row).includes(query.q))
    .filter(row => Object.entries(query.filters).every(([key, value]) =>
      String(Reflect.get(row, key) ?? "").toLocaleLowerCase("zh-CN").includes(value.toLocaleLowerCase("zh-CN"))))
    .sort((a, b) => String(Reflect.get(a, query.sort) ?? "")
      .localeCompare(String(Reflect.get(b, query.sort) ?? ""), "zh-CN", { numeric: true }) * direction);
  return { items: filtered.slice((query.page - 1) * query.page_size, query.page * query.page_size),
    total: filtered.length, page: query.page, page_size: query.page_size };
}

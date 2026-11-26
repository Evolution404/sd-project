import type { Page } from "../../shared/types/contracts.js";
import { parseListQuery } from "./list-query.js";
import { requireValue } from "../../shared/errors/business-error.js";

// Reserved for bounded configuration lists. High-volume business lists use SQL queries.
export function memoryPage<T extends object>(rows: T[], search: URLSearchParams, gridFields: readonly string[] = []): Page<T> {
  const query = parseListQuery(search);
  const direction = query.direction === "asc" ? 1 : -1;
  const nativeFilters=Object.entries(gridFields.length ? query.grid_filters ?? {} : {}).map(([field,selection])=>{
    requireValue(gridFields.includes(field) && Array.isArray(selection),"不支持的配置列表筛选字段："+field,400);
    return {field,selection};
  });
  const keyword = query.q.toLocaleLowerCase("zh-CN");
  const filtered = rows.filter(row => !keyword || JSON.stringify(row).toLocaleLowerCase("zh-CN").includes(keyword))
    .filter(row => Object.entries(query.filters).every(([key, value]) =>
      {
        const raw = Reflect.get(row, key);
        if ((key === "role_codes" || key === "organization_ids") && Array.isArray(raw)) return raw.includes(value);
        const field = String(raw ?? "").toLocaleLowerCase("zh-CN");
        const expected = value.toLocaleLowerCase("zh-CN");
        return key === "status" || key === "display_status" ? field === expected : field.includes(expected);
      }))
    .filter(row=>nativeFilters.every(({field,selection})=>selection.includes(Reflect.get(row,field) == null || Reflect.get(row,field)==="" ? null : String(Reflect.get(row,field)))))
    .sort((a, b) => String(Reflect.get(a, query.sort) ?? "")
      .localeCompare(String(Reflect.get(b, query.sort) ?? ""), "zh-CN", { numeric: true }) * direction);
  return { items: filtered.slice((query.page - 1) * query.page_size, query.page * query.page_size),
    total: filtered.length, page: query.page, page_size: query.page_size };
}

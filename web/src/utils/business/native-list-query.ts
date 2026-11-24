/** Adapter from upstream CrudTable's native Element Plus events to business list HTTP parameters.
 * No custom table, filter menu or local page sorting. Each caller declares only server-supported fields.
 */
import type {CrudSearchConfig} from "@/components/Crud/types";
import type {HistoryScopeGuideId} from "@/guides/registry/history-scope";
export function historyScopeField(guide:HistoryScopeGuideId):NonNullable<CrudSearchConfig["fields"]>[number] {
  return {type:"select",prop:"include_deleted",label:"记录范围",attrs:{placeholder:"正常记录",clearable:true,"data-guide-action":guide},
    options:[{label:"正常记录",value:"false"},{label:"包含已删除",value:"true"}]};
}
export interface NativeListOptions {
  includeDeleted?:boolean;
  sort?: string;
  direction?: "asc" | "desc";
  gridFilters?: Record<string, string[]>;
  filters?: Record<string, string>;
}
type NativeQuery = { sort?: unknown; [key: string]: unknown };
type Choice = { value: string; text: string };

export function nativeColumnFilter(field: string, choices: readonly Choice[], single = false) {
  return { columnKey: "header_" + field, filters: [...choices], filterMultiple: !single };
}
export function nativeListQuery(query: NativeQuery, fields: readonly string[] = [], single = false): NativeListOptions {
  const order = Array.isArray(query.sort) && typeof query.sort[0] === "string"
    ? /^([a-z_]+),(asc|desc)$/.exec(query.sort[0]) : null;
  const result: NativeListOptions = order
    ? { sort: order[1], direction: order[2] as "asc" | "desc" } : {};
  if(query.include_deleted==="true")result.includeDeleted=true;
  for (const field of fields) {
    const raw = query["header_" + field];
    if (!Array.isArray(raw)) continue;
    const values = [...new Set(raw.filter((value): value is string => typeof value === "string" && value.length > 0))];
    if (!values.length) continue;
    if (single) (result.filters ??= {})[field] = values[0];
    else (result.gridFilters ??= {})[field] = values;
  }
  return result;
}
export function applyNativeListQuery(params: URLSearchParams, options: NativeListOptions): URLSearchParams {
  if(options.includeDeleted!==undefined)params.set("deleted",String(options.includeDeleted));
  if (options.sort) {
    params.set("sort", options.sort);
    params.set("direction", options.direction ?? "desc");
  }
  if (options.filters && Object.keys(options.filters).length) {
    const existing = JSON.parse(params.get("filters") || "{}") as Record<string, string>;
    params.set("filters", JSON.stringify({ ...existing, ...options.filters }));
  }
  if (options.gridFilters && Object.keys(options.gridFilters).length) {
    params.set("grid_filters", JSON.stringify(options.gridFilters));
  }
  return params;
}
export const activeStatusChoices = [
  { text: "启用", value: "active" }, { text: "停用", value: "inactive" },
];
export const projectStatusChoices = ["储备", "已入库", "立项中", "已批准", "变更中", "已结项"]
  .map(value => ({ text: value, value }));

import type { RouteContext } from "../../platform/http/context.js";
import type { HistoryKind } from "../../shared/types/history.js";
import { requireValue } from "../../shared/errors/business-error.js";

export async function handleHistory({ system, actor, read, key, sub, subKey, url }: RouteContext) {
  requireValue(read, "历史记录仅支持查询", 405);
  requireValue(key && sub && !subKey, "历史记录地址无效", 404);
  const params = url.searchParams;
  const page = Number(params.get("page") ?? 1);
  const date = (name: string) => {
    const value = params.get(name) ?? "";
    requireValue(!value || /^\d{4}-\d{2}-\d{2}$/.test(value), "请使用正确的查询日期");
    return value || undefined;
  };
  const start = date("start");
  const end = date("end");
  requireValue(!start || !end || start <= end, "结束日期不能早于开始日期");
  return { result: system.history.get(actor, { kind: key as HistoryKind, id: sub, project: params.get("project") || undefined }, {
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    category: params.get("category") || undefined,
    actor: params.get("actor")?.trim().slice(0, 80),
    entry: params.get("entry") || undefined,
    start, end,
  }) };
}

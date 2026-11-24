import type { RouteContext } from "../../platform/http/context.js";
import type { FundingKind } from "../../database/repositories/funding.js";
import { parseListQuery } from "../../platform/http/list-query.js";
import { isObject } from "../../shared/types/contracts.js";
import { requireValue } from "../../shared/errors/business-error.js";
import { authorize } from "../../platform/auth/service.js";

export async function handleFunding(context: RouteContext): Promise<{ result: unknown }> {
  const { system, actor, key, sub, subKey, read, input, deleted, url, method, mutate } = context;
  requireValue(key === "frameworks" || key === "agreements", "资金业务类型不存在", 404);
  requireValue(isObject(input), "请求正文必须为JSON对象", 400);
  const kind: FundingKind = key;
  if (read) {
    authorize(actor, "read");
    if (subKey === "deletion-impact") return { result: system.funding.deletionImpact(actor, kind, sub) };
    if (sub === "history") return { result: system.funding.history(kind, subKey) };
    if (sub) return { result: url.searchParams.get("detail") === "true"
      ? system.funding.details(kind, sub) : system.funding.get(kind, sub, deleted) };
    return { result: system.funding.search(kind, parseListQuery(url.searchParams)) };
  }
  if (method === "DELETE")
    return { result: mutate("admin", () => system.funding.remove(actor, kind, sub, input.expected_version, input.expected_references)) };
  requireValue(method === "POST", "资金业务写入请求方法无效", 405);
  return { result: mutate("write", () => system.funding.save(actor, kind, input, sub || undefined)) };
}

import type { RouteContext } from "../../platform/http/context.js";
import { parseListQuery } from "../../platform/http/list-query.js";
import { isObject } from "../../shared/types/contracts.js";
import { requireValue } from "../../shared/errors/business-error.js";
export async function handlePriceCatalog(
  context: RouteContext,
): Promise<{ result: unknown }> {
  const {
    system,
    actor,
    sub,
    subKey,
    read,
    method,
    input,
    deleted,
    url,
    mutate,
  } = context;
  requireValue(isObject(input), "请求正文必须为JSON对象", 400);
  if (sub === "preview") {
    requireValue(method === "POST", "仅支持规则预检查", 405);
    return { result: system.priceRules.preview(actor, input) };
  }
  const service = system.priceRules;
  if (
    read &&
    sub &&
    sub !== "history" &&
    url.searchParams.get("history") === "true"
  )
    return { result: service.detail(sub) };
  if (read && subKey === "deletion-impact")
    return { result: service.impact(sub) };
  if (read)
    return {
      result:
        sub === "history"
          ? service.history(subKey)
          : sub
            ? service.get(sub, deleted)
            : service.search(parseListQuery(url.searchParams)),
    };
  if (method === "DELETE")
    return {
      result: mutate("admin", () =>
        service.remove(
          actor,
          sub,
          input.expected_version,
          input.expected_references,
        ),
      ),
    };
  requireValue(method === "POST", "价格定义写入请求方法无效", 405);
  return {
    result: mutate("admin", () => service.save(actor, input, sub || undefined)),
  };
}

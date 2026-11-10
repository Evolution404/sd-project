import type { RouteContext } from "../../platform/http/context.js";
import { parseListQuery } from "../../platform/http/list-query.js";
import { isObject } from "../../shared/types/contracts.js";
import { requireValue } from "../../shared/errors/business-error.js";
import { isFoundationKind } from "./service.js";
export async function handleDictionaries(
  context: RouteContext,
): Promise<{ result: unknown }> {
  const {
    system,
    actor,
    key,
    sub,
    subKey,
    read,
    method,
    input,
    deleted,
    url,
    mutate,
  } = context;
  requireValue(isFoundationKind(key), "基础数据类型不存在", 404);
  requireValue(isObject(input), "请求正文必须为JSON对象", 400);
  if (
    read &&
    sub &&
    sub !== "history" &&
    key !== "organizations" &&
    url.searchParams.get("history") === "true"
  )
    return { result: system.dictionaries.detail(key, sub) };
  if (read && subKey === "deletion-impact" && key !== "organizations")
    return { result: system.dictionaries.impact(key, sub) };
  if (read)
    return {
      result:
        sub === "history"
          ? system.dictionaries.history(key, subKey)
          : sub
            ? system.dictionaries.get(key, sub, deleted)
            : system.dictionaries.search(key, parseListQuery(url.searchParams)),
    };
  if (method === "DELETE")
    return {
      result: mutate("admin", () =>
        key === "organizations"
          ? system.organizations.remove(actor, sub, input)
          : system.dictionaries.remove(
              actor,
              key,
              sub,
              input.expected_version,
              input.expected_references,
            ),
      ),
    };
  requireValue(method === "POST", "基础数据写入请求方法无效", 405);
  return {
    result: mutate("admin", () =>
      system.dictionaries.save(actor, key, input, sub || undefined),
    ),
  };
}

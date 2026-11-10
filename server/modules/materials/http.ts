import type { RouteContext } from "../../platform/http/context.js";
import { parseListQuery } from "../../platform/http/list-query.js";
import { isObject } from "../../shared/types/contracts.js";
import { requireValue } from "../../shared/errors/business-error.js";
export async function handleMaterials(
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
  if (
    read &&
    sub &&
    sub !== "history" &&
    url.searchParams.get("history") === "true"
  )
    return { result: system.materials.detail(sub) };
  if (read && subKey === "deletion-impact")
    return { result: system.materials.impact(sub) };
  if (read)
    return {
      result:
        sub === "history"
          ? system.materials.history(subKey)
          : sub
            ? system.materials.get(sub, deleted)
            : system.materials.search(parseListQuery(url.searchParams)),
    };
  if (method === "DELETE")
    return {
      result: mutate("admin", () =>
        system.materials.remove(
          actor,
          sub,
          input.expected_version,
          input.expected_references,
        ),
      ),
    };
  requireValue(method === "POST", "物资写入请求方法无效", 405);
  return {
    result: mutate("admin", () =>
      system.materials.save(actor, input, sub || undefined),
    ),
  };
}

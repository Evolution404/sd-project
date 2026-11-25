import type { RouteContext } from "../../platform/http/context.js";
import { parseGridJSON, parseGridSelection, parseListQuery } from "../../platform/http/list-query.js";
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
  if (read && sub === "filter-values") {
    const key = url.searchParams.get("column") ?? "";
    const term = url.searchParams.get("term") ?? "";
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const limit = Number(url.searchParams.get("limit") ?? "100");
    const selection = url.searchParams.get("selection");
    requireValue(Number.isSafeInteger(offset) && offset >= 0, "候选值偏移量无效", 400);
    requireValue(Number.isSafeInteger(limit) && limit >= 0 && limit <= 100, "候选值每页数量无效", 400);
    requireValue(term.length <= 128, "筛选搜索内容过长", 400);
    requireValue(/^[a-z_]{1,60}$/.test(key), "请选择有效的筛选字段", 400);
    return { result: system.materials.facets(parseListQuery(url.searchParams), key, term, offset, limit,
      selection === null ? undefined : parseGridSelection(parseGridJSON(selection))) };
  }
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
  if (sub === "worksheet" && subKey === "preview")
    return { result: system.materials.createWorksheet(actor, input.rows) };
  if (sub === "worksheet" && subKey === "commit") {
    const fingerprint = input.fingerprint;
    requireValue(typeof fingerprint === "string" && /^[0-9a-f]{64}$/.test(fingerprint), "请先完成物资工作表预检");
    return { result: mutate("admin", () => system.materials.createWorksheet(actor, input.rows, fingerprint)) };
  }
  if (sub === "bulk" && subKey === "preview") return { result: system.materials.previewBulk(actor, input.rows) };
  if (sub === "bulk" && !subKey) return {
    result: mutate("admin", () => system.materials.saveBatch(actor, input.rows, input.fingerprint)),
  };
  return {
    result: mutate("admin", () =>
      system.materials.save(actor, input, sub || undefined),
    ),
  };
}

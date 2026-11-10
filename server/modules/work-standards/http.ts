import type { RouteContext } from "../../platform/http/context.js";
import { parseListQuery } from "../../platform/http/list-query.js";
import { isObject } from "../../shared/types/contracts.js";
import { requireValue } from "../../shared/errors/business-error.js";
export async function handleWorkStandards(
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
  requireValue(isObject(input), "请求正文必须为JSON对象", 400);
  const service = system.standards,
    operation = key === "operations";
  if (operation && subKey === "pricing-definitions") {
    requireValue(read, "价格特征定义只允许查询", 405);
    const parameter = url.searchParams.get("version");
    return {
      result: service.operationPriceFeatures(
        sub,
        parameter === null ? undefined : Number(parameter),
      ),
    };
  }
  if (
    read &&
    sub &&
    sub !== "history" &&
    url.searchParams.get("history") === "true"
  )
    return {
      result: operation
        ? service.operationDetail(sub)
        : service.objectDetail(sub),
    };
  if (read && subKey === "deletion-impact")
    return {
      result: operation
        ? service.operationImpact(sub)
        : service.objectImpact(sub),
    };
  if (read) {
    const result =
      sub === "history"
        ? operation
          ? service.operationHistory(subKey)
          : service.objectHistory(subKey)
        : sub
          ? operation
            ? service.getOperation(sub, deleted)
            : service.getObject(sub, deleted)
          : operation
            ? service.searchOperations(parseListQuery(url.searchParams))
            : service.searchObjects(parseListQuery(url.searchParams));
    return { result };
  }
  if (method === "DELETE")
    return {
      result: mutate("admin", () =>
        operation
          ? service.removeOperation(
              actor,
              sub,
              input.expected_version,
              input.expected_references,
            )
          : service.removeObject(
              actor,
              sub,
              input.expected_version,
              input.expected_references,
            ),
      ),
    };
  requireValue(method === "POST", "作业标准写入请求方法无效", 405);
  return {
    result: mutate("admin", () =>
      operation
        ? service.saveOperation(actor, input, sub || undefined)
        : service.saveObject(actor, input, sub || undefined),
    ),
  };
}

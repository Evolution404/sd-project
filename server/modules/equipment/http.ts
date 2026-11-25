import type { RouteContext } from "../../platform/http/context.js";
import { parseListQuery } from "../../platform/http/list-query.js";
import { isObject } from "../../shared/types/contracts.js";
import { requireValue } from "../../shared/errors/business-error.js";
import { isEquipmentKind } from "./service.js";

export async function handleEquipment(
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
    page,
  } = context;
  requireValue(isEquipmentKind(key), "设备目录不存在", 404);
  requireValue(isObject(input), "请求正文必须为JSON对象", 400);
  if (key === "voltages" && sub === "entry-batch") {
    requireValue(method === "POST" && (subKey === "preview" || subKey === "commit"), "电压等级批量请求无效", 405);
    return { result: subKey === "preview" ? system.equipment.voltageEntryBatch(actor, input, false)
      : mutate("admin", () => system.equipment.voltageEntryBatch(actor, input, true)) };
  }
  if (sub === "bulk" && subKey === "preview") {
    requireValue(method === "POST", "设备批量预检请求方法无效", 405);
    return { result: system.equipment.previewBulk(actor, key, input) };
  }
  if (sub === "bulk" && !subKey) {
    requireValue(method === "POST", "设备批量维护请求方法无效", 405);
    return { result: mutate("admin", () => system.equipment.bulk(actor, key, input)) };
  }
  if (key === "physical" && subKey === "replacement") {
    requireValue(
      method === "GET" || method === "POST",
      "整基更换请求方法无效",
      405,
    );
    return {
      result: read
        ? system.equipment.replacementPreview(sub)
        : mutate("admin", () =>
            system.equipment.replacePhysical(actor, sub, input),
          ),
    };
  }
  if (read) {
    if (subKey === "deletion-impact") return { result: system.equipment.deletionImpact(actor, key, sub) };
    if (sub === "history")
      return { result: system.equipment.history(key, subKey) };
    if (sub) return { result: system.equipment.get(key, sub, deleted) };
    if (key === "voltages")
      return {
        result: page(system.equipment.list(key, deleted), url.searchParams),
      };
    return {
      result: system.equipment.search(key, {
        ...parseListQuery(url.searchParams),
        lineId: url.searchParams.get("line_id"),
        lineKind: url.searchParams.get("line_kind"),
        excludeId: url.searchParams.get("exclude_id"),
      }),
    };
  }
  if (method === "DELETE")
    return {
      result: mutate("admin", () =>
        system.equipment.remove(actor, key, sub, input.expected_version, input.expected_references),
      ),
    };
  requireValue(method === "POST", "设备写入请求方法无效", 405);
  return {
    result: mutate("admin", () =>
      system.equipment.save(actor, key, input, sub || undefined),
    ),
  };
}

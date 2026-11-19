import { isObject } from "../../shared/types/contracts.js";
import type { HandlingTarget } from "../../shared/types/handling-batch.js";
import { integer, requireValue, text } from "../../shared/errors/business-error.js";

export function parseHandlingTargets(value: unknown): HandlingTarget[] {
  requireValue(Array.isArray(value) && value.length > 0 && value.length <= 100, "请勾选1～100条记录");
  const items = value.map((row: unknown) => {
    requireValue(isObject(row), "批量办理记录无效");
    return {
      id: text(row.id, "记录标识").trim(),
      expected_version: integer(row.expected_version, "记录版本", 1),
      expected_event_seq: row.expected_event_seq === undefined ? undefined : integer(row.expected_event_seq, "需求状态版本", 1),
    };
  });
  requireValue(new Set(items.map(row => row.id)).size === items.length, "同一条记录不能重复选择");
  return items;
}

import { requireValue } from "../../shared/errors/business-error.js";
import { isObject } from "../../shared/types/contracts.js";
import type { ParsedWorkbook, ParsedWorkbookRow } from "../../shared/types/exchange.js";
import { layouts, MAX_DETAIL_ROWS, MAX_DOCUMENTS, parseBusinessCell, issue } from "./workbook.js";

const ordinaryFields = ["problem_description", "completion_standard", "target_object", "priority_id", "priority_name", "expected_on", "reason"];
const columns = {
  documents: ["import_ref", "id", "expected_version", "operation_id", "operation_version", ...ordinaryFields],
  work_locations: ["import_ref", "location_ref", "location_kind", "physical_tower_id", "logical_tower_id", "span_id",
    "span_version", "context_line_id", "quantity_scaled", "work_mode", "specification"],
  materials: ["import_ref", "material_id", "quantity_scaled", "note"],
  sources: ["import_ref", "description", "discovered_on"],
};

export function parseOnlineDemands(input: unknown): { parsed: ParsedWorkbook; mode: "create" | "update" } {
  requireValue(isObject(input) && (input.mode === "create" || input.mode === "update") && isObject(input.rows),
    "请提供需求新增或普通修订工作表");
  const { mode, rows } = input;
  requireValue(Object.keys(rows).every(key => Object.hasOwn(columns, key)), "存在未定义的需求工作表");
  requireValue(Array.isArray(rows.documents) && rows.documents.length > 0 && rows.documents.length <= MAX_DOCUMENTS,
    "单批须提供1至5000张业务单据");
  const parsed: ParsedWorkbook = { rows: { documents: [] }, issues: [] };
  let details = 0;
  const revisionIds = new Set<string>();
  for (const { key, name } of layouts.demands) {
    const table = rows[key] ?? [];
    requireValue(Array.isArray(table), name + "须为表格");
    if (key !== "documents") {
      details += table.length;
      requireValue(details <= MAX_DETAIL_ROWS, "工作表明细行数超过25000");
      requireValue(mode === "create" || !table.length, "普通修订不允许修改单据明细");
    }
    const includes = new Set(columns[key as keyof typeof columns]);
    parsed.rows[key] = table.map((raw: unknown, index): ParsedWorkbookRow => {
      requireValue(isObject(raw) && Object.keys(raw).length <= 180, name + "行格式无效");
      requireValue(typeof raw.import_ref === "string" && raw.import_ref.length <= 128 && raw.import_ref.trim() === raw.import_ref &&
        raw.import_ref.length > 0, name + "缺少需求组号");
      if (key === "documents" && mode === "update") {
        requireValue(typeof raw.id === "string" && raw.id.length > 0 && raw.id.length <= 128 &&
          !revisionIds.has(raw.id) && Number.isSafeInteger(raw.expected_version) && Number(raw.expected_version) > 0,
          "修订须选择不同需求并携带原正式版本");
        revisionIds.add(raw.id);
      }
      const row: ParsedWorkbookRow = { _sheet: name, _row: index + 2 };
      for (const [field, rawValue] of Object.entries(raw)) {
        const attribute = /^attribute_(?:[0-9a-f]{2}){1,100}$/.test(field);
        if (mode === "update") {
          requireValue(["import_ref", "id", "expected_version", ...ordinaryFields].includes(field),
            "普通修订只允许修改需求基本资料");
        } else {
          requireValue(field !== "id" && field !== "expected_version" &&
            (includes.has(field) || attribute && (key === "documents" || key === "work_locations")),
          "工作表包含未授权的录入字段");
        }
        requireValue(rawValue === null || (typeof rawValue === "string" && rawValue.length <= 20000) ||
          typeof rawValue === "boolean" || (typeof rawValue === "number" && Number.isFinite(rawValue)) ||
          (attribute && Array.isArray(rawValue) && rawValue.length <= 100 &&
            rawValue.every(value => typeof value === "string" && value.length <= 100)), "工作表单元格值无效");
        try {
          row[field] = rawValue === null ? null : parseBusinessCell(field, rawValue);
        } catch (error) {
          parsed.issues.push(issue(name, row._row, field, rawValue,
            error instanceof Error ? error.message : "单元格值无效", "修正单元格后重新预检"));
        }
      }
      return row;
    });
  }
  return { parsed, mode };
}

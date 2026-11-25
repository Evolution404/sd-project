import { BusinessError, requireValue } from "../../shared/errors/business-error.js";
import { isObject } from "../../shared/types/contracts.js";
import { EQUIPMENT_CREATE_WORKSHEET_FIELDS, isEquipmentBulkKind, MAX_EQUIPMENT_WORKSHEET_ROWS } from "../../shared/equipment-bulk.js";
import type { ParsedWorkbook, ParsedWorkbookRow } from "../../shared/types/exchange.js";
import type { EquipmentCatalogKind } from "../../shared/types/equipment.js";
import type { ExchangePorts } from "./ports.js";
import { layouts, parseBusinessCell, issue } from "./workbook.js";

const assetTabs = { lines: "documents", physical: "physical", towers: "towers", spans: "spans" } as const;
const references = {
  parent_line_id: "lines", junction_tower_id: "towers", line_id: "lines",
  physical_tower_id: "physical", start_tower_id: "towers", end_tower_id: "towers",
} as const;

export function parseOnlineAssets(input: unknown, equipment: ExchangePorts["equipment"]): ParsedWorkbook {
  requireValue(isObject(input) && typeof input.kind === "string" && isEquipmentBulkKind(input.kind),
    "请选择合法设备工作表");
  const kind = input.kind;
  const rows = input.rows;
  requireValue(Array.isArray(rows) && rows.length > 0 && rows.length <= MAX_EQUIPMENT_WORKSHEET_ROWS,
    "单批设备须提供 1 至 " + MAX_EQUIPMENT_WORKSHEET_ROWS + " 行");
  const tab = assetTabs[kind];
  const name = layouts.assets.find(layout => layout.key === tab)!.name;
  const accepted = new Set<string>(EQUIPMENT_CREATE_WORKSHEET_FIELDS[kind]);
  const parsed: ParsedWorkbook = { rows: { documents: [] }, issues: [] };
  const cache = new Map<string, ReturnType<typeof equipment.get>>();
  function get(kind: EquipmentCatalogKind, id: string) {
    const key = kind + "/" + id;
    const existing = cache.get(key);
    if (existing) return existing;
    const candidate = equipment.get(kind, id);
    requireValue(candidate.status === "active" && !candidate.deleted, "请选择仍在运的正式台账");
    cache.set(key, candidate);
    return candidate;
  }
  function line(id: string) {
    const record = get("lines", id);
    requireValue(record.name && record.voltage_level_id, "线路正式名称或电压等级不完整");
    const voltage = get("voltages", record.voltage_level_id).name;
    requireValue(voltage, "请选用明确的线路电压等级");
    return { name: record.name, voltage };
  }

  parsed.rows[tab] = rows.map((raw: unknown, index): ParsedWorkbookRow => {
    const row: ParsedWorkbookRow = { _sheet: name, _row: index + 2 };
    requireValue(isObject(raw) && Object.keys(raw).every(field => accepted.has(field)),
      "第 " + (index + 1) + " 行包含未定义的设备字段");
    for (const [key, value] of Object.entries(raw)) {
      if (value === "" || value === null || value === undefined) continue;
      requireValue(typeof value === "string" && value.length <= 5000, "设备工作表字段须为文本");
      try {
        if (Object.hasOwn(references, key)) {
          const target = get(references[key as keyof typeof references], value);
          row[key] = target.id;
          if (key === "line_id") {
            const selected = line(value);
            row.line_name = selected.name;
            row.voltage_name = selected.voltage;
          }
          if (key === "parent_line_id") {
            const selected = line(value);
            row.parent_line_name = selected.name;
            row.parent_voltage_name = selected.voltage;
          }
          if (key === "junction_tower_id") row.junction_tower_no = target.tower_no;
          if (key === "start_tower_id" || key === "end_tower_id") {
            requireValue(target.line_id && target.tower_no, "档距端点的线路或杆号不完整");
            const endpointLine = line(target.line_id);
            const end = key === "start_tower_id" ? "start" : "end";
            row[end + "_tower_no"] = target.tower_no;
            row[end + "_line_name"] = endpointLine.name;
            row[end + "_voltage_name"] = endpointLine.voltage;
          }
        } else if (key === "sort_rank") {
          requireValue(/^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value)), "线路排序必须为正整数");
          row[key] = Number(value);
        } else if (key === "longitude" || key === "latitude") {
          const limit = key === "longitude" ? 180 : 90;
          requireValue(/^[+-]?[0-9]+(?:\.[0-9]{1,6})?$/.test(value) && Math.abs(Number(value)) <= limit,
            "坐标范围无效，最多六位小数");
          row[key] = Number(value);
        } else if (key === "commissioned_on") {
          const date = new Date(value);
          requireValue(/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date.valueOf()) &&
            date.toISOString().slice(0, 10) === value, "请选择有效的投运日期");
          row[key] = value;
        } else {
          row[key] = parseBusinessCell(key, value.trim());
        }
      } catch (cause) {
        if (!(cause instanceof BusinessError)) throw cause;
        parsed.issues.push(issue(name, row._row, key, value, cause.message));
      }
    }
    return row;
  });
  return parsed;
}

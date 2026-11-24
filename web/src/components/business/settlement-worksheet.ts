import { createBusinessWorksheet, cellAddress, type WorksheetValues, type WorksheetIssue } from "@/components/BusinessWorksheet/univer-engine";
import type { SettlementResolutionInput, WorkPosition } from "@/api/business/finance";
import { exactScaledDecimalText, formatScaledDecimal, quantityFitsUnitPrecision } from "@/utils/business/fixed-scale";

export interface WorksheetEntry {
  quantity: string;
  evidence: string;
}
export type WorksheetEntries = Readonly<Record<string, WorksheetEntry>>;
export interface QuantityIssue {
  row: number;
  cell: string;
  location: string;
  demand: string;
  message: string;
}

interface WorksheetOptions {
  host: HTMLElement;
  rows: readonly WorkPosition[];
  initial: WorksheetEntries;
  dark: boolean;
  primary: string;
  onChange: (entries: WorksheetEntries) => void;
  onSelection: (text: string) => void;
  onNotice: (text: string) => void;
  onValidation: (issues: QuantityIssue[]) => void;
}

const showQuantity = (quantity: number, unit: string) => formatScaledDecimal(quantity, 4) + " " + unit;
const columns = [
  { key: "position", title: "作业位置", width: 107 },
  { key: "operation", title: "操作类型", width: 137 },
  { key: "line", title: "线路", width: 132 },
  { key: "remaining", numeric: true, title: "批准余量", width: 105 },
  { key: "quantity", editable: true, numeric: true, title: "本次解决量", width: 126 },
  { key: "evidence", editable: true, title: "完成依据", width: 174 },
  { key: "demand", title: "需求编号", width: 123 },
  { key: "approved", numeric: true, title: "批准量", width: 105 },
  { key: "prior", numeric: true, title: "此前生效量", width: 112 },
  { key: "description", title: "需求描述", width: 300 },
  { key: "unit", title: "计量单位", width: 95 },
  { key: "startTower", title: "起点杆塔号", width: 125 },
  { key: "endTower", title: "终点杆塔号", width: 125 },
  { key: "physicalCode", title: "物理杆塔编号", width: 150 },
];
function inspectQuantity(position: WorkPosition, raw: string) {
  const scaled = raw === "" ? 0 : exactScaledDecimalText(raw, 4);
  if (scaled === null || scaled < 0) return { error: "请填写有效的非负数量" } as const;
  if (!quantityFitsUnitPrecision(scaled, position.precision ?? -1)) {
    return { error: position.precision === null ? "采用单位缺少有效的数量精度"
      : position.precision === 0 ? "单位为" + position.unit + "，请填写整数"
      : "单位为" + position.unit + "，最多可填 " + position.precision + " 位小数" } as const;
  }
  return { scaled, excess: raw === "" ? 0 : Math.max(0, scaled - Math.max(0, position.remaining_quantity_scaled)) } as const;
}

export function createSettlementWorksheet(options: WorksheetOptions) {
  const { rows, initial, onChange, onValidation } = options;
  const byId = new Map(rows.map(row => [row.id, row]));
  function entriesFrom(values: WorksheetValues): WorksheetEntries {
    return Object.fromEntries(rows.flatMap(row => {
      const entry = values[row.id];
      return row.editable && entry && (entry.quantity || entry.evidence)
        ? [[row.id, { quantity: entry.quantity ?? "", evidence: entry.evidence ?? "" }]] : [];
    }));
  }
  function validate(values: WorksheetValues): WorksheetIssue[] {
    const entries = entriesFrom(values);
    return rows.flatMap((position, index) => {
      const entry = entries[position.id];
      if (!entry) return [];
      const result = inspectQuantity(position, entry.quantity);
      const message = result.error ?? (result.excess ? "超出批准余量 " + showQuantity(result.excess, position.unit) : "");
      return message ? [{ row: index + 1, column: 4, cell: cellAddress(index + 1, 4), rowId: position.id,
        field: "quantity", location: position.location_label, message }] : [];
    });
  }
  const engine = createBusinessWorksheet({
    ...options, name: "本次完成工作量", columns:columns.filter(column=>column.key==="startTower"||column.key==="endTower"?rows.some(row=>row.location_kind==="span"):column.key==="physicalCode"?rows.some(row=>row.location_kind==="physical_tower"):true),
    rows: rows.map(row => ({
      id: row.id, label: row.location_label, locked: !row.editable || row.location_item_no === null,
      values: {
        position: row.location_label, operation: row.operation_snapshot, line: row.line_name || "—",
        remaining: row.editable ? formatScaledDecimal(row.remaining_quantity_scaled,4) : "—",
        quantity: row.editable ? initial[row.id]?.quantity ?? "" : "未纳入批准版本",
        evidence: row.editable ? initial[row.id]?.evidence ?? "" : "—",
        demand: row.demand_no, approved: row.editable ? formatScaledDecimal(row.approved_quantity_scaled,4) : "—",
        prior: formatScaledDecimal(row.prior_resolved_quantity_scaled,4), description: row.problem_description,
        unit:row.unit,startTower:row.start_tower_no||"",endTower:row.end_tower_no||"",physicalCode:row.physical_code||"",
      },
    })),
    filled: values => !!(values.quantity || values.evidence),
    describe: (row, values) => {
      const position = byId.get(row.id)!;
      const result = inspectQuantity(position, values.quantity ?? "");
      const label = "当前作业位置为 " + position.location_label + "，批准余量为 " + showQuantity(position.remaining_quantity_scaled, position.unit);
      return result.excess ? label + "，超出 " + showQuantity(result.excess, position.unit) : label;
    },
    validate,
    onChange: values => onChange(entriesFrom(values)),
    onValidation: issues => onValidation(issues.map(issue => ({ ...issue, demand: byId.get(issue.rowId)!.demand_no }))),
  });
  return {
    ...engine,
    focusQuantity: (row: number, keyboard = false) => engine.focusCell(row, 4, keyboard),
    remaining: () => engine.fillColumn("quantity", row =>
      formatScaledDecimal(Math.max(0, byId.get(row.id)!.remaining_quantity_scaled), 4), "本次解决量"),
    async prepareSave() {
      const values = await engine.prepareSave();
      if (!values) return null;
      const entries = entriesFrom(values);
      const resolutions: SettlementResolutionInput[] = rows.flatMap(position => {
        const entry = entries[position.id];
        if (!entry || position.location_item_no === null) return [];
        const result = inspectQuantity(position, entry.quantity);
        return result.scaled === undefined ? [] : [{ project_scope_id: position.project_scope_id,
          location_item_no: position.location_item_no, resolved_quantity_scaled: result.scaled, evidence: entry.evidence }];
      });
      return { resolutions };
    },
  };
}

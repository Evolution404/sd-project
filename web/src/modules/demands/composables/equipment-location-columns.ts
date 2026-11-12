import type { EquipmentRecord } from "../../../../../server/shared/types/equipment";
import type { DemandLocationKind } from "../../../../../server/shared/types/demands";
import type { TableColumn } from "../../../shared/ui/BusinessTable.vue";
import { towerTypeLabel, towerNatureLabel } from "../../../shared/utils/tower-labels.mjs";

/** One schema per *business entity*, never a union of unrelated row fields. */
export interface LocationTableColumn extends TableColumn {
  sortable: boolean;
  filterable: boolean;
  sortKey?: string;
  filterKey?: string;
}
const selection: LocationTableColumn = {
  key: "selected", label: "全选本页", sortable: false, filterable: false,
  hideable: false, customHeader: true, minWidth: 144,
};
const sortable = (key: string, label: string, minWidth = 145): LocationTableColumn =>
  ({ key, label, minWidth, sortable: true, filterable: true, sortKey: key, filterKey: key });
const filtered = (key: string, label: string, minWidth = 145): LocationTableColumn =>
  ({ key, label, minWidth, sortable: false, filterable: true, filterKey: key });
const display = (key: string, label: string, minWidth = 145): LocationTableColumn =>
  ({ key, label, minWidth, sortable: false, filterable: false });

const schemas: Readonly<Record<DemandLocationKind, readonly LocationTableColumn[]>> = {
  logical_tower: [
    selection,
    sortable("line_name", "所属线路", 190),
    sortable("voltage_level_name", "电压等级", 145),
    sortable("tower_no", "杆号", 115),
    sortable("tower_nature", "杆塔性质", 145),
    filtered("operations_team", "运维班组", 160),
  ],
  physical_tower: [
    selection,
    sortable("asset_no", "资产编号", 170),
    filtered("related_lines", "关联线路", 190),
    sortable("related_towers", "关联杆号", 170),
    sortable("current_circuits", "关联回路数", 145),
    sortable("tower_nature", "杆塔性质", 155),
    sortable("tower_type", "塔型", 150),
  ],
  span: [
    selection,
    sortable("line_name", "所属线路", 195),
    display("span", "档距", 170),
    { ...sortable("start_tower_no", "起点杆号", 130), defaultVisible: false },
    { ...sortable("end_tower_no", "终点杆号", 130), defaultVisible: false },
    sortable("transmission_center_length_mm", "中心管辖长度（米）", 210),
  ],
};
export function equipmentLocationColumns(kind: DemandLocationKind): LocationTableColumn[] {
  return schemas[kind].map(column => ({ ...column }));
}
export function equipmentLocationPreferenceKey(kind: DemandLocationKind): string {
  return "demand:location-picker:" + kind;
}
export function equipmentLocationQueryKind(
  kind: DemandLocationKind,
  _lineId: string | null,
): "physical" | "towers" | "spans" {
  return kind === "span" ? "spans" : kind === "physical_tower" ? "physical" : "towers";
}
const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";
const associations = (value: unknown) =>
  text(value).split(/[、,，]/).filter(Boolean).join("、");
export function equipmentLocationDisplay(
  kind: DemandLocationKind,
  row: EquipmentRecord,
  key: string,
): string | number {
  if (key === "span") {
    const start = text(row.start_tower_no), end = text(row.end_tower_no);
    return start && end ? start + " ~ " + end : "档距端点待核实";
  }
  if (key === "related_towers") {
    const linked = associations(row.related_towers) || [...new Set(
      (row.bindings || []).map(binding => text(binding.tower_no)).filter(Boolean),
    )].join("、");
    return linked || "未关联杆号";
  }
  if (key === "related_lines") return associations(row.related_lines) || "未关联线路";
  if (key === "tower_no") return text(row.tower_no) || "杆号待核实";
  if (key === "asset_no") return text(row.asset_no) || "未设置资产编号";
  if (key === "transmission_center_length_mm")
    return row.transmission_center_length_mm == null
      ? "长度待核实" : row.transmission_center_length_mm / 1000;
  if (key === "tower_nature") return towerNatureLabel(row.tower_nature);
  if (key === "tower_type") return towerTypeLabel(row.tower_type);
  if (key === "current_circuits") return row.current_circuits ?? 0;
  if (key === "line_name" && kind === "physical_tower")
    return text(row.related_lines) || "未关联线路";
  const value = row[key as keyof EquipmentRecord];
  return typeof value === "number" ? value : text(value) || "—";
}

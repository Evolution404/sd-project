import type { EquipmentKind } from "../../../../server/shared/types/equipment";
import type { TableColumn } from "../../shared/ui/BusinessTable.vue";
export const equipmentColumns: Record<EquipmentKind, TableColumn[]> = {
  lines: [
    { key: "name", label: "线路名称", minWidth: 180 },
    { key: "voltage_level_name", label: "电压等级" },
    { key: "line_kind", label: "线路类型" },
    { key: "parent_line_name", label: "所属主线", minWidth: 150 },
    { key: "junction_tower_no", label: "接入杆塔" },
    { key: "line_code", label: "线路编号", minWidth: 145 },
    { key: "status", label: "状态" },
  ],
  physical: [
    { key: "asset_no", label: "现场铭牌号", minWidth: 170 },
    { key: "tower_material", label: "杆塔材质" },
    { key: "tower_nature", label: "杆塔性质" },
    { key: "model", label: "型号" },
    { key: "height_scaled", label: "高度（米）" },
    { key: "commissioned_on", label: "投运日期" },
    { key: "related_lines", label: "关联线路", minWidth: 190 },
    { key: "related_towers", label: "关联杆塔号", minWidth: 150 },
    { key: "current_circuits", label: "关联回路数" },
    { key: "purpose", label: "用途", minWidth: 155 },
    { key: "status", label: "状态" },
  ],
  towers: [
    { key: "line_name", label: "所属线路", minWidth: 170 },
    { key: "voltage_level_name", label: "电压等级" },
    { key: "tower_no", label: "杆塔号" },
    { key: "tower_nature", label: "杆塔性质" },
    { key: "operations_team", label: "运维班组" },
    { key: "management_department", label: "管辖部门" },
    { key: "display_name", label: "杆塔名称", minWidth: 155, sortable: false, filterable: false },
    { key: "circuit_position", label: "回路位置", minWidth: 135, sortable: false, filterable: false },
    { key: "status", label: "状态" },
  ],
  spans: [
    { key: "line_name", label: "所属线路", minWidth: 170 },
    { key: "start_tower_no", label: "起点杆塔" },
    { key: "end_tower_no", label: "终点杆塔" },
    { key: "transmission_center_length_mm", label: "中心管辖长度（米）" },
    { key: "status", label: "状态" },
  ],
};

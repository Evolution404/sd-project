/** Shared business display and batch-edit definitions. Structural changes use domain commands. */
export const EQUIPMENT_LINE_KINDS = { main: "主线", branch: "支线" } as const;
export const EQUIPMENT_STATUSES = { active: "在运", inactive: "停用", retired: "退役", draft: "草稿" } as const;
export function equipmentLineKind(value: unknown): string {
  return EQUIPMENT_LINE_KINDS[value as keyof typeof EQUIPMENT_LINE_KINDS] ?? "未明确";
}
export function equipmentStatus(value: unknown): string {
  return EQUIPMENT_STATUSES[value as keyof typeof EQUIPMENT_STATUSES] ?? "未明确";
}
export const EQUIPMENT_BULK_FIELDS = {
  lines: ["name","voltage_level_id"],
  physical: ["asset_no","tower_material","tower_nature","model","height_scaled","purpose","commissioned_on","longitude","latitude"],
  towers: ["tower_no","sort_rank","display_name","operations_team","management_department"],
  spans: ["transmission_center_length_mm"],
} as const;
export type EquipmentBulkKind = keyof typeof EQUIPMENT_BULK_FIELDS;
export function isEquipmentBulkKind(kind:string): kind is EquipmentBulkKind {
  return Object.prototype.hasOwnProperty.call(EQUIPMENT_BULK_FIELDS,kind);
}
export const EQUIPMENT_FIELD_META:Record<string,{title:string;type:"text"|"select"|"number"|"date";required?:boolean;precision?:number}> = {
  name:{title:"线路名称",type:"text",required:true},voltage_level_id:{title:"电压等级",type:"select",required:true},
  asset_no:{title:"现场铭牌",type:"text"},tower_material:{title:"杆塔材质",type:"select"},tower_nature:{title:"杆塔性质",type:"select"},
  model:{title:"型号",type:"text"},height_scaled:{title:"高度（米）",type:"number",precision:4},purpose:{title:"用途",type:"text"},
  commissioned_on:{title:"投运日期",type:"date"},longitude:{title:"经度",type:"number",precision:6},latitude:{title:"纬度",type:"number",precision:6},
  tower_no:{title:"杆塔号",type:"text",required:true},sort_rank:{title:"线路排序",type:"number",required:true,precision:0},
  display_name:{title:"显示名称",type:"text"},operations_team:{title:"运维班组",type:"text"},management_department:{title:"管理部门",type:"text"},
  transmission_center_length_mm:{title:"管辖长度（米）",type:"number",precision:3},
};

export const MAX_EQUIPMENT_WORKSHEET_ROWS = 100;

export const EQUIPMENT_CREATE_WORKSHEET_FIELDS = {
  lines: ["name", "voltage_name", "line_kind", "parent_line_id", "junction_tower_id"],
  physical: EQUIPMENT_BULK_FIELDS.physical,
  towers: ["line_id", "physical_tower_id", ...EQUIPMENT_BULK_FIELDS.towers],
  spans: ["line_id", "start_tower_id", "end_tower_id", "transmission_center_length_mm"],
} as const;

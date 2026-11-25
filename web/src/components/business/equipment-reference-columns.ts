import type { EquipmentKind, EquipmentRow } from "@/api/business/equipment";

export function equipmentReferenceColumns(kind: EquipmentKind): {key:keyof EquipmentRow;label:string;width?:number}[] {
  return kind==="lines"?[
  {key:"name",label:"线路名称",width:180},{key:"voltage_level_name",label:"电压等级"},{key:"line_code",label:"线路编号"}
]:kind==="physical"?[
  {key:"tower_code",label:"物理杆塔编号"},{key:"asset_no",label:"现场铭牌"},{key:"tower_material_label",label:"杆塔材质"},{key:"model",label:"型号"}
]:[
  {key:"line_id_label",label:"所属线路",width:180},{key:"voltage_level_name",label:"电压等级"},{key:"tower_no",label:"杆塔号"},{key:"logical_code",label:"逻辑杆塔编号"}
];
}

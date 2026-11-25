import { applyNativeListQuery, type NativeListOptions } from "@/utils/business/native-list-query";
import { randomRequestId } from "@/utils/business/request-id";
import {exactScaledDecimalText,formatScaledDecimal} from "@/utils/business/fixed-scale";
export type EquipmentKind="voltages"|"lines"|"physical"|"towers"|"spans";
export interface EquipmentRow {
 id:string;code?:string;line_code?:string;tower_code?:string;logical_code?:string;
 name?:string;status:string;version:number;label:string;deleted:boolean;
 line_id?:string;line_name?:string;line_id_label?:string;line_kind?:string;voltage_level_id?:string;
 voltage_level_name?:string;parent_line_id?:string|null;junction_tower_id?:string|null;
 tower_no?:string;display_name?:string;sort_rank?:number;operations_team?:string;management_department?:string;
 physical_tower_id?:string|null;physical_tower_id_label?:string;
 asset_no?:string|null;tower_material?:string|null;tower_material_label?:string;
 tower_nature?:string|null;tower_nature_label?:string;model?:string;
 height_scaled?:number|null;purpose?:string;commissioned_on?:string|null;
 longitude?:number|null;latitude?:number|null;
 related_lines?:string;related_towers?:string;current_circuits?:number;
 bindings?:Array<{logical_tower_id:string;line_id:string;line_name:string;voltage_name:string|null;tower_no:string;logical_status:string;logical_deleted:boolean}>;
 start_tower_id?:string;end_tower_id?:string;start_tower_no?:string;end_tower_no?:string;
 transmission_center_length_mm?:number|null;
 created_at?:string;updated_at?:string|null;change_reason?:string;
 replacements?: Array<{ id: string; after_json: string | null; created_at: string }>;
}
export type EquipmentForm=Partial<EquipmentRow>&{
  height_text?:string;length_text?:string;
};
interface Page<T>{items:T[];total:number}
export interface PhysicalReplacementPreview {
  physical: EquipmentRow;
  bindings: EquipmentRow[];
}
async function request<T>(path:string,method="GET",input?:unknown):Promise<T>{
 const response=await fetch("/api/catalog/"+path,{method,credentials:"same-origin",
  ...(method==="GET"?{}:{headers:{"Content-Type":"application/json",
   "Idempotency-Key":randomRequestId()},body:JSON.stringify(input??{})})});
 const data:unknown=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(typeof data==="object"&&data&&"message" in data?
  String(data.message):"HTTP "+response.status);
 return data as T;
}
export function listEquipment(kind:EquipmentKind,opts:{
 page?:number;size?:number;keyword?:string;lineId?:string;lineKind?:string
} & NativeListOptions={}):Promise<Page<EquipmentRow>>{
 const q=new URLSearchParams({page:String(opts.page||1),page_size:String(opts.size||20),
   q:opts.keyword||"",sort:"created_at",direction:"desc"});
 if(opts.lineId)q.set("line_id",opts.lineId);
 if(opts.lineKind)q.set("line_kind",opts.lineKind);
 applyNativeListQuery(q, opts);
  return request(kind+"?"+q);
}
export function getEquipment(kind:EquipmentKind,id:string,includeDeleted=false):Promise<EquipmentRow>{
 return request(kind+"/"+encodeURIComponent(id)+(includeDeleted?"?deleted=true":""));
}
export function equipmentHistory(kind:EquipmentKind,id:string):Promise<unknown[]>{
 return request(kind+"/history/"+encodeURIComponent(id));
}
export function equipmentImpact(kind:EquipmentKind,id:string):Promise<Record<string,number>>{
 return request(kind+"/"+encodeURIComponent(id)+"/deletion-impact");
}
export function physicalReplacementPreview(id: string): Promise<PhysicalReplacementPreview> {
  return request("physical/" + encodeURIComponent(id) + "/replacement");
}
export function replacePhysicalTower(preview: PhysicalReplacementPreview, form: EquipmentForm): Promise<EquipmentRow> {
  return request("physical/" + encodeURIComponent(preview.physical.id) + "/replacement", "POST", {
    expected_version: preview.physical.version,
    bindings: preview.bindings.map(({ id, version }) => ({ id, version })),
    properties: physicalProperties(form),
  });
}
function metreScaled(raw:string,precision:number,label:string):number|null{
 if(!String(raw||"").trim())return null;
 const scaled=exactScaledDecimalText(raw.trim(),precision);
 if(scaled===null||scaled<0)throw Error(label+"最多保留"+precision+"位小数且不可为负");
 return scaled;
}
function physicalProperties(form: EquipmentForm) {
  return {
    asset_no: form.asset_no || null,
    tower_material: form.tower_material || null,
    tower_nature: form.tower_nature || null,
    model: form.model || "",
    purpose: form.purpose || "",
    height_scaled: metreScaled(form.height_text || "", 4, "杆塔高度"),
    commissioned_on: form.commissioned_on || null,
    longitude: form.longitude ?? null,
    latitude: form.latitude ?? null,
  };
}
export async function saveEquipment(kind:EquipmentKind,form:EquipmentForm,id?:string){
 const input:Record<string,unknown>={
   status:form.status||"active",
   ...(id?{expected_version:form.version,reason:form.change_reason||""}:{})
 };
 if(kind==="voltages"){
   input.name=String(form.name||"").trim();
 }
 if(kind==="lines"){
   input.name=String(form.name||"").trim();
   input.voltage_level_id=form.voltage_level_id;
   input.line_kind=form.line_kind||"main";
   input.parent_line_id=form.line_kind==="branch"?form.parent_line_id||null:null;
   input.junction_tower_id=form.line_kind==="branch"?form.junction_tower_id||null:null;
 }
 if(kind==="physical")Object.assign(input, physicalProperties(form));
 if(kind==="towers"){
   input.line_id=form.line_id;
   input.tower_no=String(form.tower_no||"").trim();
   input.physical_tower_id=form.physical_tower_id||null;
   if(form.sort_rank!==undefined)input.sort_rank=form.sort_rank;
   input.display_name=form.display_name||null;
   input.operations_team=form.operations_team||"";
   input.management_department=form.management_department||"";
 }
 if(kind==="spans"){
   input.line_id=form.line_id;input.start_tower_id=form.start_tower_id;
   input.end_tower_id=form.end_tower_id;
   const metres=metreScaled(form.length_text||"",3,"档距管辖长度");
   input.transmission_center_length_mm=metres;
 }
 return request<EquipmentRow>(kind+(id?"/"+encodeURIComponent(id):""),"POST",input);
}
export function equipmentForm(row:EquipmentRow):EquipmentForm{
 return {...row,height_text:row.height_scaled==null?"":formatScaledDecimal(row.height_scaled,4),
   length_text:row.transmission_center_length_mm==null?"":formatScaledDecimal(row.transmission_center_length_mm,3)};
}

export function bulkUpdateEquipment(kind:Exclude<EquipmentKind,"voltages">,rows:{id:string;expected_version:number;changes:Record<string,unknown>}[]){
 return request<{count:number;ids:string[]}>(kind+"/bulk","POST",{rows});
}

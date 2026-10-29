import {one,all} from './db.mjs';
export function captureDemand(d){
 return {...d,
  sources:all('SELECT s.* FROM source_records s JOIN demand_sources ds ON ds.source_id=s.id WHERE ds.demand_id=?',d.id),
  related_logical_ids:all('SELECT logical_tower_id FROM demand_related_logical_towers WHERE demand_id=?',d.id).map(x=>x.logical_tower_id)};
}
export const readDemandSnapshot=scope=>scope.demand_snapshot_json?JSON.parse(scope.demand_snapshot_json):null;
export function frozenProjects(demandId){
 return all("SELECT p.id,p.code,p.status,s.quantity_scaled FROM project_demand_scopes s JOIN projects p ON p.id=s.project_id WHERE s.demand_id=? AND p.status IN ('stocked','approved','closed')",demandId);
}
export function protectDemandChange(old,next){
 const refs=frozenProjects(old.id);if(!refs.length)return;
 const keys=['location_line_id','span_id','span_version','span_snapshot_json','logical_tower_id','observed_physical_tower_id','work_target_type','operation_id','operation_version','unit_id','unit_version','target_object','completion_standard','custom_fields_json','field_definitions_json'];
 const assigned=one("SELECT COALESCE(SUM(s.quantity_scaled),0) n FROM project_demand_scopes s JOIN projects p ON p.id=s.project_id WHERE s.demand_id=? AND p.status IN ('approved','closed')",old.id).n;
 if(keys.some(k=>old[k]!==next[k])||next.quantity_scaled<assigned||refs.some(x=>next.quantity_scaled<x.quantity_scaled)||next.status==='cancelled'){
  throw Object.assign(new Error('需求已被入库或立项项目引用（'+refs.map(x=>x.code).join('、')+'），不能直接改写工作范围或取消；新增工作请另建需求，原范围调整需办理项目变更'),{status:409});
 }
}

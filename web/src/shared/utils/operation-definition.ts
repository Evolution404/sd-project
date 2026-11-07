type Item=Record<string,any>;
export function readOperationDefinition(operation:Item|undefined,items:Item[]){
 if(!operation||operation.status!=='active'||!['line','physical'].includes(operation.work_target_type))return null;
 const unit=items.find(i=>i.id===operation.default_unit_id&&i.type_id==='unit'&&i.status==='active');
 const profile=operation.operation_profile,kinds=profile?.location_kinds;
 if(!profile||!Array.isArray(kinds)||!kinds.length||kinds.length>2||new Set(kinds).size!==kinds.length||kinds.some(k=>!['tower','span'].includes(k))||!kinds.includes(profile.default_location_kind)||operation.work_target_type==='physical'&&(kinds.length!==1||kinds[0]!=='tower'))return null;
 return unit?{unit_id:unit.id,unit_name:String(unit.name),work_target_type:String(operation.work_target_type),target_label:operation.work_target_type==='physical'?'共用物理杆塔':'线路侧设备',location_kinds:kinds as string[],default_location_kind:String(profile.default_location_kind),default_target_object:String(profile.default_target_object||''),entry_hint:String(profile.entry_hint||'')}:null;
}

const reject=message=>{throw Object.assign(new Error(message),{status:422})};

export function validateOperationProfile(profile,workTarget){
 if(!profile||typeof profile!=='object'||Array.isArray(profile))reject('请维护操作类型的作业位置和录入模板');
 const kinds=profile.location_kinds;
 if(!Array.isArray(kinds)||!kinds.length||kinds.length>2||new Set(kinds).size!==kinds.length||kinds.some(k=>!['tower','span'].includes(k)))reject('操作类型必须至少配置一种作业位置：杆塔或档距');
 if(workTarget==='physical'&&(kinds.length!==1||kinds[0]!=='tower'))reject('共用物理杆塔作业只能配置杆塔位置');
 if(!kinds.includes(profile.default_location_kind))reject('默认作业位置必须属于该操作允许的位置');
 const bounded=(value,name,max)=>{if(value!==undefined&&typeof value!=='string')reject(name+'必须为文本');const v=(value||'').trim();if(v.length>max)reject(name+'最多'+max+'字');return v};
 return {location_kinds:[...kinds],default_location_kind:profile.default_location_kind,default_target_object:bounded(profile.default_target_object,'默认处理部位',1000),entry_hint:bounded(profile.entry_hint,'录入提示',2000)};
}

// The existing default_unit_id column now defines the operation's fixed unit.
// Never rewrite demand/unit snapshots when the definition is edited.
export function operationDefinition(operation,unit){
 if(!operation||!['line','physical'].includes(operation.work_target_type))reject('操作类型必须配置唯一作业对象：线路侧设备或共用物理杆塔');
 if(!operation.default_unit_id||!unit||unit.id!==operation.default_unit_id||unit.type_id!=='unit'||unit.status!=='active')reject('操作类型必须关联一个有效计量单位，请由管理员完善操作定义');
 const profile=validateOperationProfile(operation.operation_profile,operation.work_target_type);
 return {work_target_type:operation.work_target_type,unit_id:unit.id,unit,...profile};
}

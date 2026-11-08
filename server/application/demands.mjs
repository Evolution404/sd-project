import { authorize, id, now } from './auth.mjs';
import { requireValue, text, integer, expectedVersion } from '../domain/errors.mjs';
export function createDemands(repo,catalog) {
  function get(key,includeDeleted=false) {
    const row=repo.find('v_demand_current','id',key);requireValue(row&&(includeDeleted||!repo.deleted('demands').has(key)),'需求不存在或已删除',404);
    const definition=JSON.parse(row.full_definition_json);
    return {...definition,...row,work_locations:definition.work_locations,materials:repo.where('demand_material_version_items',{demand_id:key,demand_version:row.current_version}),sources:repo.where('demand_sources',{demand_id:key}).map(x=>repo.find('source_records','id',x.source_id)),binding:repo.find('v_project_demand_binding_current','demand_id',key)||null};
  }
  function normalize(input,previous) {
    const op=catalog.get('operations',input.operation_id||previous?.operation_id);
    requireValue(op.status==='active','操作类型已停用');
    const unit=catalog.get('units',op.default_unit_id),object=catalog.get('objects',op.work_object_id);
    requireValue(!input.unit_id||input.unit_id===unit.id,'单位必须与操作类型一致');
    requireValue(!input.work_object_id||input.work_object_id===object.id,'作业对象必须与操作类型一致');
    const raw=input.work_locations??previous?.work_locations;
    requireValue(Array.isArray(raw)&&raw.length>0&&raw.length<=5000,'必须提供1至5000个作业位置');
    const keys=new Set();
    const locations=raw.map((loc,index)=>{
      const kind=loc.location_kind;
      requireValue(['logical_tower','physical_tower','span'].includes(kind),'作业位置类型无效');
      requireValue((op.work_target_type==='physical')===(kind==='physical_tower'),'设备定位必须与操作类型一致');
      requireValue(kind==='span'?op.allow_span:op.allow_tower,'操作类型不允许此作业位置');
      const key=kind==='span'?'span_id':kind==='logical_tower'?'logical_tower_id':'physical_tower_id';
      const entity=catalog.get(kind==='span'?'spans':kind==='logical_tower'?'towers':'physical',loc[key]);
      requireValue(!['retired','inactive'].includes(entity.status),'作业位置已停用或退役');
      requireValue(!keys.has(`${kind}/${entity.id}`),'同一需求不能重复列入同一位置');keys.add(`${kind}/${entity.id}`);
      const associated=kind==='physical_tower'?repo.where('logical_towers',{physical_tower_id:entity.id}).filter(t=>t.status==='active'):[];
      const lineIds=[...new Set(associated.map(t=>t.line_id))];
      const contextLineId=loc.context_line_id||(lineIds.length===1?lineIds[0]:null);
      requireValue(!contextLineId||lineIds.includes(contextLineId),'物理塔的上下文线路必须来自其真实在运回路');
      const line=entity.line_id?catalog.get('lines',entity.line_id):contextLineId?catalog.get('lines',contextLineId):null;
      requireValue(['outage','non_outage','unspecified'].includes(loc.work_mode||'unspecified'),'作业方式无效');
      const physical=kind==='logical_tower'&&entity.physical_tower_id?catalog.get('physical',entity.physical_tower_id):kind==='physical_tower'?entity:null;
      return {item_no:index+1,location_kind:kind,[key]:entity.id,...(kind==='span'?{span_version:entity.version}:{}),context_line_id:contextLineId,quantity_scaled:integer(loc.quantity_scaled,'位置数量',1),work_mode:loc.work_mode||'unspecified',site_features_json:typeof loc.site_features_json==='string'?JSON.parse(loc.site_features_json):(loc.site_features_json||{}),location_snapshot_json:{line_name:line?.name||'',line_id:line?.id||null,voltage_level_id:line?.voltage_level_id||null,tower_no:entity.tower_no||'',physical_code:physical?.tower_code||'',tower_type:physical?.tower_type||null,span:kind==='span'?entity:null}};
    });
    const total=locations.reduce((sum,loc)=>sum+loc.quantity_scaled,0);integer(total,'需求总数量',1);
    const materials=(input.materials??previous?.materials??[]).map((item,index)=>{
      const master=catalog.get('materials',item.material_id);
      requireValue(master.status==='active'||previous?.materials?.some(old=>old.material_id===master.id),'物资已停用');
      return {material_id:master.id,quantity_scaled:integer(item.quantity_scaled,'预计物资数量',1),note:item.note||'',item_no:index+1};
    });
    requireValue(new Set(materials.map(x=>x.material_id)).size===materials.length,'物资不能重复');
    const first=locations[0],snapshot=first.location_snapshot_json;
    return {operation_id:op.id,operation_version:op.version,operation_snapshot:op.name,work_object_id:object.id,work_object_snapshot:object.name,work_target_type:op.work_target_type,unit_id:unit.id,unit_version:unit.version,unit_snapshot:unit.name,quantity_scaled:total,target_object:text(input.target_object||previous?.target_object||op.default_target_object||object.name,'处理部位'),problem_description:text(input.problem_description??previous?.problem_description,'问题描述'),completion_standard:text(input.completion_standard??previous?.completion_standard??op.completion_standard,'验收标准'),priority_id:input.priority_id??previous?.priority_id??null,expected_on:input.expected_on===undefined?previous?.expected_on??null:input.expected_on,logical_tower_id:first.logical_tower_id||null,physical_tower_id:first.physical_tower_id||null,span_id:first.span_id||null,span_version:first.span_version||null,span_snapshot_json:first.span_id?JSON.stringify(snapshot.span):null,observed_physical_tower_id:null,context_line_id:first.context_line_id||null,line_name_snapshot:snapshot.line_name,tower_no_snapshot:snapshot.tower_no,physical_code_snapshot:snapshot.physical_code,custom_fields_json:JSON.stringify(input.custom_fields||{}),field_definitions_json:op.fields_json,work_locations:locations,materials};
  }
  function save(actor,input,key,options={}) {
    authorize(actor,'write');return repo.transaction(()=>{
      const previous=key?get(key):null;if(previous)expectedVersion(previous.current_version,input.expected_version);
      const normalized=normalize(input,previous);
      const duplicates=repo.demandDuplicates(normalized.operation_id,normalized.work_locations,key);
      requireValue(!duplicates.length||options.allowDuplicates,'发现同操作同位置的疑似重复需求，须人工判定',409,{duplicates:duplicates.map(x=>x.demand_no)});
      let keyId=key||id(),timestamp=now();
      if(previous){
        const snapshot={...JSON.parse(previous.full_definition_json),...normalized};
        const sourceChange=(input.sources||[]).some(source=>!source.id||!previous.sources.some(old=>old.id===source.id));
        requireValue(sourceChange||JSON.stringify(normalized)!==JSON.stringify(normalize(previous,previous)),'需求内容没有变化');
        repo.insert('demand_revisions',{id:id(),demand_id:keyId,version:previous.current_version+1,snapshot_json:JSON.stringify(snapshot),changed_by:actor.id,changed_at:timestamp,reason:input.reason||''});
      }else{
        const {work_locations,materials,...root}=normalized;
        repo.insert('demands',{id:keyId,demand_no:text(input.demand_no,'需求编号'),...root,initial_work_locations_json:JSON.stringify(work_locations),created_by:actor.id,created_at:timestamp});
        materials.forEach(item=>repo.insert('demand_material_items',{id:id(),demand_id:keyId,...item,created_at:timestamp,updated_at:timestamp}));
      }
      if(input.sources)for(const source of input.sources){
        if(source.id){requireValue(repo.find('source_records','id',source.id),'来源不存在');if(!repo.where('demand_sources',{demand_id:keyId,source_id:source.id}).length)repo.insert('demand_sources',{demand_id:keyId,source_id:source.id});}
        else {const sourceId=id();repo.insert('source_records',{id:sourceId,source_system:source.source_system||'manual',external_record_id:source.external_record_id||null,description:text(source.description,'来源说明'),discovered_on:source.discovered_on||null,created_by:actor.id,created_at:timestamp});repo.insert('demand_sources',{demand_id:keyId,source_id:sourceId});}
      }
      catalog.audit(actor,'demands',keyId,previous?'revise':'create',previous,get(keyId));return get(keyId);
    });
  }
  return {get,normalize,save,
    list(includeDeleted=false){const deleted=repo.deleted('demands');return repo.list('v_demand_current').filter(x=>includeDeleted||!deleted.has(x.id)).map(x=>({...get(x.id,includeDeleted),deleted:deleted.has(x.id)}));},
    transition(actor,key,input){authorize(actor,'demand.activate');return repo.transaction(()=>{
      const previous=get(key);expectedVersion(previous.current_version,input.expected_version);
      const last=repo.latest('demand_lifecycle_events','demand_id',key,'event_seq');
      expectedVersion(last.event_seq,input.expected_event_seq);
      repo.insert('demand_lifecycle_events',{id:id(),demand_id:key,event_seq:last.event_seq+1,from_status:previous.status,to_status:input.status,actor_id:actor.id,recorded_at:now(),reason:input.reason||''});return get(key);
    });},
    history(key){get(key,true);return {versions:repo.where('demand_versions',{demand_id:key}),events:repo.where('demand_lifecycle_events',{demand_id:key}),bindings:repo.where('project_demand_scopes',{demand_id:key}).map(scope=>({...scope,events:repo.where('project_demand_link_events',{project_scope_id:scope.id})}))};},
    remove(actor,key,input){authorize(actor,'admin');return repo.transaction(()=>{const previous=get(key);expectedVersion(previous.current_version,input.expected_version);requireValue(previous.status==='cancelled','需求删除前须明确取消并处理项目关联');catalog.audit(actor,'demands',key,'delete',previous,{logical:true});return {deleted:true};});}
  };
}

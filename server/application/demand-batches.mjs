import {createHash} from 'node:crypto';
import {uid,now,transaction,audit} from '../database/index.mjs';
import {validateFieldDefinitions,validateFieldValues} from '../domain/custom-fields.mjs';
import {quantityToScaled} from '../domain/quantity.mjs';
import {operationDefinition} from '../domain/operation-definition.mjs';
import {loadDemandCatalogRows} from '../database/queries/demand-catalog.mjs';
import {demandBatchById,demandBatchByKey,createDemandDraft,updateDemandDraft,deleteDemandDraft,deletedDemandDraftAudits,demandBatchResultFacts,demandSubmissionWriter} from '../database/repositories/demand-batches.mjs';

export const DEMAND_BATCH_LIMIT=5000;
export const DEMAND_BODY_LIMIT=32*1024*1024;
const fail=(status,message,details)=>{throw Object.assign(new Error(message),{status,details})};
const text=v=>typeof v==='string'?v.trim():v==null?'':String(v).trim();
const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
export const validDemandDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const mapBy=rows=>new Map(rows.map(x=>[x.id,x]));
function index(rows,key){const out=new Map();for(const row of rows){const k=key(row);if(!out.has(k))out.set(k,[]);out.get(k).push(row)}return out}
const norm=v=>text(v).toLowerCase();
const duplicateKey=(row,physical=false)=>[row.workType,row.op?.id,norm(row.target),physical?row.tower?.physical_tower_id:row.location?.span.id||row.tower?.id].join('|');

// A single catalog read per validation pass; never query every tower/option per row.
export function demandCatalog(){
 const {items,lines,towers,spans,existing,historicalSources:sourceRows}=loadDemandCatalogRows();
 const historicalSources=index(sourceRows,s=>s.demand_id);
 for(const demand of existing)demand.source_summary=historicalSources.get(demand.id)||[];
 return {items,lines,towers,spans,byItem:mapBy(items),byLine:mapBy(lines),byTower:mapBy(towers),bySpan:mapBy(spans),
  itemNames:index(items,x=>x.type_id+'|'+x.name),lineNames:index(lines,x=>x.name),towerNames:index(towers,x=>x.line_id+'|'+x.tower_no),
  spanEnds:index(spans,x=>x.line_id+'|'+[x.start_tower_id,x.end_tower_id].sort().join('|')),
  duplicates:index(existing,x=>[x.work_target_type,x.operation_id,norm(x.target_object),x.work_target_type==='physical'?x.physical_tower_id:x.span_id||x.logical_tower_id].join('|'))};
}

export function inspectDemandBatch(body,{catalog=demandCatalog()}={}){
 if(!Array.isArray(body.rows)||body.rows.length>DEMAND_BATCH_LIMIT)fail(422,'每批最多5000条需求，不能静默截断');
 if(body.rows.some(r=>!r||typeof r!=='object'||Array.isArray(r)))fail(422,'需求行必须为对象');
 const issues=[],validated=[],output=[],sources=[],sourceKeys=new Set(),rowKeys=new Set(),inBatch=new Map();
 const issue=(row,field,message,extra={})=>{const x={row:row.index+1,row_key:row.key,sheet:row.sheet||'需求明细',sheet_row:row.sheet_row||row.index+2,field,message,...extra};issues.push(x);row.issues.push(x)};
 const item=(id,name,type,row,field,optional=false)=>{
  if(optional&&!id&&!text(name))return null;
  const matches=id?[catalog.byItem.get(id)].filter(Boolean):catalog.itemNames.get(type+'|'+text(name))||[];
  if(matches.length!==1||matches[0].type_id!==type){issue(row,field,matches.length>1?'存在同名选项，请在线明确选择':'请选择存在且有效的'+field);return null}
  return matches[0];
 };
 const required=(value,row,field)=>{const v=text(value);if(!v)issue(row,field,field+'不能为空');else if(v.length>10000)issue(row,field,field+'不能超过10000字');return v};
 const sourceInputs=body.sources??(body.source?[body.source]:[]);
 if(!Array.isArray(sourceInputs)||sourceInputs.length>DEMAND_BATCH_LIMIT)fail(422,'来源依据必须为数组且最多5000条');
 for(const [i,input]of sourceInputs.entries()){
  const s=input&&typeof input==='object'&&!Array.isArray(input)?input:{};
  const row={index:i,key:text(s.source_key)||'LY'+String(i+1).padStart(3,'0'),sheet:s.sheet||'来源依据',sheet_row:s.sheet_row||i+2,issues:[]};
  if(sourceKeys.has(row.key))issue(row,'来源编号','来源编号重复');sourceKeys.add(row.key);
  const src=item(s.type_id,s.type_name,'source',row,'来源类型');
  const proposer=required(s.proposed_by,row,'提出单位／人员');
  const discovered=text(s.discovered_on);if(!validDemandDate(discovered))issue(row,'发现／提出日期','请填写真实有效的 YYYY-MM-DD 日期');
  for(const e of s.parse_errors||[])issue(row,e.field||'单元格',e.message);
  sources.push({...s,source_key:row.key,type_id:src?.id||'',type_name:src?.name||s.type_name||'',issues:row.issues,
   _validated:{key:row.key,src,proposer,discovered,description:text(s.description)||null,external_ref:text(s.external_ref)||null}});
 }
 const bySource=new Map(sources.map(s=>[s.source_key,s]));
 for(const [i,input]of body.rows.entries()){
  const data={...body,...input};
  const row={...input,index:i,key:text(input.row_key)||'MX'+String(i+1).padStart(4,'0'),issues:[],candidates:[],internal_duplicates:[]};
  row.row_key=row.key;
  if(rowKeys.has(row.key))issue(row,'明细编号','明细编号重复');rowKeys.add(row.key);
  if(input.excluded){output.push(row);continue}
  for(const e of input.parse_errors||[])issue(row,e.field||'单元格',e.message);
  const op=item(data.operation_id,data.operation_name,'operation',row,'操作类型');
  let definition;try{if(op)definition=operationDefinition(op,catalog.byItem.get(op.default_unit_id))}catch(e){issue(row,'操作类型',e.message)}
  let tower,line,location;
  const kind=data.location_kind||(data.span_id||text(data.end_tower_no)?'span':definition?.default_location_kind);
  if(!['tower','span'].includes(kind))issue(row,'作业位置','请先配置操作类型的作业位置');
  if(definition&&!definition.location_kinds.includes(kind))issue(row,'作业位置','该操作仅允许'+definition.location_kinds.map(k=>k==='tower'?'杆塔':'档距').join('／')+'位置');
  if(data.span_id&&kind!=='span')issue(row,'作业位置','档距定位不能标为杆塔作业');
  if(data.logical_tower_id&&!data.span_id){tower=catalog.byTower.get(data.logical_tower_id);line=tower&&catalog.byLine.get(tower.line_id)}
  else if(!data.span_id){
   const found=data.line_id?[catalog.byLine.get(data.line_id)].filter(Boolean):(catalog.lineNames.get(text(data.line_name))||[]).filter(l=>!text(data.voltage_name)||l.voltage_name===text(data.voltage_name));
   if(found.length===1){line=found[0];const candidates=catalog.towerNames.get(line.id+'|'+text(data.tower_no))||[];
    if(candidates.length===1)tower=candidates[0];
    else issue(row,'杆塔／档距起点编号',candidates.length?'编号有多个候选，请选择正确杆塔':'在线路中未找到该原始杆塔编号');
   }else issue(row,'线路名称',found.length?'线路重名，请补充电压等级或在线选择':'未找到有效线路');
  }
  let span=data.span_id?catalog.bySpan.get(data.span_id):null;
  if(kind==='span'&&!data.span_id&&line&&tower){
   const ends=catalog.towerNames.get(line.id+'|'+text(data.end_tower_no))||[];
   if(ends.length===1){const matches=catalog.spanEnds.get(line.id+'|'+[tower.id,ends[0].id].sort().join('|'))||[];
    if(matches.length===1)span=matches[0];else issue(row,'档距终点编号',matches.length?'档距匹配不唯一':'两端之间不存在有效档距，不能自动建立连接');
   }else issue(row,'档距终点编号','请选择该线路有效的档距终点');
  }
  if(data.span_id&&!span)issue(row,'档距','档距不存在或已转为历史');
  if(span){
   const start=catalog.byTower.get(span.start_tower_id),end=catalog.byTower.get(span.end_tower_id);line=catalog.byLine.get(span.line_id);tower=start;
   if(!start||!end||!line||start.line_id!==span.line_id||end.line_id!==span.line_id)issue(row,'档距','档距端点或实体已失效');
   else location={span,start,end,line,snapshot:{id:span.id,version:span.version,line_id:line.id,line_name:line.name,start_tower_id:start.id,end_tower_id:end.id,start_tower_no:start.tower_no,end_tower_no:end.tower_no,start_physical_tower_id:start.physical_tower_id,end_physical_tower_id:end.physical_tower_id,distance_method:'coordinate-derived'}};
   if(data.span_version!==undefined&&data.span_version!==span.version)issue(row,'档距','档距版本已变化，请重新选择');
  }
  if(!tower||!line)issue(row,'位置','逻辑杆塔不存在或台账未启用');
  if(kind==='tower'&&text(data.end_tower_no))issue(row,'档距终点编号','杆塔需求不应填写档距终点');
  const workType=data.work_target_type||definition?.work_target_type;
  if(!['line','physical'].includes(workType))issue(row,'作业对象','请选择线路侧设备或共用物理杆塔');
  if((span||kind==='span')&&workType!=='line')issue(row,'作业对象','档距需求只能采用线路侧作业');
  if(definition&&definition.work_target_type!==workType)issue(row,'作业对象','作业对象必须与操作类型定义一致');
  const unit=data.unit_id||text(data.unit_name)?item(data.unit_id,data.unit_name,'unit',row,'单位'):definition?.unit||null;
  if(definition&&unit&&definition.unit_id!==unit.id)issue(row,'单位','单位必须使用操作类型定义的“'+definition.unit.name+'”');
  const priority=item(data.priority_id,data.priority_name,'priority',row,'优先级',true);
  const target=required(data.target_object,row,'处理部位／对象');
  const standard=required(data.completion_standard,row,'完成标准');
  const problem=required(data.problem_description,row,'问题描述／实施必要性');
  let quantity;try{quantity=quantityToScaled(data.quantity)}catch(e){issue(row,'工作量',e.message)}
  if(data.expected_on&&!validDemandDate(data.expected_on))issue(row,'期望完成日期','请填写真实有效的 YYYY-MM-DD 日期');
  let fields=[],custom={},customInput={};
  if(op){
   fields=validateFieldDefinitions(JSON.parse(op.fields_json));
   customInput={...(body.custom_fields||{}),...(input.custom_fields||{})};
   try{custom=validateFieldValues(fields,customInput)}catch(e){issue(row,'扩展字段',e.message)}
  }
  const keys=input.source_keys===undefined?sources.map(s=>s.source_key):input.source_keys;
  if(!Array.isArray(keys)||!keys.length||keys.length>20||keys.some(k=>typeof k!=='string'))issue(row,'来源编号','每条需求应引用1至20项来源');
  const sourceData=[];
  for(const key of Array.isArray(keys)?new Set(keys.slice(0,20)):[]){const s=bySource.get(key);if(!s)issue(row,'来源编号','不存在来源编号：'+key);else if(s.issues.length)issue(row,'来源编号','来源 '+key+' 尚有未修正问题');else sourceData.push(s._validated)}
  const related=[];
  if(input.related_logical_ids!==undefined&&!Array.isArray(input.related_logical_ids))issue(row,'受影响位置','关联杆塔必须为数组');
  if(workType==='physical')for(const id of new Set(Array.isArray(input.related_logical_ids)?input.related_logical_ids:[])){
   const other=catalog.byTower.get(id);if(!other||other.physical_tower_id!==tower?.physical_tower_id)issue(row,'受影响位置','受影响位置不属于同一有效实体');else related.push(id);
  }
  const locationToken=hash({tower,line,end:location?.end,span:location?.span,related:related.map(id=>catalog.byTower.get(id))});
  if(input.location_token&&input.location_token!==locationToken)issue(row,'位置','台账版本或实体关联已变化，请重新预检确认');
  const dictionaryToken=hash({op,unit,priority,sources:sourceData.map(s=>s.src)});
  if(input.dictionary_token&&input.dictionary_token!==dictionaryToken)issue(row,'字典版本','操作、单位或来源配置已变化，请重新预检确认');
  const v={tower,location,target,quantity,related,custom,fields,op,unit,priority,standard,problem,workType,sourceData,expected_on:data.expected_on||null,originalIndex:i,rowKey:row.key};
  if(tower&&op){
   const key=duplicateKey(v,workType==='physical');row.candidate_count=(catalog.duplicates.get(key)||[]).length;row.candidates=(catalog.duplicates.get(key)||[]).slice(0,20);
   const same=inBatch.get(key)||[];for(const previous of same){row.internal_duplicates.push(previous.row_key);previous.internal_duplicates.push(row.row_key)}same.push(row);inBatch.set(key,same);
  }
  Object.assign(row,{logical_tower_id:tower?.id||input.logical_tower_id||'',line_id:line?.id||'',line_name:line?.name||input.line_name||'',voltage_name:line?.voltage_name||input.voltage_name||'',
   tower_no:tower?.tower_no||input.tower_no||'',end_tower_no:location?.end.tower_no||input.end_tower_no||'',location_kind:kind,
   span_id:span?.id||input.span_id,span_version:span?.version||input.span_version,work_target_type:workType,
   operation_id:op?.id||'',operation_name:op?.name||data.operation_name||'',unit_id:unit?.id||'',unit_name:unit?.name||data.unit_name||'',priority_id:priority?.id||'',priority_name:priority?.name||data.priority_name||'',
   target_object:target,quantity:text(data.quantity),completion_standard:standard,problem_description:problem,expected_on:data.expected_on||'',custom_fields:{...customInput,...custom},source_keys:Array.isArray(keys)?keys:[],related_logical_ids:related,
   location_token:locationToken,dictionary_token:dictionaryToken,field_definitions:fields});
  validated.push(v);output.push(row);
 }
 for(const row of output)if(!row.excluded&&row.internal_duplicates.length)issue(row,'本批重复','与 '+row.internal_duplicates.join('、')+' 的位置、作业和部位相同，请明确区分实际作业或排除重复行');
 const selected=output.filter(r=>!r.excluded);
 const token=hash({rows:validated,sources:sources.map(s=>s._validated),candidates:selected.map(r=>r.candidates)});
 // Unused source rows stay visible for correction, but cannot block an explicitly reduced submission scope.
 const referencedSources=new Set(selected.flatMap(r=>r.source_keys||[]));
 const submissionIssues=issues.filter(i=>i.sheet!=='来源依据'||referencedSources.has(i.row_key));
 return {rows:output,sources:sources.map(({_validated,...s})=>s),issues:submissionIssues,validation_token:token,
  summary:{total:output.length,included:selected.length,excluded:output.length-selected.length,invalid:selected.filter(r=>r.issues.length).length,duplicates:selected.filter(r=>r.candidates.length).length,ready:selected.filter(r=>!r.issues.length&&!r.candidates.length).length},_validated:validated};
}

export function previewDemandBatch(body){const {_validated,...result}=inspectDemandBatch(body);return result}
export function ownedBatch(id,user){
 const batch=demandBatchById(id);if(!batch)fail(404,'批次不存在');
 if(batch.created_by!==user.id&&user.role!=='admin')fail(403,'只能访问自己的草稿批次');return batch;
}
function checkDraft(draft){
 if(!draft||typeof draft!=='object'||Array.isArray(draft))fail(422,'草稿内容必须为对象');
 if(!Array.isArray(draft.rows)||draft.rows.length>DEMAND_BATCH_LIMIT)fail(422,'草稿最多5000条需求');
}
export function draftBatch(body,user){
 checkDraft(body);const t=now(),item={id:uid(),draft_json:JSON.stringify(body),status:'draft',version:1,idempotency_key:null,payload_sha256:null,source_id:null,created_by:user.id,created_at:t,updated_at:t};
 return transaction(()=>{createDemandDraft(item);audit(user.id,'demand_batches',item.id,'create',null,item);return item});
}
export function updateDraft(id,body,user){return transaction(()=>{
 const old=ownedBatch(id,user);if(old.status!=='draft')fail(409,'批次已提交，不能修改草稿');if(old.version!==body.version)fail(409,'草稿已被修改，请刷新');checkDraft(body.draft);
 const next={...old,draft_json:JSON.stringify(body.draft),version:old.version+1,updated_at:now()};
 updateDemandDraft(next);audit(user.id,'demand_batches',id,'update_draft',old,next,'保存草稿');return next;
})}
export function deleteDraft(id,body,user){return transaction(()=>{
 const old=ownedBatch(id,user);if(old.status!=='draft')fail(409,'已提交批次请通过需求更正／删除流程处理');if(old.version!==body.version)fail(409,'草稿版本已变化');
 if(!text(body.reason))fail(422,'请填写删除依据');
 audit(user.id,'demand_batches',id,'delete_draft',old,{deletion_kind:'physical'},body.reason);deleteDemandDraft(id);return {id};
})}
export function deletedDrafts(user){return deletedDemandDraftAudits(user.id,user.role==='admin').map(e=>({id:e.entity_id,reason:e.reason,deleted_at:e.created_at,before:JSON.parse(e.before_json)}))}
export function batchResult(id){
 const batch=demandBatchById(id);if(!batch)fail(404,'批次不存在');
 const facts=demandBatchResultFacts(id);
 const body=JSON.parse(batch.draft_json);
 return {batch_id:id,source_id:batch.source_id,
  source_ids:facts.tracked.map(x=>x.id),count:facts.count,
  ids:facts.ids.map(x=>x.id),linked_ids:facts.linked.map(x=>x.id),
  row_results:body.submission_rows||[]};
}
export function submitBatch(body,user){
 const key=text(body.idempotency_key);if(!key||key.length>160)fail(422,'请提供有效的幂等键');
 const digest=hash({...body,idempotency_key:undefined});
 return transaction(()=>{
  const previous=demandBatchByKey(key);
  if(previous){ownedBatch(previous.id,user);if(previous.payload_sha256!==digest)fail(409,'相同幂等键的数据内容不同');return batchResult(previous.id)}
  const draft=body.draft_id?ownedBatch(body.draft_id,user):null;
  if(draft&&(draft.status!=='draft'||draft.version!==body.draft_version))fail(409,'草稿状态或版本已变化，请重新加载');
  // Rebuild every reference and duplicate candidate under the SQLite write lock.
  const checked=inspectDemandBatch(body);
  if(checked.issues.length)fail(422,'批量预检失败',checked.issues);
  if(!checked._validated.length)fail(422,'至少选择一条待提交需求');
  if(body.validation_token&&body.validation_token!==checked.validation_token)fail(409,'数据或重复候选已变化，请重新预检');
  const t=now(),batchId=draft?.id||uid(),sourceIds=new Map(),ids=[],linkedIds=[],rowResults=[];
  const used=new Map(checked._validated.flatMap(r=>r.sourceData.map(s=>[s.key,s])));
  const writer=demandSubmissionWriter();
  for(const s of used.values()){const id=uid();writer.addSource(id,s,user.id,t);sourceIds.set(s.key,id)}
  const firstSource=[...sourceIds.values()][0];
  writer.submitBatch({draft,batchId,body,key,digest,firstSource,userId:user.id,time:t});
  let sequence=writer.startingDemandNo;
  const recordAudit=(entity,id,action,value,reason='')=>
   writer.audit({entity,entityId:id,action,after:value,reason,userId:user.id,time:t});
  for(const r of checked._validated){
   const submitted=body.rows[r.originalIndex],resultRow=checked.rows[r.originalIndex],candidates=resultRow.candidates,review=submitted.duplicate_review;
   let matched;
   if(candidates.length){
    if(!review||!['link','separate'].includes(review.decision)||!text(review.reason))fail(409,'发现疑似重复需求，请明确关联原需求或登记新发需求并填写依据');
    matched=candidates.find(c=>c.id===review.candidate_id);if(!matched)fail(409,'重复候选已变化，请重新核对');
    if(review.decision==='link'&&!['admin','verifier'].includes(user.role))fail(403,'关联已有需求来源需核实权限');
   }else if(review?.decision==='link')fail(409,'原需求候选已变化，不能再关联来源');
   if(matched&&review.decision==='link'){
    for(const s of r.sourceData){const sid=sourceIds.get(s.key);writer.bindSource(matched.id,sid,batchId)}
    writer.recordReview(uid(),batchId,matched.id,null,'link',review.reason,user.id,t);recordAudit('demands',matched.id,'attach_source',{batch_id:batchId,source_ids:r.sourceData.map(s=>sourceIds.get(s.key)),duplicate_review:review.reason},review.reason);
    linkedIds.push(matched.id);rowResults.push({row_key:r.rowKey,id:matched.id,demand_no:matched.demand_no,action:'link'});continue;
   }
   const {tower,location,op,unit,priority}=r,id=uid(),no='XQ-'+String(++sequence).padStart(7,'0');
   const demand={id,demand_no:no,batch_id:batchId,
    logical_tower_id:r.workType==='line'&&!location?tower.id:null,
    physical_tower_id:r.workType==='physical'?tower.physical_tower_id:null,
    observed_physical_tower_id:r.workType==='line'&&!location?tower.physical_tower_id:null,
    line_name_snapshot:location?.line.name||tower.line_name,tower_no_snapshot:location?location.start.tower_no+'—'+location.end.tower_no:tower.tower_no,physical_code_snapshot:r.workType==='line'&&location?null:tower.tower_code,
    work_target_type:r.workType,operation_id:op.id,operation_version:op.version,operation_snapshot:op.name,target_object:r.target,quantity_scaled:r.quantity,unit_id:unit.id,unit_version:unit.version,unit_snapshot:unit.name,completion_standard:r.standard,problem_description:r.problem,priority_id:priority?.id||null,priority_snapshot:priority?.name||null,expected_on:r.expected_on,status:'pending',version:1,confirmed_at:null,created_by:user.id,created_at:t,updated_at:t,
    custom_fields_json:JSON.stringify(r.custom),field_definitions_json:JSON.stringify(r.fields),context_line_id:r.workType==='physical'?tower.line_id:null,span_id:location?.span.id||null,span_version:location?.span.version||null,span_snapshot_json:location?JSON.stringify(location.snapshot):null};
   writer.insertDemand(demand);
   for(const s of r.sourceData){const sid=sourceIds.get(s.key);writer.bindSource(id,sid,batchId)}
   if(matched)writer.recordReview(uid(),batchId,matched.id,id,'separate',review.reason,user.id,t);
   for(const lid of r.related)if(lid!==tower.id)writer.linkRelatedTower(id,lid);
   recordAudit('demands',id,'submit',demand);ids.push(id);rowResults.push({row_key:r.rowKey,id,demand_no:no,action:'create'});
  }
  writer.finish(batchId,body,rowResults);
  recordAudit('demand_batches',batchId,'submit',{id:batchId,status:'submitted',demand_count:ids.length});
  return {batch_id:batchId,source_id:firstSource,source_ids:[...sourceIds.values()],count:ids.length,ids,linked_ids:linkedIds,row_results:rowResults};
 });
}

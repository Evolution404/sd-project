import {draftBatch,ownedBatch,updateDraft,deleteDraft,deletedDrafts,batchResult,submitBatch,previewDemandBatch,DEMAND_BODY_LIMIT} from '../application/demand-batches.mjs';
import {demandTemplate,parseDemandWorkbook,inspectWorkbookLayout,demandProblemWorkbook,demandResultWorkbook} from '../infrastructure/excel/demand-workbook.mjs';
import {listAuditRecords,auditRecordDetail,createManualAudit,maintainAuditRecord} from '../application/audit-records.mjs';
import {fundingDetail,updateFunding,fundingDeletionPreview,deleteFunding,deletedFunding,filterFundingStatus} from '../application/funding.mjs';
import {dictionaryWorkspace,changeDictionaryStatus,exportDictionary,dictionaryDeletionPreview,deleteDictionaryItem} from '../application/dictionary-workspace.mjs';
import {nextDictionaryOrder,reorderDictionary} from '../application/dictionary-order.mjs';
import {systemCode} from '../domain/system-code.mjs';
import * as ledger from '../application/ledgers.mjs';
import {validateFieldDefinitions,validateFieldValues} from '../domain/custom-fields.mjs';
import {protectDemandChange,frozenProjects} from '../database/repositories/demand-snapshots.mjs';
import {quantityToScaled} from '../domain/quantity.mjs';
import http from 'node:http';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { readFileSync, createReadStream, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve, extname, sep } from 'node:path';
import {dataRoot,uid,now,transaction,audit} from '../database/index.mjs';
import ExcelJS from 'exceljs';
import {executionRoutes} from './routes/execution-routes.mjs';
import {normalizeIP,isPermittedIP,isLoopback} from './middleware/ip-access.mjs';
import {previewWholeTowerReplacement,replaceWholeTower} from '../application/tower-replacements.mjs';
import {approvalVersions,listChangeOrders,createChangeDraft,getChangeOrder,submitChangeOrder,rejectChangeOrder,approveChangeOrder} from '../application/change-orders.mjs';
import {financeRoutes} from './routes/finance-routes.mjs';
import {listReferencePrices,referencePriceVersions,createReferencePrice,reviseReferencePrice,setReferencePriceStatus,applicableReferencePrices,applyReferencePrice} from '../application/reference-prices.mjs';
import {listFrameworks,createFramework,listAgreements,createAgreement,listProjects,createProject,projectDetail,addScope,changeScope,bindAgreement,advanceProject,savePreliminaryEstimate} from '../application/projects.mjs';
import {seedCurrentDictionaryDefaults} from '../database/repositories/dictionary-defaults.mjs';
import {operationDefinition,validateOperationProfile} from '../domain/operation-definition.mjs';
import {insertDictionaryItem,updateDictionaryItem} from '../database/repositories/dictionaries.mjs';
import {attachmentOwnerExists,insertAttachment,attachmentById,demandAttachments} from '../database/repositories/attachments.mjs';
import {demandDetailRow,demandSources,demandRelatedTowers,demandRelatedIds,demandSourceTypeIds,demandRevisions,ownedDemandBatches,demandSpanChoices,listDemands} from '../database/queries/demands.mjs';
import {healthStatus,overviewCounts,dictionaryTypes,dictionaryType,dictionaryItem,dictionaryRawItem,dictionaryItems,registryList,registryDetail} from '../database/queries/system.mjs';
import {demandById,saveDemandRevision,patchDemandFields} from '../database/repositories/demands.mjs';
import {assetById,lineById,physicalById,logicalAtLocation,hasActivePhysicalDependents,hasActiveLineDependents,createVoltage as insertVoltageAsset,createPhysical as insertPhysicalAsset,createLogical as insertLogicalAsset,patchAsset,recordTowerNameChange,recordPhysicalBindingChange} from '../database/repositories/assets.mjs';
import {firstAdminActor,userByUsername,activeUserForSession,createSession,removeSession,listAllowedIPs,allowedIPById,insertAllowedIP,deleteAllowedIP} from '../database/repositories/access.mjs';

// Add only missing factory options on startup; preserve customized, inactive and
// renamed rows in existing databases. No schema upgrade or destructive reset.
const dictionarySeedActor=firstAdminActor();
if(dictionarySeedActor)transaction(()=>seedCurrentDictionaryDefaults(dictionarySeedActor.id));

class Problem extends Error { constructor(status,message,details){super(message);this.status=status;this.details=details;} }
const fail=(status,message,details)=>{throw new Problem(status,message,details)};
const required=(x,label)=>{if(typeof x!=='string'||!x.trim())fail(422,label+'不能为空');return x.trim()};
const choice=(x,allowed,label)=>{if(!allowed.includes(x))fail(422,label+'无效');return x};
const sha=(data)=>createHash('sha256').update(data).digest('hex');
const shaToken=token=>sha(token);
const verifyPassword=(pass,hash)=>{
 const [salt,hex]=hash.split(':');if(!salt||!hex)return false;
 const expected=Buffer.from(hex,'hex');return expected.length===64&&timingSafeEqual(expected,scryptSync(pass,salt,64));
};
const publicUser=u=>({id:u.id,username:u.username,role:u.role});
const roleSets={view:['admin','editor','verifier','viewer'],write:['admin','editor'],verify:['admin','verifier'],stock:['admin'],approve:['admin'],settle:['admin'],admin:['admin']};
const route=(req)=>new URL(req.url,'http://localhost');
function authenticate(req){
 const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('sd_session='));
 if(!cookie)fail(401,'请登录');
 const token=cookie.slice('sd_session='.length);
 const row=activeUserForSession(shaToken(token),now());
 if(!row)fail(401,'登录已失效');return row;
}
function permit(user,op){if(!roleSets[op].includes(user.role))fail(403,'当前账号没有操作权限')}
function validStatus(s,options){return choice(s,options,'状态')}
function ensureItem(id,type,{active=true}={}){
 const x=dictionaryItem(id,type);
 if(!x||active&&x.status!=='active')fail(422,'字典选项不存在、已删除或已停用：'+type);
 return x;
}
function ensureLogical(id,active=true){
 const x=logicalAtLocation(id);
 if(!x||active&&(x.status!=='active'||x.line_status!=='active'||x.setup_status!=='ready'||x.physical_status!=='active'))fail(422,'逻辑杆塔不存在或台账未启用：'+id);
 return x;
}
function ensureLine(id,active=true){
 const row=lineById(id);
 if(!row||active&&(row.status!=='active'||row.setup_status!=='ready'))fail(422,'线路不存在或已停用');
 return row;
}
const postAudit=(user,entity,item,action,before=null,reason='')=>audit(user.id,entity,item.id,action,before,item,reason);
const json=(res,status,data,extra={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extra});res.end(JSON.stringify(data))};
async function parseJson(req,limit=1024*1024){
 let bytes=0;const chunks=[];
 for await(const buf of req){bytes+=buf.length;if(bytes>limit)fail(413,'提交数据过大');chunks.push(buf)}
 if(!bytes)return {};
 try{const val=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!val||typeof val!=='object'||Array.isArray(val))fail(422,'请求体必须为对象');return val}
 catch(e){if(e instanceof Problem)throw e;fail(400,'JSON 格式错误')}
}
async function parseBinary(req,limit=15*1024*1024){
 let size=0;const chunks=[];
 for await(const buf of req){size+=buf.length;if(size>limit)fail(413,'上传文件超出限制');chunks.push(buf)}
 return Buffer.concat(chunks);
}
function csrf(req){
 const origin=req.headers.origin;
 const host=req.headers.host;
 if(origin&&new URL(origin).host!==host)fail(403,'跨站请求被拒绝');
}
function createVoltage(body,user){
 const order=Number(body.sort_order??nextDictionaryOrder('voltage'));
 if(!Number.isInteger(order))fail(422,'显示顺序必须为整数');
 const id=uid(),code=systemCode(body.code,'VL');
 const item={id,code,name:required(body.name,'电压名称'),
  status:body.status||'active',version:1,sort_order:order,updated_at:now()};
 validStatus(item.status,['active','inactive']);
 transaction(()=>{
  insertVoltageAsset(item);
  postAudit(user,'voltage_levels',item,'create');
 });
 return item;
}
function createLine(body,user){return ledger.createLedgerLine(body,user)}
function createPhysical(body,user){
 const t=now();
 const item={id:uid(),tower_code:required(body.tower_code,'物理塔编码'),asset_no:body.asset_no||null,tower_type:body.tower_type||null,longitude:body.longitude===''||body.longitude==null?null:Number(body.longitude),latitude:body.latitude===''||body.latitude==null?null:Number(body.latitude),commissioned_on:body.commissioned_on||null,status:body.status||'active',version:1,created_at:t,updated_at:t};
 validStatus(item.status,['active','inactive','retired']);
 transaction(()=>{insertPhysicalAsset(item);postAudit(user,'physical_towers',item,'create')});return item;
}
function createLogical(body,user){
 const line=ensureLine(body.line_id);
 const status=body.status||'active';validStatus(status,['draft','active','inactive']);
 const physical=body.physical_tower_id?physicalById(body.physical_tower_id):null;
 if(status==='active'&&(!physical||physical.status!=='active'))fail(422,'启用节点必须关联在用物理塔');
 if(body.physical_tower_id&&!physical)fail(422,'物理塔不存在');
 const sort_rank=Number(body.sort_rank);if(!Number.isInteger(sort_rank)||sort_rank<=0)fail(422,'沿线顺序必须为正整数');
 const t=now(),item={id:uid(),logical_code:required(body.logical_code,'逻辑位置编码'),line_id:line.id,physical_tower_id:physical?.id||null,tower_no:required(body.tower_no,'杆塔编号'),display_name:body.display_name||null,sort_rank,circuit_position:body.circuit_position||null,management_department:String(body.management_department||'').trim(),maintenance_team:String(body.maintenance_team||'').trim(),status,version:1,created_at:t,updated_at:t};
 transaction(()=>{
  insertLogicalAsset(item,physical,user.id,t,{name:uid(),physical:physical?uid():null});
  postAudit(user,'logical_towers',item,'create');
 });
 return item;
}
function updateTowerData(table,id,body,user){
 if(table==='transmission_lines')return ledger.updateLedgerLine(id,{...body,reason:body.reason||'线路资料维护'},user);
 const whitelist={voltage_levels:['code','name','status','sort_order'],transmission_lines:['name','status'],physical_towers:['asset_no','tower_type','longitude','latitude','commissioned_on','status'],logical_towers:['tower_no','display_name','sort_rank','circuit_position','physical_tower_id','management_department','maintenance_team','status']};
 const old=assetById(table,id);if(!old)fail(404,'台账不存在或已删除');
 if(body.version!==old.version)fail(409,'台账已被其他人修改，请刷新');
 const changes=Object.fromEntries(Object.entries(body).filter(([k,v])=>whitelist[table].includes(k)&&v!==undefined));
 if(!Object.keys(changes).length)return old;
 const next={...old,...changes};
 if(table==='voltage_levels'){
  next.code=required(next.code,'电压编码');
  next.name=required(next.name,'电压名称');
  validStatus(next.status,['active','inactive']);
  next.sort_order=Number(next.sort_order);
  if(!Number.isInteger(next.sort_order))fail(422,'显示顺序必须为整数');
  changes.code=next.code;changes.name=next.name;changes.sort_order=next.sort_order;
 }
 if(table==='transmission_lines')validStatus(next.status,['active','inactive']);
 if(table==='logical_towers'){
  validStatus(next.status,['draft','active','inactive']);
  const p=next.physical_tower_id?physicalById(next.physical_tower_id):null;
  if(next.status==='active'&&(!p||p.status!=='active'))fail(422,'启用逻辑塔必须有在用实体');
  if(next.physical_tower_id&&!p)fail(422,'实体不存在');
 }
 if(table==='physical_towers'&&next.status!=='active'){
  if(hasActivePhysicalDependents(id))fail(422,'存在启用逻辑节点，不可停用此实体');
 }
 if(table==='transmission_lines'&&next.status!=='active'){
  if(hasActiveLineDependents(id))fail(422,'线路下有启用逻辑节点，请先处理');
 }
 if(table==='logical_towers'&&old.physical_tower_id!==next.physical_tower_id){
  required(body.reason,'实体变化原因');
  if(body.change_kind!=='correction')fail(409,'整塔更换必须使用物理杆塔整体换塔流程；单回路关联修正请明确标为 correction');
 }

 const t=now();next.version=old.version+1;next.updated_at=t;changes.version=next.version;changes.updated_at=t
 transaction(()=>{
  patchAsset(table,id,changes);
  const reason=body.reason?.trim()||'资料维护';
  if(table==='logical_towers'){
   if(old.tower_no!==next.tower_no||old.display_name!==next.display_name){
    recordTowerNameChange(id,next,user.id,reason,t,uid());
   }
   if(old.physical_tower_id!==next.physical_tower_id){
    recordPhysicalBindingChange(id,next.physical_tower_id,user.id,reason,t,'correction',uid());
   }
  }
  postAudit(user,table,next,'update',old,reason);
 });return next;
}
function createDictionary(body,user){
 const type=dictionaryType(body.type_id);if(!type)fail(422,'未知字典类别');
 if(body.default_unit_id)ensureItem(body.default_unit_id,'unit');
 const item={id:uid(),type_id:type.id,code:systemCode(body.code,'DICT'),name:required(body.name,'字典名称'),status:body.status||'active',sort_order:Number(body.sort_order??nextDictionaryOrder(type.id)),version:1,work_target_type:type.id==='operation'?(body.work_target_type||'line'):null,default_unit_id:type.id==='operation'?(body.default_unit_id||null):null,default_quantity_scaled:type.id==='operation'&&body.default_quantity!=null?quantityToScaled(body.default_quantity):null,completion_standard:type.id==='operation'?(body.completion_standard||null):null,fields_json:JSON.stringify(validateFieldDefinitions(body.fields||[])),updated_at:now()};
 if(!Number.isSafeInteger(item.sort_order))fail(422,'显示顺序必须为整数');
 validStatus(item.status,['active','inactive']);
 if(type.id==='operation'){
  if(!body.work_target_type)fail(422,'请配置操作类型的作业对象');
  operationDefinition({...item,operation_profile:body.operation_profile},item.default_unit_id?ensureItem(item.default_unit_id,'unit'):null);
 }
 const snapshot=type.id==='operation'?{...item,operation_profile:validateOperationProfile(body.operation_profile,item.work_target_type)}:item;
 transaction(()=>{insertDictionaryItem(item,snapshot,user.id);postAudit(user,type.id==='operation'?'operations':'dictionary_items',snapshot,'create')});return snapshot;
}
function updateDictionary(id,body,user){
 const old=dictionaryRawItem(id);if(!old)fail(404,'选项不存在或已删除');if(body.version!==old.version)fail(409,'选项已更新，请刷新');
 const next={...old};
 if(body.operation_profile!==undefined&&old.type_id==='operation')next.operation_profile=validateOperationProfile(body.operation_profile,body.work_target_type??old.work_target_type);
 const keys=['code','name','status','sort_order','work_target_type','default_unit_id','completion_standard'];
 for(const key of keys)if(body[key]!==undefined)next[key]=body[key];
 if(body.default_quantity!==undefined)next.default_quantity_scaled=body.default_quantity===null?null:quantityToScaled(body.default_quantity);
 if(body.fields!==undefined)next.fields_json=JSON.stringify(validateFieldDefinitions(body.fields));
 if(next.default_unit_id&&next.default_unit_id!==old.default_unit_id)ensureItem(next.default_unit_id,'unit');
 if(old.type_id==='operation'&&(body.operation_profile!==undefined||next.default_unit_id!==old.default_unit_id||next.work_target_type!==old.work_target_type||old.status!=='active'&&next.status==='active'))operationDefinition(next,next.default_unit_id?ensureItem(next.default_unit_id,'unit'):null);
 if(!Number.isSafeInteger(next.sort_order))fail(422,'显示顺序必须为整数');
 next.name=required(next.name,'选项名称');next.code=required(next.code,'选项编码');validStatus(next.status,['active','inactive']);next.version++;next.updated_at=now();
 transaction(()=>{
  updateDictionaryItem(old,next,user.id);
  postAudit(user,old.type_id==='operation'?'operations':'dictionary_items',next,'update',old,body.reason||'字典维护');
 });return next;
}
function demandDetail(id){
 const d=demandDetailRow(id);
 if(!d)fail(404,'需求不存在');
 d.sources=demandSources(id);
 d.related_towers=demandRelatedTowers(id);
 d.custom_fields=JSON.parse(d.custom_fields_json);d.field_definitions=JSON.parse(d.field_definitions_json);
 d.project_references=frozenProjects(id);
 d.span_snapshot=d.span_snapshot_json?JSON.parse(d.span_snapshot_json):null;
 d.attachments=demandAttachments(id);
 d.revisions=demandRevisions(id);
 return d;
}
function updateDemand(id,body,user){
 const old=demandById(id);if(!old)fail(404,'需求不存在');
 if(old.version!==body.version)fail(409,'需求版本冲突，请刷新');
 if(old.status==='active'&&(!body.reason||!body.reason.trim()))fail(422,'有效需求修订必须填写原因');
 if(old.status==='cancelled')fail(409,'已取消需求不可直接修改');
 const next={...old};
 const keys=['target_object','completion_standard','problem_description','expected_on','priority_id','operation_id','unit_id'];
 for(const k of keys)if(body[k]!==undefined)next[k]=body[k];
 if(body.work_target_type!==undefined&&body.work_target_type!==old.work_target_type&&next.operation_id===old.operation_id&&body.adopt_operation_definition!==true)fail(422,'作业对象由操作类型确定，不能单独修改');
 if(body.quantity!==undefined)next.quantity_scaled=quantityToScaled(body.quantity);
 if(next.operation_id!==old.operation_id||next.unit_id!==old.unit_id||body.adopt_operation_definition===true){
  const op=ensureItem(next.operation_id,'operation'),definition=operationDefinition(op,op.default_unit_id?ensureItem(op.default_unit_id,'unit'):null);
  if(body.unit_id!==undefined&&body.unit_id!==definition.unit_id)fail(422,'单位必须与操作类型定义一致');
  if(body.work_target_type!==undefined&&body.work_target_type!==definition.work_target_type)fail(422,'作业对象必须与操作类型定义一致');
  if(!definition.location_kinds.includes(old.span_id?'span':'tower'))fail(422,'已有需求的作业位置不在新操作定义允许范围内，请选择适用的操作类型');
  if(definition.work_target_type!==old.work_target_type)fail(422,'原需求位置与新作业对象不一致，请重新登记适用的操作类型和设备位置');
  next.unit_id=definition.unit_id;next.work_target_type=definition.work_target_type;
  next.unit_version=definition.unit.version;next.unit_snapshot=definition.unit.name;
  next.operation_version=op.version;next.operation_snapshot=op.name;next.field_definitions_json=op.fields_json;next.custom_fields_json=JSON.stringify(validateFieldValues(JSON.parse(op.fields_json),body.custom_fields||{}));
 }
 if(next.unit_id!==old.unit_id){const u=ensureItem(next.unit_id,'unit');next.unit_version=u.version;next.unit_snapshot=u.name}
 if(next.priority_id!==old.priority_id){next.priority_snapshot=next.priority_id?ensureItem(next.priority_id,'priority').name:null}
 if(body.custom_fields!==undefined)next.custom_fields_json=JSON.stringify(validateFieldValues(JSON.parse(next.field_definitions_json),body.custom_fields));
 protectDemandChange(old,next);
 next.target_object=required(next.target_object,'处理对象');next.problem_description=required(next.problem_description,'问题说明');next.completion_standard=required(next.completion_standard,'完成标准');
 next.version++;next.updated_at=now();if(old.status==='active'){next.status='pending';next.confirmed_at=null}
 return transaction(()=>{
  saveDemandRevision(id,old,body.reason||'待核实修订',user.id,now(),uid());
  const changed=Object.keys(next).filter(k=>next[k]!==old[k]);
  patchDemandFields(id,Object.fromEntries(changed.map(key=>[key,next[key]])));
  postAudit(user,'demands',next,'revise',old,body.reason||'修改');
  return demandDetail(id);
 });
}
function revalidateLocation(id,body,user){
 const old=demandById(id);if(!old)fail(404,'需求不存在');
 if(old.version!==body.version)fail(409,'需求版本冲突，请刷新');
 if(old.status==='cancelled')fail(409,'已取消需求不能重新核实位置');
 const reason=required(body.reason,'位置重新核实依据');
 return transaction(()=>{
  const related=demandRelatedIds(id);
  const next={...old,status:'pending',confirmed_at:null,
   version:old.version+1,updated_at:now()};
  if(old.span_id){
   const location=ledger.spanDemandLocation(old.span_id);
   next.line_name_snapshot=location.line.name;
   next.tower_no_snapshot=location.start.tower_no+'—'+location.end.tower_no;
   next.span_version=location.span.version;
   next.span_snapshot_json=JSON.stringify(location.snapshot);
  }else if(old.physical_tower_id){
   const physical=physicalById(old.physical_tower_id);
   if(!physical||physical.status!=='active')fail(409,'共用物理杆塔已失效，请先核对设备台账');
   if(related.some(x=>ensureLogical(x.logical_tower_id).physical_tower_id!==physical.id))
    fail(409,'受影响回路与当前实体不一致，请先核对共塔范围');
   next.physical_code_snapshot=physical.tower_code;
  }else{
   const tower=ensureLogical(old.logical_tower_id);
   next.observed_physical_tower_id=tower.physical_tower_id;
   next.line_name_snapshot=tower.line_name;
   next.tower_no_snapshot=tower.tower_no;
   next.physical_code_snapshot=tower.tower_code;
  }
  protectDemandChange(old,next);
  saveDemandRevision(id,old,reason,user.id,now(),uid());
  patchDemandFields(id,Object.fromEntries(Object.keys(next).filter(key=>key!=='id'&&next[key]!==old[key]).map(key=>[key,next[key]])));
  postAudit(user,'demands',next,'revalidate_location',old,reason);return demandDetail(id);
 });
}
function verifyDemand(id,body,user){
 const old=demandById(id);
 if(!old)fail(404,'需求不存在');if(old.version!==body.version)fail(409,'已被其他人修改');
 const status=choice(body.status,['active','returned','cancelled'],'核实结论');
 if(old.status==='cancelled'||old.status==='active'&&status==='active')fail(409,'当前状态不允许此操作');
 const reason=required(body.reason,'核实意见');
 if(status==='active'){
  if(old.logical_tower_id){
   const tower=ensureLogical(old.logical_tower_id);
   if(tower.physical_tower_id!==old.observed_physical_tower_id)
    fail(409,'实体关联已变化，请修订后重新提交核实');
  }else if(old.physical_tower_id){
   const physical=physicalById(old.physical_tower_id);
   if(!physical||physical.status!=='active')fail(409,'物理杆塔已失效，请重新核实位置');
  }else if(!old.span_id)fail(409,'需求缺少有效设备位置');
  ensureItem(old.operation_id,'operation');ensureItem(old.unit_id,'unit');
  validateFieldValues(JSON.parse(old.field_definitions_json),JSON.parse(old.custom_fields_json));
  if(old.span_id){
   const current=ledger.spanDemandLocation(old.span_id),adopted=JSON.parse(old.span_snapshot_json);
   if(old.span_version!==current.span.version||
    ['start_tower_id','end_tower_id','start_physical_tower_id','end_physical_tower_id']
    .some(k=>adopted[k]!==current.snapshot[k]))
    fail(409,'档距或两端杆塔已变化，请重新核实位置');
  }
  for(const link of demandSourceTypeIds(id))ensureItem(link.type_id,'source');
 }
 protectDemandChange(old,{...old,status});
 const t=now(),next={...old,status,version:old.version+1,confirmed_at:status==='active'?t:null,updated_at:t};
 return transaction(()=>{
  saveDemandRevision(id,old,reason,user.id,t,uid());
  patchDemandFields(id,{status:next.status,version:next.version,confirmed_at:next.confirmed_at,updated_at:t});
  postAudit(user,'demands',next,'verify',old,reason);return demandDetail(id);
 });
}
async function exportExcel(rows){
 const workbook=new ExcelJS.Workbook();const sheet=workbook.addWorksheet('需求台账');
 sheet.columns=[['系统编号','demand_no'],['线路','line_name_snapshot'],['杆塔号','tower_no_snapshot'],['物理塔','physical_code_snapshot'],['操作','operation_snapshot'],['处理部位','target_object'],['工作量','quantity_scaled'],['单位','unit_snapshot'],['状态','status'],['问题说明','problem_description']].map(([header,key])=>({header,key,width:20}));
 for(const d of rows)sheet.addRow({...d,quantity_scaled:d.quantity_scaled/10000});
 sheet.getRow(1).font={bold:true};
 return Buffer.from(await workbook.xlsx.writeBuffer());
}
const ROUTES={'/api/voltage-levels':'voltage_levels','/api/lines':'transmission_lines','/api/physical-towers':'physical_towers','/api/logical-towers':'logical_towers'};
async function dispatch(req,res){
 const {pathname,searchParams}=route(req),method=req.method;
 if(pathname==='/api/health'&&method==='GET')return json(res,200,healthStatus());
 if(pathname==='/api/auth/login'&&method==='POST'){
  csrf(req);const body=await parseJson(req);
  const user=userByUsername(required(body.username,'用户名'));
  if(!user||user.status!=='active'||typeof body.password!=='string'||!verifyPassword(body.password,user.password_hash))fail(401,'用户名或密码错误');
  const token=randomBytes(32).toString('hex'),expires=new Date(Date.now()+12*3600*1000).toISOString();
  createSession(shaToken(token),user.id,expires,now());
  const secure=req.socket.encrypted?' Secure;':'';
  return json(res,200,{user:publicUser(user)},{'Set-Cookie':`sd_session=${token}; Path=/; HttpOnly; SameSite=Strict;${secure} Max-Age=43200`});
 }
 const user=authenticate(req);
 if(pathname==='/api/auth/me'&&method==='GET')return json(res,200,{user:publicUser(user)});
 if(pathname==='/api/auth/logout'&&method==='POST'){csrf(req);const token=(req.headers.cookie||'').split(';').find(x=>x.trim().startsWith('sd_session='))?.trim().slice(11);if(token)removeSession(shaToken(token));return json(res,200,{ok:true},{'Set-Cookie':'sd_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'})}
 if(method!=='GET')csrf(req);
 if(pathname==='/api/audit-records'){
  permit(user,'admin');
  if(method==='GET')return json(res,200,listAuditRecords(searchParams));
  if(method==='POST')return json(res,201,createManualAudit(await parseJson(req),user));
 }
 const auditRecordRoute=pathname.match(/^\/api\/audit-records\/([^/]+)(?:\/(restore))?$/);
 if(auditRecordRoute){
  permit(user,'admin');const [,id,action]=auditRecordRoute;
  if(method==='GET'&&!action)return json(res,200,auditRecordDetail(id));
  if(method==='PATCH'&&!action)return json(res,200,maintainAuditRecord(id,'annotate',await parseJson(req),user));
  if(method==='DELETE'&&!action)return json(res,200,maintainAuditRecord(id,'hide',await parseJson(req),user));
  if(method==='POST'&&action==='restore')return json(res,200,maintainAuditRecord(id,'show',await parseJson(req),user));
 }
 if(pathname==='/api/access/ips'&&method==='GET'){
  permit(user,'admin');
  return json(res,200,{current_ip:normalizeIP(req.socket.remoteAddress),local_recovery:true,
   entries:listAllowedIPs()});
 }
 if(pathname==='/api/access/ips'&&method==='POST'){
  permit(user,'admin');const body=await parseJson(req);
  const ip=normalizeIP(required(body.ip,'IP地址'));
  if(!ip)fail(422,'请输入单个有效的 IPv4 或 IPv6 地址，不支持网段、端口或主机名');
  if(isLoopback(ip))fail(422,'本机回环地址始终允许，无需加入白名单');
  const item={id:uid(),ip,note:typeof body.note==='string'?body.note.trim().slice(0,300):'',created_by:user.id,created_at:now()};
  transaction(()=>{insertAllowedIP(item);postAudit(user,'allowed_ips',item,'add')});
  return json(res,201,item);
 }
 const ipEntry=pathname.match(/^\/api\/access\/ips\/([^/]+)$/);
 if(ipEntry&&method==='DELETE'){
  permit(user,'admin');
  const previous=allowedIPById(ipEntry[1]);
  if(!previous)fail(404,'允许访问的IP不存在');
  transaction(()=>{deleteAllowedIP(previous.id);audit(user.id,'allowed_ips',previous.id,'remove',previous,null,'IP访问授权撤销')});
  return json(res,200,{removed:previous.ip});
 }
 const wholeTower=pathname.match(/^\/api\/physical-towers\/([^/]+)\/replace$/);
 if(wholeTower&&method==='GET'){permit(user,'view');return json(res,200,previewWholeTowerReplacement(wholeTower[1]))}
 if(wholeTower&&method==='POST'){permit(user,'write');return json(res,200,replaceWholeTower(wholeTower[1],await parseJson(req),user))}
 if(pathname.startsWith('/api/ledger/')){
  permit(user,'admin');
  const parts=pathname.split('/').filter(Boolean),[, ,entity,id,action,subAction]=parts;
  const body=method==='GET'?null:{...await parseJson(req),__operation:method+' '+pathname};
  if(entity==='lines'&&!id){if(method==='GET')return json(res,200,ledger.listLedgerLines());if(method==='POST')return json(res,201,ledger.createLedgerLine(body,user))}
  if(entity==='lines'&&id){
   if(method==='GET')return json(res,200,ledger.ledgerWorkspace(id));
   if(!action&&method==='PATCH')return json(res,200,ledger.updateLedgerLine(id,body,user));
   if(!action&&method==='DELETE')return json(res,200,ledger.deleteLedgerLine(id,body,user));
   if(action==='topology'&&method==='POST'){
    permit(user,'admin');
    return json(res,subAction==='preview'?200:201,subAction==='preview'
      ?ledger.previewLedgerTopologyDraft(id,body,user):ledger.applyLedgerTopologyDraft(id,body,user));
   }
   if(action==='towers'&&method==='POST')return json(res,subAction==='preview'?200:201,subAction==='preview'?ledger.previewTowers(id,body):ledger.addLedgerTowers(id,body,user));
   if(action==='reorder'&&method==='POST')return json(res,200,ledger.reorderLedgerTowers(id,body,user));
   if(action==='spans'&&method==='POST')return json(res,subAction==='preview'?200:201,subAction==='preview'?ledger.previewSpans(id,body):ledger.addLedgerSpans(id,body,user));
   if(action==='replace-spans'&&method==='POST')return json(res,200,ledger.replaceLedgerSpans(id,body,user));
  }
  if(entity==='towers'&&!id&&method==='GET')return json(res,200,ledger.ledgerTowers(searchParams));
  if(entity==='spans'&&!id&&method==='GET')return json(res,200,ledger.ledgerSpans(searchParams));
  if(entity==='shared'&&method==='POST')return json(res,200,id==='preview'?ledger.previewShared(body):ledger.bindShared(body,user));
  if(entity==='towers'&&id&&action==='detach'){
   if(method==='GET')return json(res,200,ledger.previewDetachShared(id));
   if(method==='POST')return json(res,200,ledger.detachShared(id,body,user));
  }
  if(entity==='towers'&&id){if(method==='GET')return json(res,200,ledger.ledgerTowerDetail(id));if(method==='PATCH')return json(res,200,ledger.updateLedgerTower(id,body,user));if(method==='DELETE')return json(res,200,ledger.deleteLedgerTower(id,body,user))}
  if(entity==='spans'&&id){if(method==='PATCH')return json(res,200,ledger.updateLedgerSpan(id,body,user));if(method==='DELETE')return json(res,200,ledger.deleteLedgerSpan(id,body,user))}
  fail(404,'台账操作不存在');
 }
 if(pathname==='/api/reference-prices'&&method==='GET'){
  permit(user,'view');
  return json(res,200,listReferencePrices({
   operation_id:searchParams.get('operation_id'),unit_id:searchParams.get('unit_id'),
   status:searchParams.get('status')
  }));
 }
 if(pathname==='/api/reference-prices'&&method==='POST'){
  permit(user,'admin');return json(res,201,createReferencePrice(await parseJson(req),user));
 }
 const refHistory=pathname.match(/^\/api\/reference-prices\/([^/]+)\/versions$/);
 if(refHistory&&method==='GET'){permit(user,'view');return json(res,200,referencePriceVersions(refHistory[1]))}
 const refStatus=pathname.match(/^\/api\/reference-prices\/([^/]+)\/status$/);
 if(refStatus&&method==='POST'){permit(user,'admin');return json(res,200,setReferencePriceStatus(refStatus[1],await parseJson(req),user))}
 const refUpdate=pathname.match(/^\/api\/reference-prices\/([^/]+)$/);
 if(refUpdate&&method==='PATCH'){permit(user,'admin');return json(res,200,reviseReferencePrice(refUpdate[1],await parseJson(req),user))}
 const scopeReference=pathname.match(/^\/api\/projects\/([^/]+)\/scopes\/([^/]+)\/reference-price(?:-options)?$/);
 if(scopeReference){
  if(pathname.endsWith('/reference-price-options')&&method==='GET'){
   permit(user,'view');return json(res,200,applicableReferencePrices(scopeReference[1],scopeReference[2]));
  }
  if(pathname.endsWith('/reference-price')&&method==='POST'){
   permit(user,'write');
   applyReferencePrice(scopeReference[1],scopeReference[2],await parseJson(req),user);
   return json(res,200,projectDetail(scopeReference[1]));
  }
 }
 if(pathname==='/api/frameworks'&&method==='GET'){permit(user,'view');return json(res,200,searchParams.get('status')==='deleted'?deletedFunding('frameworks'):filterFundingStatus(listFrameworks(),searchParams.get('status')))}
 if(pathname==='/api/frameworks'&&method==='POST'){permit(user,'write');return json(res,201,createFramework(await parseJson(req),user))}
 if(pathname==='/api/agreements'&&method==='GET'){permit(user,'view');return json(res,200,searchParams.get('status')==='deleted'?deletedFunding('agreements'):filterFundingStatus(listAgreements(),searchParams.get('status')))}
 if(pathname==='/api/agreements'&&method==='POST'){permit(user,'write');return json(res,201,createAgreement(await parseJson(req),user))}
 const fundingRoute=pathname.match(/^\/api\/(frameworks|agreements)\/([^/]+)(?:\/(deletion))?$/);
 if(fundingRoute){
  const [,kind,id,action]=fundingRoute;
  permit(user,method==='GET'?'view':method==='DELETE'?'admin':'write');
  if(method==='GET')return json(res,200,action?fundingDeletionPreview(kind,id):fundingDetail(kind,id));
  if(method==='PATCH'&&!action)return json(res,200,updateFunding(kind,id,await parseJson(req),user));
  if(method==='DELETE'&&!action)return json(res,200,deleteFunding(kind,id,await parseJson(req),user));
 }
 if(await financeRoutes({pathname,method,user,url:route(req),permit,parseJson,req,res,json}))return;
 const projectApproval=pathname.match(/^\/api\/projects\/([^/]+)\/approval-versions$/);
 if(projectApproval&&method==='GET'){permit(user,'view');return json(res,200,approvalVersions(projectApproval[1]))}
 const changeList=pathname.match(/^\/api\/projects\/([^/]+)\/change-orders$/);
 if(changeList&&method==='GET'){permit(user,'view');return json(res,200,listChangeOrders(changeList[1]))}
 if(changeList&&method==='POST'){permit(user,'write');return json(res,201,createChangeDraft(changeList[1],await parseJson(req),user))}
 const changeAction=pathname.match(/^\/api\/change-orders\/([^/]+)\/(submit|approve|reject)$/);
 if(changeAction&&method==='POST'){
  permit(user,changeAction[2]==='submit'?'write':'approve');
  const payload=await parseJson(req);
  return json(res,200,({
   submit:submitChangeOrder,approve:approveChangeOrder,reject:rejectChangeOrder
  })[changeAction[2]](changeAction[1],payload,user));
 }
 const changeDetail=pathname.match(/^\/api\/change-orders\/([^/]+)$/);
 if(changeDetail&&method==='GET'){permit(user,'view');return json(res,200,getChangeOrder(changeDetail[1]))}
 if(pathname==='/api/projects'&&method==='GET'){permit(user,'view');return json(res,200,listProjects())}
 if(pathname==='/api/projects'&&method==='POST'){permit(user,'write');return json(res,201,createProject(await parseJson(req),user))}
 const projectParts=pathname.split('/').filter(Boolean);
 if(projectParts[0]==='api'&&projectParts[1]==='projects'&&projectParts[2]){
  permit(user,method==='GET'?'view':'write');
  const [, , id,action,scopeId]=projectParts;
  if(method==='GET'&&!action)return json(res,200,projectDetail(id));
  if(method==='POST'&&action==='scopes'&&!scopeId)return json(res,201,addScope(id,await parseJson(req),user));
  if(method==='PATCH'&&action==='scopes'&&scopeId)return json(res,200,changeScope(id,scopeId,await parseJson(req),user));
  if(method==='POST'&&action==='agreement')return json(res,200,bindAgreement(id,await parseJson(req),user));
  if(method==='POST'&&action==='preliminary-estimate')return json(res,200,savePreliminaryEstimate(id,await parseJson(req),user));
  if(method==='POST'&&action==='stock'){permit(user,'stock');return json(res,200,advanceProject(id,'stocked',await parseJson(req),user))}
  if(method==='POST'&&action==='approve'){permit(user,'approve');return json(res,200,advanceProject(id,'approved',await parseJson(req),user))}
 }
 if(await executionRoutes({pathname,method,user,url:route(req),permit,parseJson,req,res,json}))return;
 if(pathname==='/api/overview'&&method==='GET'){permit(user,'view');return json(res,200,overviewCounts())}
 const dictionaryDeleteMatch=pathname.match(/^\/api\/dictionary-deletion\/([^/]+)\/([^/]+)$/);
 if(dictionaryDeleteMatch){
  permit(user,'admin');const [,type,id]=dictionaryDeleteMatch;
  if(method==='GET')return json(res,200,dictionaryDeletionPreview(type,id));
  if(method==='DELETE')return json(res,200,deleteDictionaryItem(type,id,await parseJson(req),user));
 }
 if(pathname==='/api/dictionary-workspace'&&method==='GET'){permit(user,'admin');return json(res,200,dictionaryWorkspace())}
 if(pathname==='/api/dictionary-workspace/export.xlsx'&&method==='GET'){
  permit(user,'admin');const buffer=await exportDictionary(searchParams);
  res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="dictionary.xlsx"','Content-Length':buffer.length,'Cache-Control':'no-store'});return res.end(buffer);
 }
 const dictionaryStatusMatch=pathname.match(/^\/api\/dictionary-status\/([^/]+)$/);
 if(dictionaryStatusMatch&&method==='POST'){permit(user,'admin');return json(res,200,changeDictionaryStatus(dictionaryStatusMatch[1],await parseJson(req),user))}
 if(pathname==='/api/dictionary-types'&&method==='GET')return json(res,200,dictionaryTypes());
 if(pathname==='/api/dictionary-items'&&method==='GET'){
  const type=searchParams.get('type');return json(res,200,dictionaryItems(type));
 }
 if(pathname==='/api/demand-entry/spans'&&method==='GET'){
  permit(user,'write');const lineId=required(searchParams.get('line_id'),'线路'),page=Number(searchParams.get('page')||1),search=searchParams.get('search')||'';
  if(!Number.isInteger(page)||page<1)fail(422,'页码无效');
  return json(res,200,demandSpanChoices(lineId,page,search));
 }
 const dictionaryOrderMatch=pathname.match(/^\/api\/dictionary-order\/([^/]+)$/);
 if(dictionaryOrderMatch&&method==='POST'){permit(user,'admin');return json(res,200,reorderDictionary(dictionaryOrderMatch[1],await parseJson(req),user))}
 if(pathname==='/api/dictionary-items'&&method==='POST'){permit(user,'admin');return json(res,201,createDictionary(await parseJson(req),user))}
 const dictMatch=pathname.match(/^\/api\/dictionary-items\/([^/]+)$/);
 if(dictMatch&&method==='PATCH'){permit(user,'admin');return json(res,200,updateDictionary(dictMatch[1],await parseJson(req),user))}
 for(const [path,table] of Object.entries(ROUTES)){
  if(pathname===path&&method==='GET'){
   permit(user,'view');
   const q=searchParams.get('line_id');
   return json(res,200,registryList(table,q));
  }
  if(pathname===path&&method==='POST'){
   permit(user,table==='voltage_levels'?'admin':'write');const body=await parseJson(req);const create={voltage_levels:createVoltage,transmission_lines:createLine,physical_towers:createPhysical,logical_towers:createLogical}[table];
   return json(res,201,create(body,user));
  }
  const match=pathname.match(new RegExp('^'+path+'/([^/]+)$'));
  if(match&&method==='PATCH'){permit(user,table==='voltage_levels'?'admin':'write');return json(res,200,updateTowerData(table,match[1],await parseJson(req),user))}
  if(match&&method==='GET'){
   permit(user,'view');
   const item=registryDetail(table,match[1]);
   if(!item)fail(404,'记录不存在或已删除');
   return json(res,200,item);
  }
 }
 const workbookFile=(buffer,name)=>{res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(name),'Content-Length':buffer.length,'Cache-Control':'no-store'});return res.end(buffer)};
 if(pathname==='/api/demand-import/template'&&method==='POST'){permit(user,'write');return workbookFile(await demandTemplate(await parseJson(req,DEMAND_BODY_LIMIT)),'需求导入模板.xlsx')}
 if(pathname==='/api/demand-import/layout'&&method==='POST'){permit(user,'write');return json(res,200,await inspectWorkbookLayout(await parseBinary(req),{header_row:searchParams.get('header_row')}))}
 if(pathname==='/api/demand-import/parse'&&method==='POST'){
  permit(user,'write');
  const contentType=req.headers['content-type']||'';
  if(!contentType.startsWith('multipart/form-data'))fail(415,'请使用文件表单上传需求文件与导入选项');
  const buffer=await parseBinary(req,DEMAND_BODY_LIMIT+15*1024*1024+1024*1024);
  let form,options;try{form=await new Response(buffer,{headers:{'Content-Type':contentType}}).formData();options=JSON.parse(String(form.get('options')||'{}'))}catch{fail(400,'文件表单或导入选项格式错误')}
  const file=form.get('file');if(!file||typeof file==='string')fail(422,'请选择需求 Excel 文件');
  if(!/\.xlsx$/i.test(file.name))fail(422,'请选择 .xlsx 文件');
  if(file.size>15*1024*1024)fail(413,'Excel文件不能超过15MB');
  if(!options||typeof options!=='object'||Array.isArray(options))fail(422,'导入选项必须为对象');
  return json(res,200,await parseDemandWorkbook(Buffer.from(await file.arrayBuffer()),{...options,filename:file.name}));
 }
 if(pathname==='/api/demand-import/problems'&&method==='POST'){permit(user,'write');return workbookFile(await demandProblemWorkbook(await parseJson(req,DEMAND_BODY_LIMIT)),'需求核对问题.xlsx')}
 if(pathname==='/api/demand-batches'&&method==='GET'){permit(user,'write');const status=choice(searchParams.get('status')||'draft',['draft','submitted','deleted'],'批次状态');if(status==='deleted')return json(res,200,deletedDrafts(user));return json(res,200,ownedDemandBatches(status,user.id,user.role==='admin'))}
 if(pathname==='/api/demand-batches/drafts'&&method==='POST'){permit(user,'write');return json(res,201,draftBatch(await parseJson(req,DEMAND_BODY_LIMIT),user))}
 if(pathname==='/api/demand-batches/submit'&&method==='POST'){permit(user,'write');return json(res,201,submitBatch(await parseJson(req,DEMAND_BODY_LIMIT),user))}
 if(pathname==='/api/demand-batches/preview'&&method==='POST'){permit(user,'write');return json(res,200,previewDemandBatch(await parseJson(req,DEMAND_BODY_LIMIT)))}
 const batchExport=pathname.match(/^\/api\/demand-batches\/([^/]+)\/result.xlsx$/);
 if(batchExport&&method==='GET'){permit(user,'write');const saved=ownedBatch(batchExport[1],user);if(saved.status!=='submitted')fail(409,'批次尚未提交');return workbookFile(await demandResultWorkbook(batchResult(saved.id)),'需求提交结果.xlsx')}
 const batch=pathname.match(/^\/api\/demand-batches\/([^/]+)$/);
 if(batch&&method==='GET'){permit(user,'write');return json(res,200,ownedBatch(batch[1],user))}
 if(batch&&method==='DELETE'){permit(user,'write');return json(res,200,deleteDraft(batch[1],await parseJson(req),user))}
 if(batch&&method==='PATCH'){permit(user,'write');return json(res,200,updateDraft(batch[1],await parseJson(req,DEMAND_BODY_LIMIT),user))}
 if(pathname==='/api/demands/duplicate-candidates'&&method==='POST'){
  permit(user,'view');
  const body=await parseJson(req,DEMAND_BODY_LIMIT),v=previewDemandBatch(body);
  if(v.issues.length)fail(422,'批量预检失败',v.issues);
  return json(res,200,{rows:v.rows.map((x,index)=>({index,candidates:x.candidates}))});
 }
 if(pathname==='/api/demands'&&method==='GET'){permit(user,'view');return json(res,200,listDemands(searchParams))}
 if(pathname==='/api/demands/export.xlsx'&&method==='GET'){permit(user,'view');const buf=await exportExcel(listDemands(searchParams));res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':"attachment; filename*=UTF-8''demands.xlsx",'Content-Length':buf.length,'Cache-Control':'no-store'});return res.end(buf)}
 const d=pathname.match(/^\/api\/demands\/([^/]+)(?:\/(verify|revisions|revalidate-location))?$/);
 if(d&&method==='GET'){permit(user,'view');return json(res,200,demandDetail(d[1]))}
 if(d&&d[2]==='revalidate-location'&&method==='POST'){permit(user,'write');return json(res,200,revalidateLocation(d[1],await parseJson(req),user))}
 if(d&&d[2]==='verify'&&method==='POST'){permit(user,'verify');return json(res,200,verifyDemand(d[1],await parseJson(req),user))}
 if(d&&!d[2]&&method==='PATCH'){permit(user,'write');return json(res,200,updateDemand(d[1],await parseJson(req),user))}
 if(pathname==='/api/attachments'&&method==='POST'){
  permit(user,'write');const ownerType=choice(req.headers['x-owner-type'],['source','demand'],'附件归属');
  const ownerId=required(req.headers['x-owner-id'],'归属ID');
  if(!attachmentOwnerExists(ownerType,ownerId))fail(404,'归属业务对象不存在');
  const filename=required(decodeURIComponent(req.headers['x-filename']||''),'文件名').replace(/[\\/]/g,'_');
  const bytes=await parseBinary(req),key=uid(),id=uid();if(!bytes.length)fail(422,'附件不能为空');
  const file=join(dataRoot,'attachments',key);
  writeFileSync(file,bytes,{flag:'wx'});
  try{transaction(()=>{insertAttachment({id,kind:ownerType,ownerId,storageKey:key,filename,mime:req.headers['content-type']||'application/octet-stream',bytes:bytes.length,sha256:sha(bytes),actorId:user.id,createdAt:now()});postAudit(user,'attachments',{id,owner_type:ownerType,owner_id:ownerId,filename},'upload')})}catch(e){unlinkSync(file);throw e}
  return json(res,201,{id,filename,bytes:bytes.length});
 }
 const att=pathname.match(/^\/api\/attachments\/([^/]+)$/);
 if(att&&method==='GET'){permit(user,'view');const item=attachmentById(att[1]);if(!item)fail(404,'附件不存在');const path=join(dataRoot,'attachments',item.storage_key);
  res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(item.filename),'X-Content-Type-Options':'nosniff'});return createReadStream(path).pipe(res);
 }
 fail(404,'API 不存在');
}
function serveStatic(req,res){
 let path=decodeURIComponent(route(req).pathname);
 if(path.startsWith('/api/'))return json(res,404,{error:'API 不存在'});
 const root=resolve('dist');
 if(!existsSync(root))return json(res,503,{error:'前端尚未构建，请先执行 npm run build'});
 const file=resolve(root,'.'+path);
 if(file!==root&&!file.startsWith(root+sep))return json(res,403,{error:'路径不允许'});
 const target=existsSync(file)&&!path.endsWith('/')?file:join(root,'index.html');
 const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.ico':'image/x-icon'};
 res.writeHead(200,{'Content-Type':types[extname(target)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});
 createReadStream(target).pipe(res);
}
export const app=http.createServer(async(req,res)=>{
 try{
  // Defense in depth: never send any HTTP payload to unauthorized peers.
  if(!isPermittedIP(req.socket.remoteAddress)){req.socket.destroy();return;}
  if(route(req).pathname.startsWith('/api/'))await dispatch(req,res);
  else if(req.method==='GET'||req.method==='HEAD')serveStatic(req,res);
  else fail(405,'方法不允许');
 }
 catch(e){
  if((e?.errcode&255)===19||e?.code?.startsWith('SQLITE_CONSTRAINT'))return json(res,409,{error:'数据约束冲突，请检查编码、外键及有效顺序'});
  if(e?.code==='SQLITE_BUSY')return json(res,503,{error:'数据库繁忙，请重试'});
  const status=e instanceof Problem?e.status:(Number.isInteger(e?.status)?e.status:500);
  if(status===500)console.error(e);
  if(!res.headersSent)json(res,status,{error:status===500?'服务器内部错误':e.message,details:e.details});
  else res.end();
 }
});
// Reject unauthorized peers at the TCP connection event, before HTTP requests
// can be parsed or any response (including /api/health) is generated.
// TCP three-way handshake is already finished at this point; an OS firewall
// is required to drop SYN packets before the handshake.
app.on('connection',socket=>{
 try{
  if(!isPermittedIP(socket.remoteAddress)){
   if(typeof socket.resetAndDestroy==='function')socket.resetAndDestroy();
   else socket.destroy();
  }
 }catch(error){
  console.error('IP access check failed:',error);
  socket.destroy(); // fail closed even if the allowlist database is unavailable
 }
});

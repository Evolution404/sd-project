import * as ledger from './ledgers.mjs';
import {validateFieldDefinitions,validateFieldValues} from './custom-fields.mjs';
import {protectDemandChange,frozenProjects} from './demand-snapshots.mjs';
import {quantityToScaled} from './quantity.mjs';
import http from 'node:http';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { readFileSync, createReadStream, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve, extname, sep } from 'node:path';
import { db, dataRoot, one, all, exec, uid, now, transaction, audit } from './db.mjs';
import ExcelJS from 'exceljs';
import {listExecutions,executionDetail,createExecution,addExecutionItem,changeExecutionStage,confirmCompletion} from './executions.mjs';
import {normalizeIP,isPermittedIP,isLoopback} from './ip-access.mjs';
import {listFrameworks,createFramework,listAgreements,createAgreement,listProjects,createProject,projectDetail,addScope,changeScope,bindAgreement,advanceProject} from './projects.mjs';

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
const roleSets={view:['admin','editor','verifier','viewer'],write:['admin','editor'],verify:['admin','verifier'],admin:['admin']};
const route=(req)=>new URL(req.url,'http://localhost');
function authenticate(req){
 const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('sd_session='));
 if(!cookie)fail(401,'请登录');
 const token=cookie.slice('sd_session='.length);
 const row=one(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.status='active'`,shaToken(token),now());
 if(!row)fail(401,'登录已失效');return row;
}
function permit(user,op){if(!roleSets[op].includes(user.role))fail(403,'当前账号没有操作权限')}
function validStatus(s,options){return choice(s,options,'状态')}
function ensureItem(id,type,{active=true}={}){
 const x=one('SELECT * FROM dictionary_items WHERE id=? AND type_id=?',id,type);
 if(!x||active&&x.status!=='active')fail(422,'字典选项不存在或已停用：'+type);
 return x;
}
function ensureLogical(id,active=true){
 const x=one(`SELECT t.*,l.name AS line_name,l.status AS line_status,l.voltage_level_id,l.setup_status,p.tower_code,p.status AS physical_status
 FROM logical_towers t JOIN transmission_lines l ON l.id=t.line_id
 LEFT JOIN physical_towers p ON p.id=t.physical_tower_id WHERE t.id=?`,id);
 if(!x||active&&(x.status!=='active'||x.line_status!=='active'||x.setup_status!=='ready'||x.physical_status!=='active'))fail(422,'逻辑杆塔不存在或台账未启用：'+id);
 return x;
}
function ensureLine(id,active=true){
 const row=one('SELECT * FROM transmission_lines WHERE id=?',id);
 if(!row||active&&(row.status!=='active'||row.setup_status!=='ready'))fail(422,'线路不存在或已停用');return row;
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
const listLookup=(table)=>all('SELECT * FROM '+table+' ORDER BY created_at DESC LIMIT 1000');
function createVoltage(body,user){
 const order=Number(body.sort_order??100);
 if(!Number.isInteger(order))fail(422,'显示顺序必须为整数');
 const id=uid(),code=body.code===undefined||body.code===null||typeof body.code==='string'&&!body.code.trim()?'VL-'+id.replaceAll('-',''):required(body.code,'电压编码');
 const item={id,code,name:required(body.name,'电压名称'),
  status:body.status||'active',version:1,sort_order:order,updated_at:now()};
 validStatus(item.status,['active','inactive']);
 transaction(()=>{
  exec('INSERT INTO voltage_levels(id,code,name,status,version,sort_order,updated_at) VALUES(?,?,?,?,?,?,?)',...Object.values(item));
  postAudit(user,'voltage_levels',item,'create');
 });
 return item;
}
function createLine(body,user){return ledger.createLedgerLine(body,user)}
function createPhysical(body,user){
 const t=now();
 const item={id:uid(),tower_code:required(body.tower_code,'物理塔编码'),asset_no:body.asset_no||null,tower_type:body.tower_type||null,longitude:body.longitude===''||body.longitude==null?null:Number(body.longitude),latitude:body.latitude===''||body.latitude==null?null:Number(body.latitude),commissioned_on:body.commissioned_on||null,status:body.status||'active',version:1,created_at:t,updated_at:t};
 validStatus(item.status,['active','inactive','retired']);
 transaction(()=>{exec('INSERT INTO physical_towers(id,tower_code,asset_no,tower_type,longitude,latitude,commissioned_on,status,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',...Object.values(item));postAudit(user,'physical_towers',item,'create')});return item;
}
function createLogical(body,user){
 const line=ensureLine(body.line_id);
 const status=body.status||'active';validStatus(status,['draft','active','inactive']);
 const physical=body.physical_tower_id?one('SELECT * FROM physical_towers WHERE id=?',body.physical_tower_id):null;
 if(status==='active'&&(!physical||physical.status!=='active'))fail(422,'启用节点必须关联在用物理塔');
 if(body.physical_tower_id&&!physical)fail(422,'物理塔不存在');
 const sort_rank=Number(body.sort_rank);if(!Number.isInteger(sort_rank)||sort_rank<=0)fail(422,'沿线顺序必须为正整数');
 const t=now(),item={id:uid(),logical_code:required(body.logical_code,'逻辑位置编码'),line_id:line.id,physical_tower_id:physical?.id||null,tower_no:required(body.tower_no,'杆塔编号'),display_name:body.display_name||null,sort_rank,circuit_position:body.circuit_position||null,status,version:1,created_at:t,updated_at:t};
 transaction(()=>{
 exec('INSERT INTO logical_towers VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',...Object.values(item));
 exec('INSERT INTO logical_tower_name_history(id,logical_tower_id,tower_no,display_name,valid_from,valid_to,changed_by,reason) VALUES(?,?,?,?,?,NULL,?,?)',uid(),item.id,item.tower_no,item.display_name,t,user.id,'初始登记');
 if(physical)exec('INSERT INTO logical_tower_physical_history(id,logical_tower_id,physical_tower_id,valid_from,valid_to,change_kind,changed_by,reason) VALUES(?,?,?,?,NULL,?,?,?)',uid(),item.id,physical.id,t,'initial',user.id,'初始核实');
 postAudit(user,'logical_towers',item,'create')});return item;
}
function updateTowerData(table,id,body,user){
 if(table==='transmission_lines')return ledger.updateLedgerLine(id,{...body,reason:body.reason||'线路资料维护'},user);
 const whitelist={voltage_levels:['code','name','status','sort_order'],transmission_lines:['name','status'],physical_towers:['asset_no','tower_type','longitude','latitude','commissioned_on','status'],logical_towers:['tower_no','display_name','sort_rank','circuit_position','physical_tower_id','status']};
 const old=one('SELECT * FROM '+table+' WHERE id=?',id);if(!old)fail(404,'台账不存在');
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
  const p=next.physical_tower_id?one('SELECT * FROM physical_towers WHERE id=?',next.physical_tower_id):null;
  if(next.status==='active'&&(!p||p.status!=='active'))fail(422,'启用逻辑塔必须有在用实体');
  if(next.physical_tower_id&&!p)fail(422,'实体不存在');
 }
 if(table==='physical_towers'&&next.status!=='active'){
  if(one("SELECT 1 FROM logical_towers WHERE physical_tower_id=? AND status='active' LIMIT 1",id))fail(422,'存在启用逻辑节点，不可停用此实体');
 }
 if(table==='transmission_lines'&&next.status!=='active'){
  if(one("SELECT 1 FROM logical_towers WHERE line_id=? AND status='active' LIMIT 1",id))fail(422,'线路下有启用逻辑节点，请先处理');
 }
 if(table==='logical_towers'&&old.physical_tower_id!==next.physical_tower_id&&!required(body.reason,'实体变化原因'))fail(422,'需要原因');
 const t=now();next.version=old.version+1;next.updated_at=t;changes.version=next.version;changes.updated_at=t
 transaction(()=>{
  const keys=Object.keys(changes);exec('UPDATE '+table+' SET '+keys.map(k=>k+'=?').join(',')+' WHERE id=?',...keys.map(k=>changes[k]),id);
  const reason=body.reason?.trim()||'资料维护';
  if(table==='transmission_lines'&&old.name!==next.name){
   exec('UPDATE line_name_history SET valid_to=? WHERE line_id=? AND valid_to IS NULL',t,id);
   exec('INSERT INTO line_name_history(id,line_id,name,valid_from,valid_to,changed_by,reason) VALUES(?,?,?,?,NULL,?,?)',uid(),id,next.name,t,user.id,reason);
  }
  if(table==='logical_towers'){
   if(old.tower_no!==next.tower_no||old.display_name!==next.display_name){
    exec('UPDATE logical_tower_name_history SET valid_to=? WHERE logical_tower_id=? AND valid_to IS NULL',t,id);
    exec('INSERT INTO logical_tower_name_history(id,logical_tower_id,tower_no,display_name,valid_from,valid_to,changed_by,reason) VALUES(?,?,?,?,?,NULL,?,?)',uid(),id,next.tower_no,next.display_name,t,user.id,reason);
   }
   if(old.physical_tower_id!==next.physical_tower_id){
    exec('UPDATE logical_tower_physical_history SET valid_to=? WHERE logical_tower_id=? AND valid_to IS NULL',t,id);
    if(next.physical_tower_id)exec('INSERT INTO logical_tower_physical_history(id,logical_tower_id,physical_tower_id,valid_from,valid_to,change_kind,changed_by,reason) VALUES(?,?,?,?,NULL,?,?,?)',uid(),id,next.physical_tower_id,t,choice(body.change_kind,['correction','replacement'],'实体变化类型'),user.id,reason);
   }
  }
  postAudit(user,table,next,'update',old,reason);
 });return next;
}
function createDictionary(body,user){
 const type=one('SELECT * FROM dictionary_types WHERE id=?',body.type_id);if(!type)fail(422,'未知字典类别');
 if(body.default_unit_id)ensureItem(body.default_unit_id,'unit');
 const item={id:uid(),type_id:type.id,code:required(body.code,'字典编码'),name:required(body.name,'字典名称'),status:body.status||'active',sort_order:Number(body.sort_order??100),version:1,work_target_type:type.id==='operation'?(body.work_target_type||'line'):null,default_unit_id:type.id==='operation'?(body.default_unit_id||null):null,default_quantity_scaled:type.id==='operation'&&body.default_quantity!=null?quantityToScaled(body.default_quantity):null,completion_standard:type.id==='operation'?(body.completion_standard||null):null,fields_json:JSON.stringify(validateFieldDefinitions(body.fields||[])),updated_at:now()};
 validStatus(item.status,['active','inactive']);
 if(item.work_target_type)validStatus(item.work_target_type,['line','physical','both']);
 transaction(()=>{exec('INSERT INTO dictionary_items VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',...Object.values(item));exec('INSERT INTO dictionary_item_versions VALUES(?,?,?,?,?,?)',uid(),item.id,1,JSON.stringify(item),user.id,now());postAudit(user,'dictionary_items',item,'create')});return item;
}
function updateDictionary(id,body,user){
 const old=one('SELECT * FROM dictionary_items WHERE id=?',id);if(!old)fail(404,'选项不存在');if(body.version!==old.version)fail(409,'选项已更新，请刷新');
 const next={...old};
 const keys=['code','name','status','sort_order','work_target_type','default_unit_id','completion_standard'];
 for(const key of keys)if(body[key]!==undefined)next[key]=body[key];
 if(body.default_quantity!==undefined)next.default_quantity_scaled=body.default_quantity===null?null:quantityToScaled(body.default_quantity);
 if(body.fields!==undefined)next.fields_json=JSON.stringify(validateFieldDefinitions(body.fields));
 if(next.default_unit_id)ensureItem(next.default_unit_id,'unit');
 if(next.work_target_type)validStatus(next.work_target_type,['line','physical','both']);
 next.name=required(next.name,'选项名称');next.code=required(next.code,'选项编码');validStatus(next.status,['active','inactive']);next.version++;next.updated_at=now();
 transaction(()=>{
  exec('UPDATE dictionary_items SET code=?,name=?,status=?,sort_order=?,version=?,work_target_type=?,default_unit_id=?,default_quantity_scaled=?,completion_standard=?,fields_json=?,updated_at=? WHERE id=?',next.code,next.name,next.status,next.sort_order,next.version,next.work_target_type,next.default_unit_id,next.default_quantity_scaled,next.completion_standard,next.fields_json,next.updated_at,id);
  exec('INSERT INTO dictionary_item_versions VALUES(?,?,?,?,?,?)',uid(),id,next.version,JSON.stringify(next),user.id,now());
  postAudit(user,'dictionary_items',next,'update',old,body.reason||'字典维护');
 });return next;
}
function draftBatch(body,user){
 const t=now(),item={id:uid(),draft_json:JSON.stringify(body),status:'draft',version:1,idempotency_key:null,payload_sha256:null,source_id:null,created_by:user.id,created_at:t,updated_at:t};
 transaction(()=>{exec('INSERT INTO demand_batches VALUES(?,?,?,?,?,?,?,?,?,?)',...Object.values(item));postAudit(user,'demand_batches',item,'create')});return item;
}
function ownedBatch(id,user){
 const batch=one('SELECT * FROM demand_batches WHERE id=?',id);if(!batch)fail(404,'批次不存在');
 if(batch.created_by!==user.id&&user.role!=='admin')fail(403,'只能访问自己的草稿批次');
 return batch;
}
function updateDraft(id,body,user){
 const old=ownedBatch(id,user);
 if(old.status!=='draft')fail(409,'批次已提交，不能修改草稿');
 if(old.version!==body.version)fail(409,'草稿已被修改，请刷新');
 if(!body.draft||typeof body.draft!=='object'||Array.isArray(body.draft))fail(422,'草稿内容必须为对象');
 return transaction(()=>{
  const next={...old,draft_json:JSON.stringify(body.draft),version:old.version+1,updated_at:now()};
  exec('UPDATE demand_batches SET draft_json=?,version=?,updated_at=? WHERE id=?',next.draft_json,next.version,next.updated_at,id);
  postAudit(user,'demand_batches',next,'update_draft',old,'保存草稿');return next;
 });
}
function validateRows(body){
 if(!Array.isArray(body.rows)||body.rows.length===0||body.rows.length>500)fail(422,'每批需选择1至500个位置');
 if(body.rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))fail(422,'每个位置必须为对象');
 const seen=new Set();const rows=[];const errors=[];
 const workType=choice(body.work_target_type,['line','physical'],'作业对象类型');
 const op=ensureItem(body.operation_id,'operation');
 if(op.work_target_type!=='both'&&op.work_target_type!==workType)fail(422,'操作类型不适用于所选作业对象');
 const unit=ensureItem(body.unit_id,'unit');
 const sourceInputs=body.sources===undefined?[body.source]:(Array.isArray(body.sources)?body.sources:null);
 if(!sourceInputs||sourceInputs.length<1||sourceInputs.length>20)fail(422,'每批次必须填写1至20条来源');
 const sourceData=sourceInputs.map((source,index)=>{
  if(!source||typeof source!=='object')fail(422,'来源'+(index+1)+'不能为空');
  const src=ensureItem(source.type_id,'source');
  const proposer=required(source.proposed_by,'来源'+(index+1)+'的提出单位/人员');
  const discovered=required(source.discovered_on,'来源'+(index+1)+'的发现日期');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(discovered))fail(422,'来源'+(index+1)+'日期格式为 YYYY-MM-DD');
  return {src,proposer,discovered,description:source.description||null,external_ref:source.external_ref||null};
 });
 for(const values of [body.custom_fields,...body.rows.map(row=>row.custom_fields)])if(values!==undefined&&(!values||typeof values!=='object'||Array.isArray(values)))fail(422,'自定义字段值必须为对象');
 const priority=body.priority_id?ensureItem(body.priority_id,'priority'):null;
 const standard=required(body.completion_standard,'完成标准');const problem=required(body.problem_description,'问题说明');
 body.rows.forEach((row,index)=>{
  try{
   const location=row.span_id?ledger.spanDemandLocation(row.span_id):null;
   if(location&&workType!=='line')fail(422,'档距需求请选择线路侧作业');
   if(location&&row.span_version!==location.span.version)fail(409,'档距版本已变化，请重新选择');
   const id=location?location.start.id:required(row.logical_tower_id,'逻辑杆塔');
   const key=location?'span:'+row.span_id:'tower:'+id;if(seen.has(key))fail(422,'重复选择同一位置');seen.add(key);
   const tower=ensureLogical(id);
   const target=required(row.target_object??body.target_object,'部位/处理对象');
   const quantity=quantityToScaled(row.quantity??body.quantity);
   let related=[];
   if(workType==='physical'){
    if(!tower.physical_tower_id)fail(422,'共用实体作业缺少实体核实');
    if(row.related_logical_ids){
     if(!Array.isArray(row.related_logical_ids))fail(422,'关联杆塔格式错误');
     related=[...new Set(row.related_logical_ids)];
     for(const lid of related){
      const other=ensureLogical(lid);
      if(other.physical_tower_id!==tower.physical_tower_id)fail(422,'共用作业受影响杆塔不属于同一实体');
     }
    }
   }
   const fields=validateFieldDefinitions(JSON.parse(op.fields_json));
   const custom=validateFieldValues(fields,{...(body.custom_fields||{}),...(row.custom_fields||{})});
   rows.push({tower,target,quantity,related,custom,fields,location,originalIndex:index});
  }catch(e){errors.push({row:index+1,message:e.message})}
 });
 if(errors.length)fail(422,'批量预检失败',errors);
 // 同一公共实体同一部位的多个主位置必须由用户明确合并或区分范围
 const common=new Set();
 for(const r of rows)if(workType==='physical'){
  const key=r.tower.physical_tower_id+'|'+r.target;
  if(common.has(key))fail(422,'发现共塔同部位重复主需求，请保留一条并在其受影响位置中关联其他回路');
  common.add(key);
 }
 return {rows,op,unit,sourceData,priority,standard,problem,workType};
}
function submitBatch(body,user){
 const key=required(body.idempotency_key,'幂等键');if(key.length>160)fail(422,'幂等键过长');
 const payload=JSON.stringify({...body,idempotency_key:undefined});const digest=sha(payload);
 const previous=one('SELECT * FROM demand_batches WHERE idempotency_key=?',key);
 if(previous){ownedBatch(previous.id,user);if(previous.payload_sha256!==digest)fail(409,'相同幂等键的数据内容不同');return batchResult(previous.id)}
 const draft=body.draft_id?ownedBatch(body.draft_id,user):null;
 if(draft&&(draft.status!=='draft'||draft.version!==body.draft_version))fail(409,'草稿状态或版本已变化，请重新加载');
 const v=validateRows(body);const t=now();
 return transaction(()=>{
  const again=one('SELECT * FROM demand_batches WHERE idempotency_key=?',key);
  if(again){if(again.payload_sha256!==digest)fail(409,'重复键不匹配');return batchResult(again.id)}
  const batchId=draft?.id||uid(),sourceIds=[];
  for(const source of v.sourceData){
   const sourceId=uid();
   exec('INSERT INTO source_records VALUES(?,?,?,?,?,?,?,?,?)',sourceId,source.src.id,source.src.name,source.proposer,source.discovered,source.description,source.external_ref,user.id,t);
   sourceIds.push(sourceId);
  }
  if(draft)exec("UPDATE demand_batches SET draft_json=?,status='submitted',version=version+1,idempotency_key=?,payload_sha256=?,source_id=?,updated_at=? WHERE id=?",JSON.stringify(body),key,digest,sourceIds[0],t,batchId);
  else exec('INSERT INTO demand_batches VALUES(?,?,?,?,?,?,?,?,?,?)',batchId,JSON.stringify(body),'submitted',1,key,digest,sourceIds[0],user.id,t,t);
  const ids=[];
  for(const row of v.rows){
   // Revalidate inside the write lock: no stale objects/options accepted
   const tower=ensureLogical(row.tower.id);
   const op=ensureItem(v.op.id,'operation');const unit=ensureItem(v.unit.id,'unit');
   const priority=v.priority?ensureItem(v.priority.id,'priority'):null;
   for(const source of v.sourceData)ensureItem(source.src.id,'source');
   const id=uid(),seq=one('SELECT COUNT(*) AS n FROM demands').n+1;
   const no='XQ-'+String(seq).padStart(7,'0');
   const item={id,demand_no:no,batch_id:batchId,logical_tower_id:tower.id,observed_physical_tower_id:tower.physical_tower_id,line_name_snapshot:tower.line_name,tower_no_snapshot:tower.tower_no,physical_code_snapshot:tower.tower_code,work_target_type:v.workType,operation_id:op.id,operation_version:op.version,operation_snapshot:op.name,target_object:row.target,quantity_scaled:row.quantity,unit_id:unit.id,unit_version:unit.version,unit_snapshot:unit.name,completion_standard:v.standard,problem_description:v.problem,priority_id:priority?.id||null,priority_snapshot:priority?.name||null,expected_on:body.expected_on||null,status:'pending',version:1,confirmed_at:null,created_by:user.id,created_at:t,updated_at:t};
   item.custom_fields_json=JSON.stringify(row.custom);item.field_definitions_json=JSON.stringify(row.fields);
   item.location_kind=row.location?'span':'tower';item.location_line_id=row.location?.line.id||tower.line_id;item.span_id=row.location?.span.id||null;item.span_version=row.location?.span.version||null;item.span_snapshot_json=row.location?JSON.stringify(row.location.snapshot):null;
   if(row.location){item.line_name_snapshot=row.location.line.name;item.tower_no_snapshot=row.location.start.tower_no+'—'+row.location.end.tower_no;}
   exec('INSERT INTO demands('+Object.keys(item).join(',')+') VALUES('+Object.keys(item).map(()=>'?').join(',')+')',...Object.values(item));
   for(const sourceId of sourceIds)exec('INSERT INTO demand_sources VALUES(?,?)',id,sourceId);
   for(const relatedId of row.related)if(relatedId!==tower.id)exec('INSERT INTO demand_related_logical_towers VALUES(?,?)',id,relatedId);
   postAudit(user,'demands',item,'submit');
   ids.push(id);
  }
  postAudit(user,'demand_batches',{id:batchId,status:'submitted',demand_count:ids.length},'submit');
  return {batch_id:batchId,source_id:sourceIds[0],source_ids:sourceIds,count:ids.length,ids};
 });
}
function batchResult(id){
 const batch=one('SELECT * FROM demand_batches WHERE id=?',id);if(!batch)fail(404,'批次不存在');
 return {batch_id:id,source_id:batch.source_id,source_ids:all('SELECT DISTINCT source_id AS id FROM demand_sources WHERE demand_id IN (SELECT id FROM demands WHERE batch_id=?) ORDER BY source_id',id).map(x=>x.id),count:one('SELECT COUNT(*) n FROM demands WHERE batch_id=?',id).n,ids:all('SELECT id FROM demands WHERE batch_id=? ORDER BY created_at',id).map(x=>x.id)};
}
function demandDetail(id){
 const d=one(`SELECT d.*,l.name AS current_line_name,t.tower_no AS current_tower_no,pt.tower_code AS current_physical_code
 FROM demands d JOIN logical_towers t ON t.id=d.logical_tower_id JOIN transmission_lines l ON l.id=t.line_id
 LEFT JOIN physical_towers pt ON pt.id=t.physical_tower_id WHERE d.id=?`,id);
 if(!d)fail(404,'需求不存在');
 d.sources=all('SELECT s.* FROM source_records s JOIN demand_sources ds ON ds.source_id=s.id WHERE ds.demand_id=?',id);
 d.related_towers=all('SELECT t.*,l.name AS line_name FROM logical_towers t JOIN transmission_lines l ON l.id=t.line_id JOIN demand_related_logical_towers r ON r.logical_tower_id=t.id WHERE r.demand_id=?',id);
 d.custom_fields=JSON.parse(d.custom_fields_json);d.field_definitions=JSON.parse(d.field_definitions_json);
 d.project_references=frozenProjects(id);
 d.span_snapshot=d.span_snapshot_json?JSON.parse(d.span_snapshot_json):null;
 d.attachments=all("SELECT id,filename,bytes,sha256,created_at FROM attachments WHERE owner_type='demand' AND owner_id=? ORDER BY created_at",id);
 d.revisions=all('SELECT * FROM demand_revisions WHERE demand_id=? ORDER BY version DESC',id);
 return d;
}
function updateDemand(id,body,user){
 const old=one('SELECT * FROM demands WHERE id=?',id);if(!old)fail(404,'需求不存在');
 if(old.version!==body.version)fail(409,'需求版本冲突，请刷新');
 if(old.status==='active'&&(!body.reason||!body.reason.trim()))fail(422,'有效需求修订必须填写原因');
 if(old.status==='cancelled')fail(409,'已取消需求不可直接修改');
 const next={...old};
 const keys=['target_object','completion_standard','problem_description','expected_on','priority_id','operation_id','unit_id'];
 for(const k of keys)if(body[k]!==undefined)next[k]=body[k];
 if(body.quantity!==undefined)next.quantity_scaled=quantityToScaled(body.quantity);
 if(next.operation_id!==old.operation_id){
  const op=ensureItem(next.operation_id,'operation');if(op.work_target_type!=='both'&&op.work_target_type!==next.work_target_type)fail(422,'操作不适用');
  next.operation_version=op.version;next.operation_snapshot=op.name;next.field_definitions_json=op.fields_json;next.custom_fields_json=JSON.stringify(validateFieldValues(JSON.parse(op.fields_json),body.custom_fields||{}));
 }
 if(next.unit_id!==old.unit_id){const u=ensureItem(next.unit_id,'unit');next.unit_version=u.version;next.unit_snapshot=u.name}
 if(next.priority_id!==old.priority_id){next.priority_snapshot=next.priority_id?ensureItem(next.priority_id,'priority').name:null}
 if(body.custom_fields!==undefined)next.custom_fields_json=JSON.stringify(validateFieldValues(JSON.parse(next.field_definitions_json),body.custom_fields));
 protectDemandChange(old,next);
 next.target_object=required(next.target_object,'处理对象');next.problem_description=required(next.problem_description,'问题说明');next.completion_standard=required(next.completion_standard,'完成标准');
 next.version++;next.updated_at=now();if(old.status==='active'){next.status='pending';next.confirmed_at=null}
 return transaction(()=>{
  exec('INSERT INTO demand_revisions VALUES(?,?,?,?,?,?,?)',uid(),id,old.version,JSON.stringify(old),body.reason||'待核实修订',user.id,now());
  const changed=Object.keys(next).filter(k=>next[k]!==old[k]);
  exec('UPDATE demands SET '+changed.map(k=>k+'=?').join(',')+' WHERE id=?',...changed.map(k=>next[k]),id);
  postAudit(user,'demands',next,'revise',old,body.reason||'修改');
  return demandDetail(id);
 });
}
function revalidateLocation(id,body,user){
 const old=one('SELECT * FROM demands WHERE id=?',id);if(!old)fail(404,'需求不存在');
 if(old.version!==body.version)fail(409,'需求版本冲突，请刷新');
 if(old.status==='cancelled')fail(409,'已取消需求不能重新核实位置');
 const reason=required(body.reason,'位置重新核实依据');
 return transaction(()=>{
  const tower=ensureLogical(old.logical_tower_id);
  const location=old.span_id?ledger.spanDemandLocation(old.span_id):null;
  const related=all('SELECT logical_tower_id FROM demand_related_logical_towers WHERE demand_id=?',id);
  if(old.work_target_type==='physical'&&related.some(x=>ensureLogical(x.logical_tower_id).physical_tower_id!==tower.physical_tower_id))fail(409,'受影响回路与当前实体不一致，请先核对共塔范围');
  const next={...old,observed_physical_tower_id:tower.physical_tower_id,line_name_snapshot:tower.line_name,tower_no_snapshot:tower.tower_no,physical_code_snapshot:tower.tower_code,status:'pending',confirmed_at:null,version:old.version+1,updated_at:now()};
  if(location){next.line_name_snapshot=location.line.name;next.tower_no_snapshot=location.start.tower_no+'—'+location.end.tower_no;next.span_version=location.span.version;next.span_snapshot_json=JSON.stringify(location.snapshot)}
  protectDemandChange(old,next);
  exec('INSERT INTO demand_revisions VALUES(?,?,?,?,?,?,?)',uid(),id,old.version,JSON.stringify(old),reason,user.id,now());
  exec('UPDATE demands SET observed_physical_tower_id=?,line_name_snapshot=?,tower_no_snapshot=?,physical_code_snapshot=?,status=?,confirmed_at=NULL,version=?,updated_at=?,span_version=?,span_snapshot_json=? WHERE id=?',next.observed_physical_tower_id,next.line_name_snapshot,next.tower_no_snapshot,next.physical_code_snapshot,next.status,next.version,next.updated_at,next.span_version,next.span_snapshot_json,id);
  postAudit(user,'demands',next,'revalidate_location',old,reason);return demandDetail(id);
 });
}
function verifyDemand(id,body,user){
 const old=one('SELECT * FROM demands WHERE id=?',id);
 if(!old)fail(404,'需求不存在');if(old.version!==body.version)fail(409,'已被其他人修改');
 const status=choice(body.status,['active','returned','cancelled'],'核实结论');
 if(old.status==='cancelled'||old.status==='active'&&status==='active')fail(409,'当前状态不允许此操作');
 const reason=required(body.reason,'核实意见');
 if(status==='active'){
  const tower=ensureLogical(old.logical_tower_id);
  if(tower.physical_tower_id!==old.observed_physical_tower_id)fail(409,'实体关联已变化，请修订后重新提交核实');
  ensureItem(old.operation_id,'operation');ensureItem(old.unit_id,'unit');
  validateFieldValues(JSON.parse(old.field_definitions_json),JSON.parse(old.custom_fields_json));
  if(old.span_id){const current=ledger.spanDemandLocation(old.span_id),adopted=JSON.parse(old.span_snapshot_json);if(old.span_version!==current.span.version||['start_tower_id','end_tower_id','start_physical_tower_id','end_physical_tower_id'].some(k=>adopted[k]!==current.snapshot[k]))fail(409,'档距或两端杆塔已变化，请重新核实位置');}
  for(const link of all('SELECT s.type_id FROM source_records s JOIN demand_sources x ON x.source_id=s.id WHERE x.demand_id=?',id))ensureItem(link.type_id,'source');
 }
 protectDemandChange(old,{...old,status});
 const t=now(),next={...old,status,version:old.version+1,confirmed_at:status==='active'?t:null,updated_at:t};
 return transaction(()=>{
  exec('INSERT INTO demand_revisions VALUES(?,?,?,?,?,?,?)',uid(),id,old.version,JSON.stringify(old),reason,user.id,t);
  exec('UPDATE demands SET status=?,version=?,confirmed_at=?,updated_at=? WHERE id=?',status,next.version,next.confirmed_at,t,id);
  postAudit(user,'demands',next,'verify',old,reason);return demandDetail(id);
 });
}
function listDemands(query){
 let sql=`SELECT d.id,d.demand_no,d.line_name_snapshot,d.tower_no_snapshot,d.physical_code_snapshot,d.operation_snapshot,d.target_object,d.quantity_scaled,d.unit_snapshot,d.status,d.version,d.created_at,d.work_target_type,d.problem_description,d.location_kind,d.location_line_id,d.span_id,d.span_version
 FROM demands d WHERE 1=1`;
 const args=[];
 if(query.get('status')){sql+=' AND d.status=?';args.push(query.get('status'))}
 if(query.get('line_id')){sql+=' AND d.location_line_id=?';args.push(query.get('line_id'))}
 if(query.get('search')){sql+=' AND (d.demand_no LIKE ? OR d.target_object LIKE ? OR d.problem_description LIKE ? OR d.line_name_snapshot LIKE ? OR d.tower_no_snapshot LIKE ?)';args.push(...Array(5).fill('%'+query.get('search')+'%'))}
 sql+=' ORDER BY d.created_at DESC,d.demand_no DESC';
 return all(sql,...args);
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
 if(pathname==='/api/health'&&method==='GET')return json(res,200,{ok:true,database:one('PRAGMA quick_check').quick_check==='ok',schema:one('PRAGMA user_version').user_version});
 if(pathname==='/api/auth/login'&&method==='POST'){
  csrf(req);const body=await parseJson(req);
  const user=one('SELECT * FROM users WHERE username=?',required(body.username,'用户名'));
  if(!user||user.status!=='active'||typeof body.password!=='string'||!verifyPassword(body.password,user.password_hash))fail(401,'用户名或密码错误');
  const token=randomBytes(32).toString('hex'),expires=new Date(Date.now()+12*3600*1000).toISOString();
  exec('INSERT INTO sessions VALUES(?,?,?,?)',shaToken(token),user.id,expires,now());
  const secure=req.socket.encrypted?' Secure;':'';
  return json(res,200,{user:publicUser(user)},{'Set-Cookie':`sd_session=${token}; Path=/; HttpOnly; SameSite=Strict;${secure} Max-Age=43200`});
 }
 const user=authenticate(req);
 if(pathname==='/api/auth/me'&&method==='GET')return json(res,200,{user:publicUser(user)});
 if(pathname==='/api/auth/logout'&&method==='POST'){csrf(req);const token=(req.headers.cookie||'').split(';').find(x=>x.trim().startsWith('sd_session='))?.trim().slice(11);if(token)exec('DELETE FROM sessions WHERE token_hash=?',shaToken(token));return json(res,200,{ok:true},{'Set-Cookie':'sd_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'})}
 if(method!=='GET')csrf(req);
 if(pathname==='/api/access/ips'&&method==='GET'){
  permit(user,'admin');
  return json(res,200,{current_ip:normalizeIP(req.socket.remoteAddress),local_recovery:true,
   entries:all('SELECT a.*,u.username AS created_by_name FROM allowed_ips a LEFT JOIN users u ON u.id=a.created_by ORDER BY a.created_at,a.ip')});
 }
 if(pathname==='/api/access/ips'&&method==='POST'){
  permit(user,'admin');const body=await parseJson(req);
  const ip=normalizeIP(required(body.ip,'IP地址'));
  if(!ip)fail(422,'请输入单个有效的 IPv4 或 IPv6 地址，不支持网段、端口或主机名');
  if(isLoopback(ip))fail(422,'本机回环地址始终允许，无需加入白名单');
  const item={id:uid(),ip,note:typeof body.note==='string'?body.note.trim().slice(0,300):'',created_by:user.id,created_at:now()};
  transaction(()=>{exec('INSERT INTO allowed_ips(id,ip,note,created_by,created_at) VALUES(?,?,?,?,?)',...Object.values(item));postAudit(user,'allowed_ips',item,'add')});
  return json(res,201,item);
 }
 const ipEntry=pathname.match(/^\/api\/access\/ips\/([^/]+)$/);
 if(ipEntry&&method==='DELETE'){
  permit(user,'admin');
  const previous=one('SELECT * FROM allowed_ips WHERE id=?',ipEntry[1]);
  if(!previous)fail(404,'允许访问的IP不存在');
  transaction(()=>{exec('DELETE FROM allowed_ips WHERE id=?',previous.id);audit(user.id,'allowed_ips',previous.id,'remove',previous,null,'IP访问授权撤销')});
  return json(res,200,{removed:previous.ip});
 }
 if(pathname.startsWith('/api/ledger/')){
  permit(user,method==='GET'?'view':'write');
  const parts=pathname.split('/').filter(Boolean),[, ,entity,id,action,subAction]=parts;
  const body=method==='GET'?null:{...await parseJson(req),__operation:method+' '+pathname};
  if(entity==='lines'&&!id){if(method==='GET')return json(res,200,ledger.listLedgerLines());if(method==='POST')return json(res,201,ledger.createLedgerLine(body,user))}
  if(entity==='lines'&&id){
   if(method==='GET')return json(res,200,ledger.ledgerWorkspace(id));
   if(!action&&method==='PATCH')return json(res,200,ledger.updateLedgerLine(id,body,user));
   if(!action&&method==='DELETE')return json(res,200,ledger.deleteLedgerLine(id,body,user));
   if(action==='towers'&&method==='POST')return json(res,subAction==='preview'?200:201,subAction==='preview'?ledger.previewTowers(id,body):ledger.addLedgerTowers(id,body,user));
   if(action==='reorder'&&method==='POST')return json(res,200,ledger.reorderLedgerTowers(id,body,user));
   if(action==='spans'&&method==='POST')return json(res,subAction==='preview'?200:201,subAction==='preview'?ledger.previewSpans(id,body):ledger.addLedgerSpans(id,body,user));
   if(action==='replace-spans'&&method==='POST')return json(res,200,ledger.replaceLedgerSpans(id,body,user));
  }
  if(entity==='towers'&&!id&&method==='GET')return json(res,200,ledger.ledgerTowers(searchParams));
  if(entity==='spans'&&!id&&method==='GET')return json(res,200,ledger.ledgerSpans(searchParams));
  if(entity==='shared'&&method==='POST')return json(res,200,id==='preview'?ledger.previewShared(body):ledger.bindShared(body,user));
  if(entity==='towers'&&id){if(method==='GET')return json(res,200,ledger.ledgerTowerDetail(id));if(method==='PATCH')return json(res,200,ledger.updateLedgerTower(id,body,user));if(method==='DELETE')return json(res,200,ledger.deleteLedgerTower(id,body,user))}
  if(entity==='spans'&&id){if(method==='PATCH')return json(res,200,ledger.updateLedgerSpan(id,body,user));if(method==='DELETE')return json(res,200,ledger.deleteLedgerSpan(id,body,user))}
  fail(404,'台账操作不存在');
 }
 if(pathname==='/api/frameworks'&&method==='GET'){permit(user,'view');return json(res,200,listFrameworks())}
 if(pathname==='/api/frameworks'&&method==='POST'){permit(user,'write');return json(res,201,createFramework(await parseJson(req),user))}
 if(pathname==='/api/agreements'&&method==='GET'){permit(user,'view');return json(res,200,listAgreements())}
 if(pathname==='/api/agreements'&&method==='POST'){permit(user,'write');return json(res,201,createAgreement(await parseJson(req),user))}
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
  if(method==='POST'&&action==='stock')return json(res,200,advanceProject(id,'stocked',await parseJson(req),user));
  if(method==='POST'&&action==='approve')return json(res,200,advanceProject(id,'approved',await parseJson(req),user));
 }
 if(pathname.startsWith('/api/projects/')&&pathname.endsWith('/executions')){
  const id=pathname.split('/')[3];
  permit(user,method==='GET'?'view':'write');
  if(method==='GET')return json(res,200,listExecutions(id));
  if(method==='POST')return json(res,201,createExecution(id,await parseJson(req),user));
 }
 const execParts=pathname.split('/').filter(Boolean);
 if(execParts[0]==='api'&&execParts[1]==='executions'&&execParts[2]){
  permit(user,method==='GET'?'view':'write');
  const [, ,id,action,itemId,subAction]=execParts;
  if(method==='GET'&&!action)return json(res,200,executionDetail(id));
  if(method==='POST'&&action==='items'&&!itemId)return json(res,201,addExecutionItem(id,await parseJson(req),user));
  if(method==='POST'&&['start','finish','cancel'].includes(action))return json(res,200,changeExecutionStage(id,{start:'running',finish:'finished',cancel:'cancelled'}[action],await parseJson(req),user));
  if(method==='POST'&&action==='items'&&itemId&&subAction==='complete')return json(res,201,confirmCompletion(id,itemId,await parseJson(req),user));
 }
 if(pathname==='/api/overview'&&method==='GET'){permit(user,'view');return json(res,200,{lines:one('SELECT COUNT(*) n FROM transmission_lines').n,physical:one('SELECT COUNT(*) n FROM physical_towers').n,logical:one('SELECT COUNT(*) n FROM logical_towers').n,pending:one("SELECT COUNT(*) n FROM demands WHERE status='pending'").n,active:one("SELECT COUNT(*) n FROM demands WHERE status='active'").n})}
 if(pathname==='/api/dictionary-types'&&method==='GET')return json(res,200,all('SELECT * FROM dictionary_types WHERE id NOT IN (?,?) ORDER BY rowid','team','erection'));
 if(pathname==='/api/dictionary-items'&&method==='GET'){
  const type=searchParams.get('type');return json(res,200,type?all('SELECT * FROM dictionary_items WHERE type_id=? ORDER BY sort_order,name',type):all('SELECT * FROM dictionary_items ORDER BY type_id,sort_order,name'));
 }
 if(pathname==='/api/dictionary-items'&&method==='POST'){permit(user,'admin');return json(res,201,createDictionary(await parseJson(req),user))}
 const dictMatch=pathname.match(/^\/api\/dictionary-items\/([^/]+)$/);
 if(dictMatch&&method==='PATCH'){permit(user,'admin');return json(res,200,updateDictionary(dictMatch[1],await parseJson(req),user))}
 for(const [path,table] of Object.entries(ROUTES)){
  if(pathname===path&&method==='GET'){
   permit(user,'view');
   const q=searchParams.get('line_id');
   if(table==='logical_towers')return json(res,200,all(`SELECT t.*,l.name AS line_name,v.name AS voltage_name,p.tower_code AS physical_code
    FROM logical_towers t JOIN transmission_lines l ON l.id=t.line_id JOIN voltage_levels v ON v.id=l.voltage_level_id LEFT JOIN physical_towers p ON p.id=t.physical_tower_id
    WHERE (? IS NULL OR t.line_id=?) ORDER BY l.name,t.sort_rank`,q,q));
   if(table==='transmission_lines')return json(res,200,all('SELECT l.*,v.name AS voltage_name FROM transmission_lines l JOIN voltage_levels v ON v.id=l.voltage_level_id ORDER BY l.name'));
   return json(res,200,all('SELECT * FROM '+table+(table==='voltage_levels'?' ORDER BY sort_order,name':' ORDER BY rowid DESC')+' LIMIT 1000'));
  }
  if(pathname===path&&method==='POST'){
   permit(user,table==='voltage_levels'?'admin':'write');const body=await parseJson(req);const create={voltage_levels:createVoltage,transmission_lines:createLine,physical_towers:createPhysical,logical_towers:createLogical}[table];
   return json(res,201,create(body,user));
  }
  const match=pathname.match(new RegExp('^'+path+'/([^/]+)$'));
  if(match&&method==='PATCH'){permit(user,table==='voltage_levels'?'admin':'write');return json(res,200,updateTowerData(table,match[1],await parseJson(req),user))}
  if(match&&method==='GET'){permit(user,'view');const item=one('SELECT * FROM '+table+' WHERE id=?',match[1]);if(!item)fail(404,'记录不存在');
   const histories={transmission_lines:'line_name_history',logical_towers:'logical_tower_name_history'};
   return json(res,200,{...item,name_history:histories[table]?all('SELECT * FROM '+histories[table]+' WHERE '+(table==='transmission_lines'?'line_id':'logical_tower_id')+'=? ORDER BY valid_from DESC',match[1]):[],physical_history:table==='logical_towers'?all('SELECT * FROM logical_tower_physical_history WHERE logical_tower_id=? ORDER BY valid_from DESC',match[1]):[]});
  }
 }
 if(pathname==='/api/demand-batches'&&method==='GET'){permit(user,'write');const status=choice(searchParams.get('status')||'draft',['draft','submitted'],'批次状态');return json(res,200,all('SELECT * FROM demand_batches WHERE status=? AND (created_by=? OR ?=1) ORDER BY updated_at DESC',status,user.id,user.role==='admin'?1:0))}
 if(pathname==='/api/demand-batches/drafts'&&method==='POST'){permit(user,'write');return json(res,201,draftBatch(await parseJson(req),user))}
 if(pathname==='/api/demand-batches/submit'&&method==='POST'){permit(user,'write');return json(res,201,submitBatch(await parseJson(req),user))}
 const batch=pathname.match(/^\/api\/demand-batches\/([^/]+)$/);
 if(batch&&method==='GET'){permit(user,'write');return json(res,200,ownedBatch(batch[1],user))}
 if(batch&&method==='PATCH'){permit(user,'write');return json(res,200,updateDraft(batch[1],await parseJson(req),user))}
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
  if(!one('SELECT id FROM '+(ownerType==='source'?'source_records':'demands')+' WHERE id=?',ownerId))fail(404,'归属业务对象不存在');
  const filename=required(decodeURIComponent(req.headers['x-filename']||''),'文件名').replace(/[\\/]/g,'_');
  const bytes=await parseBinary(req),key=uid(),id=uid();if(!bytes.length)fail(422,'附件不能为空');
  const file=join(dataRoot,'attachments',key);
  writeFileSync(file,bytes,{flag:'wx'});
  try{transaction(()=>{exec('INSERT INTO attachments(id,owner_type,owner_id,storage_key,filename,mime,bytes,sha256,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',id,ownerType,ownerId,key,filename,req.headers['content-type']||'application/octet-stream',bytes.length,sha(bytes),user.id,now());postAudit(user,'attachments',{id,owner_type:ownerType,owner_id:ownerId,filename},'upload')})}catch(e){unlinkSync(file);throw e}
  return json(res,201,{id,filename,bytes:bytes.length});
 }
 const att=pathname.match(/^\/api\/attachments\/([^/]+)$/);
 if(att&&method==='GET'){permit(user,'view');const item=one('SELECT * FROM attachments WHERE id=?',att[1]);if(!item)fail(404,'附件不存在');const path=join(dataRoot,'attachments',item.storage_key);
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
if(process.env.SD_DISABLE_LISTEN!=='1'){
 const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT||8787);
 app.listen(port,host,()=>console.log(`SD Project listening on http://${host}:${port}, DATA_DIR=${dataRoot}`));
}

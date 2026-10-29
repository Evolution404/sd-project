import {spanDemandLocation} from './ledgers.mjs';
import {captureDemand,readDemandSnapshot} from './demand-snapshots.mjs';
import {quantityToScaled} from './quantity.mjs';
import {uid,now,one,all,exec,transaction,audit} from './db.mjs';
const fault=(status,message)=>{const e=new Error(message);e.status=status;throw e};
const required=(value,label)=>{if(typeof value!=='string'||!value.trim())fault(422,label+'不能为空');return value.trim()};
const versionOf=(old,body)=>{
 if(!Number.isInteger(body.version)||body.version!==old.version)fault(409,'版本不匹配，请刷新后再提交');
};
export function yuanToFen(value,label='金额'){
 const raw=String(value??'').trim();
 if(!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(raw))fault(422,label+'格式无效，最多两位小数');
 const [integer,frac='']=raw.split('.');
 const fen=BigInt(integer)*100n+BigInt(frac.padEnd(2,'0'));
 if(fen>BigInt(Number.MAX_SAFE_INTEGER))fault(422,label+'超出有效范围');
 return Number(fen);
}
export function lineEstimate(scope){
 if(scope.unit_price_fen===null)return null;
 const fen=(BigInt(scope.quantity_scaled)*BigInt(scope.unit_price_fen)+5000n)/10000n;
 if(fen>BigInt(Number.MAX_SAFE_INTEGER))fault(422,'明细金额超过允许范围');
 return Number(fen);
}
const framework=id=>one('SELECT * FROM frameworks WHERE id=?',id)||fault(404,'框架不存在');
const agreement=id=>one('SELECT * FROM agreements WHERE id=?',id)||fault(404,'执行协议不存在');
const project=id=>one('SELECT * FROM projects WHERE id=?',id)||fault(404,'项目不存在');
const scopes=id=>all(`SELECT s.*,d.quantity_scaled AS demand_quantity_scaled,d.status AS demand_status
 FROM project_demand_scopes s JOIN demands d ON d.id=s.demand_id WHERE s.project_id=? ORDER BY s.created_at,s.id`,id).map(s=>{
 const d=readDemandSnapshot(s);
 if(!d)fault(409,'项目需求历史快照缺失，请先核对历史版本');
 return {...s,demand_no:d.demand_no,operation_snapshot:d.operation_snapshot,line_name_snapshot:d.line_name_snapshot,
  tower_no_snapshot:d.tower_no_snapshot,target_object:d.target_object,unit_snapshot:d.unit_snapshot,demand_snapshot:d};
});
function summary(items){
 const missing=items.filter(x=>x.unit_price_fen===null);
 const total=items.reduce((n,x)=>n+BigInt(lineEstimate(x)||0),0n);
 if(total>BigInt(Number.MAX_SAFE_INTEGER))fault(422,'估算总金额超过允许范围');
 return {known_total_fen:Number(total),missing_price_count:missing.length,total:items.length,complete:missing.length===0&&items.length>0};
}
const event=(user,entity,id,action,before,after,reason='')=>audit(user.id,entity,id,action,before,after,reason);
export function listFrameworks(){
 return all(`SELECT f.*, COALESCE((SELECT SUM(a.limit_fen) FROM agreements a WHERE a.framework_id=f.id),0) agreement_limit_fen,
 (SELECT COUNT(*) FROM agreements a WHERE a.framework_id=f.id) agreement_count,
 COALESCE((SELECT SUM(p.approved_budget_fen) FROM projects p JOIN agreements a ON a.id=p.agreement_id WHERE a.framework_id=f.id AND p.status IN ('approved','closed')),0) approved_project_budget_fen
 FROM frameworks f ORDER BY f.created_at DESC`);
}
export function createFramework(body,user){
 const t=now(),item={id:uid(),code:required(body.code,'框架编码'),name:required(body.name,'框架名称'),
 limit_fen:yuanToFen(body.limit_yuan,'框架额度'),status:'active',version:1,created_at:t,updated_at:t};
 if(item.limit_fen<=0)fault(422,'框架额度必须大于零');
 return transaction(()=>{exec('INSERT INTO frameworks VALUES(?,?,?,?,?,?,?,?)',...Object.values(item));event(user,'frameworks',item.id,'create',null,item);return item});
}
export function listAgreements(){
 return all(`SELECT a.*,f.name AS framework_name,f.code AS framework_code,
 COALESCE((SELECT SUM(p.approved_budget_fen) FROM projects p WHERE p.agreement_id=a.id AND p.status IN ('approved','closed')),0) approved_budget_fen
 FROM agreements a JOIN frameworks f ON f.id=a.framework_id ORDER BY a.created_at DESC`);
}
export function createAgreement(body,user){
 const f=framework(body.framework_id);
 if(f.status!=='active')fault(422,'框架已停用，不能新增协议');
 const fen=yuanToFen(body.limit_yuan,'协议额度');
 if(fen<=0)fault(422,'协议额度必须大于零');
 const t=now(),item={id:uid(),code:required(body.code,'协议编号'),framework_id:f.id,
 name:required(body.name,'协议名称'),limit_fen:fen,status:'active',version:1,created_at:t,updated_at:t};
 return transaction(()=>{
  const used=one('SELECT COALESCE(SUM(limit_fen),0) n FROM agreements WHERE framework_id=?',f.id).n;
  if(BigInt(used)+BigInt(fen)>BigInt(f.limit_fen))fault(422,'协议额度累计超过框架总额度');
  exec('INSERT INTO agreements VALUES(?,?,?,?,?,?,?,?,?)',...Object.values(item));
  event(user,'agreements',item.id,'create',null,item);return item;
 });
}
export function createProject(body,user){
 const ag=body.agreement_id?agreement(body.agreement_id):null;
 if(ag&&ag.status!=='active')fault(422,'执行协议不可用');
 if(body.category_id){
  const item=one("SELECT * FROM dictionary_items WHERE id=? AND type_id='category' AND status='active'",body.category_id);
  if(!item)fault(422,'无效的项目类别');
 }
 const t=now(),item={id:uid(),code:required(body.code,'项目编号'),name:required(body.name,'项目名称'),
 agreement_id:ag?.id||null,category_id:body.category_id||null,status:'reserve',version:1,estimate_fen:null,approved_budget_fen:null,created_by:user.id,created_at:t,updated_at:t};
 return transaction(()=>{
  exec('INSERT INTO projects VALUES('+Object.keys(item).map(()=>'?').join(',')+')',...Object.values(item));
  event(user,'projects',item.id,'create',null,item);return item;
 });
}
export function listProjects(){
 return all(`SELECT p.*,a.name AS agreement_name,f.name AS framework_name,
 (SELECT COUNT(*) FROM project_demand_scopes s WHERE s.project_id=p.id) demand_count
 FROM projects p LEFT JOIN agreements a ON a.id=p.agreement_id
 LEFT JOIN frameworks f ON f.id=a.framework_id ORDER BY p.created_at DESC`);
}
export function projectDetail(id){
 const p=project(id),items=scopes(id),events=all('SELECT * FROM project_stage_events WHERE project_id=? ORDER BY created_at',id);
 return {...p,scopes:items,estimate:summary(items),events};
}
function demand(id){
 const d=one('SELECT * FROM demands WHERE id=?',id);
 if(!d||d.status!=='active')fault(422,'必须选择已核实有效的需求');
 const current=one('SELECT physical_tower_id FROM logical_towers WHERE id=?',d.logical_tower_id);
 if(current?.physical_tower_id!==d.observed_physical_tower_id)fault(409,'需求实体关联已变化，请重新核实位置后再关联项目');
 if(d.span_id){const latest=spanDemandLocation(d.span_id),adopted=JSON.parse(d.span_snapshot_json);if(latest.span.version!==d.span_version||['start_tower_id','end_tower_id','start_physical_tower_id','end_physical_tower_id'].some(k=>adopted[k]!==latest.snapshot[k]))fault(409,'档距已变化，请重新核实位置后再关联项目');}
 return d;
}
export function addScope(id,body,user){
 const p=project(id);versionOf(p,body);
 if(p.status!=='reserve')fault(409,'正式入库后不得直接改变需求范围');
 const d=demand(body.demand_id),q=quantityToScaled(body.quantity);
 if(q>d.quantity_scaled)fault(422,'纳入数量不能超过需求核实数量');
 const t=now(),item={id:uid(),project_id:id,demand_id:d.id,demand_version:d.version,quantity_scaled:q,
 unit_price_fen:null,price_source:null,price_date:null,tax_mode:null,note:body.note||'',created_at:t,updated_at:t,demand_snapshot_json:JSON.stringify(captureDemand(d))};
 return transaction(()=>{
  exec('INSERT INTO project_demand_scopes('+Object.keys(item).join(',')+') VALUES('+Object.keys(item).map(()=>'?').join(',')+')',...Object.values(item));
  exec('UPDATE projects SET version=version+1,updated_at=? WHERE id=?',t,id);
  event(user,'project_demand_scopes',item.id,'create',null,item);
  return projectDetail(id);
 });
}
export function changeScope(id,scopeId,body,user){
 const p=project(id);versionOf(p,body);
 if(!['reserve','stocked'].includes(p.status))fault(409,'立项后需求与估价已冻结');
 if(p.status==='stocked'&&body.quantity!==undefined)fault(409,'入库范围已冻结，不可直接改变数量');
 const old=one('SELECT * FROM project_demand_scopes WHERE id=? AND project_id=?',scopeId,id);
 if(!old)fault(404,'关联需求不存在');
 const d=demand(old.demand_id);
 const next={...old};
 if(body.quantity!==undefined)next.quantity_scaled=quantityToScaled(body.quantity);
 if(next.quantity_scaled>d.quantity_scaled)fault(422,'超过需求工作量');
 if(body.unit_price_yuan!==undefined){
  next.unit_price_fen=body.unit_price_yuan===null||body.unit_price_yuan===''?null:yuanToFen(body.unit_price_yuan,'单价');
 }
 if(body.price_source!==undefined)next.price_source=body.price_source?.trim()||null;
 if(body.price_date!==undefined)next.price_date=body.price_date||null;
 if(body.tax_mode!==undefined){
  if(body.tax_mode&&!['inclusive','exclusive','none'].includes(body.tax_mode))fault(422,'税口径无效');
  next.tax_mode=body.tax_mode||null;
 }
 if(body.note!==undefined)next.note=body.note;
 if(p.status==='reserve'){next.demand_version=d.version;next.demand_snapshot_json=JSON.stringify(captureDemand(d))}
 next.updated_at=now();
 return transaction(()=>{
  exec('UPDATE project_demand_scopes SET demand_version=?,quantity_scaled=?,unit_price_fen=?,price_source=?,price_date=?,tax_mode=?,note=?,updated_at=?,demand_snapshot_json=? WHERE id=?',
  next.demand_version,next.quantity_scaled,next.unit_price_fen,next.price_source,next.price_date,next.tax_mode,next.note,next.updated_at,next.demand_snapshot_json,scopeId);
  exec('UPDATE projects SET version=version+1,updated_at=? WHERE id=?',now(),id);
  event(user,'project_demand_scopes',scopeId,'update',old,next,body.reason||'估算明细调整');
  return projectDetail(id);
 });
}
export function bindAgreement(id,body,user){
 const p=project(id);versionOf(p,body);
 if(p.status==='approved'||p.status==='closed')fault(409,'立项后的协议归属不得通过普通编辑改挂');
 const ag=agreement(body.agreement_id);
 if(ag.status!=='active'||framework(ag.framework_id).status!=='active')fault(422,'协议或框架已停用');
 return transaction(()=>{
  const next={...p,agreement_id:ag.id,version:p.version+1,updated_at:now()};
  exec('UPDATE projects SET agreement_id=?,version=?,updated_at=? WHERE id=?',next.agreement_id,next.version,next.updated_at,id);
  event(user,'projects',id,'bind_agreement',p,next,body.reason||'落实执行协议');return projectDetail(id);
 });
}
function stageSnapshot(p,items,stage,reason,user){
 return {project_id:p.id,project_code:p.code,project_name:p.name,stage,agreement_id:p.agreement_id,
 scopes:items.map(x=>({scope_id:x.id,demand_id:x.demand_id,demand_version:x.demand_version,demand_snapshot:x.demand_snapshot,quantity_scaled:x.quantity_scaled,unit_price_fen:x.unit_price_fen,price_source:x.price_source,price_date:x.price_date,tax_mode:x.tax_mode,amount_fen:lineEstimate(x)})),
 created_at:now(),reason,actor_id:user.id};
}
export function advanceProject(id,stage,body,user){
 const p=project(id);versionOf(p,body);
 const reason=required(body.reason,'阶段确认依据');
 if(stage==='stocked'&&p.status!=='reserve'||stage==='approved'&&p.status!=='stocked')fault(409,'项目当前阶段不允许该操作');
 if(!['stocked','approved'].includes(stage))fault(422,'无效阶段');
 return transaction(()=>{
  const latest=project(id);versionOf(latest,body);
  const items=scopes(id);
  if(items.length===0)fault(422,'至少关联一条核实需求');
  for(const x of items){const d=demand(x.demand_id);
   if(latest.status==='reserve'&&d.version!==x.demand_version)fault(409,'需求已发生修订，必须核对范围版本');
  }
  const estimate=summary(items);
  if(stage==='approved'){
   if(!latest.agreement_id)fault(422,'立项前必须绑定唯一执行协议');
   const ag=agreement(latest.agreement_id),fw=framework(ag.framework_id);
   if(ag.status!=='active'||fw.status!=='active')fault(422,'协议或框架未启用');
   if(!estimate.complete)fault(422,'存在未估价需求，不能形成批准预算');
   if(items.some(x=>!x.price_source||!x.price_date||!x.tax_mode))fault(422,'立项估算缺少价格来源、日期或税口径');
   const used=one("SELECT COALESCE(SUM(approved_budget_fen),0) n FROM projects WHERE agreement_id=? AND status IN ('approved','closed')",ag.id).n;
   if(BigInt(used)+BigInt(estimate.known_total_fen)>BigInt(ag.limit_fen))fault(422,'批准预算超过协议可用额度');
   for(const x of items){
    const assigned=one(`SELECT COALESCE(SUM(s.quantity_scaled),0) n
     FROM project_demand_scopes s JOIN projects p ON p.id=s.project_id
     WHERE s.demand_id=? AND p.status IN ('approved','closed')`,x.demand_id).n;
    if(assigned+x.quantity_scaled>x.demand_quantity_scaled)fault(409,'需求范围已被其他有效项目承接，不能重复立项：'+x.demand_no);
   }
  }
  const t=now(),newVersion=latest.version+1;
  exec('UPDATE projects SET status=?,version=?,estimate_fen=?,approved_budget_fen=?,updated_at=? WHERE id=?',stage,newVersion,estimate.complete?estimate.known_total_fen:null,stage==='approved'?estimate.known_total_fen:null,t,id);
  const snapshot=stageSnapshot(latest,items,stage,reason,user);
  exec('INSERT INTO project_stage_events VALUES(?,?,?,?,?,?,?,?)',uid(),id,stage,newVersion,JSON.stringify(snapshot),reason,user.id,t);
  event(user,'projects',id,'stage_'+stage,latest,{...latest,status:stage,version:newVersion,estimate},reason);
  return projectDetail(id);
 });
}

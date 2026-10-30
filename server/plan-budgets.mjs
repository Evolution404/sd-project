import {planCostTotals} from './cost-rules.mjs';
import {createHash} from 'node:crypto';
import {all,one,exec,uid,now,audit,transaction} from './db.mjs';
import {yuanToFen} from './money.mjs';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
const required=(v,label)=>typeof v==='string'&&v.trim()?v.trim():fail(422,label+'不能为空');
const plan=id=>one('SELECT * FROM executions WHERE id=?',id)||fail(404,'检修计划不存在');
const project=id=>one('SELECT * FROM projects WHERE id=?',id)||fail(404,'子项目不存在');
const current=id=>one('SELECT * FROM plan_budget_current WHERE execution_id=?',id)||null;
const approval=id=>one('SELECT * FROM project_approval_versions WHERE project_id=? ORDER BY version_no DESC LIMIT 1',id)||fail(409,'项目缺少正式批准依据');
const draft=id=>one('SELECT * FROM plan_budget_drafts WHERE id=?',id)||fail(404,'预算草稿不存在');
function bodyFields(body,fields){
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!fields.includes(k)))fail(422,'预算操作包含无效字段');
}
function draftVersion(row,body){
 if(!Number.isSafeInteger(body.version)||body.version!==row.version)fail(409,'预算草稿已变化，请刷新后重试');
 if(row.status!=='draft')fail(409,'预算草稿已确认或已删除，请查看历史或另建调整草稿');
}
const netForPlan=id=>one(`SELECT COALESCE(SUM(CASE WHEN se.entry_kind='payment' THEN se.amount_fen ELSE -se.amount_fen END),0) n
 FROM effective_settlement_entries se JOIN execution_items i ON i.id=se.execution_item_id WHERE i.execution_id=?`,id).n;
export function projectPlanBudgetSummary(projectId){
 const p=project(projectId);
 const plans=all(`SELECT e.id AS execution_id,e.number,e.status,b.id AS budget_id,b.version_no AS budget_version,
  b.kind AS budget_kind,b.amount_fen AS confirmed_budget_fen,b.confirmed_at,
  (SELECT COUNT(*) FROM plan_budget_drafts d WHERE d.execution_id=e.id AND d.status='draft') AS draft_count
  FROM executions e LEFT JOIN plan_budget_current b ON b.execution_id=e.id
  WHERE e.project_id=? ORDER BY e.created_at,e.number`,projectId)
  .map(e=>({...e,budget_status:e.budget_kind==='release'?'released':e.budget_id?'active':'unconfigured'}));
 const allocated=plans.reduce((n,e)=>n+BigInt(e.confirmed_budget_fen||0),0n);
 if(allocated>BigInt(Number.MAX_SAFE_INTEGER))fail(422,'计划核定预算合计超出有效范围');
 return {project_id:p.id,approved_budget_fen:p.approved_budget_fen,allocated_budget_fen:Number(allocated),
  unallocated_budget_fen:p.approved_budget_fen==null?null:p.approved_budget_fen-Number(allocated),
  unconfigured_plan_count:plans.filter(e=>e.budget_status==='unconfigured').length,plans};
}
export function ensurePlanBudgetsFit(projectId,proposedBudgetFen){
 const summary=projectPlanBudgetSummary(projectId);
 if(summary.allocated_budget_fen>proposedBudgetFen)fail(409,'子项目预算不能低于已核定计划预算合计，请先确认调减计划预算');
}
export function planBudgetDetail(executionId,filters={}){
 const draftStatus=filters.draft_status||'draft';
 if(!['draft','confirmed','deleted','all'].includes(draftStatus))fail(422,'预算草稿状态无效');
 const e=plan(executionId),p=project(e.project_id),a=approval(p.id),budget=current(e.id);
 const allocation=projectPlanBudgetSummary(p.id),settled=netForPlan(e.id);
 return {...planCostTotals(e.id),execution_id:e.id,number:e.number,plan_status:e.status,project_id:p.id,project_status:p.status,
  project_approval_version_id:a.id,project_approval_version_no:a.version_no,project_approved_budget_fen:p.approved_budget_fen,
  current:budget,budget_status:budget?.kind==='release'?'released':budget?'active':'unconfigured',
  budget_version:budget?.version_no||0,allocated_budget_fen:allocation.allocated_budget_fen,
  project_unallocated_budget_fen:allocation.unallocated_budget_fen,
  max_plan_budget_fen:p.approved_budget_fen==null?null:p.approved_budget_fen-allocation.allocated_budget_fen+(budget?.amount_fen||0),
  settled_fen:settled,budget_minus_settled_fen:budget?budget.amount_fen-settled:null,
  versions:all(`SELECT b.*,u.username AS confirmed_by_name,a.version_no AS project_approval_version_no
   FROM plan_budget_versions b JOIN users u ON u.id=b.confirmed_by
   JOIN project_approval_versions a ON a.id=b.project_approval_version_id WHERE b.execution_id=? ORDER BY b.version_no DESC`,e.id),
  drafts:all(`SELECT d.*,u.username AS created_by_name,v.id AS confirmed_version_id FROM plan_budget_drafts d
   JOIN users u ON u.id=d.created_by LEFT JOIN plan_budget_versions v ON v.proposal_id=d.id
   WHERE d.execution_id=? AND (?='all' OR d.status=?) ORDER BY d.created_at DESC,d.id`,e.id,draftStatus,draftStatus)};
}
function normalize(body,e){
 const p=project(e.project_id),a=approval(p.id),b=current(e.id);
 if(body.base_budget_version!==(b?.version_no||0)||body.project_approval_version_id!==a.id)
  fail(409,'项目批准依据或计划核定预算已变化，请刷新并重新核对编制内容');
 const kind=body.kind||'set';
 if(!['set','release'].includes(kind))fail(422,'预算编制类型无效');
 const amount=kind==='release'?0:yuanToFen(body.amount_yuan,'计划核定预算');
 if(kind==='set'&&amount<=0)fail(422,'计划核定预算须大于零；撤销预算请使用删除当前预算');
 if(kind==='release'&&(!b||b.kind==='release'))fail(409,'当前没有可撤销的核定预算');
 return {kind,amount_fen:amount,basis:required(body.basis,kind==='release'?'撤销依据':'预算编制依据'),
  base_budget_version:b?.version_no||0,project_approval_version_id:a.id};
}
export function createPlanBudgetDraft(executionId,body,user){
 bodyFields(body,['kind','amount_yuan','basis','base_budget_version','project_approval_version_id']);
 return transaction(()=>{
  const e=plan(executionId),values=normalize(body,e),time=now();
  const row={id:uid(),execution_id:e.id,...values,version:1,status:'draft',created_by:user.id,created_at:time,updated_by:user.id,updated_at:time};
  exec('INSERT INTO plan_budget_drafts('+Object.keys(row).join(',')+') VALUES('+Object.keys(row).map(()=>'?').join(',')+')',...Object.values(row));
  audit(user.id,'plan_budget_drafts',row.id,'create',null,row,row.basis);return row;
 });
}
export function updatePlanBudgetDraft(id,body,user){
 bodyFields(body,['version','kind','amount_yuan','basis','base_budget_version','project_approval_version_id']);
 return transaction(()=>{
  const old=draft(id);draftVersion(old,body);const values=normalize(body,plan(old.execution_id));
  const row={...old,...values,version:old.version+1,updated_by:user.id,updated_at:now()};
  exec(`UPDATE plan_budget_drafts SET kind=?,amount_fen=?,basis=?,base_budget_version=?,project_approval_version_id=?,
   version=?,updated_by=?,updated_at=? WHERE id=?`,row.kind,row.amount_fen,row.basis,row.base_budget_version,row.project_approval_version_id,row.version,row.updated_by,row.updated_at,id);
  audit(user.id,'plan_budget_drafts',id,'update',old,row,row.basis);return row;
 });
}
export function deletePlanBudgetDraft(id,body,user){
 bodyFields(body,['version','reason']);
 return transaction(()=>{
  const old=draft(id);draftVersion(old,body);const reason=required(body.reason,'删除依据');
  exec("UPDATE plan_budget_drafts SET status='deleted',version=version+1,updated_by=?,updated_at=? WHERE id=?",user.id,now(),id);
  const row=draft(id);audit(user.id,'plan_budget_drafts',id,'delete',old,row,reason);return row;
 });
}
export function planBudgetDraftDetail(id){
 const row=draft(id);
 return {...row,history:all(`SELECT a.*,u.username AS actor_name FROM audit_events a JOIN users u ON u.id=a.actor_id
  WHERE a.entity='plan_budget_drafts' AND a.entity_id=? ORDER BY a.created_at,a.rowid`,id)
  .map(e=>({...e,before:e.before_json?JSON.parse(e.before_json):null,after:e.after_json?JSON.parse(e.after_json):null})),
  confirmed:one('SELECT * FROM plan_budget_versions WHERE proposal_id=?',id)||null};
}
export function confirmPlanBudget(id,body,user){
 bodyFields(body,['version','request_key']);
 return transaction(()=>{
  const key=required(body.request_key,'操作标识');
  if(key.length>150)fail(422,'操作标识过长');
  const fingerprint=createHash('sha256').update(JSON.stringify({id,version:body.version,actor:user.id})).digest('hex');
  const replay=one('SELECT * FROM plan_budget_versions WHERE request_key=?',key);
  if(replay){if(replay.request_hash!==fingerprint)fail(409,'操作标识已用于其他确认内容');return replay}
  const d=draft(id);draftVersion(d,body);
  const e=plan(d.execution_id),p=project(e.project_id),a=approval(p.id),b=current(e.id);
  if(d.base_budget_version!==(b?.version_no||0)||d.project_approval_version_id!==a.id)
   fail(409,'草稿采用的项目批准依据或计划预算已变化，请编辑草稿重新核对');
  const allocation=projectPlanBudgetSummary(p.id);
  if(p.approved_budget_fen==null||BigInt(allocation.allocated_budget_fen)-BigInt(b?.amount_fen||0)+BigInt(d.amount_fen)>BigInt(p.approved_budget_fen))
   fail(409,'计划核定预算合计超过子项目当前批准预算，请先调整分配金额');
  const time=now(),v={id:uid(),execution_id:e.id,proposal_id:d.id,version_no:(b?.version_no||0)+1,kind:d.kind,
   amount_fen:d.amount_fen,previous_amount_fen:b?.amount_fen??null,basis:d.basis,project_approval_version_id:a.id,
   project_budget_fen:p.approved_budget_fen,confirmed_by:user.id,confirmed_at:time,request_key:key,request_hash:fingerprint};
  exec('INSERT INTO plan_budget_versions('+Object.keys(v).join(',')+') VALUES('+Object.keys(v).map(()=>'?').join(',')+')',...Object.values(v));
  exec("UPDATE plan_budget_drafts SET status='confirmed',version=version+1,updated_by=?,updated_at=? WHERE id=?",user.id,time,id);
  audit(user.id,'plan_budget_drafts',id,'confirm',d,draft(id),d.basis);
  audit(user.id,'plan_budget_versions',v.id,d.kind==='release'?'release':'confirm',b,v,d.basis);
  return v;
 });
}

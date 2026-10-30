import {ensureCostReconciliationSources,settlementCostLinks} from './cost-rules.mjs';
import {ensureFinalCompletionBasis} from './completion-rules.mjs';
import {createHash} from 'node:crypto';
import {one,all,exec,uid,now,audit,transaction} from './db.mjs';
import {yuanToFen,amountFen} from './money.mjs';
import {settlementFail as fail,validateSettlementDate,ensureSettlementNumber} from './settlement-validation.mjs';
const required=(v,label)=>typeof v==='string'&&v.trim()?v.trim():fail(422,label+'不能为空');
const current=id=>one('SELECT * FROM settlement_current WHERE id=?',id)||fail(404,'结算凭证不存在');
const signed=e=>e.entry_kind==='payment'?e.amount_fen:-e.amount_fen;
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');
function validateBody(body,allowed){
 if(!body||typeof body!=='object'||Array.isArray(body))fail(422,'凭证操作内容无效');
 if(Object.keys(body).some(k=>!allowed.includes(k)))fail(422,'包含不支持的字段；凭证的项目、工作项、批准版本和冲销对应不可改挂');
}
function version(entry,value){
 if(!Number.isSafeInteger(value)||value!==entry.version)fail(409,'凭证已被其他操作更新，请刷新后重新处理');
 if(entry.status==='voided')fail(409,'凭证已撤销，请在历史查询中查看');
}
function command(id,action,body,user,work){
 return transaction(()=>{
  const requestKey=required(body.request_key,'操作标识');
  if(requestKey.length>150)fail(422,'操作标识过长');
  const fingerprint=hash({id,action,actor:user.id,body});
  const prior=one('SELECT * FROM settlement_commands WHERE request_key=?',requestKey);
  if(prior){
   if(prior.request_hash!==fingerprint)fail(409,'操作标识已用于其他内容，请重新发起操作');
   return JSON.parse(prior.result_json);
  }
  const commandId=uid(),result=work(commandId);
  exec('INSERT INTO settlement_commands VALUES(?,?,?,?,?,?,?,?)',commandId,requestKey,fingerprint,id,action,user.id,JSON.stringify(result),now());
  return result;
 });
}
function append(entry,action,reason,commandId,user){
 const time=now();
 exec(`INSERT INTO settlement_revisions(id,entry_id,version,command_id,action,status,settlement_no,settlement_type,
 amount_fen,occurred_on,evidence,reason,changed_by,changed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
 uid(),entry.id,entry.version+1,commandId,action,action==='void'?'voided':'active',entry.settlement_no,
 entry.settlement_type,entry.amount_fen,entry.occurred_on,entry.evidence,reason,user.id,time);
}
const total=(field,id)=>one(`SELECT COALESCE(SUM(CASE WHEN entry_kind='payment' THEN amount_fen ELSE -amount_fen END),0) n
 FROM effective_settlement_entries WHERE ${field}=?`,id).n;
// Enforce the same approved limits for every write path, including voiding a reversal.
function checkBalances(entry,beforeNet){
 const rootId=entry.entry_kind==='payment'?entry.id:entry.reversal_of;
 const root=current(rootId);
 const reversed=one('SELECT COALESCE(SUM(amount_fen),0) n FROM effective_settlement_entries WHERE reversal_of=?',rootId).n;
 if(reversed>(root.status==='active'?root.amount_fen:0))fail(409,'更正后冲销金额超过原凭证金额，请先更正关联冲销凭证');
 const p=one('SELECT * FROM projects WHERE id=?',entry.project_id);
 const scope=one('SELECT * FROM project_demand_scopes WHERE id=?',entry.project_scope_id);
 const projectNet=total('project_id',p.id),scopeNet=total('project_scope_id',scope.id);
 if(projectNet<0||scopeNet<0)fail(409,'操作后净结算不能为负数');
 if(p.approved_budget_fen==null||projectNet>p.approved_budget_fen)fail(409,'项目累计结算超过当前批准预算');
 if(scope.unit_price_fen==null||scopeNet>amountFen(scope.quantity_scaled,scope.unit_price_fen))fail(409,'本需求结算金额超过当前批准范围金额');
 const plan=entry.execution_item_id?one(`SELECT e.status FROM executions e JOIN execution_items i ON i.execution_id=e.id WHERE i.id=?`,entry.execution_item_id):null;
 if(scopeNet>beforeNet&&(p.status!=='approved'||scope.status!=='active'||plan?.status==='cancelled'))
  fail(409,'已结项项目、退出范围或取消计划只能更正资料或减少净结算；增加净结算需先恢复正式业务依据');
 ensureFinalCompletionBasis(scope.id);ensureCostReconciliationSources();
}
export function settlementDetail(id){
 const entry=current(id);
 const original=one('SELECT * FROM project_settlement_entries WHERE id=?',id);
 const root=entry.reversal_of||id;
 const versions=[{...original,version:1,status:'active',action:'record',reason:original.evidence,
  changed_by:original.recorded_by,changed_at:original.created_at,
  changed_by_name:one('SELECT username FROM users WHERE id=?',original.recorded_by)?.username},
 ...all(`SELECT r.*,u.username AS changed_by_name FROM settlement_revisions r
 JOIN users u ON u.id=r.changed_by WHERE r.entry_id=? ORDER BY r.version`,id)];
 const labels=one(`SELECT p.name AS project_name,d.demand_no,e.number AS plan_number,a.version_no AS approval_version_no
 FROM project_settlement_entries se JOIN projects p ON p.id=se.project_id
 JOIN project_demand_scopes s ON s.id=se.project_scope_id JOIN demands d ON d.id=s.demand_id
 JOIN project_approval_versions a ON a.id=se.approval_version_id
 LEFT JOIN execution_items i ON i.id=se.execution_item_id LEFT JOIN executions e ON e.id=i.execution_id WHERE se.id=?`,id);
 return {entry:{...entry,...labels},original,versions,related:all(`SELECT * FROM settlement_current WHERE id=? OR reversal_of=? ORDER BY created_at,id`,root,root)};
}
export function correctSettlement(id,body,user){
 validateBody(body,['request_key','version','reason','settlement_no','settlement_type','amount_yuan','occurred_on','evidence']);
 return command(id,'correct',body,user,commandId=>{
  const entry=current(id);version(entry,body.version);
  const reason=required(body.reason,'更正依据');
  const next={...entry,settlement_no:required(body.settlement_no,'凭证编号'),
   amount_fen:yuanToFen(body.amount_yuan,'结算金额'),occurred_on:required(body.occurred_on,'结算日期'),
   evidence:required(body.evidence,'结算凭证依据')};
  if(next.amount_fen<=0)fail(422,'结算金额须大于零');
  validateSettlementDate(next.occurred_on);ensureSettlementNumber(next.settlement_no,id);
  if(entry.entry_kind==='payment'){
   if(!['advance','progress','final'].includes(body.settlement_type))fail(422,'结算性质无效');
   next.settlement_type=body.settlement_type;
  }else if(body.settlement_type!=null&&body.settlement_type!=='')fail(422,'冲销凭证不能改为正向结算性质');
  const before=total('project_scope_id',entry.project_scope_id);
  append(next,'correct',reason,commandId,user);checkBalances(next,before);
  const result=settlementDetail(id);
  audit(user.id,'project_settlement_entries',id,'correct',entry,result.entry,reason);
  return result;
 });
}
export function settlementVoidPreview(id){
 const entry=current(id);
 const affected=entry.status==='voided'?[]:entry.entry_kind==='payment'
  ?all("SELECT * FROM settlement_current WHERE status='active' AND (id=? OR reversal_of=?) ORDER BY id",id,id):[entry];
 // Include all sibling versions: a concurrent correction/reversal changes the confirmation.
 const family=all('SELECT * FROM settlement_current WHERE id=? OR reversal_of=? ORDER BY id',entry.reversal_of||id,entry.reversal_of||id);
 const costLinks=settlementCostLinks(entry.entry_kind==='payment'?id:entry.reversal_of);
 return {entry,affected,cost_reconciliations:costLinks,net_change_fen:-affected.reduce((s,e)=>s+signed(e),0),
  preview_token:hash({entry,family,costLinks})};
}
export function voidSettlement(id,body,user){
 validateBody(body,['request_key','version','reason','preview_token','affected_ids']);
 return command(id,'void',body,user,commandId=>{
  const entry=current(id);version(entry,body.version);
  const reason=required(body.reason,'撤销依据');
  const preview=settlementVoidPreview(id);
  if(!body.preview_token||body.preview_token!==preview.preview_token)fail(409,'凭证或关联冲销已发生变化，请重新查看撤销影响后确认');
  if(!Array.isArray(body.affected_ids)||hash([...body.affected_ids].sort())!==hash(preview.affected.map(e=>e.id).sort()))
   fail(422,'请明确确认预览中全部将撤销的凭证');
  const before=total('project_scope_id',entry.project_scope_id);
  for(const row of preview.affected){
   append(row,'void',reason,commandId,user);
   audit(user.id,'project_settlement_entries',row.id,'void',row,current(row.id),reason);
  }
  checkBalances(entry,before);
  return {...settlementDetail(id),affected_ids:preview.affected.map(e=>e.id),net_change_fen:preview.net_change_fen};
 });
}

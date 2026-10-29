import {all,one,exec,transaction,audit,uid,now} from './db.mjs';
import {quantityToScaled} from './quantity.mjs';
import {yuanToFen,amountFen,sumFen} from './money.mjs';
import {captureDemand} from './demand-snapshots.mjs';
const err=(status,message)=>{const e=new Error(message);e.status=status;throw e};
const required=(value,name)=>{if(typeof value!=='string'||!value.trim())err(422,name+'不能为空');return value.trim()};
const project=id=>one('SELECT * FROM projects WHERE id=?',id)||err(404,'项目不存在');
const latestApproval=id=>one('SELECT * FROM project_approval_versions WHERE project_id=? ORDER BY version_no DESC LIMIT 1',id)||err(409,'项目缺少批准基线');
const amount=amountFen;
const sumBudget=items=>sumFen(items.map(x=>amount(x.quantity_scaled,x.unit_price_fen)));
const recordedDemand=id=>{
 const d=one("SELECT * FROM demands WHERE id=? AND status='active'",id);
 if(!d)err(422,'需求不存在或尚未核实');
 const pos=one('SELECT physical_tower_id FROM logical_towers WHERE id=?',d.logical_tower_id);
 if(!pos||pos.physical_tower_id!==d.observed_physical_tower_id)err(409,'需求位置已变化，请重新核实');
 return d;
};
export function approvalVersions(projectId){project(projectId);return all('SELECT * FROM project_approval_versions WHERE project_id=? ORDER BY version_no DESC',projectId)}
export function listChangeOrders(projectId){project(projectId);return all('SELECT * FROM project_change_orders WHERE project_id=? ORDER BY created_at DESC,id DESC',projectId)}
export function getChangeOrder(id){return one('SELECT * FROM project_change_orders WHERE id=?',id)||err(404,'变更单不存在')}
function changesFrom(body,baseline){
 if(!Array.isArray(body.changes)||!body.changes.length||body.changes.length>100)err(422,'请填写1至100项拟变更范围');
 const base=new Map(JSON.parse(baseline.snapshot_json).scopes.map(x=>[x.scope_id,x]));
 const used=new Set();
 return body.changes.map((raw,index)=>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))err(422,'变更项'+(index+1)+'格式错误');
  const action=required(raw.action,'变更类型');
  if(!['add','adjust','remove'].includes(action))err(422,'不支持的变更类型');
  const scopeId=action==='add'?null:required(raw.scope_id,'原批准范围');
  if(scopeId&&!base.has(scopeId))err(422,'原批准版本无此范围');
  const demandId=action==='add'?required(raw.demand_id,'新增需求'):base.get(scopeId).demand_id;
  const token=scopeId||'new:'+demandId;
  if(used.has(token))err(422,'同一变更单不可重复处理同一范围或需求');
  used.add(token);
  const quantity=action==='remove'?0:quantityToScaled(raw.quantity);
  const unitPrice=action==='remove'?null:raw.unit_price_yuan===undefined||raw.unit_price_yuan===null||raw.unit_price_yuan===''?null:yuanToFen(raw.unit_price_yuan,'变更单价');
  if(raw.tax_mode!==undefined&&raw.tax_mode!==''&&!['inclusive','exclusive','none'].includes(raw.tax_mode))err(422,'变更税口径无效');
  return {action,scope_id:scopeId,demand_id:demandId,quantity_scaled:quantity,
   unit_price_fen:unitPrice,price_source:typeof raw.price_source==='string'?raw.price_source.trim():null,
   price_date:raw.price_date||null,tax_mode:raw.tax_mode||null,
   evidence:required(raw.evidence,'变更项依据')};
 });
}
export function createChangeDraft(projectId,body,user){
 const p=project(projectId);
 if(p.status!=='approved')err(409,'项目须完成立项才能登记变更');
 const latest=latestApproval(projectId);
 if(body.base_approval_version_id&&body.base_approval_version_id!==latest.id)err(409,'批准版本已变化');
 const item={id:uid(),project_id:projectId,code:required(body.code,'变更单编号'),
  base_approval_version_id:latest.id,proposal_json:JSON.stringify({changes:changesFrom(body,latest),base_version_no:latest.version_no}),
  reason:required(body.reason,'变更原因'),status:'draft',created_by:user.id,created_at:now(),
  decided_by:null,decided_at:null,decision_reason:null};
 return transaction(()=>{exec('INSERT INTO project_change_orders('+Object.keys(item).join(',')+') VALUES('+Object.keys(item).map(()=>'?').join(',')+')',...Object.values(item));audit(user.id,'project_change_orders',item.id,'create_draft',null,item,item.reason);return item});
}
export function submitChangeOrder(id,body,user){
 return transaction(()=>{
  const old=getChangeOrder(id);
  if(old.status!=='draft')err(409,'只有草稿可以提交审批');
  if(user.id!==old.created_by&&user.role!=='admin')err(403,'只能提交自己创建的变更单');
  if(latestApproval(old.project_id).id!==old.base_approval_version_id)err(409,'批准基线已更新，需重新编制变更单');
  const reason=required(body.reason,'提交说明'),t=now();
  exec("UPDATE project_change_orders SET status='submitted' WHERE id=?",id);
  audit(user.id,'project_change_orders',id,'submit',old,{...old,status:'submitted'},reason);
  return getChangeOrder(id);
 });
}
export function rejectChangeOrder(id,body,user){
 return transaction(()=>{
  const old=getChangeOrder(id);
  if(old.status!=='submitted')err(409,'只允许驳回待审变更单');
  const reason=required(body.reason,'驳回依据'),t=now();
  exec("UPDATE project_change_orders SET status='rejected',decided_by=?,decided_at=?,decision_reason=? WHERE id=?",user.id,t,reason,id);
  audit(user.id,'project_change_orders',id,'reject',old,{...old,status:'rejected',decided_by:user.id,decided_at:t},reason);
  return getChangeOrder(id);
 });
}
function actualCommitted(scopeId){
 return one(`SELECT COALESCE(SUM(CASE WHEN e.status='finished'
  THEN (SELECT COALESCE(SUM(quantity_scaled),0) FROM completion_records c WHERE c.execution_item_id=i.id)
  ELSE i.planned_quantity_scaled END),0) AS n
  FROM execution_items i JOIN executions e ON e.id=i.execution_id
  WHERE i.project_scope_id=? AND e.status IN ('planned','running','finished')`,scopeId).n;
}
function materializeChanges(order,p,baseline){
 const proposal=JSON.parse(order.proposal_json);
 const scopes=JSON.parse(baseline.snapshot_json).scopes.map(x=>({...x}));
 const changes=proposal.changes,updates=[],retire=[],add=[],seenDemand=new Set(scopes.map(x=>x.demand_id));
 for(const change of changes){
  const index=change.action==='add'?-1:scopes.findIndex(x=>x.scope_id===change.scope_id);
  if(change.action!=='add'&&index<0)err(409,'原批准范围已被变更，请重新编制');
  if(change.action!=='add'){
   const before=scopes[index],old=one('SELECT * FROM project_demand_scopes WHERE id=? AND project_id=? AND status=?',before.scope_id,p.id,'active');
   if(!old)err(409,'当前范围已经变化');
   if(one(`SELECT 1 FROM execution_items i JOIN executions e ON e.id=i.execution_id
    WHERE i.project_scope_id=? AND e.status IN ('planned','running') LIMIT 1`,old.id))
     err(409,'该范围存在未结束的执行批次，必须先完成或取消，才能批准涉及此范围的变更');
   const consumed=actualCommitted(old.id);
   const settled=one(`SELECT COALESCE(SUM(CASE WHEN entry_kind='payment' THEN amount_fen ELSE -amount_fen END),0) n
    FROM project_settlement_entries WHERE project_scope_id=?`,old.id).n;
   if(change.action==='remove'&&settled>0)err(409,'范围存在未冲销结算凭证，不能直接移除');
   if(change.action==='remove'){
    if(consumed>0)err(409,'已有实际完成工作量，不能完全移除该范围；可改为不低于已完成量');
    // Historical completed batches remain in their old approval version; do not delete the scope.
    scopes.splice(index,1);retire.push(before);seenDemand.delete(before.demand_id);
   }else{
    if(change.quantity_scaled<consumed)err(409,'拟缩减数量不能低于历史实际完成量');
    const price=change.unit_price_fen??before.unit_price_fen;
    const updated={...before,quantity_scaled:change.quantity_scaled,unit_price_fen:price,
     price_source:change.price_source||before.price_source,price_date:change.price_date||before.price_date,
     tax_mode:change.tax_mode||before.tax_mode};
    if(amount(updated.quantity_scaled,updated.unit_price_fen)<settled)
     err(409,'调整后的范围核定金额不能低于已有结算金额');
    scopes[index]=updated;updates.push(updated);
   }
  }else{
   if(seenDemand.has(change.demand_id))err(409,'需求已在项目范围内，不可重复新增');
   const d=recordedDemand(change.demand_id),quantity=change.quantity_scaled;
   if(quantity>d.quantity_scaled)err(409,'新增数量超出需求有效数量');
   const dormant=one("SELECT id FROM project_demand_scopes WHERE project_id=? AND demand_id=? AND status='retired'",p.id,d.id);
   const entry={scope_id:dormant?.id||uid(),demand_id:d.id,demand_version:d.version,demand_snapshot:captureDemand(d),
    quantity_scaled:quantity,unit_price_fen:change.unit_price_fen,price_source:change.price_source,
    price_date:change.price_date,tax_mode:change.tax_mode,amount_fen:null,reactivate:!!dormant};
   scopes.push(entry);add.push(entry);seenDemand.add(d.id);
  }
 }
 if(!scopes.length)err(422,'项目至少保留一项批准需求范围');
 for(const scope of scopes){
  if(scope.unit_price_fen===null||scope.unit_price_fen===undefined||!scope.price_source||!scope.price_date||!scope.tax_mode)
   err(422,'批准变更前必须逐项核定单价、价格来源、日期和税口径');
  scope.amount_fen=amount(scope.quantity_scaled,scope.unit_price_fen);
  const d=one('SELECT quantity_scaled FROM demands WHERE id=?',scope.demand_id);
  if(!d||scope.quantity_scaled>d.quantity_scaled)err(409,'需求数量已变化，批准范围超过有效需求数量');
  const other=one(`SELECT p.id FROM project_demand_scopes s JOIN projects p ON p.id=s.project_id
    WHERE s.demand_id=? AND s.status='active' AND p.status IN ('approved','closed')
    AND p.id<>? LIMIT 1`,scope.demand_id,p.id);
  if(other)err(409,'该专业需求已由其他正式子项目承接，不允许跨项目通过变更单分担');
 }
 return {scopes,updates,retire,add,budget:sumBudget(scopes)};
}
export function approveChangeOrder(id,body,user){
 return transaction(()=>{
  const old=getChangeOrder(id);
  if(old.status!=='submitted')err(409,'只有已提交的变更单可以批准');
  const reason=required(body.reason,'批准依据'),p=project(old.project_id);
  if(p.status!=='approved')err(409,'项目当前阶段不可办理变更');
  if(!p.agreement_id)err(409,'项目尚未关联执行协议');
  const baseline=latestApproval(p.id);
  if(baseline.id!==old.base_approval_version_id)err(409,'变更依据的批准基线已失效，必须重新编制');
  const applied=materializeChanges(old,p,baseline),ag=one('SELECT * FROM agreements WHERE id=?',p.agreement_id);
  const fw=ag?one('SELECT * FROM frameworks WHERE id=?',ag.framework_id):null;
  if(!ag||!fw||ag.status!=='active'||fw.status!=='active')err(409,'协议或框架不可用');
  if(ag.framework_id!==p.framework_id)err(409,'协行协议与子项目所属年度框架不一致');
  const others=one("SELECT COALESCE(SUM(approved_budget_fen),0) n FROM projects WHERE agreement_id=? AND id<>? AND status IN ('approved','closed')",ag.id,p.id).n;
  if(BigInt(others)+BigInt(applied.budget)>BigInt(ag.limit_fen))err(409,'变更后的有效项目预算超过执行协议可用额度');
  const settled=one(`SELECT COALESCE(SUM(CASE WHEN entry_kind='payment' THEN amount_fen ELSE -amount_fen END),0) n
   FROM project_settlement_entries WHERE project_id=?`,p.id).n;
  if(applied.budget<settled)err(409,'变更后的预算不能低于已登记净结算金额');
  const t=now();
  for(const x of applied.updates)exec('UPDATE project_demand_scopes SET quantity_scaled=?,unit_price_fen=?,price_source=?,price_date=?,tax_mode=?,updated_at=? WHERE id=?',
   x.quantity_scaled,x.unit_price_fen,x.price_source,x.price_date,x.tax_mode,t,x.scope_id);
  for(const x of applied.retire)exec("UPDATE project_demand_scopes SET status='retired',updated_at=? WHERE id=?",t,x.scope_id);
  for(const x of applied.add){
   if(x.reactivate)exec(`UPDATE project_demand_scopes SET demand_version=?,quantity_scaled=?,unit_price_fen=?,
     price_source=?,price_date=?,tax_mode=?,note=?,updated_at=?,demand_snapshot_json=?,status='active'
     WHERE id=? AND status='retired'`,
      x.demand_version,x.quantity_scaled,x.unit_price_fen,x.price_source,x.price_date,x.tax_mode,
      '由变更单 '+old.code+' 重新纳入',t,JSON.stringify(x.demand_snapshot),x.scope_id);
   else exec(`INSERT INTO project_demand_scopes(id,project_id,demand_id,demand_version,quantity_scaled,
    unit_price_fen,price_source,price_date,tax_mode,note,created_at,updated_at,demand_snapshot_json,status)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,x.scope_id,p.id,x.demand_id,x.demand_version,x.quantity_scaled,
    x.unit_price_fen,x.price_source,x.price_date,x.tax_mode,'由变更单 '+old.code+' 增加',t,t,JSON.stringify(x.demand_snapshot),'active');
  }
  const snapshot={...JSON.parse(baseline.snapshot_json),stage:'approved',scopes:applied.scopes.map(({reactivate,...x})=>x),
   created_at:t,actor_id:user.id,reason,change_order_id:old.id,previous_approval_version_id:baseline.id};
  const nextId=uid(),version=baseline.version_no+1;
  exec('INSERT INTO project_approval_versions VALUES(?,?,?,?,?,?,?)',nextId,p.id,version,JSON.stringify(snapshot),applied.budget,user.id,t);
  exec('UPDATE projects SET version=version+1,approved_budget_fen=?,estimate_fen=?,updated_at=? WHERE id=?',applied.budget,applied.budget,t,p.id);
  exec("UPDATE project_change_orders SET status='approved',decided_by=?,decided_at=?,decision_reason=? WHERE id=?",user.id,t,reason,id);
  audit(user.id,'project_change_orders',id,'approve',old,{...getChangeOrder(id),approval_version_id:nextId,approved_budget_fen:applied.budget},reason);
  audit(user.id,'projects',p.id,'approval_version_'+version,p,{...p,approved_budget_fen:applied.budget,approval_version_id:nextId},reason);
  return {change_order:getChangeOrder(id),approval_version_id:nextId,version_no:version,approved_budget_fen:applied.budget,scopes:applied.scopes};
 });
}

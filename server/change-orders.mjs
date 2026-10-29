import {all,one,exec,transaction,audit,uid,now} from './db.mjs';
import {quantityToScaled} from './quantity.mjs';
import {yuanToFen} from './projects.mjs';
const err=(status,message)=>{const e=new Error(message);e.status=status;throw e};
const required=(value,name)=>{if(typeof value!=='string'||!value.trim())err(422,name+'不能为空');return value.trim()};
function project(id){return one('SELECT * FROM projects WHERE id=?',id)||err(404,'项目不存在')}
function approval(id){return one('SELECT * FROM project_approval_versions WHERE id=?',id)||err(404,'批准版本不存在')}
export function approvalVersions(projectId){
 project(projectId);
 return all('SELECT * FROM project_approval_versions WHERE project_id=? ORDER BY version_no DESC',projectId);
}
export function listChangeOrders(projectId){
 project(projectId);
 return all('SELECT * FROM project_change_orders WHERE project_id=? ORDER BY created_at DESC,id DESC',projectId);
}
export function getChangeOrder(id){return one('SELECT * FROM project_change_orders WHERE id=?',id)||err(404,'变更单不存在')}
export function createChangeDraft(projectId,body,user){
 const p=project(projectId);
 if(!['approved','closed'].includes(p.status))err(409,'项目必须完成立项才能登记批准范围变更草稿');
 const latest=one('SELECT * FROM project_approval_versions WHERE project_id=? ORDER BY version_no DESC LIMIT 1',projectId);
 if(!latest)err(409,'项目缺少有效批准版本');
 if(body.base_approval_version_id&&body.base_approval_version_id!==latest.id)err(409,'当前批准版本已变化，请重新加载');
 const reason=required(body.reason,'变更原因');
 const code=required(body.code,'变更单编号');
 if(!Array.isArray(body.changes)||!body.changes.length||body.changes.length>100)
  err(422,'请填写1至100项拟变更范围');
 const base=JSON.parse(latest.snapshot_json);
 if(!Array.isArray(base.scopes))err(409,'批准范围历史快照缺失');
 const currentScopes=new Map(base.scopes.map(x=>[x.scope_id,x]));
 const changes=body.changes.map((raw,index)=>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))err(422,'变更项'+(index+1)+'格式错误');
  const action=required(raw.action,'变更类型');
  if(!['add','adjust','remove'].includes(action))err(422,'不支持的变更类型');
  const scopeId=action==='add'?null:required(raw.scope_id,'已有批准范围');
  if(scopeId&&!currentScopes.has(scopeId))err(422,'批准版本中没有对应范围 '+scopeId);
  const demandId=action==='add'?required(raw.demand_id,'新增需求'):currentScopes.get(scopeId).demand_id;
  const demand=one('SELECT id,status FROM demands WHERE id=?',demandId);
  if(!demand||demand.status!=='active')err(422,'拟变更需求必须仍处于有效核实状态');
  const quantity=action==='remove'?0:quantityToScaled(raw.quantity);
  const price=action==='remove'?null:raw.unit_price_yuan===undefined||raw.unit_price_yuan===null||raw.unit_price_yuan===''?null:yuanToFen(raw.unit_price_yuan,'变更单价');
  const evidence=required(raw.evidence,'变更项依据');
  return {action,scope_id:scopeId,demand_id:demandId,quantity_scaled:quantity,unit_price_fen:price,evidence,
    before:scopeId?currentScopes.get(scopeId):null};
 });
 const ids=new Set(changes.filter(x=>x.scope_id).map(x=>x.scope_id));
 if(ids.size!==changes.filter(x=>x.scope_id).length)err(422,'同一批准范围在一张变更单中不得重复调整');
 const t=now(),item={id:uid(),project_id:projectId,code,base_approval_version_id:latest.id,
  proposal_json:JSON.stringify({changes,base_version_no:latest.version_no,base_approved_budget_fen:latest.approved_budget_fen}),
  reason,status:'draft',created_by:user.id,created_at:t,decided_by:null,decided_at:null,decision_reason:null};
 return transaction(()=>{
  exec('INSERT INTO project_change_orders('+Object.keys(item).join(',')+') VALUES('+Object.keys(item).map(()=>'?').join(',')+')',...Object.values(item));
  audit(user.id,'project_change_orders',item.id,'create_draft',null,item,reason);
  return item;
 });
}

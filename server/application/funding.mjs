import {createHash} from 'node:crypto';
import {now,audit,transaction} from '../database/index.mjs';
import {fundingDeletionEvent,deletedFundingIds,fundingRow,fundingAgreements,fundingProjects,fundingUsedAmounts,fundingHistory,fundingDeletedRows,fundingFrameworkName,otherAgreementLimits,patchFunding,removeFunding} from '../database/repositories/funding.mjs';
import {yuanToFen} from '../domain/money.mjs';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
const required=(value,label)=>typeof value==='string'&&value.trim()?value.trim():fail(422,label+'不能为空');
const tableOf=kind=>['frameworks','agreements'].includes(kind)?kind:fail(422,'无效的资金对象');
export const fundingDeletion=fundingDeletionEvent;
export function currentFunding(kind,rows){
 const removed=deletedFundingIds(kind);
 return rows.filter(x=>!removed.has(x.id));
}
function record(kind,id,allowDeleted=false){
 tableOf(kind);const deletion=fundingDeletion(kind,id),row=fundingRow(kind,id);
 if(deletion&&!allowDeleted)fail(409,'记录已删除，不能修改或用于新增业务');
 if(!row&&!deletion)fail(404,'记录不存在');
 return deletion&&allowDeleted?{...(row||JSON.parse(deletion.before_json)),status:'deleted',deleted_at:deletion.created_at}:row;
}
const version=(row,body)=>{if(row.version!==body.version)fail(409,'记录已被修改，请刷新后重试')};
function related(kind,id){
 const agreements=kind==='frameworks'?fundingAgreements(id):[];
 const projects=fundingProjects(kind,id);
 const approved=projects.filter(p=>['approved','closed'].includes(p.status));
 const {settled,planBudget,actualCost:actual}=fundingUsedAmounts(kind,id);
 return {actual_cost_fen:actual,allocated_plan_budget_fen:planBudget,agreements:agreements.map(a=>({...a,status:fundingDeletion('agreements',a.id)?'deleted':a.status})),projects,
  approved_count:approved.length,approved_budget_fen:approved.reduce((sum,p)=>sum+(p.approved_budget_fen||0),0),settled_fen:settled,
  agreement_limit_fen:agreements.reduce((sum,a)=>sum+a.limit_fen,0)};
}
export function fundingDetail(kind,id){
 const row=record(kind,id,true);
 return {...row,...related(kind,id),
  framework_deleted:kind==='agreements'&&!!fundingDeletion('frameworks',row.framework_id),
  framework_name:kind==='agreements'?(fundingFrameworkName(row.framework_id)
  ||JSON.parse(fundingDeletion('frameworks',row.framework_id)?.before_json||'null')?.name):null,
  history:fundingHistory(kind,id).map(x=>({...x,
    before:x.before_json?JSON.parse(x.before_json):null,
    after:x.after_json?JSON.parse(x.after_json):null}))};
}
export function deletedFunding(kind){
 tableOf(kind);return fundingDeletedRows(kind).map(x=>fundingDetail(kind,x.entity_id));
}
export function updateFunding(kind,id,body,user){
 return transaction(()=>{
  const old=record(kind,id);version(old,body);const links=related(kind,id);
  const next={...old,name:body.name===undefined?old.name:required(body.name,'名称'),
   limit_fen:body.limit_yuan===undefined?old.limit_fen:yuanToFen(body.limit_yuan,'授权额度'),status:body.status??old.status};
  if(next.limit_fen<=0)fail(422,'授权额度必须大于零');
  if(!['active','inactive'].includes(next.status))fail(422,'状态无效');
  if(kind==='frameworks'){
   next.fiscal_year=body.fiscal_year===undefined?old.fiscal_year:Number(body.fiscal_year);
   if(!Number.isInteger(next.fiscal_year)||next.fiscal_year<2000||next.fiscal_year>2100)fail(422,'框架年度必须是2000至2100之间的整数');
   if(next.limit_fen<links.agreement_limit_fen)fail(409,'框架额度不能低于已关联协议的授权额度合计');
  }else{
   next.framework_id=body.framework_id??old.framework_id;
   const parent=fundingRow('frameworks',next.framework_id);
   if(!parent||next.framework_id!==old.framework_id&&(parent.status!=='active'||fundingDeletion('frameworks',parent.id)))fail(422,'请选择启用的年度框架');
   if(next.framework_id!==old.framework_id&&links.projects.length)fail(409,'协议已有子项目；调整所属框架须同时处理项目归属，不能单独改挂');
   const other=otherAgreementLimits(next.framework_id,id);
   if(BigInt(other)+BigInt(next.limit_fen)>BigInt(parent.limit_fen))fail(409,'协议额度累计超过框架总额度');
  }
  if(next.limit_fen<Math.max(links.approved_budget_fen,links.settled_fen))fail(409,'授权额度不能低于已批准项目预算或已归集净结算');
  if(links.approved_count&&user.role!=='admin'&&(next.limit_fen!==old.limit_fen||kind==='frameworks'&&next.fiscal_year!==old.fiscal_year||next.status!==old.status))fail(403,'已有正式项目，调整授权额度、年度或状态需要管理员权限');
  const changed=Object.keys(next).filter(key=>next[key]!==old[key]);if(!changed.length)return fundingDetail(kind,id);
  const reason=required(body.reason,'变更依据');next.version=old.version+1;next.updated_at=now();
  const keys=[...changed,'version','updated_at'];patchFunding(kind,id,Object.fromEntries(keys.map(k=>[k,next[k]])));
  audit(user.id,kind,id,'update',old,next,reason);return fundingDetail(kind,id);
 });
}
export function fundingDeletionPreview(kind,id){
 const row=record(kind,id),links=related(kind,id);
 const linked=links.agreements.length+links.projects.length>0;
 return {item:row,references:links,token:createHash('sha256').update(JSON.stringify({row,links})).digest('hex'),deletion_kind:linked?'logical':'physical',
  description:linked?'从正常列表和新增选项移除，不再允许新增或立项；保留关联项目、协议、历史依据及资金占用；已有立项项目可继续实施和结算。':'没有关联项目或协议，将直接删除并保留操作历史。'};
}
export function deleteFunding(kind,id,body,user){
 return transaction(()=>{
  const preview=fundingDeletionPreview(kind,id),old=preview.item;version(old,body);
  if(body.preview_token&&body.preview_token!==preview.token)fail(409,'关联情况已变化，请重新核对删除影响');
  const reason=required(body.reason,'删除依据');
  removeFunding(kind,id,preview.deletion_kind==='logical',now());
  audit(user.id,kind,id,'delete',old,{id,deletion_kind:preview.deletion_kind,references:preview.references},reason);
  return {deleted:true,id,deletion_kind:preview.deletion_kind};
 });
}

export function filterFundingStatus(rows,status){
 if(!status)return rows;
 if(!['active','inactive'].includes(status))fail(422,'资金对象状态无效');
 return rows.filter(row=>row.status===status);
}

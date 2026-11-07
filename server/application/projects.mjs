import {currentFunding,fundingDeletion} from './funding.mjs';
import {systemCode} from '../domain/system-code.mjs';
import {spanDemandLocation} from './ledgers.mjs';
import {captureDemand,readDemandSnapshot} from '../database/repositories/demand-snapshots.mjs';
import {quantityToScaled} from '../domain/quantity.mjs';
import {yuanToFen,amountFen} from '../domain/money.mjs';
export {yuanToFen} from '../domain/money.mjs';
import {uid,now,transaction,audit} from '../database/index.mjs';
import {projectFramework,projectAgreement,projectById,projectCategory,projectCategoryStatus,projectScopes,frameworksWithUsage,agreementsWithUsage,usedAgreementCapacity,insertFramework,insertAgreement,insertProject,updateProjectPreliminary,allProjects,projectEvents,frameworkProjectLabels,agreementProjectLabel,projectDemand,physicalAtTower,physicalTowerAtDemand,insertProjectScope,touchProject,projectScope,updateProjectScope,setProjectAgreement,approvedBudgetsForAgreement,otherApprovedProjectForDemand,updateProjectStage,insertProjectStage,insertProjectApproval} from '../database/repositories/projects.mjs';
const fault=(status,message)=>{const e=new Error(message);e.status=status;throw e};
const required=(value,label)=>{if(typeof value!=='string'||!value.trim())fault(422,label+'不能为空');return value.trim()};
const versionOf=(old,body)=>{
 if(!Number.isInteger(body.version)||body.version!==old.version)fault(409,'版本不匹配，请刷新后再提交');
};
export function lineEstimate(scope){
 return scope.unit_price_fen===null?null:amountFen(scope.quantity_scaled,scope.unit_price_fen);
}
const framework=id=>projectFramework(id)||fault(404,'框架不存在');
const agreement=id=>projectAgreement(id)||fault(404,'执行协议不存在');
const project=id=>projectById(id)||fault(404,'项目不存在');
const scopes=id=>projectScopes(id).map(s=>{
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
 return currentFunding('frameworks',frameworksWithUsage());
}
export function createFramework(body,user){
 const fiscalYear=body.fiscal_year===undefined?new Date().getFullYear():Number(body.fiscal_year);
 if(!Number.isInteger(fiscalYear)||fiscalYear<2000||fiscalYear>2100)fault(422,'框架年度必须是2000至2100之间的整数');
 const t=now(),item={id:uid(),code:systemCode(body.code,'FW'),name:required(body.name,'框架名称'),fiscal_year:fiscalYear,
 limit_fen:yuanToFen(body.limit_yuan,'框架额度'),status:'active',version:1,created_at:t,updated_at:t};
 if(item.limit_fen<=0)fault(422,'框架额度必须大于零');
 return transaction(()=>{insertFramework(item);event(user,'frameworks',item.id,'create',null,item);return item});
}
export function listAgreements(){
 return currentFunding('agreements',agreementsWithUsage()).map(row=>({...row,framework_deleted:!!fundingDeletion('frameworks',row.framework_id)}));
}
export function createAgreement(body,user){
 const f=framework(body.framework_id);
 if(f.status!=='active')fault(422,'框架已停用，不能新增协议');
 const fen=yuanToFen(body.limit_yuan,'协议额度');
 if(fen<=0)fault(422,'协议额度必须大于零');
 const t=now(),item={id:uid(),code:systemCode(body.code,'AG'),framework_id:f.id,
 name:required(body.name,'协议名称'),limit_fen:fen,status:'active',version:1,created_at:t,updated_at:t};
 return transaction(()=>{
  const used=usedAgreementCapacity(f.id);
  if(BigInt(used)+BigInt(fen)>BigInt(f.limit_fen))fault(422,'协议额度累计超过框架总额度');
  insertAgreement(item);
  event(user,'agreements',item.id,'create',null,item);return item;
 });
}
export function createProject(body,user){
 const ag=body.agreement_id?agreement(body.agreement_id):null;
 const frameworkId=body.framework_id||ag?.framework_id;
 if(!frameworkId)fault(422,'请先选择所属年度框架');
 const fw=framework(frameworkId);
 if(fw.status!=='active')fault(422,'所属年度框架已停用');
 if(ag&&(ag.status!=='active'||ag.framework_id!==fw.id))fault(422,'协行协议必须属于当前年度框架且处于启用状态');
 if(body.category_id){
  const item=projectCategory(body.category_id);
  if(!item)fault(422,'无效的项目类别');
 }
 const t=now(),item={id:uid(),code:systemCode(body.code,'PJ'),name:required(body.name,'项目名称'),framework_id:fw.id,
 agreement_id:ag?.id||null,category_id:body.category_id||null,status:'reserve',version:1,estimate_fen:null,approved_budget_fen:null,created_by:user.id,created_at:t,updated_at:t};
 return transaction(()=>{
  insertProject(item);
  event(user,'projects',item.id,'create',null,item);return item;
 });
}
/** Estimate and category may be refined while the project is still a draft. */
export function savePreliminaryEstimate(id,body,user){
 const p=project(id);versionOf(p,body);
 if(p.status!=='reserve')fault(409,'只有储备草稿可以修改初步估算和项目类别');
 const amount=yuanToFen(body.amount_yuan,'初步估算');
 if(amount<=0)fault(422,'初步估算必须大于零');
 const basis=required(body.basis,'初步估算依据');
 if(!body.category_id)fault(422,'须选定正式项目类别');
 const category=projectCategory(body.category_id);
 if(!category)fault(422,'项目类别不存在或已停用');
 return transaction(()=>{
  const t=now(),next={...p,category_id:category.id,
   preliminary_estimate_fen:amount,preliminary_estimate_basis:basis,
   preliminary_estimate_at:t,preliminary_estimate_by:user.id,
   updated_at:t,version:p.version+1};
  updateProjectPreliminary(id,next);
  event(user,'projects',id,'preliminary_estimate',p,next,basis);
  return projectDetail(id);
 });
}
export function listProjects(){
 return allProjects();
}
export function projectDetail(id){
 const p=project(id),items=scopes(id),events=projectEvents(id);
 const parent=frameworkProjectLabels(p.framework_id);
 const ag=p.agreement_id?agreementProjectLabel(p.agreement_id):null;
 return {...p,framework_name:parent?.name,framework_year:parent?.fiscal_year,framework_deleted:!!fundingDeletion('frameworks',p.framework_id),agreement_name:ag?.name||null,agreement_deleted:!!(p.agreement_id&&fundingDeletion('agreements',p.agreement_id)),scopes:items,estimate:summary(items),events};
}
function demand(id){
 const d=projectDemand(id);
 if(!d||d.status!=='active')fault(422,'必须选择已核实有效的需求');
 if(d.logical_tower_id){
  const current=physicalAtTower(d.logical_tower_id);
  if(current?.physical_tower_id!==d.observed_physical_tower_id)
   fault(409,'需求实体关联已变化，请重新核实位置后再关联项目');
 }
 if(d.physical_tower_id){
  const physical=physicalTowerAtDemand(d.physical_tower_id);
  if(!physical||physical.status!=='active')fault(409,'共用物理杆塔已失效，请重新核实位置');
 }
 if(d.span_id){
  const latest=spanDemandLocation(d.span_id),adopted=JSON.parse(d.span_snapshot_json);
  if(latest.span.version!==d.span_version||
   ['start_tower_id','end_tower_id','start_physical_tower_id','end_physical_tower_id']
   .some(k=>adopted[k]!==latest.snapshot[k]))
   fault(409,'档距已变化，请重新核实位置后再关联项目');
 }
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
  insertProjectScope(item);
  touchProject(id,t);
  event(user,'project_demand_scopes',item.id,'create',null,item);
  return projectDetail(id);
 });
}
export function changeScope(id,scopeId,body,user){
 const p=project(id);versionOf(p,body);
 if(!['reserve','stocked'].includes(p.status))fault(409,'立项后需求与估价已冻结');
 if(p.status==='stocked'&&body.quantity!==undefined)fault(409,'入库范围已冻结，不可直接改变数量');
 const old=projectScope(scopeId,id);
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
 if(['unit_price_yuan','price_source','price_date','tax_mode'].some(key=>body[key]!==undefined))next.reference_price_version_id=null;
 if(body.note!==undefined)next.note=body.note;
 if(p.status==='reserve'){next.demand_version=d.version;next.demand_snapshot_json=JSON.stringify(captureDemand(d))}
 next.updated_at=now();
 return transaction(()=>{
  updateProjectScope(scopeId,next);
  touchProject(id,now());
  event(user,'project_demand_scopes',scopeId,'update',old,next,body.reason||'估算明细调整');
  return projectDetail(id);
 });
}
export function bindAgreement(id,body,user){
 const p=project(id);versionOf(p,body);
 if(p.status==='approved'||p.status==='closed')fault(409,'立项后的协议归属不得通过普通编辑改挂');
 const ag=agreement(body.agreement_id);
 if(ag.status!=='active'||framework(ag.framework_id).status!=='active')fault(422,'协议或框架已停用');
 if(ag.framework_id!==p.framework_id)fault(422,'协行协议与子项目所属年度框架不一致');
 return transaction(()=>{
  const next={...p,agreement_id:ag.id,version:p.version+1,updated_at:now()};
  setProjectAgreement(id,next.agreement_id,next.version,next.updated_at);
  event(user,'projects',id,'bind_agreement',p,next,body.reason||'落实执行协议');return projectDetail(id);
 });
}
function stageSnapshot(p,items,stage,reason,user){
 return {project_id:p.id,project_code:p.code,project_name:p.name,stage,framework_id:p.framework_id,agreement_id:p.agreement_id,category_id:p.category_id,preliminary_estimate_fen:p.preliminary_estimate_fen,preliminary_estimate_basis:p.preliminary_estimate_basis,
 scopes:items.map(x=>({scope_id:x.id,demand_id:x.demand_id,demand_version:x.demand_version,demand_snapshot:x.demand_snapshot,quantity_scaled:x.quantity_scaled,unit_price_fen:x.unit_price_fen,price_source:x.price_source,price_date:x.price_date,tax_mode:x.tax_mode,reference_price_version_id:x.reference_price_version_id,amount_fen:lineEstimate(x)})),
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
  if(stage==='stocked'){
   const category=projectCategoryStatus(latest.category_id);
   if(!category||category.status!=='active')fault(422,'正式入库前必须选择启用的项目类别');
   if(!latest.preliminary_estimate_fen||!latest.preliminary_estimate_basis?.trim())
    fault(422,'正式入库前必须填写有依据的初步估算，缺价不得视为零');
  }
  if(stage==='approved'){
   if(!latest.agreement_id)fault(422,'立项前必须绑定唯一执行协议');
   const ag=agreement(latest.agreement_id),fw=framework(ag.framework_id);
   if(ag.status!=='active'||fw.status!=='active')fault(422,'协议或框架未启用');
   if(ag.framework_id!==latest.framework_id)fault(422,'协行协议与子项目所属年度框架不一致');
   if(!estimate.complete)fault(422,'存在未估价需求，不能形成批准预算');
   if(items.some(x=>!x.price_source||!x.price_date||!x.tax_mode))fault(422,'立项估算缺少价格来源、日期或税口径');
   const used=approvedBudgetsForAgreement(ag.id);
   if(BigInt(used)+BigInt(estimate.known_total_fen)>BigInt(ag.limit_fen))fault(422,'批准预算超过协议可用额度');
   for(const x of items){
    const other=otherApprovedProjectForDemand(x.demand_id,id);
    if(other)fault(409,'该专业需求已由其他正式子项目承接，不可重复立项：'+x.demand_no);
   }
  }
  const t=now(),newVersion=latest.version+1;
  updateProjectStage(id,stage,newVersion,
   stage==='approved'?estimate.known_total_fen:latest.preliminary_estimate_fen,
   stage==='approved'?estimate.known_total_fen:null,t);
  const snapshot=stageSnapshot(latest,items,stage,reason,user);
  const snapshotJson=JSON.stringify(snapshot);
  insertProjectStage({id:uid(),project_id:id,stage,version:newVersion,
   snapshot_json:snapshotJson,reason,actor_id:user.id,created_at:t});
  if(stage==='approved'){
   insertProjectApproval({id:uid(),project_id:id,version_no:1,
    snapshot_json:snapshotJson,approved_budget_fen:estimate.known_total_fen,
    approved_by:user.id,approved_at:t});
  }
  event(user,'projects',id,'stage_'+stage,latest,{...latest,status:stage,version:newVersion,estimate},reason);
  return projectDetail(id);
 });
}

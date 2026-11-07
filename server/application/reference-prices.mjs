import {systemCode} from '../domain/system-code.mjs';
import {uid,now,transaction,audit} from '../database/index.mjs';
import {yuanToFen} from '../domain/money.mjs';
import {operationDefinition} from '../domain/operation-definition.mjs';
import {activePriceDictionaryItem,catalogById,activeVoltage,currentReferencePrice,catalogPriceIds,priceVersions,insertPriceCatalog,insertPriceVersion,setCatalogPriceVersion,updatePriceCatalogStatus,activePriceScope,projectPriceScope,projectForPricing,demandForPricing,applyPriceToScope} from '../database/repositories/reference-prices.mjs';

const error=(status,message)=>{const e=new Error(message);e.status=status;throw e};
const required=(value,name)=>{
 if(typeof value!=='string'||!value.trim())error(422,name+'不能为空');
 return value.trim();
};
const enumValue=(value,values,name)=>{
 if(!values.includes(value))error(422,name+'无效');
 return value;
};
const dateValue=(value,name)=>{
 const date=required(value,name);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date))||
    new Date(date+'T00:00:00.000Z').toISOString().slice(0,10)!==date)error(422,name+'必须是有效的 YYYY-MM-DD');
 return date;
};
const lookup=(id,type)=>activePriceDictionaryItem(id,type)
 ||error(422,'请选择有效的'+(type==='operation'?'检修操作类型':'计量单位'));
const cat=id=>catalogById(id)||error(404,'参考价格项目不存在');
function quote(body){
 const unit_price_fen=yuanToFen(body.unit_price_yuan,'参考单价');
 if(unit_price_fen<=0)error(422,'参考单价必须大于零');
 return {unit_price_fen,price_source:required(body.price_source,'价格来源'),
  price_date:dateValue(body.price_date,'价格依据日期'),
  tax_mode:enumValue(body.tax_mode,['inclusive','exclusive','none'],'税口径'),
  effective_on:dateValue(body.effective_on,'生效日期'),
  basis:required(body.basis,'价格测算说明')};
}
const current=currentReferencePrice;
export function listReferencePrices(options={}){
 return catalogPriceIds(options).map(row=>current(row.id));
}
export function referencePriceVersions(id){
 cat(id);
 return priceVersions(id);
}
export function createReferencePrice(body,user){
 const operation=lookup(body.operation_id,'operation'),unit=lookup(body.unit_id||operation.default_unit_id,'unit');
 const definition=operationDefinition(operation,lookup(operation.default_unit_id,'unit'));
 if(unit.id!==definition.unit_id)error(422,'参考价单位必须与操作类型定义一致');
 const voltageId=body.voltage_level_id||null;
 if(voltageId&&!activeVoltage(voltageId))error(422,'所选电压等级不存在或已停用');
 const plan_type=enumValue(body.plan_type,['both','outage','non_outage'],'检修方式');
 const price=quote(body);
 const t=now(),item={id:uid(),code:systemCode(body.code,'RP'),
  title:required(body.title,'参考价名称'),operation_id:operation.id,unit_id:unit.id,
  voltage_level_id:voltageId,plan_type,specification:String(body.specification||'').trim(),
  status:'active',version:1,created_by:user.id,created_at:t,updated_at:t};
 const revision={id:uid(),catalog_id:item.id,version_no:1,...price,
  reason:'首次建立参考价格',created_by:user.id,created_at:t};
 return transaction(()=>{
  insertPriceCatalog(item);
  insertPriceVersion(revision);
  audit(user.id,'reference_price_catalog',item.id,'create',null,{...item,revision},revision.reason);
  return current(item.id);
 });
}
export function reviseReferencePrice(id,body,user){
 const reason=required(body.reason,'修订依据'),price=quote(body);
 return transaction(()=>{
  const old=cat(id);
  if(body.version!==old.version)error(409,'参考价格已发生变化，请刷新后重试');
  if(old.status!=='active')error(409,'已停用参考价不能修订');
  const nextVersion=old.version+1,t=now();
  const revision={id:uid(),catalog_id:id,version_no:nextVersion,...price,
   reason,created_by:user.id,created_at:t};
  insertPriceVersion(revision);
  setCatalogPriceVersion(id,nextVersion,t);
  audit(user.id,'reference_price_catalog',id,'revise_price',old,current(id),reason);
  return current(id);
 });
}
export function setReferencePriceStatus(id,body,user){
 const reason=required(body.reason,'状态变更依据'),status=enumValue(body.status,['active','inactive'],'参考价状态');
 return transaction(()=>{
  const old=cat(id);
  if(body.version!==old.version)error(409,'参考价格版本已变化，请刷新后重试');
  if(old.status===status)error(409,'参考价已经处于此状态');
  updatePriceCatalogStatus(id,status,now());
  audit(user.id,'reference_price_catalog',id,'status_'+status,old,cat(id),reason);
  return current(id);
 });
}
export function applicableReferencePrices(projectId,scopeId){
 const scope=activePriceScope(projectId,scopeId);
 if(!scope)error(404,'专业需求范围不存在');
 const demand=demandForPricing(scope.demand_id);
 if(!demand)error(422,'专业需求位置或线路信息缺失');
 return listReferencePrices({operation_id:demand.operation_id,unit_id:demand.unit_id,status:'active'})
  .filter(price=>!price.voltage_level_id||price.voltage_level_id===demand.voltage_level_id)
  .sort((a,b)=>Number(!!b.voltage_level_id)-Number(!!a.voltage_level_id));
}
export function applyReferencePrice(projectId,scopeId,body,user){
 return transaction(()=>{
  const project=projectForPricing(projectId);
  if(!project)error(404,'子项目不存在');
  if(!['reserve','stocked'].includes(project.status))error(409,'立项后不得直接改写估价依据');
  if(body.version!==project.version)error(409,'项目版本已更新，请刷新后重试');
  const scope=projectPriceScope(projectId,scopeId);
  if(!scope)error(404,'专业需求范围不存在');
  const price=current(required(body.catalog_id,'参考价目录项目'));
  if(!price||price.status!=='active')error(422,'参考价格目录项目不存在或已停用');
  if(body.reference_price_version_id!==price.reference_price_version_id)error(409,'参考单价版本已更新，请重新选择');
  const demand=demandForPricing(scope.demand_id);
  if(!demand||price.operation_id!==demand.operation_id||price.unit_id!==demand.unit_id)
   error(422,'参考价的检修操作或计量单位与专业需求不匹配');
  if(price.voltage_level_id&&price.voltage_level_id!==demand.voltage_level_id)
   error(422,'参考价的适用电压等级与专业需求不匹配');
  const t=now(),source='参考单价 '+price.title+' v'+price.version_no+' · '+price.price_source;
  applyPriceToScope(projectId,scopeId,price,source,t);
  audit(user.id,'project_demand_scopes',scopeId,'apply_reference_price',scope,
   {...scope,unit_price_fen:price.unit_price_fen,price_source:source,price_date:price.price_date,
    tax_mode:price.tax_mode,reference_price_version_id:price.reference_price_version_id},
   '储备估算引用参考价目录（非正式结算价格）');
  return {scope_id:scopeId,reference_price_version_id:price.reference_price_version_id};
 });
}

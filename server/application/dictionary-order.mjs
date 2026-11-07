import {dictionaryTypeExists,nextOrderNumber,dictionaryRowsForOrder,setDictionaryOrder} from '../database/repositories/dictionaries.mjs';
import {transaction,audit,uid,now} from '../database/index.mjs';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
export const nextDictionaryOrder=nextOrderNumber;
export function reorderDictionary(type,body,user){
 if(type!=='voltage'&&!dictionaryTypeExists(type))fail(422,'未知字典类别');
 return transaction(()=>{
  const voltage=type==='voltage',table=voltage?'voltage_levels':type==='operation'?'operations':'dictionary_items';
  const current=dictionaryRowsForOrder(type);
  const rows=body.rows;
  if(!Array.isArray(rows)||rows.length!==current.length||new Set(rows.map(x=>x?.id)).size!==current.length)fail(409,'选项列表已变化，请刷新后调整顺序');
  const oldById=new Map(current.map(x=>[x.id,x]));
  for(const row of rows){
   const old=oldById.get(row?.id);
   if(!old||row.version!==old.version)fail(409,'选项已更新，请刷新后调整顺序');
  }
  return rows.map((row,index)=>{
   const old=oldById.get(row.id),sort_order=(index+1)*10;
   if(old.sort_order===sort_order)return old;
   const next={...old,sort_order,version:old.version+1,updated_at:now()};
   setDictionaryOrder(table,next,user.id,uid());
   audit(user.id,table,next.id,'reorder',old,next,'调整显示顺序');
   return next;
  });
 });
}

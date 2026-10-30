import {currentDictionaryRows} from './dictionary-deletions.mjs';
import {db,all,one,exec,transaction,audit,uid,now} from './db.mjs';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
export function nextDictionaryOrder(type){
 const row=type==='voltage'
  ?one('SELECT MAX(sort_order) n FROM voltage_levels')
  :one('SELECT MAX(sort_order) n FROM dictionary_items WHERE type_id=?',type);
 return Math.max(100,(row.n??0)+10);
}
export function reorderDictionary(type,body,user){
 if(type!=='voltage'&&!one('SELECT id FROM dictionary_types WHERE id=?',type))fail(422,'未知字典类别');
 return transaction(()=>{
  const voltage=type==='voltage',table=voltage?'voltage_levels':'dictionary_items';
  const current=currentDictionaryRows(db,table,voltage?all('SELECT * FROM voltage_levels'):all('SELECT * FROM dictionary_items WHERE type_id=?',type));
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
   exec('UPDATE '+table+' SET sort_order=?,version=?,updated_at=? WHERE id=?',sort_order,next.version,next.updated_at,next.id);
   if(!voltage)exec('INSERT INTO dictionary_item_versions VALUES(?,?,?,?,?,?)',uid(),next.id,next.version,JSON.stringify(next),user.id,next.updated_at);
   audit(user.id,table,next.id,'reorder',old,next,'调整显示顺序');
   return next;
  });
 });
}

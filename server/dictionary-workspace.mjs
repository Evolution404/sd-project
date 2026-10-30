import {all,one,exec,transaction,audit,uid,now} from './db.mjs';
import ExcelJS from 'exceljs';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
const uses={
 voltage:[['线路台账','线路的电压等级'],['杆塔查询','随所属线路展示电压等级'],['检修参考单价','限定参考价格适用的电压范围']],
 unit:[['专业需求','工作量的计量单位'],['操作类型','录入需求时采用的默认单位'],['检修参考单价','参考单价的计价单位']],
 source:[['专业需求','登记巡视、专项检查等需求来源']],
 priority:[['专业需求','标记需求的轻重缓急']],
 project_category:[['子项目储备','储备分类和项目预算统计']],
 operation:[['专业需求','定义工作内容、默认值和附加字段'],['检修参考单价','关联作业对应的参考单价']],
 tower_structure:[['基础台账','杆塔结构类型建议值，引用数按当前名称匹配']],
 tower_purpose:[['基础台账','杆塔用途建议值，引用数按当前名称匹配']],
 category:[['扩展分类','预留分类，当前未接入业务录入']]
};
const groups=[
 {id:'common',title:'通用基础',types:['voltage','unit']},
 {id:'business',title:'需求与项目',types:['operation','source','priority','project_category']},
 {id:'tower',title:'杆塔台账',types:['tower_structure','tower_purpose']},
 {id:'extension',title:'其他扩展',types:['category']}
];
export const builtinDictionaryItem=item=>item.id.startsWith(item.type_id==='voltage'?'builtin-voltage-':'builtin-'+item.type_id+'-');
export function dictionaryWorkspace(){
 const categories=[{id:'voltage',title:'电压等级'},...all("SELECT * FROM dictionary_types WHERE id NOT IN ('team','erection') ORDER BY rowid")]
  .map(type=>({...type,uses:uses[type.id]||[],group_id:groups.find(group=>group.types.includes(type.id))?.id||'extension'}));
 const categoriesById=new Map(categories.map(type=>[type.id,type]));
 const counts=new Map();
 const count=(table,column)=>{
  for(const row of all('SELECT '+column+' id,COUNT(*) n FROM '+table+' WHERE '+column+' IS NOT NULL GROUP BY '+column))counts.set(row.id,(counts.get(row.id)||0)+row.n);
 };
 for(const [table,column] of [
  ['transmission_lines','voltage_level_id'],['reference_price_catalog','voltage_level_id'],
  ['demands','operation_id'],['demands','unit_id'],['demands','priority_id'],
  ['source_records','type_id'],
  ['reference_price_catalog','operation_id'],['reference_price_catalog','unit_id'],['projects','category_id']
 ])count(table,column);
 const activeUnits=new Set(all("SELECT id FROM dictionary_items WHERE type_id='unit' AND status='active'").map(item=>item.id));
 const defaults=new Map(all('SELECT default_unit_id id,COUNT(*) n FROM dictionary_items WHERE default_unit_id IS NOT NULL GROUP BY default_unit_id').map(x=>[x.id,x.n]));
 const structure=new Map(all('SELECT tower_type name,COUNT(*) n FROM physical_towers GROUP BY tower_type').map(x=>[x.name,x.n]));
 const purpose=new Map(all('SELECT purpose name,COUNT(*) n FROM physical_towers GROUP BY purpose').map(x=>[x.name,x.n]));
 const items=[...all('SELECT *,\'voltage\' type_id FROM voltage_levels'),...all('SELECT * FROM dictionary_items')]
  .filter(item=>categoriesById.has(item.type_id)).map(item=>({...item,
   builtin:builtinDictionaryItem(item),configuration_usage_count:defaults.get(item.id)||0,
   usage_count:counts.get(item.id)|| (item.type_id==='tower_structure'?structure.get(item.name):item.type_id==='tower_purpose'?purpose.get(item.name):0)||0,
   needs_attention:item.type_id==='operation'&&item.status==='active'&&!activeUnits.has(item.default_unit_id),
   uses:categoriesById.get(item.type_id).uses
  }));
 return {categories,groups,items,stats:{builtin:items.filter(x=>x.builtin).length,active:items.filter(x=>x.status==='active').length,
  referenced:items.filter(x=>x.usage_count>0).length,attention:items.filter(x=>x.needs_attention).length}};
}
const quoteIdentifier=name=>'"'+name.replaceAll('"','""')+'"';
function deletionItem(type,id){
 if(type!=='voltage'&&!one("SELECT id FROM dictionary_types WHERE id=? AND id NOT IN ('team','erection')",type))fail(422,'未知字典类别');
 const table=type==='voltage'?'voltage_levels':'dictionary_items';
 const item=one('SELECT * FROM '+table+' WHERE id=?',id);
 if(!item||type!=='voltage'&&item.type_id!==type)fail(404,'词条不存在');
 return {table,item:{...item,type_id:type}};
}
const referenceNames={transmission_lines:'线路台账',reference_price_catalog:'检修参考单价',demands:'专业需求',source_records:'需求来源',dictionary_items:'操作默认配置',projects:'子项目',demand_batches:'需求草稿及提交批次',dictionary_item_versions:'其他字典历史版本',demand_versions:'需求历史版本',project_approval_versions:'项目批准版本',project_demand_scopes:'项目需求范围',executions:'检修计划',execution_items:'检修计划工作明细',project_change_orders:'项目变更单',project_stage_events:'项目阶段记录'};
function includesValue(value,id){
 if(value===id)return true;
 return value!==null&&typeof value==='object'&&Object.values(value).some(child=>includesValue(child,id));
}
export function dictionaryDeletionPreview(type,id){
 const {table,item}=deletionItem(type,id),references=[];
 // Inspect real foreign keys, including inactive records. Audits and this item's
 // own version rows are archived by deletion and do not constitute business use.
 const tables=all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
 for(const {name} of tables){
  if(name==='audit_events')continue;
  let count=0;
  const keys=all('PRAGMA foreign_key_list('+quoteIdentifier(name)+')').filter(key=>key.table===table&&!(name==='dictionary_item_versions'&&key.from==='item_id'));
  // Match each record once even when both its FK and snapshot reference the item.
  const columns=all('PRAGMA table_info('+quoteIdentifier(name)+')').filter(column=>column.name.endsWith('_json')).map(column=>column.name);
  const fields=[...new Set([...columns,...keys.map(key=>key.from)])];
  if(fields.length){
   const condition=name==='dictionary_item_versions'?' WHERE item_id<>?':'';
   for(const row of all('SELECT '+fields.map(quoteIdentifier).join(',')+' FROM '+quoteIdentifier(name)+condition,...(condition?[id]:[]))){
    const linked=keys.some(key=>row[key.from]===id)||columns.some(column=>{
     if(!row[column])return false;
     let value;try{value=JSON.parse(row[column])}catch{fail(409,'存在无法读取的历史数据，请先核查后再删除')}
     return includesValue(value,id);
    });
    if(linked)count++;
   }
  }
  if(count)references.push({domain:referenceNames[name]||name,count});
 }
 if(['tower_structure','tower_purpose'].includes(type)){
  const column=type==='tower_structure'?'tower_type':'purpose',count=one('SELECT COUNT(*) n FROM physical_towers WHERE '+column+'=?',item.name).n;
  if(count)references.push({domain:'杆塔台账（按当前名称匹配）',count});
 }
 const builtin=builtinDictionaryItem(item);
 return {item,builtin,references,deletable:!builtin&&!references.length,
  reason:builtin?'系统内置词条保留用于基础配置，可停用。':references.length?'词条已被引用，不能直接删除。可以停用并保留历史记录。':'未被业务、配置、草稿或历史版本引用，可以删除。'};
}
export function deleteDictionaryItem(type,id,body,user){
 return transaction(()=>{
  const preview=dictionaryDeletionPreview(type,id);
  if(body.version!==preview.item.version)fail(409,'词条已被修改，请刷新后重试');
  if(!preview.deletable)fail(409,preview.reason);
  const {table,item}=deletionItem(type,id);
  const versions=type==='voltage'?[]:all('SELECT * FROM dictionary_item_versions WHERE item_id=? ORDER BY version',id);
  audit(user.id,table,id,'delete',{...item,archived_versions:versions},null,'删除未引用的自定义词条');
  if(type!=='voltage')exec('DELETE FROM dictionary_item_versions WHERE item_id=?',id);
  exec('DELETE FROM '+table+' WHERE id=?',id);
  return {deleted:true,id};
 });
}
export function changeDictionaryStatus(type,body,user){
 if(type!=='voltage'&&!one("SELECT id FROM dictionary_types WHERE id=? AND id NOT IN ('team','erection')",type))fail(422,'未知字典类别');
 if(!['active','inactive'].includes(body.status)||!Array.isArray(body.rows)||!body.rows.length||body.rows.length>1000||new Set(body.rows.map(x=>x?.id)).size!==body.rows.length)fail(422,'请选择词条和有效状态');
 return transaction(()=>{
  const table=type==='voltage'?'voltage_levels':'dictionary_items';
  const rows=body.rows.map(item=>{
   const old=one('SELECT * FROM '+table+' WHERE id=?',item?.id??null);
   if(!old||type!=='voltage'&&old.type_id!==type)fail(422,'词条不属于当前分类');
   if(old.version!==item.version)fail(409,'词条已被修改，请刷新后重试');
   return old;
  });
  for(const old of rows){
   if(old.status===body.status)continue;
   const next={...old,status:body.status,version:old.version+1,updated_at:now()};
   exec('UPDATE '+table+' SET status=?,version=?,updated_at=? WHERE id=?',next.status,next.version,next.updated_at,next.id);
   if(type!=='voltage')exec('INSERT INTO dictionary_item_versions VALUES(?,?,?,?,?,?)',uid(),next.id,next.version,JSON.stringify(next),user.id,next.updated_at);
   audit(user.id,table,next.id,'status_'+next.status,old,next,'字典词条'+(next.status==='active'?'启用':'停用'));
  }
  return {count:rows.length};
 });
}
export async function exportDictionary(params){
 const {items,categories}=dictionaryWorkspace(),type=params.get('type'),status=params.get('status'),origin=params.get('origin'),query=(params.get('search')||'').trim().toLowerCase();
 const rows=items.filter(x=>(!type||x.type_id===type)&&(!status||x.status===status)&&(!origin||(origin==='builtin'?x.builtin:!x.builtin))&&
  (!query||[x.name,x.code,...x.uses.flat()].join(' ').toLowerCase().includes(query)));
 const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('数据字典');
 sheet.columns=[{header:'分类',key:'category',width:18},{header:'名称',key:'name',width:28},{header:'状态',key:'status',width:12},{header:'来源',key:'origin',width:14},{header:'业务引用数',key:'count',width:14},{header:'应用领域',key:'uses',width:50},{header:'最后更新',key:'updated',width:28}];
 for(const item of rows)sheet.addRow({category:categories.find(x=>x.id===item.type_id)?.title,name:item.name,status:item.status==='active'?'启用':'停用',origin:item.builtin?'系统内置':'自定义',count:item.usage_count,uses:item.uses.map(x=>x[0]).join('、'),updated:item.updated_at});
 sheet.getRow(1).font={bold:true};sheet.views=[{state:'frozen',ySplit:1}];
 return Buffer.from(await workbook.xlsx.writeBuffer());
}

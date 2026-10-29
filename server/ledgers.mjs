import {createHash} from 'node:crypto';
import {uid,now,one,all,exec,transaction,audit} from './db.mjs';
import {quantityToScaled} from './quantity.mjs';
const fail=(status,message,details)=>{throw Object.assign(new Error(message),{status,details})};
const text=(v,label)=>{if(typeof v!=='string'||!v.trim())fail(422,label+'不能为空');if(v.length>300)fail(422,label+'最多300字');return v.trim()};
const optional=v=>v===undefined||v===null?'':String(v).trim();
const version=(old,body,label='记录')=>{if(body.version!==old.version)fail(409,label+'已变化，请刷新后重试')};
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const insert=(table,item)=>exec('INSERT INTO '+table+'('+Object.keys(item).join(',')+') VALUES('+Object.keys(item).map(()=>'?').join(',')+')',...Object.values(item));
const update=(table,id,changes)=>exec('UPDATE '+table+' SET '+Object.keys(changes).map(k=>k+'=?').join(',')+' WHERE id=?',...Object.values(changes),id);
const record=(u,lineId,action,before,after,reason='')=>audit(u.id,'ledger_lines',lineId,action,before,after,reason);
const line=id=>one('SELECT * FROM transmission_lines WHERE id=?',id)||fail(404,'线路不存在');
const tower=id=>one('SELECT * FROM logical_towers WHERE id=?',id)||fail(404,'杆塔不存在');
const physical=id=>one('SELECT * FROM physical_towers WHERE id=?',id)||fail(404,'实际杆塔不存在');
const span=id=>one('SELECT * FROM line_spans WHERE id=?',id)||fail(404,'档距不存在');
function writableLine(id){const l=line(id);if(l.status!=='active')fail(409,'线路已停用');if(l.setup_status!=='ready')fail(409,'请先确认支线接入杆塔');return l}
function mutate(user,body,fn){return transaction(()=>{
 const key=body.idempotency_key;if(key!==undefined&&(typeof key!=='string'||!key.trim()||key.length>160))fail(422,'提交标识无效');
 const digest=hash(body);
 if(key){const prev=one('SELECT * FROM ledger_requests WHERE request_key=?',key);if(prev){if(prev.actor_id!==user.id||prev.request_hash!==digest)fail(409,'相同提交标识对应不同内容');return JSON.parse(prev.result_json)}}
 const result=fn();if(key)insert('ledger_requests',{request_key:key,actor_id:user.id,request_hash:digest,result_json:JSON.stringify(result),created_at:now()});return result;
})}
function topology(id){return hash({line:line(id),towers:all('SELECT t.id,t.version,t.sort_rank,t.physical_tower_id,p.version AS pv FROM logical_towers t LEFT JOIN physical_towers p ON p.id=t.physical_tower_id WHERE t.line_id=? ORDER BY t.id',id),spans:all('SELECT * FROM line_spans WHERE line_id=? ORDER BY id',id),junction:line(id).junction_tower_id? tower(line(id).junction_tower_id):null})}
function checkTopology(id,body){const l=line(id);version(l,body,'线路');if(body.topology_token&&body.topology_token!==topology(id))fail(409,'杆塔或档距已变化，请重新预览');return l}
const touch=id=>exec('UPDATE transmission_lines SET version=version+1,updated_at=? WHERE id=?',now(),id);
export function listLedgerLines(){return all(`SELECT l.*,v.name AS voltage_name,p.name AS parent_name,t.tower_no AS junction_tower_no,
 (SELECT COUNT(*) FROM logical_towers WHERE line_id=l.id) tower_count,
 (SELECT COUNT(*) FROM line_spans WHERE line_id=l.id AND status<>'retired') span_count
 FROM transmission_lines l JOIN voltage_levels v ON v.id=l.voltage_level_id LEFT JOIN transmission_lines p ON p.id=l.parent_line_id LEFT JOIN logical_towers t ON t.id=l.junction_tower_id ORDER BY l.name,l.id`)}
function lineValues(body,old=null){
 const kind=body.line_kind??old?.line_kind??'main';if(!['main','branch'].includes(kind))fail(422,'线路类型只能是主线或支线');
 const status=body.status??old?.status??'active';if(!['active','inactive'].includes(status))fail(422,'线路状态无效');
 const parentId=kind==='branch'?(body.parent_line_id??old?.parent_line_id):null;
 const parent=parentId?line(parentId):null;if(kind==='branch'&&(!parent||parent.line_kind!=='main'||status==='active'&&parent.status!=='active'))fail(422,'所属主线必须是在用主线');
 const voltageId=parent?.voltage_level_id||body.voltage_level_id||old?.voltage_level_id;
 const voltage=one("SELECT * FROM voltage_levels WHERE id=?",voltageId);
 if(!voltage||(voltage.status!=='active'&&voltageId!==old?.voltage_level_id))fail(422,'电压等级无效');
 const junctionId=kind==='branch'?(body.junction_tower_id??old?.junction_tower_id)||null:null;
 const setup=body.draft===true?'draft':body.setup_status??old?.setup_status??'ready';
 if(!['ready','draft'].includes(setup))fail(422,'线路确认状态无效');
 if(kind==='branch'&&junctionId){const t=tower(junctionId);if(t.line_id!==parentId||status==='active'&&setup==='ready'&&(t.status!=='active'||!t.physical_tower_id||physical(t.physical_tower_id).status!=='active'))fail(422,'接入杆塔必须是所属主线的在用杆塔')}
 if(kind==='branch'&&status==='active'&&setup==='ready'&&!junctionId)fail(422,'接入杆塔不能为空，可先保存支线草稿');

 return {name:text(body.name??old?.name,'线路名称'),voltage_level_id:voltageId,line_kind:kind,parent_line_id:parentId,junction_tower_id:junctionId,setup_status:setup,status,
  ...Object.fromEntries(['start_label','end_label'].map(k=>[k,optional(body[k]??old?.[k])]))};
}
export function createLedgerLine(body,user){return mutate(user,body,()=>{
 const values=lineValues(body),id=uid(),t=now(),item={id,line_code:optional(body.line_code)||'XL-'+id.replaceAll('-',''),...values,version:1,created_at:t,updated_at:t};
 insert('transmission_lines',item);insert('line_name_history',{id:uid(),line_id:id,name:item.name,valid_from:t,valid_to:null,changed_by:user.id,reason:'初始登记'});record(user,id,'create',null,item);return item;
})}
export function updateLedgerLine(id,body,user){return mutate(user,body,()=>{
 const old=line(id);version(old,body,'线路');const values=lineValues(body,old),reason=text(body.reason,'变更原因');
 if(values.parent_line_id===id)fail(422,'线路不能归属自身');
 const used=one('SELECT COUNT(*) n FROM logical_towers WHERE line_id=?',id).n+one('SELECT COUNT(*) n FROM line_spans WHERE line_id=?',id).n+one('SELECT COUNT(*) n FROM transmission_lines WHERE parent_line_id=?',id).n;
 if(used&&['line_kind','parent_line_id','junction_tower_id','voltage_level_id'].some(k=>values[k]!==old[k]))fail(409,'已有杆塔、档距或支线，不能直接改挂线路或接入点');
 if(values.status==='inactive'&&(one("SELECT 1 FROM logical_towers WHERE line_id=? AND status='active'",id)||one("SELECT 1 FROM transmission_lines WHERE parent_line_id=? AND status='active'",id)))fail(409,'请先处理在用杆塔及支线后再停用线路');
 const t=now(),next={...old,...values,version:old.version+1,updated_at:t};update('transmission_lines',id,{...values,version:next.version,updated_at:t});
 if(old.name!==next.name){exec('UPDATE line_name_history SET valid_to=? WHERE line_id=? AND valid_to IS NULL',t,id);insert('line_name_history',{id:uid(),line_id:id,name:next.name,valid_from:t,valid_to:null,changed_by:user.id,reason})}
 record(user,id,'update',old,next,reason);return next;
})}
export function deleteLedgerLine(id,body,user){return mutate(user,body,()=>{
 const old=line(id);version(old,body,'线路');
 if(one('SELECT 1 FROM logical_towers WHERE line_id=?',id)||one('SELECT 1 FROM line_spans WHERE line_id=?',id)||one('SELECT 1 FROM transmission_lines WHERE parent_line_id=?',id)||one('SELECT 1 FROM demands WHERE location_line_id=?',id))fail(409,'线路已有杆塔、档距、支线或需求引用，请使用停用');
 exec('DELETE FROM line_name_history WHERE line_id=?',id);exec('DELETE FROM transmission_lines WHERE id=?',id);record(user,id,'delete',old,null,text(body.reason,'删除原因'));return {id};
})}
export function ledgerTowers(query=new URLSearchParams()){
 const args=[],where=[];if(query.get('id')){where.push('t.id=?');args.push(query.get('id'))}if(query.get('line_id')){where.push('t.line_id=?');args.push(query.get('line_id'))}if(query.get('search')){where.push('(t.tower_no LIKE ? OR l.name LIKE ? OR p.tower_code LIKE ? OR p.model LIKE ?)');args.push(...Array(4).fill('%'+query.get('search')+'%'))}
 return all(`SELECT t.*,l.name AS line_name,l.line_kind,l.status AS line_status,l.setup_status,v.name AS voltage_name,p.tower_code AS physical_code,p.tower_type,p.model,p.height_scaled,p.purpose,p.asset_no,p.longitude,p.latitude,p.commissioned_on,p.version AS physical_version,
 (SELECT COUNT(*) FROM logical_towers x WHERE x.physical_tower_id=t.physical_tower_id) shared_count
 FROM logical_towers t JOIN transmission_lines l ON l.id=t.line_id JOIN voltage_levels v ON v.id=l.voltage_level_id LEFT JOIN physical_towers p ON p.id=t.physical_tower_id ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY l.name,t.sort_rank,t.id`,...args);
}
export function ledgerSpans(query=new URLSearchParams()){
 const args=[],where=[];if(query.get('tower_id')){where.push('(s.start_tower_id=? OR s.end_tower_id=?)');args.push(query.get('tower_id'),query.get('tower_id'))}if(query.get('line_id')){where.push('s.line_id=?');args.push(query.get('line_id'))}if(query.get('status')!=='all')where.push("s.status<>'retired'");if(query.get('search')){where.push('(l.name LIKE ? OR a.tower_no LIKE ? OR b.tower_no LIKE ?)');args.push(...Array(3).fill('%'+query.get('search')+'%'))}
 return all(`SELECT s.*,l.name AS line_name,a.tower_no AS start_tower_no,b.tower_no AS end_tower_no,
 (SELECT COUNT(*) FROM demands WHERE span_id=s.id) demand_count
 FROM line_spans s JOIN transmission_lines l ON l.id=s.line_id JOIN logical_towers a ON a.id=s.start_tower_id JOIN logical_towers b ON b.id=s.end_tower_id ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY l.name,a.sort_rank,s.created_at,s.id`,...args);
}
export function ledgerTowerDetail(id){
 const t=tower(id),p=t.physical_tower_id?physical(t.physical_tower_id):null;
 return {...t,physical:p,shared_with:all('SELECT t.id,t.line_id,t.tower_no,t.status,t.version,t.circuit_position,l.name AS line_name FROM logical_towers t JOIN transmission_lines l ON l.id=t.line_id WHERE t.physical_tower_id=? ORDER BY l.name,t.tower_no',t.physical_tower_id),
 spans:ledgerSpans(new URLSearchParams({status:'all',tower_id:id})),
 demand_count:one('SELECT COUNT(*) n FROM demands WHERE logical_tower_id=? OR span_id IN (SELECT id FROM line_spans WHERE start_tower_id=? OR end_tower_id=?)',id,id,id).n,
 names:all('SELECT * FROM logical_tower_name_history WHERE logical_tower_id=? ORDER BY valid_from DESC',id),bindings:all('SELECT * FROM logical_tower_physical_history WHERE logical_tower_id=? ORDER BY valid_from DESC',id)};
}
export function ledgerWorkspace(id){const l=listLedgerLines().find(l=>l.id===id)||fail(404,'线路不存在');return {line:l,towers:ledgerTowers(new URLSearchParams({line_id:id})),junction:l.junction_tower_id?ledgerTowers(new URLSearchParams({id:l.junction_tower_id}))[0]:null,spans:ledgerSpans(new URLSearchParams({line_id:id,status:'all'})),topology_token:topology(id),history:all("SELECT e.*,u.username AS actor_name FROM audit_events e LEFT JOIN users u ON u.id=e.actor_id WHERE e.entity='ledger_lines' AND e.entity_id=? ORDER BY e.created_at DESC,e.rowid DESC LIMIT 200",id)}}
function physicalValues(body,old={}){
 const result=Object.fromEntries(['tower_type','model','purpose','asset_no','commissioned_on'].map(k=>[k,optional(body[k]??old[k])]));
 result.height_scaled=body.height===undefined?old.height_scaled??null:body.height===''||body.height===null?null:quantityToScaled(body.height);
 for(const key of ['longitude','latitude']){const value=body[key]===undefined?old[key]:body[key];result[key]=value===''||value===undefined||value===null?null:Number(value);if(result[key]!==null&&!Number.isFinite(result[key]))fail(422,(key==='longitude'?'经度':'纬度')+'格式无效')}
 if((result.longitude===null)!==(result.latitude===null))fail(422,'经度和纬度需同时填写');if(result.longitude!==null&&(Math.abs(result.longitude)>180||Math.abs(result.latitude)>90))fail(422,'经度或纬度超出有效范围');return result;
}
function inspectTowerRows(id,body){
 writableLine(id);checkTopology(id,body);if(!Array.isArray(body.rows)||!body.rows.length||body.rows.length>500)fail(422,'每批需填写1至500基杆塔');
 const existing=new Set(all("SELECT tower_no FROM logical_towers WHERE line_id=? AND status<>'inactive'",id).map(t=>t.tower_no));const errors=[],rows=[];
 body.rows.forEach((raw,index)=>{try{
  if(!raw||typeof raw!=='object')fail(422,'杆塔行格式无效');const number=text(raw.tower_no,'杆塔号');if(existing.has(number))fail(422,'当前线路已存在或本批重复杆塔号：'+number);existing.add(number);
  const p=raw.physical_tower_id?physical(raw.physical_tower_id):null;if(p&&p.status!=='active')fail(422,'关联的实际杆塔已停用');
  rows.push({tower_no:number,circuit_position:optional(raw.circuit_position),physical_tower_id:p?.id||null,physical:p||physicalValues({...body.common,...raw})});
 }catch(e){errors.push({row:index+1,message:e.message})}});
 if(body.after_tower_id){const anchor=tower(body.after_tower_id);if(anchor.line_id!==id||anchor.status==='inactive')fail(422,'插入位置必须属于当前线路')}
 if(errors.length)fail(422,'杆塔预检失败',errors);return rows;
}
export function previewTowers(id,body){return transaction(()=>({rows:inspectTowerRows(id,body),topology_token:topology(id)}))}
function setOrder(id,ids,user){
 // Move to unused positive ranks first; the existing partial unique index stays enabled.
 const max=one('SELECT COALESCE(MAX(sort_rank),0) n FROM logical_towers WHERE line_id=?',id).n;
 ids.forEach((tid,i)=>exec('UPDATE logical_towers SET sort_rank=? WHERE id=?',Math.max(max,ids.length*100)+ids.length+i+1,tid));
 ids.forEach((tid,i)=>exec('UPDATE logical_towers SET sort_rank=?,version=version+1,updated_at=? WHERE id=?',(i+1)*100,now(),tid));
}
function newLogical(id,row,pid,user){const t=now(),tid=uid();const max=one('SELECT COALESCE(MAX(sort_rank),0) n FROM logical_towers WHERE line_id=?',id).n;
 const item={id:tid,logical_code:'WT-'+tid.replaceAll('-',''),line_id:id,physical_tower_id:pid,tower_no:row.tower_no,display_name:null,sort_rank:max+100,circuit_position:row.circuit_position||null,status:'active',version:1,created_at:t,updated_at:t};insert('logical_towers',item);
 insert('logical_tower_name_history',{id:uid(),logical_tower_id:tid,tower_no:row.tower_no,display_name:null,valid_from:t,valid_to:null,changed_by:user.id,reason:'线路内登记'});
 insert('logical_tower_physical_history',{id:uid(),logical_tower_id:tid,physical_tower_id:pid,valid_from:t,valid_to:null,change_kind:'initial',changed_by:user.id,reason:'线路内登记'});return item;
}
export function addLedgerTowers(id,body,user){return mutate(user,body,()=>{
 const rows=inspectTowerRows(id,body),before=all("SELECT id FROM logical_towers WHERE line_id=? AND status<>'inactive' ORDER BY sort_rank,id",id).map(t=>t.id),ids=[];
 for(const row of rows){let pid=row.physical_tower_id;if(!pid){pid=uid();insert('physical_towers',{id:pid,tower_code:'PT-'+pid.replaceAll('-',''),...row.physical,status:'active',version:1,created_at:now(),updated_at:now()})}ids.push(newLogical(id,row,pid,user).id)}
 const at=body.after_tower_id?before.indexOf(body.after_tower_id)+1:before.length;before.splice(at,0,...ids);setOrder(id,before,user);touch(id);record(user,id,'add_towers',null,{ids,rows:rows.map(r=>({tower_no:r.tower_no,physical_tower_id:r.physical_tower_id})),after_tower_id:body.after_tower_id||null});return {line_id:id,ids,count:ids.length};
})}
export function reorderLedgerTowers(id,body,user){return mutate(user,body,()=>{
 checkTopology(id,body);writableLine(id);const current=all("SELECT id FROM logical_towers WHERE line_id=? AND status<>'inactive' ORDER BY sort_rank,id",id).map(t=>t.id),ids=body.ordered_ids;
 if(!Array.isArray(ids)||new Set(ids).size!==current.length||ids.length!==current.length||ids.some(t=>!current.includes(t)))fail(422,'排序必须包含当前线路全部有效杆塔且不能重复');
 setOrder(id,ids,user);touch(id);record(user,id,'reorder',current,ids,text(body.reason,'调整原因'));return {line_id:id,ids};
})}
function savePhysical(old,values,body,user){
 const changes=Object.fromEntries(Object.entries(values).filter(([k,v])=>v!==old[k]&&!(v===''&&old[k]===null)));if(!Object.keys(changes).length)return;
 const refs=all('SELECT id,line_id,tower_no FROM logical_towers WHERE physical_tower_id=?',old.id);if(body.physical_version!==old.version)fail(409,'实际杆塔属性已变化，请重新查看');
 if(refs.length>1&&!body.confirm_shared)fail(422,'该实际杆塔关联多条线路，请确认共同属性修改影响');
 const reason=text(body.reason,'变更原因');update('physical_towers',old.id,{...changes,version:old.version+1,updated_at:now()});audit(user.id,'physical_towers',old.id,'update',old,{...old,...changes},reason);
 for(const lineId of new Set(refs.map(t=>t.line_id)))record(user,lineId,'physical_update',old,{...old,...changes,shared_with:refs},reason);
}
export function updateLedgerTower(id,body,user){return mutate(user,body,()=>{
 const old=tower(id);version(old,body,'杆塔');const reason=text(body.reason,'变更原因');const number=text(body.tower_no??old.tower_no,'杆塔号');const status=body.status??old.status;
 if(!['active','inactive','draft'].includes(status))fail(422,'杆塔状态无效');
 if(status==='active'){writableLine(old.line_id);if(!old.physical_tower_id&&!body.replace_physical)fail(422,'请先关联已有实际杆塔，或通过实际换塔登记实体');}
 if(number!==old.tower_no&&one("SELECT 1 FROM logical_towers WHERE line_id=? AND tower_no=? AND id<>? AND status<>'inactive'",old.line_id,number,id))fail(422,'当前线路已存在相同杆塔号');
 if(status!=='active'&&(one("SELECT 1 FROM line_spans WHERE (start_tower_id=? OR end_tower_id=?) AND status<>'retired'",id,id)||one("SELECT 1 FROM transmission_lines WHERE junction_tower_id=? AND status='active' AND setup_status='ready'",id)))fail(409,'杆塔仍连接有效档距或作为支线接入点，请先处理关联');
 if(old.physical_tower_id&&body.physical&&!body.replace_physical)savePhysical(physical(old.physical_tower_id),physicalValues(body.physical,physical(old.physical_tower_id)),body,user);
 let newPhysicalId=old.physical_tower_id;
 if(body.replace_physical){newPhysicalId=uid();const attrs=physicalValues(body.physical||{});insert('physical_towers',{id:newPhysicalId,tower_code:'PT-'+newPhysicalId.replaceAll('-',''),...attrs,status:'active',version:1,created_at:now(),updated_at:now()});const t=now();exec('UPDATE logical_tower_physical_history SET valid_to=? WHERE logical_tower_id=? AND valid_to IS NULL',t,id);insert('logical_tower_physical_history',{id:uid(),logical_tower_id:id,physical_tower_id:newPhysicalId,valid_from:t,valid_to:null,change_kind:'replacement',changed_by:user.id,reason})}
 const t=now(),changes={physical_tower_id:newPhysicalId,tower_no:number,circuit_position:body.circuit_position===undefined?old.circuit_position:optional(body.circuit_position),status,version:old.version+1,updated_at:t};update('logical_towers',id,changes);
 if(number!==old.tower_no){exec('UPDATE logical_tower_name_history SET valid_to=? WHERE logical_tower_id=? AND valid_to IS NULL',t,id);insert('logical_tower_name_history',{id:uid(),logical_tower_id:id,tower_no:number,display_name:old.display_name,valid_from:t,valid_to:null,changed_by:user.id,reason})}
 touch(old.line_id);record(user,old.line_id,'update_tower',old,{...old,...changes},reason);return {id,line_id:old.line_id};
})}
export function deleteLedgerTower(id,body,user){return mutate(user,body,()=>{
 const old=tower(id);version(old,body,'杆塔');if(one('SELECT 1 FROM demands WHERE logical_tower_id=? OR observed_physical_tower_id=?',id,old.physical_tower_id)||one('SELECT 1 FROM line_spans WHERE start_tower_id=? OR end_tower_id=?',id,id)||one('SELECT 1 FROM transmission_lines WHERE junction_tower_id=?',id)||one('SELECT 1 FROM demand_related_logical_towers WHERE logical_tower_id=?',id))fail(409,'杆塔已有需求、档距或支线引用，请使用停用或变更');
 exec('DELETE FROM logical_tower_name_history WHERE logical_tower_id=?',id);exec('DELETE FROM logical_tower_physical_history WHERE logical_tower_id=?',id);exec('DELETE FROM logical_towers WHERE id=?',id);touch(old.line_id);record(user,old.line_id,'delete_tower',old,null,text(body.reason,'删除原因'));return {id,line_id:old.line_id};
})}
function sharedRows(body){
 if(!Array.isArray(body.pairs)||!body.pairs.length||body.pairs.length>500)fail(422,'请选择1至500对共塔关系');const seen=new Set();
 return body.pairs.map(pair=>{
  if(!pair||typeof pair!=='object'||Array.isArray(pair))fail(422,'共塔关系行格式无效');
  const source=tower(pair.source_id),target=tower(pair.target_id);if(seen.has(source.id))fail(422,'同一杆塔不能重复关联');seen.add(source.id);
  if(source.id===target.id||source.line_id===target.line_id)fail(422,'请选择另一条线路上的杆塔');
  if(source.version!==pair.source_version||target.version!==pair.target_version)fail(409,'共塔候选已变化，请重新预览');
  const p=target.physical_tower_id?physical(target.physical_tower_id):null;if(!p||p.status!=='active'||target.status!=='active')fail(422,'目标杆塔必须关联在用实际杆塔');
  if(pair.target_physical_version!==undefined&&pair.target_physical_version!==p.version)fail(409,'目标实际杆塔属性已变化，请重新预览');
  return {source,target,physical:p,affected_demands:one('SELECT COUNT(*) n FROM demands WHERE logical_tower_id=?',source.id).n};
 });
}
export function previewShared(body){return transaction(()=>({pairs:sharedRows(body)}))}
export function bindShared(body,user){return mutate(user,body,()=>{
 const pairs=sharedRows(body),reason=text(body.reason,'关联依据');if(!['correction','replacement'].includes(body.change_kind))fail(422,'请区分关联纠错与实际换塔');
 for(const {source,target} of pairs){if(source.physical_tower_id===target.physical_tower_id)continue;const t=now();exec('UPDATE logical_tower_physical_history SET valid_to=? WHERE logical_tower_id=? AND valid_to IS NULL',t,source.id);insert('logical_tower_physical_history',{id:uid(),logical_tower_id:source.id,physical_tower_id:target.physical_tower_id,valid_from:t,valid_to:null,change_kind:body.change_kind,changed_by:user.id,reason});update('logical_towers',source.id,{physical_tower_id:target.physical_tower_id,version:source.version+1,updated_at:t});touch(source.line_id);record(user,source.line_id,'bind_shared',source,{...source,physical_tower_id:target.physical_tower_id},reason)}
 return {count:pairs.length,line_ids:[...new Set(pairs.map(p=>p.source.line_id))]};
})}
function checkEndpoints(id,aId,bId){
 const l=writableLine(id),a=tower(aId),b=tower(bId);if(a.id===b.id)fail(422,'起点与终点不能为同一杆塔');
 for(const t of [a,b])if((t.line_id!==id&&t.id!==l.junction_tower_id)||t.status!=='active'||!t.physical_tower_id||physical(t.physical_tower_id).status!=='active')fail(422,'起止杆塔必须属于当前线路，或是已确认的支线接入杆塔');return {a,b};
}
const lengthValue=v=>v===undefined||v===null||v===''?null:quantityToScaled(v);
export function previewSpans(id,body){return transaction(()=>{
 const l=writableLine(id);checkTopology(id,body);const own=all("SELECT * FROM logical_towers WHERE line_id=? AND status='active' ORDER BY sort_rank,id",id);const nodes=l.junction_tower_id?[tower(l.junction_tower_id),...own]:own;
 const selected=body.tower_ids;if(selected!==undefined&&(!Array.isArray(selected)||new Set(selected).size!==selected.length||selected.some(t=>!nodes.some(n=>n.id===t))))fail(422,'所选杆塔必须属于当前线路');
 const candidates=[];for(let i=1;i<nodes.length;i++){const a=nodes[i-1],b=nodes[i];if(selected&&(!selected.includes(a.id)||!selected.includes(b.id)))continue;
  const existing=one("SELECT * FROM line_spans WHERE line_id=? AND status<>'retired' AND ((start_tower_id=? AND end_tower_id=?) OR (start_tower_id=? AND end_tower_id=?))",id,a.id,b.id,b.id,a.id);
  candidates.push({start_tower_id:a.id,end_tower_id:b.id,start_tower_no:a.tower_no,end_tower_no:b.tower_no,existing_id:existing?.id||null,length:existing?.length_scaled===null||!existing?'':String(existing.length_scaled/10000)});
 }return {candidates,topology_token:topology(id)};
})}
function spanRows(id,rows,ignore=[]){
 if(!Array.isArray(rows)||!rows.length||rows.length>500)fail(422,'每批需填写1至500条档距');const seen=new Set();const errors=[],out=[];
 rows.forEach((r,index)=>{try{if(!r||typeof r!=='object'||Array.isArray(r))fail(422,'档距行格式无效');checkEndpoints(id,r.start_tower_id,r.end_tower_id);const key=[r.start_tower_id,r.end_tower_id].sort().join('|');if(seen.has(key))fail(422,'本批档距重复');seen.add(key);
 const existing=one("SELECT id FROM line_spans WHERE line_id=? AND status<>'retired' AND ((start_tower_id=? AND end_tower_id=?) OR (start_tower_id=? AND end_tower_id=?))",id,r.start_tower_id,r.end_tower_id,r.end_tower_id,r.start_tower_id);if(existing&&!ignore.includes(existing.id))fail(409,'档距已经存在');const length=lengthValue(r.length);out.push({start_tower_id:r.start_tower_id,end_tower_id:r.end_tower_id,length_scaled:length,status:length===null?'draft':'active'});
 }catch(e){errors.push({row:index+1,message:e.message})}});if(errors.length)fail(422,'档距预检失败',errors);return out;
}
export function addLedgerSpans(id,body,user){return mutate(user,body,()=>{
 checkTopology(id,body);const rows=spanRows(id,body.rows),ids=[];for(const row of rows){const sid=uid();insert('line_spans',{id:sid,line_id:id,...row,version:1,created_by:user.id,created_at:now(),updated_at:now()});ids.push(sid)}touch(id);record(user,id,'add_spans',null,{ids,rows});return {line_id:id,ids,count:ids.length};
})}
export function updateLedgerSpan(id,body,user){return mutate(user,body,()=>{
 const old=span(id);version(old,body,'档距');if(old.status==='retired')fail(409,'历史档距不能直接修改');if(body.start_tower_id&&body.start_tower_id!==old.start_tower_id||body.end_tower_id&&body.end_tower_id!==old.end_tower_id)fail(409,'端点调整请使用拆档或合档变更');
 checkEndpoints(old.line_id,old.start_tower_id,old.end_tower_id);const reason=text(body.reason,'调整依据'),length=lengthValue(body.length);const next={...old,length_scaled:length,status:length===null?'draft':'active',version:old.version+1,updated_at:now()};update('line_spans',id,{length_scaled:length,status:next.status,version:next.version,updated_at:next.updated_at});touch(old.line_id);record(user,old.line_id,'update_span',old,next,reason);return next;
})}
export function deleteLedgerSpan(id,body,user){return mutate(user,body,()=>{
 const old=span(id);version(old,body,'档距');if(one('SELECT 1 FROM demands WHERE span_id=?',id))fail(409,'档距已被需求引用，请使用档距变更并保留历史');exec('DELETE FROM line_spans WHERE id=?',id);touch(old.line_id);record(user,old.line_id,'delete_span',old,null,text(body.reason,'删除原因'));return {id,line_id:old.line_id};
})}
export function replaceLedgerSpans(id,body,user){return mutate(user,body,()=>{
 checkTopology(id,body);const reason=text(body.reason,'拆档/合档依据');if(!Array.isArray(body.old_ids)||!body.old_ids.length||new Set(body.old_ids).size!==body.old_ids.length)fail(422,'请选择需要替换的原档距');const old=body.old_ids.map(sid=>{const s=span(sid);if(s.line_id!==id||s.status==='retired')fail(409,'原档距已变化');return s});
 const rows=spanRows(id,body.rows,body.old_ids);
 // A replacement must cover the same outer ends, remain connected and have no branches/cycles.
 function chain(edges){const degree=new Map(),adj=new Map();for(const e of edges){for(const [a,b] of [[e.start_tower_id,e.end_tower_id],[e.end_tower_id,e.start_tower_id]]){degree.set(a,(degree.get(a)||0)+1);adj.set(a,[...(adj.get(a)||[]),b])}}const ends=[...degree].filter(([,n])=>n===1).map(([id])=>id).sort();const visited=new Set(),stack=[ends[0]];while(stack.length){const n=stack.pop();if(visited.has(n))continue;visited.add(n);for(const v of adj.get(n)||[])stack.push(v)}if(ends.length!==2||[...degree.values()].some(n=>n>2)||visited.size!==degree.size)fail(422,'拆档/合档必须是一条连续路径');return ends}
 if(JSON.stringify(chain(old))!==JSON.stringify(chain(rows)))fail(422,'变更前后的两端杆塔必须一致');
 for(const s of old)update('line_spans',s.id,{status:'retired',version:s.version+1,updated_at:now()});const ids=[];for(const row of rows){const sid=uid();insert('line_spans',{id:sid,line_id:id,...row,version:1,created_by:user.id,created_at:now(),updated_at:now()});ids.push(sid)}touch(id);record(user,id,'replace_spans',old,{ids,rows},reason);return {line_id:id,ids,retired_ids:body.old_ids};
})}
export function spanDemandLocation(id){
 const s=span(id);if(s.status!=='active')fail(422,'档距长度未填写或已转为历史，请先完善档距');const {a,b}=checkEndpoints(s.line_id,s.start_tower_id,s.end_tower_id);const l=line(s.line_id);
 return {span:s,start:a,end:b,line:l,snapshot:{id:s.id,version:s.version,line_id:l.id,line_name:l.name,start_tower_id:a.id,end_tower_id:b.id,start_tower_no:a.tower_no,end_tower_no:b.tower_no,start_physical_tower_id:a.physical_tower_id,end_physical_tower_id:b.physical_tower_id,length_scaled:s.length_scaled}};
}

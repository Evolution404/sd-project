import {uid,audit,transaction} from '../database/index.mjs';
import {auditRow,auditControls,manualAuditRow,auditList} from '../database/queries/audit-records.mjs';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
const controlEntities=['audit_annotations','audit_visibility'];
const row=id=>auditRow(id)||fail(404,'操作记录不存在');
function managed(id){const record=row(id);if(controlEntities.includes(record.entity))fail(422,'维护记录请从对应原始记录的处理历史查看');return record}
const controls=auditControls;
function decorate(record){
 const history=controls(record.id),annotation=history.filter(x=>x.entity==='audit_annotations').at(-1),visibility=history.filter(x=>x.entity==='audit_visibility').at(-1);
 return {...record,version:history.length,note:annotation?JSON.parse(annotation.after_json).note:'',
  status:visibility?.action==='hide'?'deleted':'active',before:record.before_json?JSON.parse(record.before_json):null,after:record.after_json?JSON.parse(record.after_json):null,
  maintenance_history:history.map(x=>({...x,value:x.after_json?JSON.parse(x.after_json):null}))};
}
export function auditRecordDetail(id){return decorate(managed(id))}
export function listAuditRecords(query){
 const number=(key,fallback,max)=>{const value=query.get(key);if(value===null)return fallback;const n=Number(value);if(!Number.isSafeInteger(n)||n<1||n>max)fail(422,'分页参数无效');return n};
 const limit=number('limit',20,100),page=number('page',1,1000000);
 const status=query.get('status')||'active';
 if(!['active','deleted','all'].includes(status))fail(422,'记录状态无效');
 const {items,total,entities}=auditList({
  entity:query.get('entity'),search:query.get('search'),status,page,limit
 });
 return {items:items.map(decorate),total,page,limit,entities};
}
export function createManualAudit(body,user){
 const message=typeof body.message==='string'?body.message.trim():'';
 if(!message||message.length>2000)fail(422,'记录内容不能为空且最多2000字');
 const id=uid();audit(user.id,'manual_notes',id,'record',null,{message},message);
 return decorate(manualAuditRow(id));
}
export function maintainAuditRecord(id,action,body,user){
 return transaction(()=>{
  const original=managed(id),current=decorate(original);
  if(current.version!==body.version)fail(409,'记录的处理状态已变化，请刷新后重试');
  const reason=typeof body.reason==='string'?body.reason.trim():'';
  if(!reason||reason.length>2000)fail(422,'处理依据不能为空且最多2000字');
  if(action==='annotate'){
   if(current.status==='deleted')fail(409,'请先恢复显示后再补充纠错说明');
   const note=typeof body.note==='string'?body.note.trim():'';if(note.length>2000)fail(422,'纠错说明最多2000字');
   audit(user.id,'audit_annotations',id,'annotate',{note:current.note},{note},reason);
  }else if(action==='hide'||action==='show'){
   if(current.status===(action==='hide'?'deleted':'active'))fail(409,'记录已经处于该显示状态');
   audit(user.id,'audit_visibility',id,action,{status:current.status},{status:action==='hide'?'deleted':'active'},reason);
  }else fail(422,'处理方式无效');
  return auditRecordDetail(id);
 });
}

const reject=message=>{throw Object.assign(new Error(message),{status:422})};
const reserved=new Set(['__proto__','prototype','constructor']);
const dateValid=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
export function validateFieldDefinitions(fields){
 if(!Array.isArray(fields)||fields.length>50)reject('字段模板必须为数组，最多50项');
 const keys=new Set();
 for(const field of fields){
  if(!field||typeof field!=='object'||Array.isArray(field))reject('字段定义必须为对象');
  if(typeof field.key!=='string'||!/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(field.key)||reserved.has(field.key)||keys.has(field.key))reject('字段编码无效或重复');
  keys.add(field.key);
  if(typeof field.label!=='string'||!field.label.trim()||field.label.length>80)reject('字段名称不能为空且最多80字');
  if(!['text','number','select','boolean','date'].includes(field.type))reject('字段类型支持 text、number、select、boolean、date');
  if(field.required!==undefined&&typeof field.required!=='boolean')reject('字段必填属性必须为布尔值');
  if(field.type==='select'&&(!Array.isArray(field.options)||!field.options.length||field.options.length>200||new Set(field.options).size!==field.options.length||field.options.some(x=>typeof x!=='string'||!x.trim()||x.length>200)))reject('下拉字段需要不重复的非空文本选项');
  if(field.default!==undefined)validateFieldValues([{...field,required:false}],{[field.key]:field.default});
 }
 return fields;
}
export function validateFieldValues(definitions,values={}){
 if(!values||typeof values!=='object'||Array.isArray(values))reject('自定义字段值必须为对象');
 const keys=new Set(definitions.map(f=>f.key));
 if(Object.keys(values).some(k=>!keys.has(k)))reject('存在未在当前字段模板定义的字段');
 const result={};
 for(const f of definitions){
  const v=values[f.key]===undefined?f.default:values[f.key];
  if(v===undefined||v===null||v===''){
   if(f.required)reject(f.label+'不能为空');
   continue;
  }
  const valid=f.type==='text'?typeof v==='string'&&v.length<=2000:
   f.type==='number'?typeof v==='number'&&Number.isFinite(v):
   f.type==='select'?typeof v==='string'&&f.options.includes(v):
   f.type==='boolean'?typeof v==='boolean':typeof v==='string'&&dateValid(v);
  if(!valid||f.required&&typeof v==='string'&&!v.trim())reject(f.label+'的值不符合字段类型或选项');
  result[f.key]=v;
 }
 return result;
}

import { parseWorkbook,makeWorkbook,errorsWorkbook,issue,MAX_DOCUMENTS } from './workbook.mjs';
import { authorize,id,now,digest } from '../application/auth.mjs';
import { requireValue,expectedVersion } from '../domain/errors.mjs';
const clean=row=>Object.fromEntries(Object.entries(row).filter(([key])=>!key.startsWith('_')));
const identity=(kind,row)=>kind==='work_locations'?`${row.location_kind}/${row.logical_tower_id||row.physical_tower_id||row.span_id}`:kind==='materials'?row.material_id:kind==='items'?`${row.cost_node_id}/${row.project_scope_id||''}`:row.project_scope_id;
function mergeDetails(kind,old,updates){
 const result=old.map(x=>({...x}));
 for(const row of updates){const entry=clean(row),key=identity(kind,entry),index=result.findIndex(x=>identity(kind,x)===key);delete entry.action;
  if(row.action==='delete'){requireValue(index>=0,'删除明细不存在');result.splice(index,1);}else {requireValue(!row.action||row.action==='upsert','未知明细动作');if(index>=0)result[index]={...result[index],...entry};else result.push(entry);}
 }
 return result;
}
function differences(before,after,path=''){
 const result=[];for(const key of new Set([...Object.keys(before||{}),...Object.keys(after||{})])){if(['_sheet','_row'].includes(key))continue;const a=before?.[key],b=after?.[key];if(JSON.stringify(a)!==JSON.stringify(b))result.push({field:path+key,before:a??null,after:b??null});}return result;
}
export function createExchange(system){
 const {repo,catalog,demands,finance}=system;
 function prepare(kind,parsed,mode){
  requireValue(['create','update','mixed'].includes(mode),'导入模式无效');
  const numberKey=kind==='demands'?'demand_no':'number',issues=[...parsed.issues],documents=[],numbers=new Set();
  for(const root of parsed.rows.documents){
   const number=root[numberKey];
   try {
    requireValue(typeof number==='string'&&number.trim(),'缺少业务编号');
    requireValue(!numbers.has(number),'文件内业务编号重复');numbers.add(number);
    const existing=root.id?(kind==='demands'?demands.get(root.id):finance.settlement(root.id)):null;
    requireValue(!existing||existing[numberKey]===number,'业务编号与稳定标识不一致');
    if(kind==='demands'&&!existing)requireValue(!repo.find('demands','demand_no',number),'业务编号已存在，更新必须携带稳定标识');
    if(kind==='settlements'&&!existing)requireValue(!repo.where('settlements',{project_id:root.project_id,number}).length,'结算编号已存在，更新须携带稳定标识');
    requireValue(mode!=='create'||!existing,'仅新增模式不能更新现有单据');requireValue(mode!=='update'||existing,'仅更新模式不能新增单据');
    if(existing)expectedVersion(kind==='demands'?existing.current_version:existing.version?.version_no||0,root.expected_version);
    if(kind==='settlements'&&existing)expectedVersion(existing.draft?.edit_version||0,root.expected_edit_version);
    const payload={...(kind==='demands'?existing:existing?.draft?.document||{}),...clean(root)};
    const detailKeys=kind==='demands'?['work_locations','materials']:['items','resolutions'];
    for(const key of detailKeys){
     const rows=parsed.rows[key].filter(row=>row[numberKey]===number).map(row=>{const value=clean(row);delete value[numberKey];for(const [field,data] of Object.entries(value))if(data==='__EMPTY__')value[field]='';if(value.site_features_json&&typeof value.site_features_json==='string')value.site_features_json=JSON.parse(value.site_features_json);return value;});
     payload[key]=mergeDetails(key,payload[key]||[],rows);
    }
    for(const key of detailKeys){
     const sourceRows=parsed.rows[key].filter(row=>row[numberKey]===number);
     const keys=sourceRows.map(row=>identity(key,row));
     requireValue(new Set(keys).size===keys.length,'同一单据的明细身份重复');
    }
    if(kind==='demands'){
     for(const row of parsed.rows.work_locations.filter(row=>row.demand_no===number&&row.action!=='delete')){
      const key=row.location_kind==='span'?'span_id':row.location_kind==='physical_tower'?'physical_tower_id':'logical_tower_id';
      try{catalog.get(row.location_kind==='span'?'spans':row.location_kind==='physical_tower'?'physical':'towers',row[key]);}
      catch(error){issues.push(issue(row._sheet,row._row,key,row[key],error.message));}
     }
     payload.sources=parsed.rows.sources.some(row=>row.demand_no===number)?parsed.rows.sources.filter(row=>row.demand_no===number).map(row=>{const value=clean(row);delete value.demand_no;return value;}):existing?.sources||[];
     for(const source of payload.sources)if(source.id){const original=repo.find('source_records','id',source.id);requireValue(original,'来源标识不存在');requireValue(['description','discovered_on','source_system','external_record_id'].every(key=>source[key]===undefined||source[key]===original[key]),'原始来源不能无痕覆盖，请补充新的更正来源');}
     const normalized=demands.normalize(payload,existing);
     const duplicates=repo.demandDuplicates(normalized.operation_id,normalized.work_locations,existing?.id);
     requireValue(!duplicates.length,'存在同操作同位置疑似重复需求，须在线复核后处理',409,{duplicates});
     Object.assign(payload,normalized);
    }else finance.validateDraft(payload.project_id||existing.project_id,payload);
    const change=differences(kind==='demands'&&existing?demands.normalize(existing,existing):existing?.draft?.document||{},kind==='demands'?demands.normalize(payload,existing):payload);
    if(kind==='demands'&&existing&&payload.sources.some(source=>!source.id||!existing.sources.some(old=>old.id===source.id)))change.push({field:'sources',before:existing.sources,after:payload.sources});
    documents.push({number,id:existing?.id||null,action:existing?(change.length?'update':'unchanged'):'create',payload,changes:change,sheet:root._sheet,row:root._row});
   }catch(error){issues.push(issue(root._sheet,root._row,error.message.includes('版本')?'expected_version':Object.keys(error.fields||{})[0]||numberKey,root,error.message));}
  }
  for(const [key,rows] of Object.entries(parsed.rows))if(key!=='documents')for(const row of rows)if(!numbers.has(row[numberKey]))issues.push(issue(row._sheet,row._row,numberKey,row[numberKey],'明细未对应文件中的业务单据'));
  const seenLocations=new Map();
  for(const doc of documents)if(kind==='demands'&&doc.action==='create')for(const loc of doc.payload.work_locations){
    const key=doc.payload.operation_id+'/'+identity('work_locations',loc),previous=seenLocations.get(key);
    if(previous&&previous.number!==doc.number){issues.push(issue(doc.sheet,doc.row,'work_locations',doc.number,'文件内多个需求存在同操作同位置疑似重复'));issues.push(issue(previous.sheet,previous.row,'work_locations',previous.number,'文件内多个需求存在同操作同位置疑似重复'));}
    else seenLocations.set(key,doc);
  }
  const invalidNumbers=new Set();
  for(const problem of issues){
   const source=Object.values(parsed.rows).flat().find(row=>row._sheet===problem.sheet&&row._row===problem.row);
   if(source)invalidNumbers.add(source[numberKey]);
  }
  return {documents:documents.filter(doc=>!invalidNumbers.has(doc.number)),issues};
 }
 async function preview(actor,kind,buffer,options={}){
  authorize(actor,'write');requireValue(['demands','settlements'].includes(kind),'未知交换类型');
  const parsed=await parseWorkbook(buffer,kind),prepared=prepare(kind,parsed,options.mode||'mixed');
  const token=id(),body={kind,mode:options.mode||'mixed',sha256:digest(buffer),parsed,...prepared};
  // A draft batch is an import work-in-progress, never a formal business fact.
  repo.insert('demand_batches',{id:token,draft_json:JSON.stringify(body),created_by:actor.id,created_at:now(),updated_at:now()});
  return {token,...prepared,summary:counts(prepared)};
 }
 function counts(prepared){return {documents:prepared.documents.length+prepared.issues.filter(x=>x.field==='demand_no'||x.field==='number').length,created:prepared.documents.filter(x=>x.action==='create').length,updated:prepared.documents.filter(x=>x.action==='update').length,unchanged:prepared.documents.filter(x=>x.action==='unchanged').length,invalid:prepared.issues.length,conflicts:prepared.issues.filter(x=>x.field==='expected_version').length};}
 function commit(actor,token,input){
  authorize(actor,'write');return system.idempotent(actor,input.request_key,{token,atomic:Boolean(input.atomic)},()=>{
   const batch=repo.find('demand_batches','id',token);requireValue(batch&&batch.created_by===actor.id,'预检批次不存在',404);requireValue(batch.status==='draft','批次已提交',409);
   const body=JSON.parse(batch.draft_json),prepared=prepare(body.kind,body.parsed,body.mode),results=[],failures=[...prepared.issues];
   requireValue(!input.atomic||!failures.length,'整批提交包含预检错误，全部未写入',422,{issues:failures});
   const execute=()=>{
    for(const document of prepared.documents){
     try {const result=repo.transaction(()=>{
       if(document.action==='unchanged')return {id:document.id,unchanged:true};
       if(body.kind==='demands')return demands.save(actor,document.payload,document.id);
       return finance.saveDraft(actor,document.payload.project_id,document.payload,document.id);
      });results.push({number:document.number,id:result.id,action:document.action});
     }catch(error){if(input.atomic)throw error;failures.push(issue(document.sheet,document.row,'document',document.number,error.message));}
    }
   };
   execute();const result={results,issues:failures,submitted_at:now(),kind:body.kind};
   repo.update('demand_batches','id',token,{status:'submitted',draft_json:JSON.stringify({...body,result}),version:batch.version+1,updated_at:now(),idempotency_key:input.request_key,payload_sha256:body.sha256});
   catalog.audit(actor,'exchange',token,'commit',null,result);return result;
  });
 }
 function lookupRows(){return ['operations','physical','towers','spans','materials','lines','units'].flatMap(kind=>catalog.list(kind).filter(row=>!['inactive','retired'].includes(row.status)).map(row=>({kind,id:row.id,code:row.code||row.tower_code||row.logical_code||row.line_code||'',name:row.name||row.tower_no||''}))).concat(repo.list('projects').map(row=>({kind:'projects',id:row.id,code:row.code,name:system.projects.get(row.id).name})),repo.list('v_project_cost_node_current').map(row=>({kind:'cost_nodes',id:row.id,name:row.name,code:row.project_id})),repo.list('project_demand_scopes').map(row=>({kind:'project_scopes',id:row.id,name:row.demand_id,code:row.project_id})));
 }
 async function exportData(actor,kind,options={}){
  authorize(actor,'read');let records=kind==='demands'?demands.list():finance.allSettlements();
  if(options.ids?.length)records=records.filter(x=>options.ids.includes(x.id));
  if(options.query)records=records.filter(x=>JSON.stringify(x).includes(options.query));
  requireValue(records.length<=MAX_DOCUMENTS,'导出超过5000张，请收窄筛选条件');
  const rows={documents:[],work_locations:[],materials:[],sources:[],items:[],resolutions:[]};
  for(const record of records){
   if(kind==='demands'){
    rows.documents.push({...record,expected_version:record.current_version});
    rows.work_locations.push(...record.work_locations.map(x=>({...x,demand_no:record.demand_no,action:'upsert'})));
    rows.materials.push(...record.materials.map(x=>({...x,demand_no:record.demand_no,action:'upsert'})));
    rows.sources.push(...record.sources.map(x=>({...x,demand_no:record.demand_no})));
   }else{
    const doc=record.draft?.document||record.version||{};
    rows.documents.push({...doc,id:record.id,number:record.number,project_id:record.project_id,expected_version:record.version?.version_no||0,expected_edit_version:record.draft?.edit_version||0});
    rows.items.push(...(record.draft?.document.items||record.items).map(x=>({...x,number:record.number,action:'upsert'})));
    rows.resolutions.push(...(record.draft?.document.resolutions||record.resolutions).map(x=>({...x,number:record.number,action:'upsert'})));
   }
  }
  return makeWorkbook(kind,rows,{report:options.report,lookups:lookupRows()});
 }
 return {preview,commit,exportData,
  template(actor,kind){authorize(actor,'read');return makeWorkbook(kind,{}, {lookups:lookupRows()});},
  errors(actor,token){authorize(actor,'read');const batch=repo.find('demand_batches','id',token);requireValue(batch&&batch.created_by===actor.id,'批次不存在',404);const body=JSON.parse(batch.draft_json);return errorsWorkbook(body.result?.issues||body.issues);}
 };
}

<script setup lang="ts">
import {computed,onMounted,onBeforeUnmount,reactive,ref,watch} from 'vue';
import {ElAlert,ElButton,ElCheckbox,ElDatePicker,ElDialog,ElForm,ElFormItem,ElInput,ElMessage,ElMessageBox,ElOption,ElPagination,ElSelect,ElTable,ElTableColumn,ElTag,ElUpload,ElProgress} from 'element-plus';
import {requestApi} from '../../shared/api/client';
import {newClientId} from '../../shared/utils/client-id';
import CustomFields from '../../shared/components/CustomFields.vue';
import {readOperationDefinition} from '../../shared/utils/operation-definition';
import {quantityScaled,displayScaledQuantity} from '../../shared/utils/quantity-display';
type Rec=Record<string,any>;
const props=defineProps<{lines:Rec[];logical:Rec[];items:Rec[];user:Rec}>();
const emit=defineEmits<{(e:'add-group'):void;(e:'submitted',result:Rec):void}>();
const mainTable=ref<{clearSelection:()=>void}>();
const rows=ref<Rec[]>([]),sources=ref<Rec[]>([]),draft=ref<Rec|null>(null),drafts=ref<Rec[]>([]),deleted=ref<Rec[]>([]),lastResult=ref<Rec|null>(null);
const busy=ref(false),progress=ref(''),error=ref(''),dirty=ref(false),checked=ref(false),filter=ref('all'),search=ref(''),page=ref(1),pageSize=ref(100),selectedKeys=ref<string[]>([]);
const batchKey=ref(newClientId()),validationToken=ref(''),importFile=ref<Rec|null>(null);
const templateOpen=ref(false),importOpen=ref(false),draftOpen=ref(false),sourceOpen=ref(false),editOpen=ref(false),bulkOpen=ref(false),historyOpen=ref(false);
const upload=ref<File|null>(null),layout=ref<Rec|null>(null),mapping=reactive<Rec>({}),importOptions=reactive<Rec>({sheet:'需求明细',header_row:1,common:{}});
const mappingEditingId=ref('');
const mappingName=ref(''),savedMappings=ref<Rec[]>([]);
const template=reactive<Rec>({line_ids:[],operation_ids:[],include_positions:false,location_kind:'',blank_rows:1,quantity:'',target_object:'',completion_standard:'',problem_description:''});
const editor=reactive<Rec>({}),editingKey=ref(''),bulk=reactive<Rec>({field:'completion_standard',value:'',only_empty:true});
const sourceEditor=reactive<Rec>({}),sourceEditIndex=ref(-1),sourceEditOpen=ref(false),versionAcknowledged=ref(false);
const clone=(v:any)=>JSON.parse(JSON.stringify(v));
const options=(type:string)=>props.items.filter(x=>x.type_id===type&&x.status==='active');
const activeLines=computed(()=>props.lines.filter(l=>l.status==='active'&&l.setup_status==='ready'));
const editorTowers=computed(()=>props.logical.filter(t=>t.line_id===editor.line_id&&t.status==='active'));
const editorOperationDefinition=computed(()=>readOperationDefinition(props.items.find(i=>i.id===editor.operation_id),props.items));
const templateOperationDefinitions=computed(()=>template.operation_ids.map((id:string)=>readOperationDefinition(props.items.find(i=>i.id===id),props.items)).filter(Boolean));
const templateObjectLabel=computed(()=>[...new Set(templateOperationDefinitions.value.map((d:Rec)=>d.target_label))].join('；'));
const templateUnitLabel=computed(()=>[...new Set(templateOperationDefinitions.value.map((d:Rec)=>d.unit_name))].join('；'));
const templateLocationKinds=computed<string[]>(()=>templateOperationDefinitions.value.length?['tower','span'].filter(k=>templateOperationDefinitions.value.every((d:Rec)=>d.location_kinds.includes(k))):[]);
watch(()=>template.operation_ids.slice(),()=>{const defs=templateOperationDefinitions.value;if(defs.length===1)template.location_kind=defs[0].default_location_kind;else if(templateLocationKinds.value.length===1)template.location_kind=templateLocationKinds.value[0];else if(!templateLocationKinds.value.includes(template.location_kind))template.location_kind='';if(!template.location_kind)template.include_positions=false});
async function chooseEditorPosition(kind:string){
 if(!editorOperationDefinition.value?.location_kinds.includes(kind)||kind===editor.location_kind)return;
 try{await ElMessageBox.confirm('切换作业位置会清空本条已选杆塔和档距，请重新选择。','切换作业位置',{confirmButtonText:'切换并重新选择',cancelButtonText:'保留当前位置'})}catch{return}
 Object.assign(editor,{location_kind:kind,logical_tower_id:'',tower_no:'',end_tower_no:'',span_id:'',span_version:undefined,location_token:''});
}
async function chooseEditorOperation(id:string){
 const operation=props.items.find(i=>i.id===id),definition=readOperationDefinition(operation,props.items);if(!definition)return;
 const fields:Rec[]=JSON.parse(operation?.fields_json||'[]');
 const removedFields=Object.keys(editor.custom_fields||{}).some(k=>!fields.some(f=>f.key===k));
 const incompatible=!definition.location_kinds.includes(editor.location_kind);
 const changed=editor.operation_id!==id,unitChanged=editor.unit_id&&editor.unit_id!==definition.unit_id||editor.unit_name&&editor.unit_name!==definition.unit_name;
 if(removedFields||incompatible||unitChanged||changed&&(Object.keys(editor.custom_fields||{}).length||editor.related_logical_ids?.length)){try{await ElMessageBox.confirm('单位和作业对象按所选操作重新确定，数量不自动换算。切换不同操作会清除不适用的附加字段与受影响位置，模板已移除的字段也会清除，请核对工作量。','按操作定义重新核对',{confirmButtonText:'采用并重新核对',cancelButtonText:'保留原内容'})}catch{return}}
 if(incompatible)Object.assign(editor,{location_kind:definition.default_location_kind,logical_tower_id:'',tower_no:'',end_tower_no:'',span_id:'',span_version:undefined,location_token:''});
 if(!editor.target_object)editor.target_object=definition.default_target_object;
 if(!editor.completion_standard)editor.completion_standard=operation?.completion_standard||'';
 const custom=Object.fromEntries(fields.filter(f=>!changed&&editor.custom_fields?.[f.key]!==undefined||f.default!==undefined).map(f=>[f.key,!changed&&editor.custom_fields?.[f.key]!==undefined?editor.custom_fields[f.key]:f.default]));
 editor.custom_fields=custom;
 Object.assign(editor,{operation_id:id,unit_id:definition.unit_id,unit_name:definition.unit_name,work_target_type:definition.work_target_type,...(changed?{related_logical_ids:[]}:{})});
}
const editorFields=computed(()=>{try{return JSON.parse(props.items.find(i=>i.id===editor.operation_id)?.fields_json||'[]')}catch{return []}});
const editorRelated=computed(()=>{const tower=props.logical.find(t=>t.id===editor.logical_tower_id);return tower?props.logical.filter(t=>t.physical_tower_id===tower.physical_tower_id&&t.status==='active'):[]});
const summary=computed(()=>{const included=rows.value.filter(r=>!r.excluded);return {total:rows.value.length,included:included.length,invalid:included.filter(r=>r.issues?.length).length,duplicates:included.filter(r=>r.candidates?.length).length,excluded:rows.value.length-included.length}});
const filtered=computed(()=>rows.value.filter(r=>(!search.value||[r.row_key,r.line_name,r.tower_no,r.operation_name,r.target_object].join(' ').toLowerCase().includes(search.value.toLowerCase()))&&(filter.value==='all'||filter.value==='invalid'&&r.issues?.length||filter.value==='duplicate'&&r.candidates?.length||filter.value==='excluded'&&r.excluded)));
const visibleRows=computed(()=>filtered.value.slice((page.value-1)*pageSize.value,page.value*pageSize.value));
const quantityTotals=computed(()=>{const totals=new Map<string,bigint>();for(const r of rows.value.filter(r=>!r.excluded)){const q=quantityScaled(r.quantity);if(q===null)continue;const key=(r.operation_name||'未选作业')+'／'+(r.unit_name||'未选单位');totals.set(key,(totals.get(key)??0n)+q)}return [...totals].map(([name,q])=>name+' '+displayScaledQuantity(q))});
watch([filter,search,pageSize],()=>{page.value=1});
watch(()=>editor.line_id,(v,old)=>{if(editOpen.value&&old&&v!==old){editor.logical_tower_id='';editor.span_id='';editor.tower_no='';editor.location_token=''}});
function markDirty(){dirty.value=true;checked.value=false;validationToken.value='';lastResult.value=null}
function payload(){return {rows:clone(rows.value),sources:clone(sources.value),import_file:importFile.value,idempotency_key:batchKey.value,...(draft.value?{draft_id:draft.value.id,draft_version:draft.value.version}:{})}}
async function task(fn:()=>Promise<void>){if(busy.value)return;busy.value=true;error.value='';try{await fn()}catch(e:any){if(e!=='cancel'&&e!=='close')error.value=e.message||'操作失败'}finally{busy.value=false;progress.value=''}}
function unlockReferences(row:Rec){delete row.location_token;delete row.dictionary_token;delete row.duplicate_review}
async function check(){
 progress.value='正在检查全部 '+rows.value.length+' 条需求及其来源…';
 // Yield once so the progress indicator paints before sending the full batch.
 await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
 const result=await requestApi('/demand-batches/preview','POST',payload());
 rows.value=result.rows;sources.value=result.sources;validationToken.value=result.validation_token;checked.value=true;return result;
}
async function precheck(){await task(async()=>{await check();ElMessage.success('已完成全部 '+rows.value.length+' 条需求检查')})}
async function saveDraft(){await task(async()=>{
 const body=payload();draft.value=draft.value?await requestApi('/demand-batches/'+draft.value.id,'PATCH',{version:draft.value.version,draft:body}):await requestApi('/demand-batches/drafts','POST',body);
 dirty.value=false;await loadDrafts();ElMessage.success('草稿已保存');
})}
async function loadDrafts(){drafts.value=await requestApi('/demand-batches?status=draft')}
async function restore(item:Rec){await task(async()=>{
 if(dirty.value)await ElMessageBox.confirm('当前有未保存的录入内容。切换草稿将替换当前清单。','切换草稿',{confirmButtonText:'替换当前清单',cancelButtonText:'继续编辑'});
 const saved=await requestApi('/demand-batches/'+item.id),body=JSON.parse(saved.draft_json);
 sources.value=(body.sources||(body.source?[body.source]:[])).map((s:Rec,i:number)=>({...s,source_key:s.source_key||'LY'+String(i+1).padStart(3,'0')}));
 const {rows:savedRows,sources:_sources,source:_source,...common}=body;
 rows.value=(savedRows||[]).map((r:Rec,i:number)=>({...common,...r,row_key:r.row_key||'MX'+String(i+1).padStart(4,'0'),source_keys:r.source_keys||sources.value.map(s=>s.source_key),custom_fields:{...common.custom_fields,...r.custom_fields}}));
 mainTable.value?.clearSelection();selectedKeys.value=[];draft.value=saved;importFile.value=body.import_file||null;batchKey.value=body.idempotency_key||newClientId();lastResult.value=null;dirty.value=false;checked.value=false;draftOpen.value=false;page.value=1;filter.value='all';
 await check();ElMessage.success('已恢复草稿；请核对当前台账和配置');
})}
async function deleteSavedDraft(item:Rec){await task(async()=>{
 const {value}=await ElMessageBox.prompt('删除后从草稿列表移除，原内容及依据保留在删除历史中。请输入删除依据。','删除草稿',{inputValidator:v=>!!v?.trim()||'请填写删除依据'});
 await requestApi('/demand-batches/'+item.id,'DELETE',{version:item.version,reason:value});if(draft.value?.id===item.id){draft.value=null;dirty.value=true}await loadDrafts();ElMessage.success('草稿已删除，可查询删除历史');
})}
async function showDeleted(){await task(async()=>{deleted.value=await requestApi('/demand-batches?status=deleted');historyOpen.value=true})}
function draftTitle(item:Rec){try{const body=JSON.parse(item.draft_json);return (body.import_file?.filename||'在线录入')+' · '+(body.rows?.length||0)+' 条'}catch{return '需求草稿'}}
async function addGroup(body:Rec,allowIncomplete=false){
 const groupRows=body.rows.length?body.rows:allowIncomplete?[{}]:[];
 if(rows.value.length+groupRows.length>5000){error.value='本批最多5000条需求，请先提交或另存当前批次';return false}
 if(!groupRows.length){error.value='请至少选择一个位置';return false}
 if(lastResult.value){error.value='当前批次已提交，请先新建批次';return false}
 const groupId=newClientId().slice(0,8),inputSources=body.sources||[body.source];
 const groupSources=inputSources.map((s:Rec,i:number)=>({...s,source_key:'LY-'+groupId+'-'+(i+1)}));
 const next=groupRows.map((r:Rec)=>{
  const tower=props.logical.find(t=>t.id===r.logical_tower_id),line=props.lines.find(l=>l.id===tower?.line_id);
  const value={...clone(body),...clone(r),row_key:'MX-'+newClientId(),source_keys:groupSources.map((s:Rec)=>s.source_key),line_id:line?.id||'',line_name:line?.name||'',tower_no:tower?.tower_no||'',custom_fields:{...body.custom_fields,...r.custom_fields}};
  delete value.rows;delete value.sources;delete value.source;delete value.idempotency_key;return value;
 });
 rows.value.push(...next);sources.value.push(...groupSources);markDirty();await precheck();return true;
}
async function submit(){await task(async()=>{
 if(lastResult.value)return;
 const result=await check();
 if(result.issues.length){filter.value='invalid';throw Error('还有 '+summary.value.invalid+' 条需求或来源未完善，请修正或明确排除后提交')}
 if(!summary.value.included)throw Error('至少纳入一条需求');
 const unresolved=rows.value.filter(r=>!r.excluded&&r.candidates?.length&&(!r.duplicate_review?.decision||!r.duplicate_review?.reason?.trim()||!r.duplicate_review?.candidate_id));
 if(unresolved.length){filter.value='duplicate';throw Error('还有 '+unresolved.length+' 条疑似重复需求，请打开编辑并填写处理方式及依据')}
 const links=rows.value.filter(r=>!r.excluded&&r.duplicate_review?.decision==='link').length;
 await ElMessageBox.confirm('本次新建 '+(summary.value.included-links)+' 条待核实需求，关联已有需求来源 '+links+' 条，排除 '+summary.value.excluded+' 条。提交后仍需按原流程核实。','确认提交本批需求',{confirmButtonText:'确认提交核实',cancelButtonText:'返回核对',type:'info'});
 progress.value='正在一次事务提交 '+summary.value.included+' 条需求，请勿重复操作…';
 const response=await requestApi('/demand-batches/submit','POST',{...payload(),validation_token:validationToken.value});
 lastResult.value=response;dirty.value=false;draft.value=null;await loadDrafts();ElMessage.success('新建 '+response.count+' 条待核实需求，关联已有需求 '+response.linked_ids.length+' 条');emit('submitted',response);
})}
async function newBatch(){
 if(dirty.value){try{await ElMessageBox.confirm('当前内容尚未保存，是否放弃并新建批次？','新建批次',{confirmButtonText:'放弃并新建',cancelButtonText:'继续编辑'})}catch{return}}
 mainTable.value?.clearSelection();rows.value=[];sources.value=[];draft.value=null;lastResult.value=null;importFile.value=null;batchKey.value=newClientId();checked.value=false;dirty.value=false;selectedKeys.value=[];page.value=1;filter.value='all';search.value='';
}
function excludeRows(keys:string[],excluded:boolean){for(const r of rows.value)if(keys.includes(r.row_key))r.excluded=excluded;markDirty()}
function editRow(row:Rec){Object.keys(editor).forEach(k=>delete editor[k]);Object.assign(editor,clone(row));editingKey.value=row.row_key;versionAcknowledged.value=false;editOpen.value=true}
function editorError(field:string){return (editor.issues||[]).filter((i:Rec)=>i.field===field).map((i:Rec)=>i.message).join('；')}
async function commitRow(){await task(async()=>{
 const index=rows.value.findIndex(r=>r.row_key===editingKey.value),next=clone(editor);
 if((next.issues||[]).some((i:Rec)=>['位置','字典版本'].includes(i.field))&&!versionAcknowledged.value)throw Error('请确认已按当前台账和配置重新核对本条需求');
 const tower=props.logical.find(t=>t.id===next.logical_tower_id);if(tower){next.line_id=tower.line_id;next.tower_no=tower.tower_no;next.line_name=props.lines.find(l=>l.id===tower.line_id)?.name}
 next.parse_errors=[];delete next.location_token;delete next.dictionary_token;rows.value[index]=next;markDirty();const result=await check();Object.assign(editor,clone(rows.value[index]));
 if(result.rows[index].issues.length)throw Error('本条仍有字段问题，请查看字段附近提示');editOpen.value=false;
})}
async function applyBulk(){await task(async()=>{
 if(!selectedKeys.value.length)throw Error('请先勾选需要修改的需求');
 for(const row of rows.value)if(selectedKeys.value.includes(row.row_key)&&(!bulk.only_empty||!row[bulk.field]||Array.isArray(row[bulk.field])&&!row[bulk.field].length)){
  row[bulk.field]=bulk.field==='source_keys'?String(bulk.value).split(/[;；]/).map(s=>s.trim()).filter(Boolean):bulk.value;
  unlockReferences(row);
 }
 markDirty();await check();bulkOpen.value=false;ElMessage.success('已按勾选范围修改，逐行检查结果已更新');
})}
function openSourceEditor(index=-1){Object.keys(sourceEditor).forEach(k=>delete sourceEditor[k]);Object.assign(sourceEditor,index<0?{source_key:'LY-'+newClientId().slice(0,8),type_id:'',discovered_on:'',proposed_by:'',external_ref:'',description:''}:clone(sources.value[index]));sourceEditIndex.value=index;sourceEditOpen.value=true}
async function commitSource(){await task(async()=>{
 const next=clone(sourceEditor);next.parse_errors=[];
 if(!next.source_key?.trim())throw Error('来源编号不能为空');
 if(sources.value.some((s,i)=>s.source_key===next.source_key&&i!==sourceEditIndex.value))throw Error('来源编号重复');
 if(sourceEditIndex.value>=0){const old=sources.value[sourceEditIndex.value].source_key;for(const row of rows.value){row.source_keys=(row.source_keys||[]).map((k:string)=>k===old?next.source_key:k);delete row.dictionary_token}sources.value[sourceEditIndex.value]=next}else{sources.value.push(next);sourceEditIndex.value=sources.value.length-1}
 markDirty();await check();Object.assign(sourceEditor,clone(sources.value[sourceEditIndex.value<0?sources.value.length-1:sourceEditIndex.value]));
 if(sourceEditor.issues?.length)throw Error('来源信息仍有问题，请查看字段提示');sourceEditOpen.value=false;
})}
async function removeSource(index:number){await task(async()=>{
 const s=sources.value[index],affected=rows.value.filter(r=>r.source_keys?.includes(s.source_key));
 await ElMessageBox.confirm('该来源被本批 '+affected.length+' 条需求引用。删除后保留各需求，缺少来源的行须补齐后提交。','删除未提交来源',{confirmButtonText:'删除来源',cancelButtonText:'取消'});
 sources.value.splice(index,1);for(const r of affected){r.source_keys=r.source_keys.filter((k:string)=>k!==s.source_key);delete r.dictionary_token}markDirty();await check();
})}
async function binary(path:string,body:BodyInit,headers:Record<string,string>={}){
 const response=await fetch('/api'+path,{method:'POST',credentials:'same-origin',headers,body});if(!response.ok){const d=await response.json();throw Error(d.error||'文件处理失败')}return response;
}
function download(blob:Blob,name:string){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
async function downloadTemplate(){await task(async()=>{const response=await binary('/demand-import/template',JSON.stringify({...template,sources:template.source_type_id?[{source_key:'LY001',type_id:template.source_type_id,discovered_on:template.discovered_on,proposed_by:template.proposed_by}]:undefined}),{'Content-Type':'application/json'});download(await response.blob(),'需求导入模板.xlsx');templateOpen.value=false})}
async function downloadResult(){await task(async()=>{const response=await fetch('/api/demand-batches/'+lastResult.value?.batch_id+'/result.xlsx',{credentials:'same-origin'});if(!response.ok)throw Error('提交结果下载失败');download(await response.blob(),'需求提交结果.xlsx')})}
async function downloadProblems(){await task(async()=>{const response=await binary('/demand-import/problems',JSON.stringify(payload()),{'Content-Type':'application/json'});download(await response.blob(),'需求核对问题.xlsx')})}
function mappingStore(){try{localStorage.setItem('sd-demand-import-mappings:'+props.user.id,JSON.stringify(savedMappings.value))}catch{ElMessage.warning('当前浏览器未能保存个人映射')}}
function saveMapping(){if(!mappingName.value.trim())return;const item={id:mappingEditingId.value||newClientId(),name:mappingName.value.trim(),mapping:clone(mapping),sheet:importOptions.sheet,header_row:importOptions.header_row};const at=savedMappings.value.findIndex(m=>m.id===item.id);if(at<0)savedMappings.value.push(item);else savedMappings.value[at]=item;mappingEditingId.value=item.id;mappingStore();ElMessage.success('个人映射已保存')}
function applyMapping(id:string){const saved=savedMappings.value.find(m=>m.id===id);if(saved){Object.keys(mapping).forEach(k=>delete mapping[k]);Object.assign(mapping,saved.mapping);importOptions.sheet=saved.sheet;importOptions.header_row=saved.header_row;mappingEditingId.value=saved.id;mappingName.value=saved.name;void refreshHeaders()}}
function removeMapping(id:string){if(mappingEditingId.value===id){mappingEditingId.value='';mappingName.value=''}savedMappings.value=savedMappings.value.filter(m=>m.id!==id);mappingStore()}
async function refreshHeaders(){if(!upload.value)return;await task(async()=>{layout.value=await(await binary('/demand-import/layout?header_row='+encodeURIComponent(importOptions.header_row),upload.value!,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})).json()})}
async function selectedFile(file:Rec){await task(async()=>{
 upload.value=file.raw;if(!upload.value)return;if(!/\.xlsx$/i.test(upload.value.name))throw Error('请选择 .xlsx 文件');if(upload.value.size>15*1024*1024)throw Error('文件不能超过15MB');
 layout.value=await(await binary('/demand-import/layout',upload.value,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})).json();
 importOptions.sheet=layout.value?.sheets.some((s:Rec)=>s.name==='需求明细')?'需求明细':layout.value?.sheets.find((s:Rec)=>!['填写说明','来源依据','可选项','杆塔参考'].includes(s.name))?.name;
 Object.keys(mapping).forEach(k=>delete mapping[k]);
})}
async function parseFile(){await task(async()=>{
 if(!upload.value)throw Error('请先选择文件');if(lastResult.value)throw Error('本批已提交，请先新建批次');
 progress.value='正在解析并校验文件中的全部需求…';
 const common={...importOptions.common},form=new FormData();form.set('file',upload.value);form.set('options',JSON.stringify({...importOptions,common,mapping,idempotency_key:batchKey.value,sources:sources.value}));
 const response=await binary('/demand-import/parse',form);
 const result=await response.json();
 if(rows.value.length){
  const incoming=new Set(result.rows.map((r:Rec)=>r.row_key)),existing=new Set(rows.value.map(r=>r.row_key));
  const overlap=result.rows.filter((r:Rec)=>existing.has(r.row_key)).length,missing=rows.value.filter(r=>!incoming.has(r.row_key)).length;
  const merged=rows.value.length+result.rows.length-overlap;if(merged>5000)throw Error('合并后超过5000条，请另建批次');
  await ElMessageBox.confirm('本次更新 '+overlap+' 条同编号明细，追加 '+(result.rows.length-overlap)+' 条；原清单中未出现的 '+missing+' 条将保留。同来源编号的内容将更新并影响引用行。','核对重传影响',{confirmButtonText:'确认合并到当前草稿',cancelButtonText:'返回核对'});
  const next=new Map(rows.value.map(r=>[r.row_key,r]));for(const r of result.rows)next.set(r.row_key,r);rows.value=[...next.values()];
  const nextSources=new Map(sources.value.map(s=>[s.source_key,s]));for(const s of result.sources)nextSources.set(s.source_key,s);sources.value=[...nextSources.values()];
 }else{rows.value=result.rows;sources.value=result.sources}
 importFile.value=result.import_file;markDirty();await check();importOpen.value=false;filter.value=summary.value.invalid?'invalid':'all';ElMessage.success('已载入 '+result.rows.length+' 条需求，尚未正式提交');
})}
function beforeUnload(e:BeforeUnloadEvent){if(dirty.value){e.preventDefault();e.returnValue=''}}
onMounted(()=>{void loadDrafts();try{savedMappings.value=JSON.parse(localStorage.getItem('sd-demand-import-mappings:'+props.user.id)||'[]')}catch{savedMappings.value=[]}window.addEventListener('beforeunload',beforeUnload)});
onBeforeUnmount(()=>window.removeEventListener('beforeunload',beforeUnload));
defineExpose({addGroup,saveDraft,isDirty:dirty});
</script>

<template>
 <section class="panel demand-batch-workspace" aria-label="需求批次清单">
  <div class="batch-heading"><div><h2>{{draft?'正在编辑草稿':'需求批次清单'}}</h2><p class="muted">在线添加与 Excel 导入统一核对；每批最多 5000 条，提交后进入待核实。</p></div><div class="batch-actions"><ElButton @click="emit('add-group')" :disabled="busy||!!lastResult" type="primary">添加一组需求</ElButton><ElButton @click="importOpen=true" :disabled="busy||!!lastResult">Excel 导入</ElButton><ElButton @click="templateOpen=true" :disabled="busy">下载模板</ElButton><ElButton @click="draftOpen=true;loadDrafts()">查看草稿（{{drafts.length}}）</ElButton></div></div>
  <ElAlert v-if="error" :title="error" type="error" show-icon :closable="false" class="batch-alert"/>
  <div v-if="busy" role="status" class="batch-progress"><ElProgress :percentage="100" :indeterminate="true" :duration="2" :show-text="false"/><span>{{progress||'正在处理，请稍候…'}}</span></div>
  <ElAlert v-if="lastResult" type="success" :closable="false" :title="'本批已提交：新建 '+lastResult.count+' 条待核实需求，关联已有需求 '+lastResult.linked_ids.length+' 条。可在需求中心查询。'"/>
  <ElButton v-if="lastResult" @click="downloadResult">下载提交结果</ElButton>
  <div class="batch-summary"><ElTag effect="plain">共 {{summary.total}} 条</ElTag><ElTag effect="plain">纳入 {{summary.included}} 条</ElTag><ElTag :type="summary.invalid?'danger':'info'">待完善 {{summary.invalid}} 条</ElTag><ElTag type="warning">疑似重复 {{summary.duplicates}} 条</ElTag><ElTag type="info">排除 {{summary.excluded}} 条</ElTag><span v-if="!checked&&rows.length" class="muted">内容有变动，请重新检查</span></div>
  <div class="batch-toolbar"><ElSelect v-model="filter" aria-label="检查结果筛选"><ElOption label="全部明细" value="all"/><ElOption label="待完善" value="invalid"/><ElOption label="疑似重复" value="duplicate"/><ElOption label="已排除" value="excluded"/></ElSelect><ElInput v-model="search" aria-label="搜索本批需求" placeholder="编号、线路、杆塔、作业、部位" clearable/><ElButton @click="sourceOpen=true">来源依据（{{sources.length}}）</ElButton><ElButton @click="precheck" :disabled="busy||!rows.length||!!lastResult">检查全部需求</ElButton><ElButton @click="downloadProblems" :disabled="busy||!rows.length">下载问题文件</ElButton></div>
  <div class="batch-selected">已选 {{selectedKeys.length}} 条 <ElButton @click="bulkOpen=true" :disabled="busy||!selectedKeys.length||!!lastResult">批量修改</ElButton><ElButton @click="excludeRows(selectedKeys,true)" :disabled="busy||!selectedKeys.length||!!lastResult">排除所选</ElButton><ElButton @click="excludeRows(selectedKeys,false)" :disabled="busy||!selectedKeys.length||!!lastResult">重新纳入所选</ElButton><span class="muted">勾选仅用于批量操作；提交范围为全部未排除行。</span></div>
  <ElTable ref="mainTable" :data="visibleRows" row-key="row_key" border @selection-change="(selection:Rec[])=>selectedKeys=selection.map(r=>r.row_key)" :max-height="560">
   <ElTableColumn type="selection" width="48" :reserve-selection="true"/>
   <ElTableColumn label="明细编号" prop="row_key" width="140" show-overflow-tooltip/>
   <ElTableColumn label="线路及位置" min-width="220"><template #default="{row}"><strong>{{row.tower_no||'未匹配位置'}}{{row.location_kind==='span'?'—'+row.end_tower_no:''}}</strong><p>{{row.line_name||'未匹配线路'}}</p><small v-if="row.sheet_row">{{row.sheet||'需求明细'}} 第 {{row.sheet_row}} 行</small><p v-if="row.issues?.length" class="batch-mobile-issue field-error">{{row.issues[0].field}}：{{row.issues[0].message}}</p></template></ElTableColumn>
   <ElTableColumn label="作业及部位" min-width="210"><template #default="{row}"><strong>{{row.operation_name||'未选操作'}}</strong><p>{{row.target_object||'未填部位'}}</p></template></ElTableColumn>
   <ElTableColumn label="本条工作量" min-width="130"><template #default="{row}">{{row.quantity||'未填写'}} {{row.unit_name}}</template></ElTableColumn>
   <ElTableColumn label="来源" min-width="130"><template #default="{row}">{{row.source_keys?.join('；')||'未引用来源'}}</template></ElTableColumn>
   <ElTableColumn label="检查结果" min-width="250"><template #default="{row}"><ElTag v-if="row.excluded" type="info">已排除</ElTag><template v-else><p v-for="(issue,i) in row.issues||[]" :key="i" class="field-error">{{issue.field}}：{{issue.message}}</p><ElTag v-if="row.candidates?.length" type="warning">疑似重复 {{row.candidates.length}} 条</ElTag><ElTag v-if="checked&&!row.issues?.length&&!row.candidates?.length" type="success">录入检查通过</ElTag></template></template></ElTableColumn>
   <ElTableColumn label="操作" fixed="right" width="145"><template #default="{row}"><ElButton link type="primary" @click="editRow(row)" :disabled="busy||!!lastResult">编辑</ElButton><ElButton link @click="excludeRows([row.row_key],!row.excluded)" :disabled="busy||!!lastResult">{{row.excluded?'纳入':'排除'}}</ElButton></template></ElTableColumn>
   <template #empty><p>点击“添加一组需求”，或导入已填写的 Excel。</p></template>
  </ElTable>
  <div class="batch-pagination"><ElPagination v-model:current-page="page" v-model:page-size="pageSize" :page-sizes="[50,100,200]" :total="filtered.length" layout="prev, pager, next, sizes, total"/></div>
  <p class="muted batch-totals" v-if="quantityTotals.length">按作业和单位汇总：{{quantityTotals.join('；')}}</p>
  <div class="batch-footer"><span>{{dirty?'有未保存的修改':draft?'草稿已保存':'录入内容不等于已核实需求'}}</span><div class="batch-actions"><ElButton @click="newBatch" :disabled="busy">新建批次</ElButton><ElButton @click="saveDraft" :disabled="busy||!rows.length||!!lastResult">保存草稿</ElButton><ElButton type="primary" @click="submit" :disabled="busy||!summary.included||!!lastResult">提交 {{summary.included}} 条核实</ElButton></div></div>
 </section>

 <ElDialog v-model="templateOpen" title="下载需求导入模板" width="900px" class="business-modal" :close-on-click-modal="false">
  <ElForm novalidate label-position="top" class="batch-form-grid">
   <ElFormItem label="涉及线路"><ElSelect v-model="template.line_ids" multiple filterable placeholder="选择线路，可带入已有位置"><ElOption v-for="l in activeLines" :key="l.id" :value="l.id" :label="l.voltage_name+' · '+l.name"/></ElSelect></ElFormItem>
   <ElFormItem label="涉及操作"><ElSelect v-model="template.operation_ids" multiple filterable placeholder="不选则包含全部操作字段"><ElOption v-for="op in options('operation')" :key="op.id" :value="op.id" :label="op.name" :disabled="!readOperationDefinition(op,items)"/></ElSelect></ElFormItem>
   <ElFormItem label="作业位置（由操作范围确定）"><ElSelect v-model="template.location_kind" clearable :disabled="templateLocationKinds.length<=1" placeholder="逐行按操作确定；带入位置需选择同类操作"><ElOption v-for="kind in templateLocationKinds" :key="kind" :value="kind" :label="kind==='tower'?'杆塔':'档距'"/></ElSelect></ElFormItem>
   <ElFormItem label="作业对象（由操作确定）"><ElInput :model-value="templateObjectLabel" readonly placeholder="选择操作类型后自动确定"/></ElFormItem><ElFormItem label="计量单位（由操作确定）"><ElInput :model-value="templateUnitLabel" readonly placeholder="选择操作类型后自动确定"/></ElFormItem>
   <ElFormItem label="位置预填"><ElCheckbox v-model="template.include_positions" :disabled="!template.location_kind">带入所选线路全部有效位置（最多5000个）</ElCheckbox></ElFormItem>
   <ElFormItem label="空白明细行数"><ElInput v-model="template.blank_rows" :disabled="template.include_positions" placeholder="1至5000"/></ElFormItem>
   <ElFormItem label="每条默认工作量"><ElInput v-model="template.quantity" placeholder="留空则逐条填写，不是整批总量"/></ElFormItem>
   <ElFormItem label="共同处理部位"><ElInput v-model="template.target_object"/></ElFormItem>
   <ElFormItem label="共同完成标准"><ElInput v-model="template.completion_standard" placeholder="留空可带入操作已配置标准"/></ElFormItem>
   <ElFormItem label="共同问题说明"><ElInput v-model="template.problem_description" type="textarea"/></ElFormItem>
   <ElFormItem label="共同来源类型"><ElSelect v-model="template.source_type_id" clearable><ElOption v-for="s in options('source')" :key="s.id" :value="s.id" :label="s.name"/></ElSelect></ElFormItem>
   <ElFormItem label="来源发现日期"><ElDatePicker v-model="template.discovered_on" type="date" value-format="YYYY-MM-DD"/></ElFormItem>
   <ElFormItem label="提出单位／人员"><ElInput v-model="template.proposed_by"/></ElFormItem>
  </ElForm><p class="muted">模板包含需求明细、来源依据、填写说明、有效选项和所选线路杆塔参考。预填内容仍需逐条核对。</p>
  <template #footer><ElButton @click="templateOpen=false">取消</ElButton><ElButton type="primary" @click="downloadTemplate" :loading="busy">生成并下载</ElButton></template>
 </ElDialog>
 <ElDialog v-model="importOpen" title="Excel 导入需求" width="1000px" class="business-modal" :close-on-click-modal="false">
  <ElAlert title="文件仅进入当前待提交清单，不自动建立台账或核实需求。重传会先展示合并影响。" type="info" :closable="false"/>
  <ElUpload :auto-upload="false" :show-file-list="false" accept=".xlsx" :on-change="selectedFile"><ElButton :disabled="busy">选择 .xlsx 文件（最多15MB）</ElButton></ElUpload><p>{{upload?.name||'尚未选择文件'}}</p>
  <ElForm novalidate v-if="layout" label-position="top" class="batch-form-grid">
   <ElFormItem label="需求工作表"><ElSelect v-model="importOptions.sheet"><ElOption v-for="s in layout.sheets" :key="s.name" :value="s.name" :label="s.name+'（'+s.rows+'行）'"/></ElSelect></ElFormItem>
   <ElFormItem label="标题所在行"><ElInput v-model="importOptions.header_row" placeholder="标准模板为1" @change="refreshHeaders"/></ElFormItem>
   <ElFormItem label="套用个人列映射"><ElSelect placeholder="选择已保存的映射" @change="applyMapping"><ElOption v-for="m in savedMappings" :key="m.id" :value="m.id" :label="m.name"/></ElSelect></ElFormItem>
   <ElFormItem label="保存当前映射"><ElInput v-model="mappingName" placeholder="例如：班组月度需求表"/><ElButton @click="saveMapping">{{mappingEditingId?'更新此映射':'保存为新映射'}}</ElButton><ElButton v-if="mappingEditingId" @click="mappingEditingId='';mappingName=''">另存为新映射</ElButton></ElFormItem>
  </ElForm>
  <ElTable v-if="layout" :data="layout.sheets.find((s:Rec)=>s.name===importOptions.sheet)?.headers||[]" max-height="230"><ElTableColumn prop="title" label="原列名" min-width="160"/><ElTableColumn label="对应系统字段" min-width="200"><template #default="{row}"><ElSelect v-model="mapping[row.column]" filterable clearable placeholder="留空自动识别标准列名"><ElOption v-for="f in layout.fields" :key="f.key" :value="f.key" :label="f.label"/></ElSelect></template></ElTableColumn></ElTable>
  <ElForm novalidate v-if="layout" label-position="top" class="batch-form-grid">
   <p class="muted batch-wide">作业位置、对象和单位按每行操作确定；已有填写发生冲突时须修正，不能用统一补值覆盖。</p>

   <ElFormItem label="缺少操作时统一填入"><ElSelect v-model="importOptions.common.operation_id" filterable clearable><ElOption v-for="op in options('operation')" :key="op.id" :value="op.id" :label="op.name"/></ElSelect></ElFormItem>

   <ElFormItem label="缺少完成标准时统一填入"><ElInput v-model="importOptions.common.completion_standard"/></ElFormItem>
   <ElFormItem label="缺少问题说明时统一填入"><ElInput v-model="importOptions.common.problem_description"/></ElFormItem>
   <ElFormItem label="缺少来源编号时统一填入"><ElInput v-model="importOptions.common.source_refs" placeholder="引用来源表或本批来源，例如 LY001;LY002"/></ElFormItem>
  </ElForm>
  <p v-for="m in savedMappings" :key="m.id">{{m.name}} <ElButton link @click="removeMapping(m.id)">删除个人映射</ElButton></p>
  <ElAlert v-if="error" :title="error" type="error" :closable="false"/>
  <template #footer><ElButton @click="importOpen=false" :disabled="busy">取消</ElButton><ElButton type="primary" @click="parseFile" :loading="busy" :disabled="!upload">解析并加入核对清单</ElButton></template>
 </ElDialog>
 <ElDialog v-model="editOpen" :title="'编辑需求 '+editingKey" width="1000px" class="business-modal" :close-on-click-modal="false">
  <ElForm novalidate :model="editor" label-position="top" class="batch-form-grid" :disabled="busy">
   <ElFormItem label="操作类型" required :error="editorError('操作类型')"><ElSelect :model-value="editor.operation_id" filterable @update:model-value="chooseEditorOperation"><ElOption v-for="op in options('operation')" :key="op.id" :value="op.id" :label="op.name" :disabled="!readOperationDefinition(op,items)"/></ElSelect></ElFormItem>
   <p v-if="editorOperationDefinition?.entry_hint" class="muted batch-wide">{{editorOperationDefinition.entry_hint}}</p>
   <ElFormItem label="线路" required :error="editorError('线路名称')"><ElSelect v-model="editor.line_id" filterable><ElOption v-for="l in activeLines" :key="l.id" :value="l.id" :label="l.voltage_name+' · '+l.name"/></ElSelect></ElFormItem>
   <ElFormItem label="作业位置" required :error="editorError('作业位置')"><ElInput v-if="!editorOperationDefinition||editorOperationDefinition.location_kinds.length===1" :model-value="editorOperationDefinition?(editor.location_kind==='span'?'档距':'杆塔'):''" readonly placeholder="先选择操作类型"/><ElSelect v-else :model-value="editor.location_kind" @update:model-value="chooseEditorPosition"><ElOption v-for="kind in editorOperationDefinition.location_kinds" :key="kind" :label="kind==='tower'?'杆塔':'档距'" :value="kind"/></ElSelect></ElFormItem>
   <ElFormItem :label="editor.location_kind==='span'?'档距起点':'杆塔编号'" required :error="editorError('位置')||editorError('杆塔／档距起点编号')"><ElSelect v-model="editor.logical_tower_id" filterable @change="editor.span_id='';editor.span_version=undefined"><ElOption v-for="t in editorTowers" :key="t.id" :value="t.id" :label="String(t.tower_no)">{{t.tower_no}}</ElOption></ElSelect></ElFormItem>
   <ElFormItem v-if="editor.location_kind==='span'" label="档距终点编号" required :error="editorError('档距')||editorError('档距终点编号')"><ElSelect v-model="editor.end_tower_no" filterable @change="editor.span_id='';editor.span_version=undefined"><ElOption v-for="t in editorTowers" :key="t.id" :value="t.tower_no" :label="String(t.tower_no)">{{t.tower_no}}</ElOption></ElSelect></ElFormItem>
   <ElFormItem label="作业对象" :error="editorError('作业对象')"><ElInput :model-value="editorOperationDefinition?.target_label||''" readonly aria-label="作业对象" placeholder="由操作类型确定"/></ElFormItem>
   <ElFormItem label="处理部位／对象" required :error="editorError('处理部位／对象')"><ElInput v-model="editor.target_object"/></ElFormItem>
   <ElFormItem label="工作量" required :error="editorError('工作量')"><ElInput v-model="editor.quantity" inputmode="decimal"/></ElFormItem>
   <ElFormItem label="单位" :error="editorError('单位')"><ElInput :model-value="editorOperationDefinition?.unit_name||''" readonly aria-label="单位" placeholder="由操作类型确定"/><ElButton v-if="editorOperationDefinition&&(editor.unit_id!==editorOperationDefinition.unit_id||editor.work_target_type!==editorOperationDefinition.work_target_type||editorError('字典版本')||editorError('扩展字段'))" link type="primary" @click="chooseEditorOperation(editor.operation_id)">采用当前操作模板并核对</ElButton></ElFormItem>
   <ElFormItem label="完成标准" required :error="editorError('完成标准')"><ElInput v-model="editor.completion_standard" type="textarea"/></ElFormItem>
   <ElFormItem label="问题描述／实施必要性" required :error="editorError('问题描述／实施必要性')"><ElInput v-model="editor.problem_description" type="textarea"/></ElFormItem>
   <ElFormItem label="来源依据" required :error="editorError('来源编号')"><ElSelect v-model="editor.source_keys" multiple filterable><ElOption v-for="s in sources" :key="s.source_key" :value="s.source_key" :label="s.source_key+' · '+(s.type_name||'待完善来源')"/></ElSelect></ElFormItem>
   <ElFormItem label="优先级"><ElSelect v-model="editor.priority_id" clearable><ElOption v-for="p in options('priority')" :key="p.id" :value="p.id" :label="p.name"/></ElSelect></ElFormItem>
   <ElFormItem label="期望完成日期" :error="editorError('期望完成日期')"><ElDatePicker v-model="editor.expected_on" type="date" value-format="YYYY-MM-DD"/></ElFormItem>
   <ElFormItem v-if="editor.work_target_type==='physical'" label="其他受影响位置"><ElSelect v-model="editor.related_logical_ids" multiple filterable><ElOption v-for="t in editorRelated" :key="t.id" :value="t.id" :label="String(t.tower_no)">{{t.tower_no}}</ElOption></ElSelect></ElFormItem>
   <ElFormItem v-if="editorFields.length" label="扩展字段" :error="editorError('扩展字段')" class="batch-wide"><CustomFields :definitions="editorFields" :model-value="editor.custom_fields||{}" @update:model-value="editor.custom_fields=$event"/></ElFormItem>
  </ElForm>
  <ElCheckbox v-if="(editor.issues||[]).some((i:Rec)=>['位置','字典版本'].includes(i.field))" v-model="versionAcknowledged">已根据当前台账和配置重新核对位置、作业及数量</ElCheckbox>
  <div v-if="editor.candidates?.length"><h3>疑似重复需求</h3><p>请核对问题与来源。关联已有来源需管理员权限；新发事项需说明与原需求的区别。</p><p class="muted">共 {{editor.candidate_count||editor.candidates.length}} 条候选，展示最近20条；请结合位置、问题、数量和历史依据判定。</p>
   <ElTable :data="editor.candidates"><ElTableColumn prop="demand_no" label="已有编号" width="150"/><ElTableColumn label="位置与作业" min-width="200"><template #default="{row}">{{row.line_name_snapshot}} {{row.tower_no_snapshot}}<p>{{row.operation_snapshot}}／{{row.target_object}}</p></template></ElTableColumn><ElTableColumn label="数量及状态" min-width="130"><template #default="{row}">{{row.quantity_scaled/10000}} {{row.unit_snapshot}}<p>{{row.status==='active'?'有效':'待核实'}}</p></template></ElTableColumn><ElTableColumn prop="problem_description" label="原问题说明" min-width="220"/><ElTableColumn label="历史来源依据" min-width="260"><template #default="{row}"><p v-for="(s,n) in row.source_summary||[]" :key="n">{{s.type_snapshot}} · {{s.discovered_on}} · {{s.proposed_by}} {{s.external_ref||''}}</p></template></ElTableColumn></ElTable>
   <ElForm novalidate :model="editor" label-position="top"><ElFormItem label="处理方式" required><ElSelect :model-value="editor.duplicate_review?.decision||''" @change="(v:string)=>editor.duplicate_review={...editor.duplicate_review,decision:v,candidate_id:editor.candidates[0].id}"><ElOption label="登记为新发需求" value="separate"/><ElOption label="关联已有需求来源" value="link" :disabled="user.role!=='admin'"/></ElSelect></ElFormItem><ElFormItem label="对应已有需求" required><ElSelect :model-value="editor.duplicate_review?.candidate_id||''" @change="(v:string)=>editor.duplicate_review={...editor.duplicate_review,candidate_id:v}"><ElOption v-for="c in editor.candidates" :key="c.id" :label="c.demand_no" :value="c.id"/></ElSelect></ElFormItem><ElFormItem label="判定依据" required><ElInput :model-value="editor.duplicate_review?.reason||''" type="textarea" @update:model-value="(v:string)=>editor.duplicate_review={...editor.duplicate_review,reason:v}"/></ElFormItem></ElForm>
  </div>
  <ElAlert v-if="error" :title="error" type="error" :closable="false"/>
  <template #footer><ElButton @click="editOpen=false">取消</ElButton><ElButton type="primary" @click="commitRow" :loading="busy">保存并检查本条</ElButton></template>
 </ElDialog>
 <ElDialog v-model="bulkOpen" title="批量修改所选需求" width="600px" class="business-modal"><p>影响当前勾选的 {{selectedKeys.length}} 条需求。</p><ElForm novalidate label-position="top"><ElFormItem label="修改字段"><ElSelect v-model="bulk.field"><ElOption v-for="f in [{value:'completion_standard',label:'完成标准'},{value:'problem_description',label:'问题描述'},{value:'target_object',label:'处理部位'},{value:'quantity',label:'每条工作量'},{value:'source_keys',label:'来源编号（分号分隔）'}]" :key="f.value" :value="f.value" :label="f.label"/></ElSelect></ElFormItem><ElFormItem label="填入内容"><ElInput v-model="bulk.value" type="textarea"/></ElFormItem><ElCheckbox v-model="bulk.only_empty">只补充空白，保留已有内容和逐行差异</ElCheckbox></ElForm><template #footer><ElButton @click="bulkOpen=false">取消</ElButton><ElButton type="primary" @click="applyBulk" :loading="busy">应用并重新检查</ElButton></template></ElDialog>
 <ElDialog v-model="sourceOpen" title="本批来源依据" width="1000px" class="business-modal"><ElButton type="primary" @click="openSourceEditor()" :disabled="!!lastResult">新增来源</ElButton><ElTable :data="sources"><ElTableColumn prop="source_key" label="来源编号" min-width="160"/><ElTableColumn prop="type_name" label="类型"/><ElTableColumn prop="proposed_by" label="提出者"/><ElTableColumn prop="discovered_on" label="发现日期"/><ElTableColumn label="问题" min-width="220"><template #default="{row}"><p v-for="(i,n) in row.issues||[]" :key="n" class="field-error">{{i.message}}</p></template></ElTableColumn><ElTableColumn label="操作" fixed="right" width="130"><template #default="{row,$index}"><ElButton link @click="openSourceEditor($index)" :disabled="!!lastResult">编辑</ElButton><ElButton link type="danger" @click="removeSource($index)" :disabled="!!lastResult">删除</ElButton></template></ElTableColumn></ElTable><template #footer><ElButton @click="sourceOpen=false">关闭</ElButton></template></ElDialog>
 <ElDialog v-model="sourceEditOpen" title="编辑来源依据" width="650px" class="business-modal" :close-on-click-modal="false"><ElForm novalidate :model="sourceEditor" label-position="top"><ElFormItem label="来源编号" required><ElInput v-model="sourceEditor.source_key"/></ElFormItem><ElFormItem label="来源类型" required :error="sourceEditor.issues?.find((i:Rec)=>i.field==='来源类型')?.message"><ElSelect v-model="sourceEditor.type_id"><ElOption v-for="s in options('source')" :key="s.id" :value="s.id" :label="s.name"/></ElSelect></ElFormItem><ElFormItem label="发现／提出日期" required :error="sourceEditor.issues?.find((i:Rec)=>i.field==='发现／提出日期')?.message"><ElDatePicker v-model="sourceEditor.discovered_on" type="date" value-format="YYYY-MM-DD"/></ElFormItem><ElFormItem label="提出单位／人员" required :error="sourceEditor.issues?.find((i:Rec)=>i.field==='提出单位／人员')?.message"><ElInput v-model="sourceEditor.proposed_by"/></ElFormItem><ElFormItem label="依据编号"><ElInput v-model="sourceEditor.external_ref"/></ElFormItem><ElFormItem label="来源说明"><ElInput v-model="sourceEditor.description" type="textarea"/></ElFormItem></ElForm><ElAlert v-if="error" :title="error" type="error" :closable="false"/><template #footer><ElButton @click="sourceEditOpen=false">取消</ElButton><ElButton type="primary" @click="commitSource" :loading="busy">保存来源并检查</ElButton></template></ElDialog>
 <ElDialog v-model="draftOpen" title="需求草稿" width="850px" class="business-modal"><ElButton @click="showDeleted">查询删除历史</ElButton><ElTable :data="drafts"><ElTableColumn label="内容" min-width="260"><template #default="{row}">{{draftTitle(row)}}</template></ElTableColumn><ElTableColumn prop="updated_at" label="保存时间" min-width="190"/><ElTableColumn label="操作" fixed="right" width="180"><template #default="{row}"><ElButton link type="primary" @click="restore(row)">继续编辑</ElButton><ElButton link type="danger" @click="deleteSavedDraft(row)">删除草稿</ElButton></template></ElTableColumn></ElTable></ElDialog>
 <ElDialog v-model="historyOpen" title="草稿删除历史" width="850px" class="business-modal"><ElTable :data="deleted"><ElTableColumn prop="deleted_at" label="删除时间"/><ElTableColumn prop="reason" label="删除依据"/><ElTableColumn label="原内容"><template #default="{row}">{{draftTitle(row.before)}}</template></ElTableColumn></ElTable><ElAlert title="删除前的完整草稿内容保留在审计中，原文件定位、来源及逐行内容可在操作记录查询。" type="info" :closable="false"/></ElDialog>
</template>

<style scoped>
.batch-mobile-issue{display:none}.demand-batch-workspace{min-width:0}.batch-heading,.batch-footer{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}.batch-actions,.batch-summary,.batch-toolbar,.batch-selected{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.batch-actions .el-button+.el-button,.batch-toolbar .el-button+.el-button,.batch-selected .el-button+.el-button{margin-left:0}.batch-summary,.batch-toolbar,.batch-selected,.batch-alert{margin:16px 0}.batch-toolbar>.el-select{width:160px}.batch-toolbar>.el-input{width:300px;max-width:100%}.batch-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 20px}.batch-form-grid>*{min-width:0}.batch-form-grid .el-select,.batch-form-grid :deep(.el-date-editor){width:100%;max-width:100%}.batch-wide{grid-column:1/-1}.batch-footer{margin-top:20px;padding-top:16px;border-top:1px solid var(--line,#dfe5ec)}.batch-pagination{display:flex;justify-content:flex-end;overflow:auto;margin-top:16px}.batch-totals{overflow-wrap:anywhere}.batch-progress{margin:12px 0}.batch-progress span{font-size:13px}.field-error{color:var(--el-color-danger);font-size:12px;white-space:normal;overflow-wrap:anywhere}.el-table p{margin:4px 0}.el-upload{margin-top:15px}
@media(max-width:800px){.batch-mobile-issue{display:block}.batch-form-grid{grid-template-columns:minmax(0,1fr)}.batch-heading,.batch-footer{align-items:flex-start}.batch-toolbar>.el-input{width:100%}.batch-pagination{justify-content:flex-start}.batch-actions{width:100%}.batch-actions .el-button{margin-left:0}.batch-footer .batch-actions .el-button{flex:1}.batch-selected .muted{width:100%}}
</style>

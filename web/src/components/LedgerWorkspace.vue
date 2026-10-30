<script setup lang="ts">
import {ElDialog} from 'element-plus';
import {requestApi} from '../api/client';
import {ElButton,ElTable,ElTableColumn,ElCheckbox,ElDrawer,ElInput,ElSelect,ElOption,ElPagination,ElForm,ElFormItem,ElRadio,ElDatePicker,type FormInstance} from 'element-plus';
import {computed,onMounted,onBeforeUnmount,reactive,ref,watch} from 'vue';
import {newClientId} from '../utils/client-id';

type Rec=Record<string,any>;
const props=defineProps<{user:Rec,view:string,lineId:string,focusTab?:string,focusTower?:string}>();
const emit=defineEmits<{(e:'update:lineId',id:string):void,(e:'update:focusTab',tab:string):void,(e:'workspace',value:Rec):void,(e:'changed'):void,(e:'demands',value:Rec):void}>();
const lines=ref<Rec[]>([]),voltage=ref<Rec[]>([]),items=ref<Rec[]>([]),allTowers=ref<Rec[]>([]),allSpans=ref<Rec[]>([]),workspace=ref<Rec|null>(null);
const loading=ref(false),busy=ref(false),error=ref(''),success=ref(''),tab=ref(props.focusTab||'towers');
const lineFormRef=ref<any>(null);
const queryTotal=ref(0),queryPageRows=ref<Rec[]>([]),queryLoading=ref(false);let queryTicket=0;
const filter=ref(''),voltageFilter=ref(''),query=ref(''),queryLine=ref(''),queryPage=ref(1),towerSearch=ref(''),towerDepartment=ref(''),towerStatus=ref(''),showRetired=ref(false);
const selectedTowers=reactive<Record<string,boolean>>({}),selectedSpans=reactive<Record<string,boolean>>({}),highlight=ref<string[]>([]);
const editor=ref(''),form=reactive<Rec>({}),rows=ref<Rec[]>([]),common=reactive<Rec>({}),preview=ref<Rec|null>(null),previewHash=ref(''),initialSnapshot=ref(''),discard=ref(false),requestKey=ref('');
const replacementTargets=ref<Rec[]>([]);
const towerView=ref<Rec|null>(null),sourceLine=ref(''),rangeStart=ref('1'),rangeEnd=ref('10'),numberWidth=ref('3'),numberPrefix=ref(''),pasteNumbers=ref(''),inputMode=ref('range');
const lineChoice=computed(()=>workspace.value?.line||null),canWrite=computed(()=>['admin','editor'].includes(props.user.role));
const visibleError=computed(()=>error.value);
const nodes=computed<Rec[]>(()=>workspace.value?[...(workspace.value.junction?[{...workspace.value.junction,is_junction:true}]:[]),...workspace.value.towers]:[]);
const ownTowers=computed<Rec[]>(()=>workspace.value?.towers||[]);
const currentSpans=computed<Rec[]>(()=> (workspace.value?.spans||[]).filter((s:Rec)=>showRetired.value||s.status!=='retired'));
const departments=computed(()=>[...new Set(nodes.value.map(t=>t.management_department).filter(Boolean))].sort());
const filteredTowers=computed(()=>nodes.value.filter(t=>
 (!towerSearch.value||[t.tower_no,t.model,t.tower_type,t.management_department].some(v=>String(v||'').toLowerCase().includes(towerSearch.value.toLowerCase())))&&
 (!towerDepartment.value||t.management_department===towerDepartment.value)&&
 (!towerStatus.value||t.status===towerStatus.value)
));
const chosenTowers=computed(()=>nodes.value.filter(t=>selectedTowers[t.id]&&t.status==='active'));
const chosenSpans=computed(()=>currentSpans.value.filter(s=>selectedSpans[s.id]&&s.status!=='retired'));
const matching=(l:Rec)=> (!filter.value||l.name.includes(filter.value))&&(!voltageFilter.value||l.voltage_level_id===voltageFilter.value);
const tree=computed<Rec[]>(()=>[...lines.value.filter(l=>l.line_kind==='main').map(main=>({...main,children:lines.value.filter(l=>l.parent_line_id===main.id&&matching(l))})),...lines.value.filter(l=>l.line_kind==='branch'&&!l.parent_line_id).map(branch=>({...branch,children:[]}))].filter(main=>matching(main)||main.children.length));
const queryRows=computed(()=>queryPageRows.value);
const pageRows=computed(()=>queryPageRows.value);
async function loadQuery(){
 if(props.view==='lines')return;
 const ticket=++queryTicket;queryLoading.value=true;
 try{
  const params=new URLSearchParams({page:String(queryPage.value),page_size:'30'});
  if(query.value.trim())params.set('search',query.value.trim());
  if(queryLine.value)params.set('line_id',queryLine.value);
  const result=await api('/ledger/'+(props.view==='towers'?'towers':'spans')+'?'+params);
  if(ticket!==queryTicket)return;
  queryPageRows.value=result.rows;queryTotal.value=result.total;
 }catch(e){if(ticket===queryTicket)report(e)}finally{if(ticket===queryTicket)queryLoading.value=false}
}
async function ensureTowerLookup(){
 if(allTowers.value.length)return;
 allTowers.value=await api('/ledger/towers');
}
const lookup=computed(()=>allTowers.value.filter(t=>t.status==='active'&&t.physical_tower_id&&t.line_status==='active'&&t.setup_status==='ready'&&t.line_id!==props.lineId&&(!sourceLine.value||t.line_id===sourceLine.value)));
const endpointOptions=computed(()=>nodes.value.filter(t=>t.status==='active'));
const ready=computed(()=>lineChoice.value?.status==='active'&&lineChoice.value?.setup_status==='ready');
const commonChanged=computed(()=>editor.value==='tower-edit'&&towerView.value&&JSON.stringify(physicalForm(towerView.value.physical))!==JSON.stringify(form.physical));
const title=computed(()=>({line:form.id?'编辑线路':'新建线路','tower-add':'新增杆塔','tower-batch':'批量添加杆塔','tower-edit':'编辑杆塔','tower-replace':'本线路单回路换塔','whole-replace':'整塔更换（确认全部共塔回路）',shared:'关联共塔',reorder:'调整沿线顺序','span-add':'新增档距','span-batch':'按杆塔顺序生成档距',replace:'拆档 / 合档变更',delete:'确认删除'} as Rec)[editor.value]||'');
const selectedRows=computed(()=>rows.value.filter(r=>r.selected!==false&&!r.existing_id));
function snapshot(){return JSON.stringify({form,rows:rows.value,common,inputMode:inputMode.value,rangeStart:rangeStart.value,rangeEnd:rangeEnd.value,numberWidth:numberWidth.value,numberPrefix:numberPrefix.value,pasteNumbers:pasteNumbers.value})}
const dirty=computed(()=>!!editor.value&&snapshot()!==initialSnapshot.value);
const qty=(n:any)=>n===null||n===undefined?'未填写':String(n/10000);
const distance=(n:any)=>n===null||n===undefined?'无法推算':String(n/10000);
const stateName=(s:string)=>({active:'在用',inactive:'停用',draft:'待完善',retired:'历史'} as Rec)[s]||s;
const optionItems=(type:string)=>items.value.filter(i=>i.type_id===type&&i.status==='active');
function notify(message:string){success.value=message}
function report(e:any){error.value=e?.message||'请求失败'}
const api=(path:string,method='GET',body?:any)=>requestApi(path,method,body);
const simpleFormRef=ref<FormInstance>(),spanAddFormRef=ref<FormInstance>(),wholeReplaceRef=ref<FormInstance>(),towerEditFormRef=ref<FormInstance>(),sharedFormRef=ref<FormInstance>(),spanReplaceRef=ref<FormInstance>(),towerAddFormRef=ref<FormInstance>();
const reasonRule=[{required:true,message:'请填写操作依据',trigger:'blur'}];
const endpointRule=[{required:true,message:'请选择杆塔',trigger:'change'}];
const towerNumberRules=(index:number)=>[
 {required:true,message:'请输入杆塔号',trigger:'blur'},
 {validator:(_r:unknown,v:unknown,done:(err?:Error)=>void)=>{
  const no=String(v??'').trim();
  if(!no)return done(new Error('请输入杆塔号'));
  if(ownTowers.value.some(t=>t.tower_no===no)||rows.value.some((t,i)=>i!==index&&t.tower_no===no))
   return done(new Error('重复杆塔号：'+no));
  done();
 },trigger:'blur'}
];
const towerHeightRule=[{validator:(_rule:unknown,v:unknown,done:(err?:Error)=>void)=>{
 const value=String(v??'').trim();
 done(!value||(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,4})?$/.test(value)&&Number(value)>0)
   ?undefined:new Error('塔高必须为正数且最多四位小数'));
},trigger:'blur'}];
const towerCoordinateRule=(limit:number)=>[{validator:(_rule:unknown,v:unknown,done:(err?:Error)=>void)=>{
 const value=String(v??'').trim();
 done(!value||(Number.isFinite(Number(value))&&Math.abs(Number(value))<=limit)
   ?undefined:new Error('坐标超出允许范围'));
},trigger:'blur'}];

async function validateSimple(formInstance:FormInstance|undefined,run:()=>Promise<unknown>){
 if(await formInstance?.validate().catch(()=>false))await run();
}

let loadVersion=0;
let loadingLineId='';
let mastersLoadedAt=0;
async function loadData(id=props.lineId,forceMasters=false){
 const ticket=++loadVersion;loadingLineId=id;loading.value=true;
 try{
  // Rapid switching between lines should not refetch global lists and dictionaries.
  // Refresh metadata on edits and periodically for multi-user changes.
  const fresh=forceMasters||!mastersLoadedAt||Date.now()-mastersLoadedAt>15000;
  const [ls,vs,ds]=fresh
   ?await Promise.all([api('/ledger/lines'),api('/voltage-levels'),api('/dictionary-items')])
   :[lines.value,voltage.value,items.value];
  if(ticket!==loadVersion)return;
  if(fresh){lines.value=ls;voltage.value=vs;items.value=ds;mastersLoadedAt=Date.now()}
 if(props.view!=='lines')void loadQuery();
 const target=ls.some((l:Rec)=>l.id===id)?id:ls[0]?.id||'';if(target!==props.lineId)emit('update:lineId',target);
 const w=target?await api('/ledger/lines/'+target):null;if(ticket!==loadVersion)return;workspace.value=w;
 for(const key of Object.keys(selectedTowers))if(!w||!nodes.value.some(t=>t.id===key))delete selectedTowers[key];
 for(const key of Object.keys(selectedSpans))if(!w||!w.spans.some((s:Rec)=>s.id===key&&s.status!=='retired'))delete selectedSpans[key];
 }catch(e){if(ticket===loadVersion)report(e)}finally{if(ticket===loadVersion){loading.value=false;loadingLineId=''}}
}
async function selectLine(id:string){if(id===props.lineId&&workspace.value?.line.id===id)return;emit('update:lineId',id);Object.keys(selectedTowers).forEach(k=>delete selectedTowers[k]);Object.keys(selectedSpans).forEach(k=>delete selectedSpans[k]);towerView.value=null;highlight.value=[];towerSearch.value='';await loadData(id)}
async function openQuery(row:Rec){const kind=props.view;emit('workspace',{lineId:row.line_id,tab:props.view==='towers'?'towers':'spans',towerId:props.view==='towers'?row.id:''});await selectLine(row.line_id);tab.value=kind==='towers'?'towers':'spans';if(row.tower_no)await showTower(row.id)}
function resetEditor(kind:string,values:Rec={},list:Rec[]=[]){error.value='';editor.value=kind;Object.keys(form).forEach(k=>delete form[k]);Object.assign(form,values);rows.value=list;Object.keys(common).forEach(k=>delete common[k]);Object.assign(common,{tower_type:'',model:'',height:'',purpose:'',commissioned_on:'',longitude:'',latitude:'',management_department:'',maintenance_team:''});preview.value=null;previewHash.value='';sourceLine.value='';requestKey.value=newClientId();initialSnapshot.value=snapshot()}
function closeEditor(){if(busy.value)return;if(dirty.value){discard.value=true;return}editor.value='';error.value=''}
function discardEditor(){discard.value=false;editor.value='';error.value=''}
async function saved(result:Rec,message:string){editor.value='';error.value='';highlight.value=result.ids||[];await loadData(result.line_id||result.id||props.lineId,true);emit('changed');notify(message)}
function lineForm(branch=false){resetEditor('line',{line_kind:branch?'branch':'main',parent_line_id:branch?props.lineId:'',junction_tower_id:'',name:'',voltage_level_id:branch?lineChoice.value?.voltage_level_id:'',status:'active',setup_status:'ready'});if(branch)void ensureTowerLookup().catch(report)}
function editLine(){if(lineChoice.value){resetEditor('line',{...lineChoice.value,reason:''});if(lineChoice.value.line_kind==='branch')void ensureTowerLookup().catch(report)}}
async function validateLineRequired(){
 const fields=['name',...(form.id?['reason']:[]),...(form.line_kind==='main'?['voltage_level_id']:['parent_line_id','junction_tower_id'])];
 let valid=true;
 for(const field of fields)if(!String(form[field]??'').trim()){valid=false;try{await lineFormRef.value?.validateField(field)}catch{}}
 return valid;
}
async function saveLine(draft=false){if(!canWrite.value)return;if(!draft&&!(await validateLineRequired()))return;busy.value=true;error.value='';try{const body={...form,draft,setup_status:draft?'draft':'ready',idempotency_key:requestKey.value};const r=await api('/ledger/lines'+(form.id?'/'+form.id:''),form.id?'PATCH':'POST',body);emit('update:lineId',r.id);await saved({line_id:r.id},draft?'支线草稿已保存，请继续确认接入杆塔':'线路已保存');tab.value='towers'}catch(e){report(e)}finally{busy.value=false}}
function physicalForm(p:Rec={}){return {tower_type:p?.tower_type||'',model:p?.model||'',height:p?.height_scaled?qty(p.height_scaled):'',purpose:p?.purpose||'',asset_no:p?.asset_no||'',commissioned_on:p?.commissioned_on||'',longitude:p?.longitude??'',latitude:p?.latitude??''}}
function addTower(batch=false,after=''){resetEditor(batch?'tower-batch':'tower-add',{after_tower_id:after,mode:'new'},batch?[]:[{tower_no:'',physical_tower_id:'',circuit_position:'',selected:true}]);void ensureTowerLookup().catch(report)}
function generateNumbers(){error.value='';const names:string[]=[];if(inputMode.value==='paste'){names.push(...pasteNumbers.value.split(/\r?\n|\t/).map(s=>s.trim()).filter(Boolean))}else{const a=Number(rangeStart.value),b=Number(rangeEnd.value),width=Number(numberWidth.value);if(!Number.isInteger(a)||!Number.isInteger(b)||a<0||b<a||b-a>=500||!Number.isInteger(width)||width<1||width>10){error.value='编号范围须递增，每批最多500基；补零位数为1至10';return}for(let i=a;i<=b;i++)names.push(numberPrefix.value+String(i).padStart(width,'0'))}if(!names.length||names.length>500){error.value='请提供1至500个杆塔编号';return}rows.value=names.map(tower_no=>({tower_no,...common,physical_tower_id:'',circuit_position:'',selected:true}));preview.value=null}
function applyCommon(overwrite=false){for(const row of rows.value)if(!overwrite||row.selected)for(const [key,value] of Object.entries(common))if(overwrite||!row[key])row[key]=value;preview.value=null}
function towerPayload(){return {version:lineChoice.value!.version,topology_token:workspace.value!.topology_token,after_tower_id:form.after_tower_id||null,common:{...common},rows:rows.value.map(r=>({...r,physical_tower_id:form.mode==='existing'||editor.value==='tower-batch'?r.physical_tower_id||null:null})),idempotency_key:requestKey.value}}
async function saveTowers(){busy.value=true;error.value='';try{const body=towerPayload(),fingerprint=JSON.stringify(body);if(editor.value==='tower-batch'&&previewHash.value!==fingerprint){preview.value=await api('/ledger/lines/'+props.lineId+'/towers/preview','POST',body);previewHash.value=fingerprint;return}const r=await api('/ledger/lines/'+props.lineId+'/towers','POST',body);await saved(r,'已保存 '+r.count+' 基杆塔')}catch(e){report(e)}finally{busy.value=false}}
async function showTower(id:string){try{towerView.value=await api('/ledger/towers/'+id)}catch(e){report(e)}}
function closeTowerDrawer(){if(!editor.value)towerView.value=null}
async function editTower(row:Rec,replace=false){await showTower(row.id);if(!towerView.value)return;
 if(replace&&towerView.value.shared_with.filter((r:Rec)=>r.status==='active').length>1){await openWholeReplacement();return}
 resetEditor(replace?'tower-replace':'tower-edit',{id:row.id,version:towerView.value.version,tower_no:towerView.value.tower_no,circuit_position:towerView.value.circuit_position||'',management_department:towerView.value.management_department||'',maintenance_team:towerView.value.maintenance_team||'',status:towerView.value.status,physical_version:towerView.value.physical?.version,physical:replace?physicalForm():physicalForm(towerView.value.physical),reason:'',confirm_shared:false})}
async function openWholeReplacement(){
 if(!towerView.value?.physical?.id)return;
 error.value='';busy.value=true;
 try{
  const id=towerView.value.physical.id;
  const [impact,allPhysical]=await Promise.all([api('/physical-towers/'+id+'/replace'),api('/physical-towers')]);
  replacementTargets.value=allPhysical.filter((x:Rec)=>x.id!==id&&x.status==='active');
  resetEditor('whole-replace',{source_id:id,source_version:impact.source.version,
    target_physical_tower_id:'',reason:''},impact.affected.map((x:Rec)=>({...x,checked:false})));
 }catch(e){report(e)}finally{busy.value=false}
}
async function saveWholeReplacement(){
 if(rows.value.some((x:Rec)=>!x.checked)){error.value='必须逐条勾选确认全部受影响回路';return}
 busy.value=true;error.value='';
 try{
  await api('/physical-towers/'+form.source_id+'/replace','POST',{
   source_version:form.source_version,target_physical_tower_id:form.target_physical_tower_id,
   confirmed_towers:rows.value.map((x:Rec)=>({id:x.id,version:x.version})),reason:form.reason
  });
  editor.value='';await loadData(props.lineId,true);emit('changed');
  if(towerView.value)await showTower(towerView.value.id);
  notify('整塔更换完成，共塔回路已在同一事务更新，历史保留');
 }catch(e){report(e)}finally{busy.value=false}
}
async function saveTower(){busy.value=true;error.value='';try{const r=await api('/ledger/towers/'+form.id,'PATCH',{...form,replace_physical:editor.value==='tower-replace',idempotency_key:requestKey.value});await saved(r,'杆塔变更已保存并留痕');await showTower(r.id)}catch(e){report(e)}finally{busy.value=false}}
function openReorder(){resetEditor('reorder',{reason:''},ownTowers.value.filter(t=>t.status!=='inactive').map(t=>({...t})))}
function move(index:number,delta:number){const target=index+delta;if(target<0||target>=rows.value.length)return;const [r]=rows.value.splice(index,1);rows.value.splice(target,0,r)}
async function saveOrder(){busy.value=true;try{const r=await api('/ledger/lines/'+props.lineId+'/reorder','POST',{version:lineChoice.value!.version,topology_token:workspace.value!.topology_token,ordered_ids:rows.value.map(r=>r.id),reason:form.reason,idempotency_key:requestKey.value});await saved(r,'沿线顺序已更新，已有档距保持原连接')}catch(e){report(e)}finally{busy.value=false}}
function openShared(row?:Rec){void ensureTowerLookup().catch(report);const candidates=row?[row]:chosenTowers.value.filter(t=>!t.is_junction);resetEditor('shared',{reason:'',change_kind:'correction'},candidates.map(source=>({source_id:source.id,source_version:source.version,source_name:source.tower_no,target_id:''})))}
async function saveShared(){busy.value=true;error.value='';try{const pairs=rows.value.map(r=>{const target=allTowers.value.find(t=>t.id===r.target_id);return {source_id:r.source_id,source_version:r.source_version,target_id:r.target_id,target_version:target?.version,target_physical_version:target?.physical_version}}),body={pairs,change_kind:form.change_kind,reason:form.reason,idempotency_key:requestKey.value},fingerprint=JSON.stringify(body);if(previewHash.value!==fingerprint){preview.value=await api('/ledger/shared/preview','POST',body);previewHash.value=fingerprint;return}await api('/ledger/shared/bind','POST',body);await saved({line_id:props.lineId},'共塔关系已保存；原需求仍保留当时的位置依据');towerView.value=null}catch(e){report(e)}finally{busy.value=false}}
function addSpan(){const selected=chosenTowers.value;resetEditor('span-add',{start_tower_id:selected[0]?.id||'',end_tower_id:selected[1]?.id||''})}
async function generateSpans(){error.value='';try{const result=await api('/ledger/lines/'+props.lineId+'/spans/preview','POST',{version:lineChoice.value!.version,topology_token:workspace.value!.topology_token,...(chosenTowers.value.length?{tower_ids:chosenTowers.value.map(t=>t.id)}:{})});resetEditor('span-batch',{topology_token:result.topology_token},result.candidates.map((r:Rec)=>({...r,selected:!r.existing_id})));initialSnapshot.value=snapshot()}catch(e){report(e)}}
async function saveSpans(){busy.value=true;error.value='';try{const r=await api('/ledger/lines/'+props.lineId+'/spans','POST',{version:lineChoice.value!.version,topology_token:workspace.value!.topology_token,rows:editor.value==='span-add'?[{...form}]:selectedRows.value,idempotency_key:requestKey.value});await saved({...r,line_id:props.lineId},'档距关系已建立，距离根据杆塔坐标自动推算');tab.value='spans'}catch(e){report(e)}finally{busy.value=false}}
function openReplace(){const old=chosenSpans.value;if(!old.length)return;const degree=new Map<string,number>();for(const s of old)for(const id of [s.start_tower_id,s.end_tower_id])degree.set(id,(degree.get(id)||0)+1);const ends=[...degree].filter(([,n])=>n===1).map(([id])=>id);if(ends.length!==2||[...degree.values()].some(n=>n>2)){error.value='请选择一条连续路径上的档距';return}resetEditor('replace',{old_ids:old.map(s=>s.id),reason:'',old_names:old.map(s=>s.start_tower_no+'—'+s.end_tower_no).join('、')},[{start_tower_id:ends[0],end_tower_id:ends[1]}])}
function splitAt(index:number){const row=rows.value[index];if(!row.insert_id)return;const oldEnd=row.end_tower_id;row.end_tower_id=row.insert_id;rows.value.splice(index+1,0,{start_tower_id:row.insert_id,end_tower_id:oldEnd});delete row.insert_id}
async function saveReplace(){busy.value=true;error.value='';try{const r=await api('/ledger/lines/'+props.lineId+'/replace-spans','POST',{version:lineChoice.value!.version,topology_token:workspace.value!.topology_token,old_ids:form.old_ids,rows:rows.value,reason:form.reason,idempotency_key:requestKey.value});await saved(r,'档距变更已保存，原档距及其需求引用保留在历史中')}catch(e){report(e)}finally{busy.value=false}}
function confirmDelete(kind:string,row:Rec){resetEditor('delete',{kind,id:row.id,version:row.version,label:kind==='lines'?row.name:kind==='towers'?row.tower_no:row.start_tower_no+'—'+row.end_tower_no,reason:''})}
async function removeRecord(){busy.value=true;try{const r=await api('/ledger/'+form.kind+'/'+form.id,'DELETE',{version:form.version,reason:form.reason,idempotency_key:requestKey.value});await saved({...r,line_id:form.kind==='lines'?'':props.lineId},'记录已删除');towerView.value=null}catch(e){report(e)}finally{busy.value=false}}
function selectTowerList(clear=false){for(const t of filteredTowers.value)if(t.status==='active')selectedTowers[t.id]=!clear}
function selectSpanList(clear=false){for(const s of currentSpans.value)if(s.status!=='retired')selectedSpans[s.id]=!clear}
function neighbours(id:string){return currentSpans.value.filter(s=>s.status!=='retired'&&(s.start_tower_id===id||s.end_tower_id===id)).map(s=>({id:s.start_tower_id===id?s.end_tower_id:s.start_tower_id,name:s.start_tower_id===id?s.end_tower_no:s.start_tower_no}))}
function launchDemands(kind:string){if(kind==='spans'){const spans=chosenSpans.value.filter(s=>s.status==='active');if(!spans.length){error.value='请选择有效档距';return}emit('demands',{kind:'span',line_id:props.lineId,rows:spans})}else emit('demands',{kind:'tower',line_id:props.lineId,rows:chosenTowers.value})}
const actionLabel=(s:string)=>({create:'新建线路',update:'线路资料调整',delete:'删除线路',add_towers:'添加杆塔',update_tower:'杆塔调整',delete_tower:'删除杆塔',physical_update:'实际杆塔公共属性调整',bind_shared:'共塔关联变更',reorder:'沿线顺序调整',add_spans:'添加档距',update_span:'档距关系调整',delete_span:'删除档距',replace_spans:'拆档 / 合档'} as Rec)[s]||'台账变更';
function unload(event:BeforeUnloadEvent){if(dirty.value){event.preventDefault();event.returnValue=''}}
onMounted(()=>{void loadData();window.addEventListener('beforeunload',unload)});onBeforeUnmount(()=>{loadVersion++;window.removeEventListener('beforeunload',unload)});
watch(()=>props.lineId,id=>{if(id&&workspace.value?.line.id!==id&&loadingLineId!==id)void loadData(id)});
watch(tab,value=>emit('update:focusTab',value));
watch(()=>props.focusTab,value=>{if(value)tab.value=value});watch(()=>props.focusTower,id=>{if(id)void showTower(id)});
watch([query,queryLine,()=>props.view],()=>{queryPage.value=1;void loadQuery()});watch(queryPage,()=>void loadQuery());
</script>
<template>
 <div class="ledger-workspace">
  <p v-if="visibleError" class="alert error" role="alert">{{visibleError}} <ElButton native-type="button" @click="error=''">×</ElButton></p><p v-if="success" class="alert ok" role="status">{{success}}</p>
  <template v-if="view!=='lines'">
   <section class="panel ledger-global-query">
    <div class="section-header"><h2>{{view==='towers'?'杆塔查询':'档距查询'}}</h2><ElButton class="secondary" @click="loadQuery">刷新</ElButton></div>
    <div class="ledger-query-tools">
     <ElSelect v-model="queryLine" clearable filterable placeholder="全部线路" aria-label="线路筛选" class="ledger-select">
      <ElOption v-for="l in lines" :key="l.id" :label="l.name" :value="l.id"/>
     </ElSelect>
     <ElInput v-model="query" clearable aria-label="查询关键词" placeholder="线路、杆塔号、型号或部门" class="ledger-search"/>
    </div>
    <ElTable :data="pageRows" v-loading="queryLoading" stripe empty-text="没有符合条件的记录" style="width:100%">
     <ElTableColumn prop="line_name" label="线路" min-width="156" show-overflow-tooltip/>
     <ElTableColumn label="杆塔号 / 起止杆塔" min-width="178" show-overflow-tooltip>
      <template #default="{row:r}">{{r.tower_no||(r.start_tower_no+'—'+r.end_tower_no)}}</template>
     </ElTableColumn>
     <ElTableColumn :label="view==='towers'?'结构 / 型号':'坐标推算距离（米）'" min-width="150" show-overflow-tooltip>
      <template #default="{row:r}">{{view==='towers'?[r.tower_type,r.model].filter(Boolean).join(' / ')||'未填写':distance(r.length_scaled)}}</template>
     </ElTableColumn>
     <ElTableColumn label="状态" width="94"><template #default="{row:r}">{{stateName(r.status)}}</template></ElTableColumn>
     <ElTableColumn label="操作" width="134" fixed="right"><template #default="{row:r}"><ElButton link @click="openQuery(r)">在线路中查看</ElButton></template></ElTableColumn>
    </ElTable>
    <div class="ledger-pagination"><ElPagination :current-page="queryPage" :page-size="30" :total="queryTotal" layout="total, prev, pager, next" @current-change="queryPage=$event"/></div>
   </section>
  </template>
  <div v-else class="ledger-layout">
   <aside class="ledger-directory panel"><div class="section-header"><h2>线路目录</h2><ElButton v-if="canWrite" class="link" aria-label="新建线路" @click="lineForm()">＋ 新建线路</ElButton></div>
    <label><span class="field-caption">搜索线路</span><ElInput v-model="filter" clearable placeholder="输入主线或支线名称"/></label><label><span class="field-caption">电压等级筛选</span><ElSelect aria-label="电压等级筛选" v-model="voltageFilter" clearable placeholder="全部电压等级"><ElOption v-for="v in voltage" :key="v.id" :label="v.name" :value="v.id"/></ElSelect></label>
    <div class="ledger-tree"><div v-for="l in tree" :key="l.id"><ElButton class="ledger-line" :class="{selected:lineId===l.id}" @click="selectLine(l.id)"><strong>{{l.name}}</strong><small>{{l.voltage_name}} · {{l.line_kind==='branch'?'支线（接入待确认）':'主线'}} · {{l.tower_count}} 基</small></ElButton><ElButton v-for="child in l.children" :key="child.id" class="ledger-line branch" :class="{selected:lineId===child.id}" @click="selectLine(child.id)"><strong>└ {{child.name}}</strong><small>支线{{child.setup_status==='draft'?' · 接入点待确认':''}}</small></ElButton></div><p v-if="!tree.length" class="empty">{{lines.length?'没有符合条件的线路':'先新建一条主线，再添加杆塔'}}</p></div>
   </aside>
   <div class="ledger-main panel ledger-unified" :aria-busy="loading">
    <section v-if="lineChoice" class="ledger-summary"><div class="section-header"><div><span class="tag">{{lineChoice.line_kind==='main'?'主线':'支线'}}</span><h2>{{lineChoice.name}}</h2><p class="muted">{{lineChoice.voltage_name}} · {{stateName(lineChoice.status)}} · {{lineChoice.tower_count}} 基杆塔 · {{lineChoice.span_count}} 档</p><p v-if="lineChoice.line_kind==='branch'" class="muted">所属主线：{{lineChoice.parent_name}} · 接入杆塔：{{lineChoice.junction_tower_no||'待确认'}}</p></div><div class="actions"><ElButton v-if="canWrite&&lineChoice.line_kind==='main'" class="secondary" @click="lineForm(true)">新增支线</ElButton><ElButton v-if="canWrite" class="secondary" @click="editLine">编辑线路</ElButton><ElButton class="light" @click="loadData()">刷新</ElButton></div></div>
     <div class="ledger-tabs"><ElButton v-for="t in [{id:'towers',name:'杆塔'},{id:'spans',name:'档距'},{id:'info',name:'线路信息'},{id:'history',name:'变更记录'}]" :key="t.id" :class="{active:tab===t.id}" @click="tab=t.id">{{t.name}}</ElButton></div>
    </section>
    <section v-if="!lineChoice" class="panel empty"><p>从左侧选择线路，或新建主线开始录入。</p><ElButton v-if="canWrite" class="primary" @click="lineForm()">新建主线</ElButton></section>
    <template v-else>
     <p v-if="lineChoice.setup_status==='draft'" class="alert">支线接入点待确认。<ElButton v-if="canWrite" class="link" @click="editLine">继续完善支线</ElButton></p>
     <section v-if="tab==='towers'" class="ledger-work-section"><div class="section-header"><div><h2>线路杆塔</h2><p class="muted">编号与沿线顺序分别维护；共塔公共属性只保存一份。</p></div><div v-if="canWrite" class="actions"><ElButton class="secondary" :disabled="!ready" @click="addTower(true)">批量添加杆塔</ElButton><ElButton class="primary" :disabled="!ready" @click="addTower()">新增杆塔</ElButton></div></div>
      <div class="toolbar ledger-tower-toolbar"><ElInput v-model="towerSearch" clearable placeholder="搜索杆塔号、结构、型号或部门" aria-label="筛选杆塔" class="ledger-search"/>
<ElSelect v-model="towerDepartment" clearable placeholder="全部管辖部门" aria-label="管辖部门筛选" class="ledger-select"><ElOption v-for="d in departments" :key="d" :label="d" :value="d"/></ElSelect>
<ElSelect v-model="towerStatus" clearable placeholder="全部状态" aria-label="杆塔状态筛选" class="ledger-status-select"><ElOption label="在用" value="active"/><ElOption label="停用" value="inactive"/><ElOption label="待完善" value="draft"/></ElSelect><ElButton v-if="chosenTowers.length" class="light" @click="selectTowerList()">全选当前列表</ElButton><ElButton v-if="chosenTowers.length" class="light" @click="selectTowerList(true)">清空选择</ElButton><ElButton v-if="canWrite" class="light" :disabled="!ownTowers.length" @click="openReorder">调整沿线顺序</ElButton><ElButton v-if="canWrite&&chosenTowers.filter(t=>!t.is_junction).length" class="secondary" @click="openShared()">批量关联共塔</ElButton><ElButton v-if="canWrite&&chosenTowers.length" class="secondary" @click="launchDemands('towers')">新建需求（已选 {{chosenTowers.length}} 基）</ElButton></div>
      <ElTable :data="filteredTowers" row-key="id" stripe class="ledger-tower-table" size="default" empty-text="没有符合条件的杆塔" style="width:100%" :row-class-name="({row}:any)=>highlight.includes(row.id)?'ledger-highlight':''">
       <ElTableColumn label="选择" width="64" align="center"><template #default="{row:t}"><ElCheckbox v-model="selectedTowers[t.id]" :disabled="t.status!=='active'" :aria-label="'选择杆塔 '+t.tower_no"/></template></ElTableColumn>
       <ElTableColumn label="顺序" width="72" align="center"><template #default="{row:t}">{{t.is_junction?'接入':ownTowers.findIndex(r=>r.id===t.id)+1}}</template></ElTableColumn>
       <ElTableColumn label="杆塔号" min-width="108" show-overflow-tooltip><template #default="{row:t}"><ElButton link type="primary" @click="showTower(t.id)">{{t.tower_no}}</ElButton></template></ElTableColumn>
       <ElTableColumn label="管辖部门" min-width="132" show-overflow-tooltip><template #default="{row:t}">{{t.management_department||'待核实'}}</template></ElTableColumn>
       <ElTableColumn label="结构 / 型号" min-width="145" show-overflow-tooltip><template #default="{row:t}"><span class="ledger-structure">{{t.tower_type||'未填写'}}</span><small class="ledger-secondary">{{t.model||''}}</small></template></ElTableColumn>
       <ElTableColumn label="共塔情况" min-width="136" show-overflow-tooltip><template #default="{row:t}">{{t.shared_count>1?'关联 '+t.shared_count+' 个线路位置':'独立杆塔'}}</template></ElTableColumn>
       <ElTableColumn label="操作" width="132" fixed="right"><template #default="{row:t}"><div class="ledger-row-actions"><ElButton link @click="showTower(t.id)">详情</ElButton><ElButton v-if="canWrite&&!t.is_junction" link @click="editTower(t)">编辑</ElButton></div></template></ElTableColumn>
      </ElTable>
     </section>
     <section v-if="tab==='spans'" class="ledger-work-section"><div class="section-header"><div><h2>线路档距</h2><p class="muted">只维护档距起止杆塔；距离根据杆塔坐标实时计算，不单独存储。</p></div><div v-if="canWrite" class="actions"><ElButton class="secondary" :disabled="!ready||nodes.length<2" @click="generateSpans">按杆塔顺序生成</ElButton><ElButton class="primary" :disabled="!ready||nodes.length<2" @click="addSpan">新增档距</ElButton></div></div>
      <div class="ledger-selection"><ElButton class="light" @click="selectSpanList()">全选当前档距</ElButton><ElButton class="light" @click="selectSpanList(true)">清空所选档距</ElButton><ElCheckbox v-model="showRetired">显示历史档距</ElCheckbox><ElButton v-if="canWrite" class="secondary" :disabled="!chosenSpans.length" @click="openReplace">拆档 / 合档</ElButton><ElButton v-if="canWrite" class="secondary" :disabled="!chosenSpans.some(s=>s.status==='active')" @click="launchDemands('spans')">按所选档距新建需求</ElButton></div>
      <ElTable :data="currentSpans" row-key="id" stripe empty-text="尚无档距，请先核对杆塔关系" style="width:100%">
       <ElTableColumn label="选择" width="64" align="center">
        <template #default="{row:s}"><ElCheckbox v-model="selectedSpans[s.id]" :disabled="s.status==='retired'" :aria-label="'选择档距 '+s.start_tower_no+'—'+s.end_tower_no"/></template>
       </ElTableColumn>
       <ElTableColumn label="起点杆塔" min-width="123" show-overflow-tooltip><template #default="{row:s}"><ElButton link type="primary" @click="showTower(s.start_tower_id)">{{s.start_tower_no}}</ElButton></template></ElTableColumn>
       <ElTableColumn label="终点杆塔" min-width="123" show-overflow-tooltip><template #default="{row:s}"><ElButton link type="primary" @click="showTower(s.end_tower_id)">{{s.end_tower_no}}</ElButton></template></ElTableColumn>
       <ElTableColumn label="坐标推算距离（米）" min-width="160"><template #default="{row:s}">{{distance(s.length_scaled)}}</template></ElTableColumn>
       <ElTableColumn label="状态" width="96"><template #default="{row:s}">{{stateName(s.status)}}</template></ElTableColumn>
       <ElTableColumn label="操作" min-width="152" fixed="right">
        <template #default="{row:s}"><ElButton v-if="canWrite&&s.status!=='retired'" link @click="confirmDelete('spans',s)">删除</ElButton><span v-if="s.demand_count">{{s.demand_count}} 条需求引用</span></template>
       </ElTableColumn>
      </ElTable>
     </section>
     <section v-if="tab==='info'" class="ledger-work-section"><h2>线路信息</h2><div class="info-grid"><div v-for="[key,label] in [['name','线路名称'],['voltage_name','电压等级']]" :key="key"><small>{{label}}</small><strong>{{lineChoice[key]||'未填写'}}</strong></div></div><ElButton v-if="canWrite" class="light" @click="confirmDelete('lines',lineChoice)">删除误录线路</ElButton></section>
     <section v-if="tab==='history'" class="ledger-work-section"><h2>变更记录</h2><article v-for="h in workspace!.history" :key="h.id" class="ledger-history"><strong>{{actionLabel(h.action)}}</strong><p>{{h.reason||'初始录入'}} · {{h.actor_name||'用户'}} · {{new Date(h.created_at).toLocaleString()}}</p></article><p v-if="!workspace!.history.length" class="empty">尚无线路工作台变更记录，原台账命名历史仍保留在杆塔详情。</p></section>
    </template>
   </div>
  </div>
  <ElDialog :model-value="!!editor" :title="title"  width="860px" @close="closeEditor" class="business-modal form-panel" :destroy-on-close="true" :close-on-click-modal="true" :close-on-press-escape="true" :lock-scroll="false"><p v-if="visibleError" class="form-modal-error" role="alert">{{visibleError}}</p>
   <ElForm v-if="editor==='line'" ref="lineFormRef" :model="form" label-position="top" novalidate class="form-grid" @submit.prevent="saveLine()">
    <ElFormItem label="线路类型" prop="line_kind"><ElSelect aria-label="线路类型" v-model="form.line_kind" :disabled="!!form.id"><ElOption :label="'主线'" data-option-value="main" value="main">主线</ElOption><ElOption :label="'支线'" data-option-value="branch" value="branch">支线</ElOption></ElSelect></ElFormItem><ElFormItem label="线路名称" prop="name" :rules="[{required:true,message:'请输入线路名称',trigger:'blur'}]"><ElInput v-model="form.name" aria-label="线路名称"/></ElFormItem>
    <ElFormItem v-if="form.line_kind==='main'" label="电压等级" prop="voltage_level_id" :rules="[{required:true,message:'请选择电压等级',trigger:'change'}]"><ElSelect aria-label="电压等级" v-model="form.voltage_level_id" :disabled="!!form.id" required><ElOption :label="'请选择'" data-option-value="" value="">请选择</ElOption><ElOption :label="String(v.name)" :data-option-value="v.id" v-for="v in voltage.filter(v=>v.status==='active'||v.id===form.voltage_level_id)" :key="v.id" :value="v.id">{{v.name}}</ElOption></ElSelect></ElFormItem>
    <template v-else><ElFormItem label="所属主线" prop="parent_line_id" :rules="[{required:true,message:'请选择所属主线',trigger:'change'}]"><ElSelect aria-label="所属主线" v-model="form.parent_line_id" :disabled="!!form.id" required><ElOption :label="'请选择'" data-option-value="" value="">请选择</ElOption><ElOption :label="String(l.name)" :data-option-value="l.id" v-for="l in lines.filter(l=>l.line_kind==='main'&&l.status==='active')" :key="l.id" :value="l.id">{{l.name}}</ElOption></ElSelect></ElFormItem><ElFormItem label="接入杆塔" prop="junction_tower_id" :rules="[{required:true,message:'请选择接入杆塔或保存草稿',trigger:'change'}]"><ElSelect aria-label="接入杆塔" v-model="form.junction_tower_id" :required="form.setup_status!=='draft'"><ElOption :label="'待确认，可保存草稿'" data-option-value="" value="">待确认，可保存草稿</ElOption><ElOption :label="String(t.tower_no) + ' · ' + String(t.model||t.tower_type||'型号未填写')" :data-option-value="t.id" v-for="t in allTowers.filter(t=>t.line_id===form.parent_line_id&&t.status==='active')" :key="t.id" :value="t.id">{{t.tower_no}} · {{t.model||t.tower_type||'型号未填写'}}</ElOption></ElSelect></ElFormItem><p class="wide muted">支线继承主线电压；接入点引用主线杆塔，不另建实际杆塔。</p></template>
    <ElFormItem v-if="form.id" label="状态" prop="status"><ElSelect aria-label="状态" v-model="form.status"><ElOption :label="'在用'" data-option-value="active" value="active">在用</ElOption><ElOption :label="'停用'" data-option-value="inactive" value="inactive">停用</ElOption></ElSelect></ElFormItem><ElFormItem v-if="form.id" class="wide" label="变更原因" prop="reason" :rules="[{required:true,message:'请输入变更原因',trigger:'blur'}]"><ElInput v-model="form.reason" aria-label="变更原因"/></ElFormItem>
    <div class="wide form-actions"><ElButton native-type="button" class="light" @click="closeEditor">取消</ElButton><ElButton v-if="form.line_kind==='branch'&&!form.junction_tower_id" native-type="button" class="secondary" :disabled="busy||!form.name||!form.parent_line_id" @click="saveLine(true)">保存支线草稿</ElButton><ElButton native-type="submit" class="primary" :disabled="busy" @click="validateLineRequired()">保存线路</ElButton></div>
   </ElForm>
   <ElForm v-if="['tower-add','tower-batch'].includes(editor)" ref="towerAddFormRef" :model="{rows,common}" label-position="top" novalidate @submit.prevent="validateSimple(towerAddFormRef,saveTowers)">
    <p class="muted">所属线路：{{lineChoice?.name}}。</p><div class="form-grid"><label><span class="field-caption">插入位置</span><ElSelect aria-label="插入位置" v-model="form.after_tower_id"><ElOption :label="'追加到线路末尾'" data-option-value="" value="">追加到线路末尾</ElOption><ElOption :label="String(t.tower_no) + ' 之后'" :data-option-value="t.id" v-for="t in ownTowers.filter(t=>t.status!=='inactive')" :key="t.id" :value="t.id">{{t.tower_no}} 之后</ElOption></ElSelect></label><label v-if="editor==='tower-add'"><span class="field-caption">实际杆塔</span><ElSelect aria-label="实际杆塔" v-model="form.mode"><ElOption :label="'新建实际杆塔'" data-option-value="new" value="new">新建实际杆塔</ElOption><ElOption :label="'关联已有线路杆塔'" data-option-value="existing" value="existing">关联已有线路杆塔</ElOption></ElSelect></label></div>
    <template v-if="editor==='tower-batch'"><div class="ledger-selection"><label class="ledger-check"><ElRadio v-model="inputMode"  value="range"/>连续编号</label><label class="ledger-check"><ElRadio v-model="inputMode"  value="paste"/>粘贴编号</label></div><div v-if="inputMode==='range'" class="form-grid"><label><span class="field-caption">编号起点</span><ElInput v-model="rangeStart" type="number" min="0"/></label><label><span class="field-caption">编号终点</span><ElInput v-model="rangeEnd" type="number" min="0"/></label><label><span class="field-caption">补零位数</span><ElInput v-model="numberWidth" type="number" min="1" max="10"/></label><label><span class="field-caption">编号前缀</span><ElInput v-model="numberPrefix" placeholder="可留空，如 #"/></label></div><label v-else><span class="field-caption">粘贴杆塔编号</span><ElInput type="textarea" v-model="pasteNumbers" :rows="4" placeholder="每行一基，支持 001A、015+1 等编号"/></label></template>
    <fieldset v-if="form.mode!=='existing'" class="ledger-fieldset"><legend>共同属性（选填）</legend><div class="form-grid"><label><span class="field-caption">管辖部门</span><ElInput v-model="common.management_department" placeholder="该批杆塔统一管辖部门"/></label><label><span class="field-caption">所属代维队</span><ElInput v-model="common.maintenance_team" placeholder="选填"/></label><label><span class="field-caption">结构类型</span><ElSelect aria-label="结构类型" v-model="common.tower_type" filterable allow-create default-first-option clearable placeholder="请选择或输入"><ElOption v-for="i in optionItems('tower_structure')" :key="i.id" :label="i.name" :value="i.name"/></ElSelect></label><label><span class="field-caption">型号</span><ElInput v-model="common.model"/></label><ElFormItem label="塔高（米）" prop="common.height" :rules="towerHeightRule"><ElInput v-model="common.height" data-validate="quantity" inputmode="decimal"/></ElFormItem><label><span class="field-caption">用途</span><ElSelect aria-label="用途" v-model="common.purpose" filterable allow-create default-first-option clearable placeholder="请选择或输入"><ElOption v-for="i in optionItems('tower_purpose')" :key="i.id" :label="i.name" :value="i.name"/></ElSelect></label><template v-if="editor==='tower-add'"><ElFormItem label="经度" prop="common.longitude" :rules="towerCoordinateRule(180)"><ElInput v-model="common.longitude" type="number" step="any" min="-180" max="180"/></ElFormItem><ElFormItem label="纬度" prop="common.latitude" :rules="towerCoordinateRule(90)"><ElInput v-model="common.latitude" type="number" step="any" min="-90" max="90"/></ElFormItem><label><span class="field-caption">投运日期</span><ElDatePicker type="date" value-format="YYYY-MM-DD" format="YYYY-MM-DD" v-model="common.commissioned_on" /></label></template></div></fieldset>
    <div v-if="editor==='tower-batch'" class="actions"><ElButton native-type="button" class="secondary" @click="generateNumbers">生成逐基预览</ElButton><ElButton native-type="button" class="light" @click="applyCommon()">共同属性仅填空值</ElButton><ElButton native-type="button" class="light" @click="applyCommon(true)">共同属性覆盖勾选行</ElButton></div>
    <label v-if="form.mode==='existing'||editor==='tower-batch'"><span class="field-caption">查找已有杆塔的线路</span><ElSelect aria-label="查找已有杆塔的线路" v-model="sourceLine"><ElOption :label="'其他全部线路'" data-option-value="" value="">其他全部线路</ElOption><ElOption :label="String(l.name)" :data-option-value="l.id" v-for="l in lines.filter(l=>l.id!==lineId)" :key="l.id" :value="l.id">{{l.name}}</ElOption></ElSelect></label>
    <div class="table-wrap"><ElTable :data="rows" >
<ElTableColumn v-if="editor==='tower-batch'"><template #header>应用共同属性</template><template #default="{row,$index}"><template v-for="([r,index]) in [[row,$index]]"><div  :data-row-index="index"><ElCheckbox v-model="r.selected"  :aria-label="'应用共同属性 '+(index+1)"/></div></template></template></ElTableColumn>
<ElTableColumn><template #header>杆塔号 <span class="required-star">*</span></template><template #default="{row,$index}"><template v-for="([r,index]) in [[row,$index]]"><div  :data-row-index="index"><ElFormItem :prop="'rows.'+index+'.tower_no'" :rules="index>=0?towerNumberRules(index):[]"><ElInput v-model="r.tower_no" :aria-label="'杆塔号 '+(index+1)"/></ElFormItem></div></template></template></ElTableColumn>
<ElTableColumn v-if="editor==='tower-batch'"><template #header>管辖部门</template><template #default="{row,$index}"><template v-for="([r,index]) in [[row,$index]]"><div :data-row-index="index"><ElInput v-model="r.management_department" :aria-label="'管辖部门 '+(index+1)" placeholder="填写管辖部门"/></div></template></template></ElTableColumn>
<ElTableColumn v-if="editor==='tower-batch'"><template #header>结构 / 型号</template><template #default="{row,$index}"><template v-for="([r,index]) in [[row,$index]]"><div  :data-row-index="index"><ElSelect v-model="r.tower_type" filterable allow-create default-first-option clearable :aria-label="'结构类型 '+(index+1)" placeholder="请选择或输入"><ElOption v-for="i in optionItems('tower_structure')" :key="i.id" :label="i.name" :value="i.name"/></ElSelect><ElInput v-model="r.model" :aria-label="'型号 '+(index+1)"/></div></template></template></ElTableColumn>
<ElTableColumn v-if="editor==='tower-batch'||form.mode==='existing'"><template #header>关联已有杆塔</template><template #default="{row,$index}"><template v-for="([r,index]) in [[row,$index]]"><div  :data-row-index="index"><ElFormItem :prop="'rows.'+index+'.physical_tower_id'" :rules="index>=0&&form.mode==='existing'?endpointRule:[]"><ElSelect v-model="r.physical_tower_id" :aria-label="'关联已有杆塔 '+(index+1)"><ElOption :label="String(editor==='tower-batch'?'新建实际杆塔':'请选择')" data-option-value="" value="">{{editor==='tower-batch'?'新建实际杆塔':'请选择'}}</ElOption><ElOption :label="String(t.line_name) + ' ' + String(t.tower_no) + ' · ' + String(t.model||t.tower_type||'未填写型号')" :data-option-value="t.physical_tower_id" v-for="t in lookup" :key="t.id" :value="t.physical_tower_id">{{t.line_name}} {{t.tower_no}} · {{t.model||t.tower_type||'未填写型号'}}</ElOption></ElSelect></ElFormItem><small v-if="r.physical_tower_id">采用该实际杆塔的公共属性</small></div></template></template></ElTableColumn>
<ElTableColumn><template #header>回路位置</template><template #default="{row,$index}"><template v-for="([r,index]) in [[row,$index]]"><div  :data-row-index="index"><ElInput v-model="r.circuit_position" :aria-label="'回路位置 '+(index+1)" placeholder="左、右等，可留空"/></div></template></template></ElTableColumn>
<ElTableColumn v-if="editor==='tower-batch'"><template #header></template><template #default="{row,$index}"><template v-for="([r,index]) in [[row,$index]]"><div  :data-row-index="index"><ElButton native-type="button" class="link" @click="rows.splice(index,1);preview=null">移除</ElButton></div></template></template></ElTableColumn></ElTable></div>
    <p v-if="preview&&previewHash===JSON.stringify(towerPayload())" class="alert ok">预检通过，共 {{rows.length}} 基。确认编号、顺序和共塔关系后保存。</p><div class="form-actions"><ElButton native-type="button" class="light" @click="closeEditor">取消</ElButton><ElButton native-type="submit" class="primary" :disabled="busy||!rows.length">{{editor==='tower-batch'?(previewHash===JSON.stringify(towerPayload())?'确认保存 '+rows.length+' 基':'预检并继续'):'保存杆塔'}}</ElButton></div>
   </ElForm>
   <ElForm v-if="editor==='whole-replace'" ref="wholeReplaceRef" :model="form" label-position="top" novalidate class="form-grid" @submit.prevent="validateSimple(wholeReplaceRef,saveWholeReplacement)">
     <p class="muted wide">该实体塔关联多个线路位置，实际整塔更换须逐项确认全部回路。单回路资料关联错误请使用“关联共塔”中的纠错功能。</p>
     <ElFormItem class="wide" label="目标实体塔" prop="target_physical_tower_id" :rules="endpointRule">
       <ElSelect v-model="form.target_physical_tower_id" required><ElOption :label="'请选择已登记的目标实体塔'" data-option-value="" value="">请选择已登记的目标实体塔</ElOption>
        <ElOption :label="String(t.tower_code) + ' · ' + String(t.model||t.tower_type||'未填写型号')" :data-option-value="t.id" v-for="t in replacementTargets" :key="t.id" :value="t.id">{{t.tower_code}} · {{t.model||t.tower_type||'未填写型号'}}</ElOption>
       </ElSelect>
     </ElFormItem>
     <div class="wide scope-item"><strong>受影响的全部在用回路（{{rows.length}}）</strong>
       <label v-for="t in rows" :key="t.id" class="ledger-check">
        <ElCheckbox v-model="t.checked"  :aria-label="'确认更换 '+t.line_name+' '+t.tower_no" required/>
        {{t.line_name}} · {{t.tower_no}}
       </label>
     </div>
     <ElFormItem class="wide" label="整体更换依据" prop="reason" :rules="reasonRule"><ElInput type="textarea" v-model="form.reason" :rows="3" placeholder="现场依据及影响范围核实情况" aria-label="整体更换依据"/></ElFormItem>
     <div class="wide form-actions"><ElButton native-type="button" class="light" @click="closeEditor">取消</ElButton><ElButton native-type="submit" class="primary" :disabled="busy||rows.some((t:Rec)=>!t.checked)">确认整塔更换</ElButton></div>
   </ElForm>
   <ElForm v-if="['tower-edit','tower-replace'].includes(editor)" ref="towerEditFormRef" :model="form" label-position="top" novalidate class="form-grid" @submit.prevent="validateSimple(towerEditFormRef,saveTower)">
    <p class="wide muted">所属线路：{{lineChoice?.name}}。{{editor==='tower-replace'?'为当前线路位置登记新的实际杆塔，原实体及业务依据保留历史。':'杆塔号只修改当前线路，公共属性修改会影响关联线路。'}}</p>
    <ElFormItem label="杆塔号" prop="tower_no" :rules="reasonRule"><ElInput v-model="form.tower_no" required/></ElFormItem><ElFormItem label="回路位置" prop="circuit_position"><ElInput v-model="form.circuit_position"/></ElFormItem><ElFormItem label="管辖部门" prop="management_department" :rules="reasonRule"><ElInput v-model="form.management_department" required placeholder="填写该基杆塔管辖班组"/></ElFormItem><ElFormItem label="所属代维队" prop="maintenance_team"><ElInput v-model="form.maintenance_team" placeholder="选填"/></ElFormItem><ElFormItem label="状态" prop="status"><ElSelect aria-label="状态" v-model="form.status"><ElOption :label="'在用'" data-option-value="active" value="active">在用</ElOption><ElOption :label="'待完善'" data-option-value="draft" value="draft">待完善</ElOption><ElOption :label="'停用'" data-option-value="inactive" value="inactive">停用</ElOption></ElSelect></ElFormItem><ElFormItem label="结构类型" prop="physical.tower_type"><ElSelect aria-label="结构类型" v-model="form.physical.tower_type" filterable allow-create default-first-option clearable placeholder="请选择或输入"><ElOption v-for="i in optionItems('tower_structure')" :key="i.id" :label="i.name" :value="i.name"/></ElSelect></ElFormItem><ElFormItem label="型号" prop="physical.model"><ElInput v-model="form.physical.model"/></ElFormItem><ElFormItem label="塔高（米）" prop="physical.height" :rules="towerHeightRule"><ElInput v-model="form.physical.height" data-validate="quantity"/></ElFormItem><ElFormItem label="用途" prop="physical.purpose"><ElSelect aria-label="用途" v-model="form.physical.purpose" filterable allow-create default-first-option clearable placeholder="请选择或输入"><ElOption v-for="i in optionItems('tower_purpose')" :key="i.id" :label="i.name" :value="i.name"/></ElSelect></ElFormItem><ElFormItem label="投运日期" prop="physical.commissioned_on"><ElDatePicker type="date" value-format="YYYY-MM-DD" format="YYYY-MM-DD" v-model="form.physical.commissioned_on" /></ElFormItem><ElFormItem label="经度" prop="physical.longitude" :rules="towerCoordinateRule(180)"><ElInput v-model="form.physical.longitude" type="number" step="any" min="-180" max="180"/></ElFormItem><ElFormItem label="纬度" prop="physical.latitude" :rules="towerCoordinateRule(90)"><ElInput v-model="form.physical.latitude" type="number" step="any" min="-90" max="90"/></ElFormItem>
    <div v-if="editor==='tower-edit'&&commonChanged&&towerView!.shared_with.length>1" class="wide alert"><p>公共属性将同时影响：{{towerView!.shared_with.map((r:Rec)=>r.line_name+' '+r.tower_no).join('、')}}</p><label class="ledger-check"><ElCheckbox v-model="form.confirm_shared"  required aria-label="确认共同属性修改影响"/>我已核对关联线路</label></div><ElFormItem class="wide" label="变更原因" prop="reason" :rules="reasonRule"><ElInput v-model="form.reason" required/></ElFormItem><div class="wide form-actions"><ElButton native-type="button" class="light" @click="closeEditor">取消</ElButton><ElButton native-type="submit" class="primary" :disabled="busy">保存杆塔变更</ElButton></div>
   </ElForm>
   <ElForm v-if="editor==='shared'" ref="sharedFormRef" :model="{...form,rows}" label-position="top" novalidate @submit.prevent="validateSimple(sharedFormRef,saveShared)"><p>请选择另一条线路上的对应杆塔。关联后采用所选实际杆塔的公共属性，原需求定位不会自动改写。</p><label><span class="field-caption">目标线路筛选</span><ElSelect aria-label="目标线路筛选" v-model="sourceLine"><ElOption :label="'其他全部线路'" data-option-value="" value="">其他全部线路</ElOption><ElOption :label="String(l.name)" :data-option-value="l.id" v-for="l in lines.filter(l=>l.id!==lineId)" :key="l.id" :value="l.id">{{l.name}}</ElOption></ElSelect></label><div v-for="(r,index) in rows" :key="r.source_id" class="scope-item" :data-row-index="index"><strong>当前线路 {{r.source_name}}</strong><ElFormItem :label="'对应杆塔 '+(index+1)" :prop="'rows.'+index+'.target_id'" :rules="endpointRule"><ElSelect v-model="r.target_id" :aria-label="'对应杆塔 '+(index+1)" required><ElOption :label="'请选择'" data-option-value="" value="">请选择</ElOption><ElOption :label="String(t.line_name) + ' ' + String(t.tower_no) + ' · ' + String(t.tower_type) + ' ' + String(t.model)" :data-option-value="t.id" v-for="t in lookup" :key="t.id" :value="t.id">{{t.line_name}} {{t.tower_no}} · {{t.tower_type}} {{t.model}}</ElOption></ElSelect></ElFormItem></div><p v-if="preview" class="alert ok">已预览 {{preview.pairs.length}} 对关系，关联前请核实实际为同一基杆塔。涉及 {{preview.pairs.reduce((n:number,p:Rec)=>n+p.affected_demands,0)}} 条既有需求，保留原快照。</p><ElFormItem label="关联依据" prop="reason" :rules="reasonRule"><ElInput type="textarea" v-model="form.reason" aria-label="关联依据"/></ElFormItem><div class="form-actions"><ElButton native-type="button" class="light" @click="closeEditor">取消</ElButton><ElButton native-type="submit" class="primary" :disabled="busy||!rows.length">{{preview?'确认共塔关联':'预览共塔关系'}}</ElButton></div></ElForm>
   <ElForm v-if="editor==='reorder'" ref="simpleFormRef" :model="form" label-position="top" novalidate @submit.prevent="validateSimple(simpleFormRef,saveOrder)"><p class="muted">只调整沿线顺序，已有档距的起止杆塔保持不变。</p><ol class="ledger-order"><li v-for="(r,index) in rows" :key="r.id"><strong>{{r.tower_no}}</strong><div class="actions"><ElButton native-type="button" :disabled="index===0" :aria-label="'上移 '+r.tower_no" @click="move(index,-1)">上移</ElButton><ElButton native-type="button" :disabled="index===rows.length-1" :aria-label="'下移 '+r.tower_no" @click="move(index,1)">下移</ElButton></div></li></ol><ElFormItem label="调整原因" prop="reason" :rules="reasonRule"><ElInput v-model="form.reason" aria-label="调整原因"/></ElFormItem><div class="form-actions"><ElButton native-type="button" class="light" @click="closeEditor">取消</ElButton><ElButton native-type="submit" class="primary" :disabled="busy">确认调整顺序</ElButton></div></ElForm>
   <ElForm v-if="editor==='span-add'" ref="spanAddFormRef" :model="form" label-position="top" novalidate class="form-grid" @submit.prevent="validateSimple(spanAddFormRef,saveSpans)"><p class="wide muted">所属线路：{{lineChoice?.name}}。名称由起止杆塔自动生成。</p><template v-if="editor==='span-add'"><ElFormItem label="起点杆塔" prop="start_tower_id" :rules="endpointRule"><ElSelect aria-label="起点杆塔" v-model="form.start_tower_id" required><ElOption  value="" label="请选择">请选择</ElOption><ElOption  v-for="t in endpointOptions" :key="t.id" :value="t.id" :label="String(t.tower_no)+(t.is_junction?'（主线接入点）':'')">{{t.tower_no}}{{t.is_junction?'（主线接入点）':''}}</ElOption></ElSelect></ElFormItem><ElFormItem label="终点杆塔" prop="end_tower_id" :rules="endpointRule"><ElSelect aria-label="终点杆塔" v-model="form.end_tower_id" required><ElOption  value="" label="请选择">请选择</ElOption><ElOption  v-for="t in endpointOptions" :key="t.id" :value="t.id" :label="String(t.tower_no)">{{t.tower_no}}</ElOption></ElSelect></ElFormItem></template><p v-else class="wide">{{form.start_tower_no}}—{{form.end_tower_no}}</p><p class="wide muted">系统自动计算两端杆塔坐标距离。缺少坐标时显示未填写。</p><div class="wide form-actions"><ElButton native-type="button" class="light" @click="closeEditor">取消</ElButton><ElButton native-type="submit" class="primary" :disabled="busy">建立档距</ElButton></div></ElForm>
   <ElForm v-if="editor==='span-batch'" novalidate @submit.prevent="saveSpans"><p>按当前杆塔顺序生成候选，未选中的杆塔间隙不会自动跨接。已存在 {{rows.filter(r=>r.existing_id).length}} 档，跳过重复建立。</p><div class="table-wrap"><ElTable :data="rows" stripe><ElTableColumn label="建立" width="96"><template #default="{row:r,$index:index}"><ElCheckbox v-model="r.selected" :disabled="!!r.existing_id" :aria-label="'建立档距 '+(index+1)"/></template></ElTableColumn><ElTableColumn prop="start_tower_no" label="起点杆塔" min-width="125"/><ElTableColumn prop="end_tower_no" label="终点杆塔" min-width="125"/><ElTableColumn label="坐标推算距离（米）" min-width="160"><template #default="{row:r}">{{distance(r.length_scaled)}}</template></ElTableColumn></ElTable></div><div class="form-actions"><ElButton native-type="button" class="light" @click="closeEditor">取消</ElButton><ElButton native-type="submit" class="primary" :disabled="busy||!selectedRows.length">确认建立 {{selectedRows.length}} 档</ElButton></div></ElForm>
   <ElForm v-if="editor==='replace'" ref="spanReplaceRef" :model="{...form,rows}" label-position="top" novalidate @submit.prevent="validateSimple(spanReplaceRef,saveReplace)"><p>原档距：{{form.old_names}}。变更必须保持外侧两端不变，原记录将保留为历史。</p><div v-for="(r,index) in rows" :key="index" class="scope-item form-grid" :data-row-index="index"><ElFormItem label="起点杆塔" :prop="'rows.'+index+'.start_tower_id'" :rules="endpointRule"><ElSelect v-model="r.start_tower_id" required :aria-label="'新档起点 '+(index+1)"><ElOption :label="String(t.tower_no)" :data-option-value="t.id" v-for="t in endpointOptions" :key="t.id" :value="t.id">{{t.tower_no}}</ElOption></ElSelect></ElFormItem><ElFormItem label="终点杆塔" :prop="'rows.'+index+'.end_tower_id'" :rules="endpointRule"><ElSelect v-model="r.end_tower_id" required :aria-label="'新档终点 '+(index+1)"><ElOption :label="String(t.tower_no)" :data-option-value="t.id" v-for="t in endpointOptions" :key="t.id" :value="t.id">{{t.tower_no}}</ElOption></ElSelect></ElFormItem><label><span class="field-caption">从现有杆塔中选择插入点</span><ElSelect v-model="r.insert_id" :aria-label="'插入杆塔 '+(index+1)"><ElOption :label="'不拆分此行'" data-option-value="" value="">不拆分此行</ElOption><ElOption :label="String(t.tower_no)" :data-option-value="t.id" v-for="t in endpointOptions.filter(t=>t.id!==r.start_tower_id&&t.id!==r.end_tower_id)" :key="t.id" :value="t.id">{{t.tower_no}}</ElOption></ElSelect></label><div class="wide actions"><ElButton native-type="button" class="secondary" :disabled="!r.insert_id" @click="splitAt(index)">在此杆塔拆为两档</ElButton><ElButton v-if="rows.length>1" native-type="button" class="light" @click="rows.splice(index,1)">移除此行</ElButton></div></div><ElFormItem label="拆档 / 合档依据" prop="reason" :rules="reasonRule"><ElInput type="textarea" v-model="form.reason" aria-label="拆档 / 合档依据"/></ElFormItem><div class="form-actions"><ElButton native-type="button" class="light" @click="closeEditor">取消</ElButton><ElButton native-type="submit" class="primary" :disabled="busy">确认档距变更</ElButton></div></ElForm>
   <ElForm v-if="editor==='delete'" ref="simpleFormRef" :model="form" label-position="top" novalidate @submit.prevent="validateSimple(simpleFormRef,removeRecord)"><p>删除“{{form.label}}”？已有业务引用的记录不能直接删除，系统会保留关联依据。</p><ElFormItem label="删除原因" prop="reason" :rules="reasonRule"><ElInput v-model="form.reason" aria-label="删除原因"/></ElFormItem><div class="form-actions"><ElButton native-type="button" class="light" @click="closeEditor">取消</ElButton><ElButton native-type="submit" class="primary" :disabled="busy">确认删除</ElButton></div></ElForm>
  </ElDialog>
  <ElDialog :model-value="discard" title="放弃未保存的修改？" @close="discard=false" width="620px" class="business-modal form-panel" :destroy-on-close="true" :close-on-click-modal="true" :close-on-press-escape="true" :lock-scroll="false"><p>已填写的内容尚未保存，关闭后将丢弃本次修改。</p><div class="form-actions"><ElButton class="secondary" @click="discard=false">继续编辑</ElButton><ElButton class="primary" @click="discardEditor">放弃修改</ElButton></div></ElDialog>
  <ElDrawer :model-value="!!towerView&&!editor" title="杆塔详情" size="min(580px, 94vw)" :destroy-on-close="true" @close="closeTowerDrawer"><div v-if="towerView" class="ledger-detail-body"><div class="section-header"><h2>杆塔 {{towerView.tower_no}}</h2><ElButton aria-label="关闭杆塔详情" @click="towerView=null">关闭</ElButton></div><h3>当前线路位置</h3><p>{{lines.find(l=>l.id===towerView!.line_id)?.name}} · {{towerView.tower_no}} · {{stateName(towerView.status)}}</p><p>管辖部门：{{towerView.management_department||'待核实'}} · 代维队：{{towerView.maintenance_team||'未填写'}}</p><h3>实际杆塔公共属性</h3><div class="info-grid"><div v-for="[key,label] in [['tower_type','结构类型'],['model','型号'],['purpose','用途']]" :key="key"><small>{{label}}</small><strong>{{towerView.physical?.[key]||'未填写'}}</strong></div><div><small>塔高（米）</small><strong>{{qty(towerView.physical?.height_scaled)}}</strong></div></div><h3>关联线路</h3><p v-for="t in towerView.shared_with" :key="t.id"><ElButton class="link" @click="towerView=null;selectLine(t.line_id)">{{t.line_name}} {{t.tower_no}}</ElButton> {{t.circuit_position}}</p><h3>相邻档距</h3><p v-for="s in towerView.spans" :key="s.id">{{s.line_name}} {{s.start_tower_no}}—{{s.end_tower_no}} · 坐标推算 {{qty(s.length_scaled)}} 米 · {{stateName(s.status)}}</p><p v-if="!towerView.spans.length" class="muted">尚未建立相邻档距</p><p class="muted">{{towerView.demand_count}} 条需求引用</p><div v-if="canWrite&&towerView.line_id===lineId" class="form-actions"><ElButton class="secondary" @click="editTower(towerView)">编辑杆塔</ElButton><ElButton class="secondary" :disabled="!ready" @click="addTower(false,towerView.id);towerView=null">后插入</ElButton><ElButton class="secondary" @click="openShared(towerView)">关联共塔</ElButton><ElButton class="secondary" @click="editTower(towerView,true)">实际换塔</ElButton><ElButton class="light" @click="confirmDelete('towers',towerView)">删除误录杆塔</ElButton></div><h3>命名与实体变更历史</h3><p v-for="h in [...towerView.names,...towerView.bindings].sort((a,b)=>b.valid_from.localeCompare(a.valid_from))" :key="h.id" class="history">{{new Date(h.valid_from).toLocaleString()}} · {{h.tower_no||({initial:'初始关联',correction:'关联纠错',replacement:'实际换塔'} as Rec)[h.change_kind]}} · {{h.reason}}</p></div></ElDrawer>
 </div>
</template>
<style scoped>
.ledger-layout{display:grid;grid-template-columns:255px minmax(0,1fr);gap:18px;align-items:start}.ledger-directory{padding:17px;position:sticky;top:20px}.ledger-directory h2{font-size:16px}.ledger-directory label{margin:12px 0}.ledger-tree{max-height:62vh;overflow:auto;margin-top:15px}.ledger-line{display:block;width:100%;text-align:left;border:0;background:transparent;padding:12px;border-radius:8px;margin:3px 0}.ledger-line strong,.ledger-line small,td small{display:block}.ledger-line small,td small{font-size:11px;color:#789080;margin-top:5px}.ledger-line.selected{background:#e7f1e9;color:#215d45}.ledger-line.branch{padding-left:24px}.ledger-main{min-width:0}.ledger-summary h2{margin:9px 0}.ledger-tabs{display:flex;gap:8px;border-top:1px solid #e7eee8;padding-top:13px;margin-top:15px;flex-wrap:wrap}.ledger-tabs button{border:0;background:transparent}.ledger-tabs .active{background:#e5f0e8;color:#185239;font-weight:700}.ledger-check{display:flex;align-items:center;flex-direction:row;font-weight:400;gap:8px;margin:0}.ledger-check input{width:auto}.ledger-selection,.ledger-pagination{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:15px 0}.ledger-pagination{justify-content:flex-end}.ledger-highlight{background:#edf7ef}.ledger-fieldset{border:1px solid #dce8df;border-radius:9px;padding:16px;margin:16px 0}.ledger-fieldset legend{font-size:13px;color:#547161;padding:0 7px}.ledger-order{padding-left:25px}.ledger-order li{display:flex;align-items:center;justify-content:space-between;gap:15px;border-bottom:1px solid #e8eee9;padding:8px 0}.ledger-history{border-bottom:1px solid #e8eee9;padding:14px 0}.ledger-history p{font-size:12px;color:#6c8273}.ledger-workspace .table-wrap{margin-top:13px}.ledger-workspace table input,.ledger-workspace table select{min-width:105px}.ledger-workspace table input[type=checkbox]{min-width:0;width:16px}.ledger-workspace form>.form-grid{margin:15px 0}.ledger-workspace form>label{margin:15px 0}.ledger-workspace td.actions{display:table-cell;white-space:nowrap;min-width:150px;vertical-align:middle}.ledger-workspace td.actions .link{margin-right:7px}.ledger-summary .actions{flex-wrap:wrap}
@media(max-width:1100px){.ledger-layout{grid-template-columns:210px minmax(0,1fr)}.ledger-directory{padding:13px}.ledger-summary .section-header{align-items:flex-start;flex-direction:column}}
@media(max-width:760px){.ledger-layout{grid-template-columns:1fr}.ledger-directory{position:static}.ledger-tree{max-height:180px}.ledger-directory .section-header{margin-bottom:5px}.ledger-directory label{margin:8px 0}.ledger-tabs{gap:3px}.ledger-summary .actions{gap:6px}}

.ledger-workspace{min-width:0}
.ledger-workspace .ledger-layout{grid-template-columns:minmax(235px,280px) minmax(0,1fr);gap:16px;align-items:start}
.ledger-layout>*{min-width:0}
.ledger-directory{min-width:0}
.ledger-directory .section-header{gap:8px;flex-wrap:wrap}
.ledger-directory .section-header h2{font-size:15px;margin:0}
.ledger-tree{max-height:calc(100vh - 350px);min-height:160px}
.ledger-line.el-button{display:block;width:100%;height:auto;min-width:0;white-space:normal;text-align:left;padding:10px!important}
.ledger-line.el-button>span{display:block;max-width:100%;min-width:0;text-align:left}
.ledger-line strong,.ledger-line small{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ledger-main.ledger-unified{min-width:0;padding:20px 23px}
.ledger-summary{padding:0 0 10px;min-width:0}
.ledger-summary .section-header{display:flex;align-items:flex-start;justify-content:space-between;gap:15px;flex-wrap:wrap}
.ledger-summary h2{font-size:20px;line-height:1.45;margin:6px 0}
.ledger-summary .muted{font-size:12px;margin:3px 0}
.ledger-summary .actions{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}
.ledger-tabs{border-top:0;border-bottom:1px solid var(--el-border-color-light);padding:12px 0;margin:0}
.ledger-tabs .el-button.active{color:var(--el-color-primary);background:var(--el-color-primary-light-9);font-weight:600}
.ledger-work-section{margin-top:20px;min-width:0}
.ledger-work-section .section-header{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.ledger-work-section .section-header h2{font-size:16px;margin:0}
.ledger-work-section .section-header p{font-size:12px;margin:6px 0}
.ledger-work-section .actions{display:flex;gap:8px;flex-wrap:wrap}
.ledger-work-section .toolbar{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin:15px 0}
.ledger-tower-toolbar .ledger-search{width:235px;max-width:100%}
.ledger-tower-toolbar .ledger-select{width:160px;max-width:100%}
.ledger-tower-toolbar .ledger-status-select{width:130px;max-width:100%}
.ledger-tower-table{width:100%;font-size:13px}
.ledger-structure,.ledger-secondary{display:block;line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ledger-secondary{font-size:11px;color:var(--el-text-color-secondary)}
.ledger-row-actions{display:flex;align-items:center;gap:3px;white-space:nowrap}
.ledger-detail-body{line-height:1.7}
.ledger-detail-body h3{font-size:14px;margin:18px 0 8px}
.ledger-workspace .table-wrap{max-width:100%;overflow-x:auto}
@media(max-width:1100px){.ledger-workspace .ledger-layout{grid-template-columns:minmax(210px,240px) minmax(0,1fr)}.ledger-main.ledger-unified{padding:16px}}
@media(max-width:760px){.ledger-workspace .ledger-layout{grid-template-columns:minmax(0,1fr)}.ledger-directory{position:static}.ledger-tree{max-height:180px}.ledger-main.ledger-unified{padding:13px}.ledger-tower-toolbar .ledger-search{width:100%}}

.ledger-global-query{min-width:0}
.ledger-query-tools{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin:15px 0}
.ledger-query-tools .ledger-select{width:245px;max-width:100%}
.ledger-query-tools .ledger-search{width:275px;max-width:100%}
@media(max-width:760px){.ledger-query-tools .ledger-select,.ledger-query-tools .ledger-search{width:100%}}
</style>

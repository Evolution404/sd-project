<script setup lang="ts">
import {computed,onMounted,reactive,ref,watch} from 'vue';
import {newClientId} from './utils/client-id';
import FormModal from './components/FormModal.vue';
import CustomFields from './components/CustomFields.vue';
import LedgerWorkspace from './components/LedgerWorkspace.vue';
import SidebarChevron from './components/SidebarChevron.vue';
import {vFormValidation,presentFormError,inlineErrorMessage} from './utils/form-validation';
type Rec = Record<string,any>;
function rememberedView(key:string,fallback:string){try{return sessionStorage.getItem(key)||fallback}catch{return fallback}}
const ledgerLineId=ref(rememberedView('ledger-line','')),ledgerTab=ref(rememberedView('ledger-tab','towers')),ledgerTowerId=ref(''),demandLocationKind=ref('tower'),demandSpanRows=ref<Rec[]>([]);
const nav=ref('overview'),page=ref('overview'),user=ref<Rec|null>(null);
const expandedGroup=ref('');const sidebarMobile=ref(false);
const username=ref(''),password=ref('');
const busy=ref(false),error=ref(''),success=ref('');
const voltage=ref<Rec[]>([]),lines=ref<Rec[]>([]),physical=ref<Rec[]>([]),logical=ref<Rec[]>([]),items=ref<Rec[]>([]),types=ref<Rec[]>([]),demands=ref<Rec[]>([]);
const overview=ref<Rec>({}),detail=ref<Rec|null>(null),edit=ref<Rec|null>(null);
const allowedIPs=ref<Rec[]>([]), currentClientIP=ref(''), ipInput=ref(''), ipNote=ref('');
const frameworks=ref<Rec[]>([]),agreements=ref<Rec[]>([]),projects=ref<Rec[]>([]);
const projectView=ref<Rec|null>(null),scopeDemand=ref(''),scopeQuantity=ref('1'),scopePriceEdit=ref<Rec|null>(null);
const scopePrice=reactive<Rec>({unit_price_yuan:'',price_source:'',price_date:new Date().toLocaleDateString('en-CA'),tax_mode:'inclusive',reason:''});
const agreementSelection=ref('');
const approvedDemandOptions=ref<Rec[]>([]);
const executionRows=ref<Rec[]>([]),executionView=ref<Rec|null>(null);
const executionNumber=ref(''),executionDescription=ref(''),execScopeId=ref(''),execQuantity=ref('1');
const completeQuantity=ref(''),completeEvidence=ref(''),completeDate=ref(new Date().toLocaleDateString('en-CA'));
const eligibleExecutionScopes=computed<Rec[]>(()=> (projectView.value?.scopes||[]).filter((x:Rec)=>!(executionView.value?.items||[]).some((i:Rec)=>i.project_scope_id===x.id)));
const eligibleDemands=computed(()=>approvedDemandOptions.value.filter(x=>!(projectView.value?.scopes||[]).some((s:Rec)=>s.demand_id===x.id)));
const statusFilter=ref(''),search=ref(''),lineFilter=ref('');
const selectedLine=ref(''),towerSearch=ref(''),fromRank=ref(''),toRank=ref('');
const rangeOpen=ref(false),sourcesOpen=ref(true),entryAdvancedOpen=ref(false);
const batchSources=ref<Rec[]>([{type_id:'',discovered_on:new Date().toLocaleDateString('en-CA'),proposed_by:'',description:'',external_ref:''}]);
const selected=reactive<Record<string,boolean>>({});
const overrides=reactive<Record<string,{target_object?:string,quantity?:string,custom_fields?:Rec}>>({});
const excluded=reactive<Record<string,boolean>>({});
const stage=ref(''),dictionaryType=ref('voltage');
const ipDialog=ref(false),projectAction=ref(''),executionAction=ref('');
const completionItem=ref<Rec|null>(null);
const demandEdit=ref<Rec|null>(null),pendingRemoveIP=ref<Rec|null>(null),attachmentDialog=ref(false);
const reasonAction=ref(''),reasonValue=ref('');

const drafts=ref<Rec[]>([]),currentDraft=ref<Rec|null>(null),draftsOpen=ref(false);
const batchKey=ref<string>(newClientId()),lastResult=ref<Rec|null>(null);
const newCommon=():Rec=> ({work_target_type:'line',operation_id:'',target_object:'',quantity:'1',unit_id:'',completion_standard:'',problem_description:'',priority_id:'',expected_on:'',custom_fields:{},source:{type_id:'',discovered_on:new Date().toLocaleDateString('en-CA'),proposed_by:'',description:'',external_ref:''}});
const common=reactive<Rec>(newCommon());
const initialForm:Rec={};
const form=reactive<Rec>({});
const labels:Rec={overview:'工作台',lines:'线路台账',towers:'杆塔查询',spans:'档距查询',entry:'新建需求',demands:'需求中心',dictionary:'数据字典',access:'IP访问管理',frameworks:'项目框架',agreements:'执行协议',projects:'子项目储备'};
const tabs=['overview','entry','demands','lines','physical','logical','dictionary','access'];
const ops=computed(()=>items.value.filter(x=>x.type_id==='operation'&&x.status==='active'&&(x.work_target_type===common.work_target_type||x.work_target_type==='both')));
const units=computed(()=>items.value.filter(x=>x.type_id==='unit'&&x.status==='active'));
const sources=computed(()=>items.value.filter(x=>x.type_id==='source'&&x.status==='active'));
const priorities=computed(()=>items.value.filter(x=>x.type_id==='priority'&&x.status==='active'));
const thisLineTowers=computed(()=>logical.value.filter(x=>x.line_id===selectedLine.value&&x.status==='active'&&(!towerSearch.value||[x.tower_no,x.logical_code,x.physical_code].some(y=>String(y||'').toLowerCase().includes(towerSearch.value.toLowerCase())))).sort((a,b)=>a.sort_rank-b.sort_rank));
const selectedRows=computed<Rec[]>(()=> (demandLocationKind.value==='span'?demandSpanRows.value:logical.value.filter(x=>selected[x.id])).filter(x=>!excluded[x.id]).map(x=>({...x,tower_no:x.span_id?x.start_tower_no+'—'+x.end_tower_no:x.tower_no,quantity:overrides[x.id]?.quantity??String(common.quantity),target_object:overrides[x.id]?.target_object??String(common.target_object),custom_fields:{...common.custom_fields,...overrides[x.id]?.custom_fields}})));
const totalQty=computed(()=>selectedRows.value.reduce((acc,x)=>acc+(Number(x.quantity)||0),0));
const thisLineSelected=computed(()=>logical.value.filter(x=>x.line_id===selectedLine.value&&selected[x.id]&&!excluded[x.id]).length);
const thisLineTotal=computed(()=>logical.value.filter(x=>x.line_id===selectedLine.value&&x.status==='active').length);
const selectedLines=computed(()=>lines.value.filter(l=>selectedRows.value.some(x=>x.line_id===l.id)));
const sectionLabel=computed(()=>nav.value==='entry'?'需求中心':['demands'].includes(nav.value)?'需求中心':['projects'].includes(nav.value)?'项目中心':['frameworks','agreements'].includes(nav.value)?'框架与协议':['lines','towers','spans'].includes(nav.value)?'基础台账':['dictionary','access'].includes(nav.value)?'系统管理':'项目全流程');
const displayTitle=computed(()=>nav.value==='entry'?'新建需求':nav.value==='projects'?'项目中心':nav.value==='overview'?'工作台':mediaTitle.value);
const roleWrite=computed(()=>user.value&&['admin','editor'].includes(user.value.role));
const roleVerify=computed(()=>user.value&&['admin','verifier'].includes(user.value.role));
const money=(value:any)=>value===null||value===undefined?'待核定':(Number(value)/100).toFixed(2);
const projectStage=(value:string)=>({reserve:'储备编制',stocked:'已入库',approved:'已立项',closed:'已结项'} as Rec)[value]||value;
const roleAdmin=computed(()=>user.value?.role==='admin');
const mediaTitle=computed(()=>labels[nav.value]||'');
const options=(type:string)=>items.value.filter(x=>x.type_id===type).sort((a,b)=>a.sort_order-b.sort_order);
const dictionaryRows=computed(()=>dictionaryType.value==='voltage'?voltage.value:options(dictionaryType.value));
const selectedOp=computed(()=>items.value.find(x=>x.id===common.operation_id));
const fieldDefinitions=computed<Rec[]>(()=>{try{const fields=JSON.parse(selectedOp.value?.fields_json||'[]');return Array.isArray(fields)?fields:[]}catch{return []}});
watch(()=>common.operation_id,()=>{common.custom_fields=Object.fromEntries(fieldDefinitions.value.filter(f=>f.default!==undefined).map(f=>[f.key,f.default]));for(const row of Object.values(overrides))delete row.custom_fields},{flush:'sync'});
const dateStr=(s:string)=>s?s.slice(0,10):'';
const fmtQty=(v:any)=>Number(v||0)/10000;
const statusName=(v:string)=>({pending:'待核实',active:'有效',returned:'退回',cancelled:'取消'} as Record<string,string>)[v]||v;
const visibleError=computed(()=>error.value===inlineErrorMessage.value?'':error.value);
const errorMessage=(e:any)=>{const message=e?.message||'网络请求失败';presentFormError(message,e?.details);return message};
function notify(msg:string){success.value=msg;setTimeout(()=>{if(success.value===msg)success.value=''},4000)}
async function api(path:string,method='GET',body?:any){
 const res=await fetch('/api'+path,{method,credentials:'same-origin',headers:{...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 const data=await res.json();
 if(!res.ok)throw Object.assign(Error(data.error+(data.details?'：'+data.details.map((x:any)=>'第'+x.row+'行 '+x.message).join('；'):'')),{details:data.details});
 return data;
}
async function doLogin(){error.value='';busy.value=true;try{const r=await api('/auth/login','POST',{username:username.value,password:password.value});user.value=r.user;password.value='';await refresh();}catch(e){error.value=errorMessage(e)}finally{busy.value=false}}
async function logout(){try{await api('/auth/logout','POST')}finally{user.value=null;detail.value=null}}
async function refresh(){
 try{
 const [v,l,p,t,i,ts,o]=await Promise.all([api('/voltage-levels'),api('/lines'),api('/physical-towers'),api('/logical-towers'),api('/dictionary-items'),api('/dictionary-types'),api('/overview')]);
 voltage.value=v;lines.value=l;physical.value=p;logical.value=t;items.value=i;types.value=ts;overview.value=o;
 if(!selectedLine.value&&l.length)selectedLine.value=l[0].id;
 if(nav.value==='demands'||nav.value==='overview')await loadDemands();
 }catch(e){error.value=errorMessage(e)}
}
async function loadStructure(){
 const [f,a,p,d]=await Promise.all([api('/frameworks'),api('/agreements'),api('/projects'),api('/demands?status=active')]);
 frameworks.value=f;agreements.value=a;projects.value=p;approvedDemandOptions.value=d;
}
function openStructureCreate(type:string){stage.value=type;edit.value=null;Object.keys(form).forEach(k=>delete form[k]);form.code='';form.name='';form.limit_yuan='';form.framework_id='';form.agreement_id='';form.category_id='';}
async function saveStructure(){
 error.value='';busy.value=true;
 try{
  const result=await api('/'+stage.value,'POST',{...form});
  stage.value='';await loadStructure();notify('业务台账已保存：'+result.code);
 }catch(e){error.value=errorMessage(e)}finally{busy.value=false}
}
async function openProject(item:Rec){projectAction.value='';scopePriceEdit.value=null;
 projectView.value=await api('/projects/'+item.id);
 scopeDemand.value='';scopeQuantity.value='1';scopePriceEdit.value=null;
 agreementSelection.value=projectView.value?.agreement_id||'';
 await loadExecutions(item.id);
}
async function loadExecutions(projectId:string){executionRows.value=await api('/projects/'+projectId+'/executions')}
async function createProjectExecution(){if(!projectView.value)return;error.value='';
 try{
 const r=await api('/projects/'+projectView.value.id+'/executions','POST',{number:executionNumber.value,description:executionDescription.value});
 executionNumber.value='';executionDescription.value='';await loadExecutions(projectView.value.id);
 executionView.value=r;projectAction.value='';notify('执行批次已建立');
 }catch(e){error.value=errorMessage(e)}
}
async function openExecution(id:string){executionAction.value='';completionItem.value=null;executionView.value=await api('/executions/'+id);execScopeId.value='';execQuantity.value='1'}
async function addExecutionPlan(){if(!executionView.value)return;error.value='';
 try{
 executionView.value=await api('/executions/'+executionView.value.id+'/items','POST',{version:executionView.value.version,scope_id:execScopeId.value,quantity:execQuantity.value});
 if(projectView.value)await loadExecutions(projectView.value.id);execScopeId.value='';executionAction.value='';notify('本次需求工作量已安排');
 }catch(e){error.value=errorMessage(e)}
}
async function executionStage(action:'start'|'finish'|'cancel',reason:string){
 if(!executionView.value)return;error.value='';
 try{
  executionView.value=await api('/executions/'+executionView.value.id+'/'+action,'POST',{version:executionView.value.version,reason});
  if(projectView.value)await loadExecutions(projectView.value.id);
  notify('批次状态已更新');
 }catch(e){error.value=errorMessage(e)}
}
async function confirmWork(item:Rec){if(!executionView.value)return;error.value='';
 try{
 executionView.value=await api('/executions/'+executionView.value.id+'/items/'+item.id+'/complete','POST',{
  idempotency_key:newClientId(),quantity:completeQuantity.value,occurred_on:completeDate.value,evidence:completeEvidence.value
 });
 completeQuantity.value='';completeEvidence.value='';completionItem.value=null;
 if(projectView.value)await loadExecutions(projectView.value.id);notify('实际完成量已确认入账');
 }catch(e){error.value=errorMessage(e)}
}
async function addProjectScope(){if(!projectView.value)return;
 error.value='';try{
 projectView.value=await api('/projects/'+projectView.value.id+'/scopes','POST',{version:projectView.value.version,demand_id:scopeDemand.value,quantity:scopeQuantity.value});
 scopeDemand.value='';projectAction.value='';notify('已关联需求范围');
 }catch(e){error.value=errorMessage(e)}
}
function editScopePrice(scope:Rec){
 scopePriceEdit.value=scope;
 Object.assign(scopePrice,{unit_price_yuan:scope.unit_price_fen===null?'':money(scope.unit_price_fen),price_source:scope.price_source||'',price_date:scope.price_date||new Date().toLocaleDateString('en-CA'),tax_mode:scope.tax_mode||'inclusive',reason:''});
}
async function saveScopePrice(){if(!projectView.value||!scopePriceEdit.value)return;
 error.value='';try{
 const price=scopePrice.unit_price_yuan===''?null:scopePrice.unit_price_yuan;
 projectView.value=await api('/projects/'+projectView.value.id+'/scopes/'+scopePriceEdit.value.id,'PATCH',{...scopePrice,unit_price_yuan:price,version:projectView.value.version});
 scopePriceEdit.value=null;notify('估价明细及依据已保存');
 }catch(e){error.value=errorMessage(e)}
}
async function bindProjectAgreement(){if(!projectView.value)return;error.value='';
 try{projectView.value=await api('/projects/'+projectView.value.id+'/agreement','POST',{version:projectView.value.version,agreement_id:agreementSelection.value,reason:'项目落实执行协议'});projectAction.value='';notify('已绑定唯一执行协议')}catch(e){error.value=errorMessage(e)}
}
async function advance(stageName:'stock'|'approve',reason:string){
 if(!projectView.value)return;
 error.value='';try{
  projectView.value=await api('/projects/'+projectView.value.id+'/'+stageName,'POST',{version:projectView.value.version,reason});
  await loadStructure();notify(stageName==='stock'?'入库版本已冻结并保存':'立项成功，批准预算已从估算明细生成');
 }catch(e){error.value=errorMessage(e)}
}
async function loadAccess(){const result=await api('/access/ips');allowedIPs.value=result.entries;currentClientIP.value=result.current_ip}
async function addAllowedIP(){error.value='';busy.value=true;try{
 await api('/access/ips','POST',{ip:ipInput.value,note:ipNote.value});
 ipInput.value='';ipNote.value='';await loadAccess();ipDialog.value=false;notify('访问IP已授权，立即生效');
 }catch(e){error.value=errorMessage(e)}finally{busy.value=false}}
async function removeAllowedIP(){
 if(!pendingRemoveIP.value)return;error.value='';
 try{const ip=pendingRemoveIP.value;
 await api('/access/ips/'+ip.id,'DELETE');pendingRemoveIP.value=null;
 await loadAccess();notify('已撤销 '+ip.ip+' 的访问权限')
 }catch(e){error.value=errorMessage(e)}
}
async function loadDemands(){const query=new URLSearchParams();if(statusFilter.value)query.set('status',statusFilter.value);if(search.value)query.set('search',search.value);if(lineFilter.value)query.set('line_id',lineFilter.value);demands.value=await api('/demands?'+query.toString())}
async function openNav(next:string){
 nav.value=next;detail.value=null;edit.value=null;error.value='';sidebarMobile.value=false;
 expandedGroup.value=['frameworks','agreements'].includes(next)?'frameworks':['lines','towers','spans'].includes(next)?'masters':['dictionary','access'].includes(next)?'system':'';
 stage.value='';ipDialog.value=false;projectAction.value='';executionAction.value='';completionItem.value=null;reasonAction.value='';
 if(next==='entry'&&roleWrite.value)await loadDrafts();
 if(next==='demands')await loadDemands();else if(next==='overview')await refresh();else if(next==='access')await loadAccess();else if(['frameworks','agreements','projects'].includes(next))await loadStructure()}
function openLedger(value:Rec){ledgerLineId.value=value.lineId;ledgerTab.value=value.tab||'towers';ledgerTowerId.value=value.towerId||'';void openNav('lines')}
async function seedLedgerDemands(value:Rec){
 resetBatch();demandLocationKind.value=value.kind;selectedLine.value=value.line_id;
 if(value.kind==='span'){demandSpanRows.value=value.rows.map((s:Rec)=>({...s,span_id:s.id,span_version:s.version}));common.work_target_type='line'}
 else for(const t of value.rows)selected[t.id]=true;
 await refresh();await openNav('entry');notify('已带入 '+value.rows.length+' 个'+(value.kind==='span'?'档距':'杆塔')+'位置，请填写本次工作内容和工程量');
}
function toggleMenu(group:string,landing:string){
 if(nav.value===landing)expandedGroup.value=expandedGroup.value===group?'':group;
 else void openNav(landing);
}
function addSource(){batchSources.value.push({type_id:'',discovered_on:new Date().toLocaleDateString('en-CA'),proposed_by:'',description:'',external_ref:''});}
function removeSource(index:number){if(batchSources.value.length>1)batchSources.value.splice(index,1);}
function removeSelectedLine(){for(const item of logical.value.filter(x=>x.line_id===selectedLine.value))selected[item.id]=false;}
function selectVisible(){for(const tower of thisLineTowers.value)selected[tower.id]=true;for(const tower of thisLineTowers.value)delete excluded[tower.id];}
function sourcePayload(){return batchSources.value.map(item=>({...item}));}
async function saveDict(){error.value='';busy.value=true;try{
 const voltageType=dictionaryType.value==='voltage';
 const body=voltageType?{name:form.name,status:form.status,sort_order:form.sort_order,version:form.version,reason:form.reason||'字典维护'}:{...form,type_id:dictionaryType.value,fields:form.fields_json?JSON.parse(form.fields_json):[]};
 const path=(voltageType?'/voltage-levels':'/dictionary-items')+(edit.value?'/'+edit.value.id:'');
 await api(path,edit.value?'PATCH':'POST',body);
 stage.value='';edit.value=null;notify('字典选项已持久化');await refresh()
 }catch(e){error.value=errorMessage(e)}finally{busy.value=false}}
function editDict(x?:Rec){
 edit.value=x||null;Object.keys(form).forEach(k=>delete form[k]);
 Object.assign(form,x||{code:'',name:'',status:'active',sort_order:100,work_target_type:'line',default_quantity:'1',fields_json:'[]'});
 if(x?.default_quantity_scaled)form.default_quantity=String(x.default_quantity_scaled/10000);
 stage.value='dictionary';
}
function applyDefault(){const op=selectedOp.value;if(!op)return;if(op.default_unit_id)common.unit_id=op.default_unit_id;if(op.default_quantity_scaled)common.quantity=String(op.default_quantity_scaled/10000);if(op.completion_standard)common.completion_standard=op.completion_standard;notify('已更新共同默认值；逐行自定义保留')}
function selectRange(){if(!fromRank.value||!toRank.value){error.value='请选择起止杆塔';return}const a=logical.value.find(x=>x.id===fromRank.value),b=logical.value.find(x=>x.id===toRank.value);if(!a||!b||a.line_id!==b.line_id)return;const min=Math.min(a.sort_rank,b.sort_rank),max=Math.max(a.sort_rank,b.sort_rank);for(const t of logical.value.filter(x=>x.line_id===a.line_id&&x.sort_rank>=min&&x.sort_rank<=max&&x.status==='active'))selected[t.id]=true;notify('已按台账顺序选择区段')}
function toggleAll(){selectVisible();}
function resetBatch(){demandLocationKind.value='tower';demandSpanRows.value=[];currentDraft.value=null;Object.assign(common,newCommon());batchSources.value=[{type_id:'',discovered_on:new Date().toLocaleDateString('en-CA'),proposed_by:'',description:'',external_ref:''}];Object.keys(selected).forEach(k=>delete selected[k]);Object.keys(excluded).forEach(k=>delete excluded[k]);Object.keys(overrides).forEach(k=>delete overrides[k]);batchKey.value=newClientId();lastResult.value=null;}
function payload(){return {...common,source:{...sourcePayload()[0]},sources:sourcePayload(),location_kind:demandLocationKind.value,rows:selectedRows.value.map(x=>({...((x.span_id)?{span_id:x.span_id,span_version:x.span_version}:{logical_tower_id:x.id}),target_object:x.target_object,quantity:x.quantity,custom_fields:overrides[x.id]?.custom_fields||{}})),idempotency_key:batchKey.value,...(currentDraft.value?{draft_id:currentDraft.value.id,draft_version:currentDraft.value.version}:{})};}
async function loadDrafts(){drafts.value=await api('/demand-batches?status=draft')}
async function restoreDraft(id:string){error.value='';try{
 const draft=await api('/demand-batches/'+id),saved=JSON.parse(draft.draft_json);
 resetBatch();
 common.operation_id=saved.operation_id||'';
 const {rows,sources,source,idempotency_key,draft_id,draft_version,location_kind,...fields}=saved;
 Object.assign(common,fields);common.custom_fields=saved.custom_fields||{};
 batchSources.value=sources?.length?sources:source?[source]:batchSources.value;
 if((rows||[]).some((row:Rec)=>row.span_id)){demandLocationKind.value='span';const spans=await api('/ledger/spans?status=all');demandSpanRows.value=(rows||[]).map((row:Rec)=>({...spans.find((x:Rec)=>x.id===row.span_id),id:row.span_id,span_id:row.span_id,span_version:row.span_version}));}
 for(const row of rows||[]){const id=row.span_id||row.logical_tower_id;selected[id]=true;overrides[id]={target_object:row.target_object,quantity:row.quantity,custom_fields:row.custom_fields||{}}}
 const first=logical.value.find(x=>x.id===rows?.[0]?.logical_tower_id);if(first)selectedLine.value=first.line_id;else if(demandSpanRows.value[0]?.line_id){selectedLine.value=demandSpanRows.value[0].line_id;ledgerLineId.value=selectedLine.value;}
 batchKey.value=idempotency_key||newClientId();currentDraft.value=draft;lastResult.value=null;
 notify('已恢复草稿；停用选项或位置会在提交时重新检查');
 }catch(e){error.value=errorMessage(e)}}
async function submitBatch(draft:boolean){error.value='';busy.value=true;try{
 if(draft){
  if(lastResult.value)throw Error('本批已提交，请清空重填后新建草稿');
  currentDraft.value=currentDraft.value?await api('/demand-batches/'+currentDraft.value.id,'PATCH',{version:currentDraft.value.version,draft:payload()}):await api('/demand-batches/drafts','POST',payload());
  await loadDrafts();notify('草稿已保存，版本 v'+currentDraft.value!.version);return;
 }
 const r=await api('/demand-batches/submit','POST',payload());lastResult.value=r;notify('成功创建 '+r.count+' 条待核实需求（'+batchSources.value.length+' 条来源分别关联）');
 await loadDrafts();await refresh();await loadDemands();
 }catch(e){error.value=errorMessage(e)}finally{busy.value=false}}
async function revalidateDemandLocation(reason:string){
 if(!detail.value)return;error.value='';
 try{detail.value=await api('/demands/'+detail.value.id+'/revalidate-location','POST',{version:detail.value.version,reason});notify('位置已更新为新版本，请重新确认有效');await loadDemands()}catch(e){error.value=errorMessage(e)}
}
async function uploadAttachment(event:Event){const input=event.target as HTMLInputElement,file=input.files?.[0];if(!file||!detail.value)return;
 error.value='';busy.value=true;try{
 if(file.size>15*1024*1024)throw Error('附件不能超过15MB');
 const res=await fetch('/api/attachments',{method:'POST',credentials:'same-origin',headers:{'x-owner-type':'demand','x-owner-id':detail.value.id,'x-filename':encodeURIComponent(file.name),'content-type':file.type||'application/octet-stream'},body:file});
 const data=await res.json();if(!res.ok)throw Error(data.error);
 detail.value=await api('/demands/'+detail.value.id);attachmentDialog.value=false;notify('附件已上传');
 }catch(e){error.value=errorMessage(e);presentFormError(error.value,undefined,input)}finally{busy.value=false;input.value=''}
}
async function showDemand(id:string){demandEdit.value=null;try{detail.value=await api('/demands/'+id);stage.value='demand'}catch(e){error.value=errorMessage(e)}}
async function verify(status:string,reason:string){if(!detail.value)return;error.value='';try{detail.value=await api('/demands/'+detail.value.id+'/verify','POST',{status,version:detail.value.version,reason});await loadDemands();notify('核实结果已保存')}catch(e){error.value=errorMessage(e)}}
async function reviseDemand(reason:string){if(!detail.value||!demandEdit.value)return;error.value='';try{
 detail.value=await api('/demands/'+detail.value.id,'PATCH',{...demandEdit.value,version:detail.value.version,quantity:String(demandEdit.value.quantity),reason});
 demandEdit.value=null;notify('修订已保存并保留历史');await loadDemands()
 }catch(e){error.value=errorMessage(e)}}
function openDemandEdit(){
 if(!detail.value)return;error.value='';
 demandEdit.value={...JSON.parse(JSON.stringify(detail.value)),quantity:String(detail.value.quantity_scaled/10000)};
}
async function saveDemandEdit(){
 if(!demandEdit.value)return;const reason=String(demandEdit.value.change_reason||'').trim();
 if(!reason){error.value='请填写修订原因';return}
 await reviseDemand(reason);
}
function openReason(kind:string){reasonValue.value='';error.value='';reasonAction.value=kind}
const reasonTitle=computed(()=>reasonAction.value.startsWith('verify:')?'需求核实意见':
 reasonAction.value==='revise'?'需求修订依据':reasonAction.value==='revalidate'?'位置重新核实依据':
 reasonAction.value==='project:stock'?'确认项目入库':reasonAction.value==='project:approve'?'确认立项批准':
 reasonAction.value==='execution:start'?'确认开工':reasonAction.value==='execution:finish'?'结束本次执行':'业务确认依据');
async function submitReason(){
 const kind=reasonAction.value,reason=reasonValue.value.trim();if(!kind||!reason)return;
 error.value='';
 if(kind.startsWith('verify:'))await verify(kind.split(':')[1],reason);
 else if(kind==='revise')await reviseDemand(reason);
 else if(kind==='revalidate')await revalidateDemandLocation(reason);
 else if(kind.startsWith('project:'))await advance(kind.slice(8) as 'stock'|'approve',reason);
 else if(kind.startsWith('execution:'))await executionStage(kind.slice(10) as 'start'|'finish'|'cancel',reason);
 if(!error.value){reasonAction.value='';reasonValue.value=''}
}
function exportDemands(){const q=new URLSearchParams();if(statusFilter.value)q.set('status',statusFilter.value);if(search.value)q.set('search',search.value);if(lineFilter.value)q.set('line_id',lineFilter.value);window.location.href='/api/demands/export.xlsx?'+q.toString()}
watch([ledgerLineId,ledgerTab],()=>{try{sessionStorage.setItem('ledger-line',ledgerLineId.value);sessionStorage.setItem('ledger-tab',ledgerTab.value)}catch{}});
onMounted(async()=>{try{user.value=(await api('/auth/me')).user;await refresh()}catch{user.value=null}});
watch([statusFilter,search,lineFilter],()=>{if(user.value&&nav.value==='demands')loadDemands().catch(e=>error.value=errorMessage(e))});
</script>
<template>
<div v-if="!user" class="auth-bg"><div class="auth-card"><div class="logo">SD</div><h1>输电项目全流程管理</h1><p class="muted">使用本地服务器账号登录</p><form v-form-validation novalidate @submit.prevent="doLogin"><label><span class="field-caption">用户名</span><input v-model="username" autocomplete="username" required placeholder="输入用户名"/></label><label><span class="field-caption">密码</span><input v-model="password" type="password" autocomplete="current-password" required placeholder="输入密码"/></label><p v-if="visibleError" class="error">{{visibleError}}</p><button class="primary full" :disabled="busy">登录系统</button></form><p class="minor">首次部署请在服务器运行「初始化管理员.cmd」</p></div></div>
<div v-else class="shell">
 <header class="app-header">
  <div class="app-brand"><div class="logo sm">输</div><strong>输电项目管理</strong></div>
  <div class="header-right"><span>项目全流程</span><span class="header-separator">·</span><span>本地业务系统</span><button v-if="roleAdmin" class="header-link" @click="openNav('access')">系统管理</button><div class="user-initial" :title="user.username">{{user.username.substring(0,1).toUpperCase()}}</div></div>
 </header>
 <div class="app-body">
 <aside class="sidebar" :class="{'mobile-open':sidebarMobile}">
  <div class="sidebar-label">项目全流程</div>
  <button class="nav-primary" :class="{active:nav==='overview'}" @click="openNav('overview')"><span class="nav-icon">▦</span>工作台</button>
  <button class="nav-primary" :class="{active:['entry','demands'].includes(nav)}" @click="openNav('demands')"><span class="nav-icon">▣</span>需求中心</button>
  <div v-if="['entry','demands'].includes(nav)" class="nav-submenu"><button :class="{active:nav==='entry'}" @click="openNav('entry')">新建需求</button><button :class="{active:nav==='demands'}" @click="openNav('demands')">需求台账</button></div>
  <button class="nav-primary" :class="{active:nav==='projects'}" @click="openNav('projects')"><span class="nav-icon">▱</span>项目中心</button>
  <button class="nav-primary" :class="{active:['frameworks','agreements'].includes(nav)}" :aria-expanded="expandedGroup==='frameworks'" @click="toggleMenu('frameworks','frameworks')"><span class="nav-icon">♧</span>框架与协议<SidebarChevron :open="expandedGroup==='frameworks'"/></button>
  <div v-if="expandedGroup==='frameworks'" class="nav-submenu"><button :class="{active:nav==='frameworks'}" @click="openNav('frameworks')">项目框架</button><button :class="{active:nav==='agreements'}" @click="openNav('agreements')">执行协议</button></div>
  <button class="nav-primary" :class="{active:['lines','towers','spans'].includes(nav)}" :aria-expanded="expandedGroup==='masters'" @click="toggleMenu('masters','lines')"><span class="nav-icon">⚑</span>基础台账<SidebarChevron :open="expandedGroup==='masters'"/></button>
  <div v-if="expandedGroup==='masters'" class="nav-submenu"><button :class="{active:nav==='lines'}" @click="openNav('lines')">线路台账</button><button :class="{active:nav==='towers'}" @click="openNav('towers')">杆塔查询</button><button :class="{active:nav==='spans'}" @click="openNav('spans')">档距查询</button></div>
  <button v-if="roleAdmin" class="nav-primary" :class="{active:['dictionary','access'].includes(nav)}" :aria-expanded="expandedGroup==='system'" @click="toggleMenu('system','access')"><span class="nav-icon">⚙</span>系统管理<SidebarChevron :open="expandedGroup==='system'"/></button>
  <div v-if="roleAdmin&&expandedGroup==='system'" class="nav-submenu"><button :class="{active:nav==='dictionary'}" @click="openNav('dictionary')">数据字典</button><button :class="{active:nav==='access'}" @click="openNav('access')">IP访问管理</button></div>
  <div class="sidebar-footer"><div><strong>{{user.username}}</strong><small>{{user.role}}</small></div><button class="light" @click="logout">退出</button></div>
 </aside>
 <main class="main">
  <div class="page-heading">
   <div class="breadcrumb"><span>{{sectionLabel}}</span><span class="breadcrumb-slash">/</span><strong>{{nav==='entry'?'新建需求':displayTitle}}</strong></div>
   <div class="page-heading-title"><h1>{{displayTitle}}</h1><span v-if="nav==='entry'" class="subtle-tag">逐基独立生成</span></div>
   <p class="page-description">{{nav==='entry'?'选择多个位置，共同内容填一次；逐基差异在预览中调整。':nav==='overview'?'掌握项目与需求的当前状态。':nav==='demands'?'查看、核实和跟踪每一条需求。':nav==='access'?'由管理员逐个配置允许访问服务器的 IP 地址。':nav==='projects'?'从项目储备到立项及分次执行的全过程管理。':'维护真实业务台账与版本历史。'}}</p>
  </div>
  <p v-if="visibleError" role="alert" class="alert error">{{visibleError}} <button @click="error=''">×</button></p><p v-if="success" role="status" class="alert ok">{{success}}</p>
  <template v-if="nav==='overview'"><div class="stats"><div v-for="(label,key) in {lines:'线路',physical:'实体杆塔',logical:'逻辑杆塔',pending:'待核实需求',active:'有效需求'}" :key="key" class="stat"><small>{{label}}</small><strong>{{overview[key]??0}}</strong></div></div><section class="panel"><div class="section-header"><div><h2>待核实事项</h2><p class="muted">基于当前数据库实际记录</p></div><button class="secondary" @click="openNav('demands')">进入需求中心</button></div><div v-if="!demands.filter(x=>x.status==='pending').length" class="empty">当前没有待核实需求</div><div v-else class="table-wrap"><table><thead><tr><th>需求编号</th><th>位置</th><th>操作</th><th>工作量</th><th></th></tr></thead><tbody><tr v-for="d in demands.filter(x=>x.status==='pending').slice(0,8)" :key="d.id"><td>{{d.demand_no}}</td><td>{{d.line_name_snapshot}} {{d.tower_no_snapshot}}</td><td>{{d.operation_snapshot}} · {{d.target_object}}</td><td>{{fmtQty(d.quantity_scaled)}} {{d.unit_snapshot}}</td><td><button class="link" @click="openNav('demands');showDemand(d.id)">查看</button></td></tr></tbody></table></div></section></template>
  <LedgerWorkspace v-if="['lines','towers','spans'].includes(nav)" :user="user" :view="nav" v-model:line-id="ledgerLineId" v-model:focus-tab="ledgerTab" :focus-tower="ledgerTowerId" @workspace="openLedger" @changed="refresh" @demands="seedLedgerDemands"/>
  <template v-if="['frameworks','agreements','projects'].includes(nav)">
   <section class="panel">
    <div class="section-header"><div><h2>{{mediaTitle}}</h2><p class="muted">框架 → 执行协议 → 子项目 → 多次执行；当前阶段保留独立业务ID与审批快照</p></div><button v-if="roleWrite" class="primary" @click="openStructureCreate(nav)">新增{{mediaTitle}}</button></div>
    <div class="table-wrap"><table>
     <thead><tr><th>业务编码</th><th>名称</th><th v-if="nav!=='frameworks'">所属框架/协议</th><th>{{nav==='projects'?'已批准预算 (元)':'授权额度 (元)'}}</th><th>状态</th><th>操作</th></tr></thead>
     <tbody>
      <tr v-for="x in nav==='frameworks'?frameworks:nav==='agreements'?agreements:projects" :key="x.id">
       <td class="mono">{{x.code}}</td><td>{{x.name}}</td><td v-if="nav!=='frameworks'">{{nav==='agreements'?x.framework_name:(x.agreement_name||'暂未绑定协议')}}</td>
       <td>{{money(nav==='projects'?x.approved_budget_fen:x.limit_fen)}}</td><td><span class="tag">{{nav==='projects'?projectStage(x.status):(x.status==='active'?'启用':'停用')}}</span></td>
       <td><button v-if="nav==='projects'" class="link" @click="openProject(x)">需求范围与阶段</button><span v-else class="muted">{{nav==='frameworks'?'协议额度：'+money(x.agreement_limit_fen):'已批准预算：'+money(x.approved_budget_fen)}}</span></td>
      </tr><tr v-if="!(nav==='frameworks'?frameworks:nav==='agreements'?agreements:projects).length"><td colspan="6" class="empty">暂无记录，请从创建框架开始</td></tr>
     </tbody>
    </table></div>
   </section>
<FormModal :open="stage===nav" :title="'创建'+mediaTitle" :error="visibleError" size="normal" @close="stage='';edit=null">
    <form v-form-validation novalidate class="form-grid" @submit.prevent="saveStructure">
     <label><span class="field-caption">业务编码</span><input v-model.trim="form.code" required placeholder="唯一稳定业务编码"/></label>
     <label><span class="field-caption">名称</span><input v-model.trim="form.name" required/></label>
     <label v-if="nav!=='projects'"><span class="field-caption">授权额度（元）</span><input v-model.trim="form.limit_yuan" data-validate="money" required inputmode="decimal" placeholder="100000.00"/></label>
     <label v-if="nav==='agreements'"><span class="field-caption">所属框架</span><select v-model="form.framework_id" required><option value="">请选择</option><option v-for="f in frameworks.filter(x=>x.status==='active')" :key="f.id" :value="f.id">{{f.name}}</option></select></label>
     <label v-if="nav==='projects'"><span class="field-caption">拟归属执行协议（储备阶段可不选）</span><select v-model="form.agreement_id"><option value="">待落实</option><option v-for="a in agreements.filter(x=>x.status==='active')" :key="a.id" :value="a.id">{{a.name}} · {{a.framework_name}}</option></select></label>
     <label v-if="nav==='projects'"><span class="field-caption">储备类别</span><select v-model="form.category_id"><option value="">待分类</option><option v-for="c in options('category').filter(x=>x.status==='active')" :key="c.id" :value="c.id">{{c.name}}</option></select></label>
     <div class="wide form-actions"><button type="button" class="light" @click="stage=''">取消</button><button class="primary" :disabled="busy">保存</button></div>
    </form>
   </FormModal>
  </template>
  <section v-if="projectView" class="detail-overlay" @click.self="projectView=null"><div class="detail-panel">
   <div class="section-header"><div><h2>{{projectView.code}} · {{projectView.name}}</h2><span class="tag">{{projectStage(projectView.status)}} · v{{projectView.version}}</span></div><button class="light" @click="projectView=null">关闭 ×</button></div>
   <div class="info-grid"><div><small>已知估算（元）</small><strong>{{money(projectView.estimate.known_total_fen)}}</strong></div><div><small>待定价项</small><strong>{{projectView.estimate.missing_price_count}}</strong></div><div><small>批准预算（元）</small><strong>{{money(projectView.approved_budget_fen)}}</strong></div><div><small>需求范围条数</small><strong>{{projectView.estimate.total}}</strong></div></div>
   <h3>关联执行协议</h3>
   <div class="toolbar"><span class="muted">{{agreements.find(x=>x.id===projectView?.agreement_id)?.name||'暂未关联执行协议'}}</span>
    <button v-if="roleWrite&&['reserve','stocked'].includes(projectView.status)" class="secondary" @click="projectAction='agreement'">设置执行协议</button>
   </div>
   <FormModal :open="projectAction==='agreement'" title="选择执行协议" :error="visibleError" @close="projectAction=''">
    <form v-form-validation novalidate class="form-grid" @submit.prevent="bindProjectAgreement">
     <label class="wide"><span class="field-caption">唯一执行协议</span><select v-model="agreementSelection" required><option value="">请选择</option><option v-for="a in agreements.filter(x=>x.status==='active')" :key="a.id" :value="a.id">{{a.name}} · {{a.framework_name}}</option></select></label>
     <div class="form-actions"><button type="button" class="light" @click="projectAction=''">取消</button><button class="primary">确认协议归属</button></div>
    </form>
   </FormModal>
   <h3>项目需求范围与估价</h3><p class="muted">每条明细引用已核实的需求版本；金额按工作量×单价计算，缺价不视为零。</p>
   <div v-for="scope in projectView.scopes" :key="scope.id" class="scope-item">
    <div class="section-header"><div><strong>{{scope.demand_no}} · {{scope.line_name_snapshot}} {{scope.tower_no_snapshot}}</strong><p class="muted">{{scope.operation_snapshot}} · {{scope.target_object}}</p></div><button v-if="roleWrite&&['reserve','stocked'].includes(projectView.status)" class="link" @click="editScopePrice(scope)">估价依据</button></div>
    <p>计划 {{fmtQty(scope.quantity_scaled)}} {{scope.unit_snapshot}} · 单价 {{money(scope.unit_price_fen)}} 元 · {{scope.price_source||'价格待确定'}}</p>
   </div>
   <button v-if="roleWrite&&projectView.status==='reserve'" class="secondary" @click="projectAction='scope'">＋ 关联需求范围</button>
   <FormModal :open="projectAction==='scope'" title="关联需求范围" :error="visibleError" @close="projectAction=''">
       <form v-form-validation novalidate class="form-grid" @submit.prevent="addProjectScope">
    <label class="wide"><span class="field-caption">纳入有效需求</span><select v-model="scopeDemand" required><option value="">请选择</option><option v-for="d in eligibleDemands" :key="d.id" :value="d.id">{{d.demand_no}} · {{d.line_name_snapshot}} {{d.tower_no_snapshot}} · {{d.operation_snapshot}}</option></select></label>
    <label><span class="field-caption">本项目拟覆盖工作量</span><input v-model="scopeQuantity" data-validate="quantity" required inputmode="decimal"/></label><div class="form-actions"><button class="secondary">关联需求</button></div>
   </form>
   </FormModal>
   <FormModal :open="!!scopePriceEdit" title="核定估价依据" :error="visibleError" @close="scopePriceEdit=null">
      <form v-form-validation novalidate class="form-grid scope-editor" @submit.prevent="saveScopePrice">
    <label><span class="field-caption">核定单价（元）</span><input v-model="scopePrice.unit_price_yuan" data-validate="money" inputmode="decimal" placeholder="留空代表待估价"/></label>
    <label><span class="field-caption">价格依据</span><input v-model="scopePrice.price_source" placeholder="物资报价或有效定额编号"/></label>
    <label><span class="field-caption">依据日期</span><input type="date" v-model="scopePrice.price_date"/></label>
    <label><span class="field-caption">税口径</span><select v-model="scopePrice.tax_mode"><option value="inclusive">含税</option><option value="exclusive">不含税</option><option value="none">不适用</option></select></label>
    <label class="wide"><span class="field-caption">修订原因</span><input v-model="scopePrice.reason" placeholder="核定或调整依据"/></label>
    <div class="wide form-actions"><button class="primary">保存估价</button><button type="button" class="light" @click="scopePriceEdit=null">取消</button></div>
   </form>
   </FormModal>
   <div v-if="roleWrite&&projectView.status==='reserve'" class="form-actions"><button class="primary" :disabled="!projectView.scopes.length" @click="openReason('project:stock')">确认项目入库</button></div>
   <div v-if="roleWrite&&projectView.status==='stocked'" class="form-actions"><button class="primary" :disabled="!projectView.estimate.complete||!projectView.agreement_id" @click="openReason('project:approve')">确认立项及预算</button></div>
   <h3>分次执行</h3>
   <div v-if="!executionRows.length" class="empty">尚无执行批次</div>
   <div v-for="e in executionRows" :key="e.id" class="scope-item"><div class="section-header"><div><strong>{{e.number}} · {{e.description}}</strong><p class="muted">{{e.item_count}} 条计划 · 确认工作量 {{fmtQty(e.completed_quantity_scaled)}}（不同单位不能合计核算）</p></div><button class="link" @click="openExecution(e.id)">进入执行</button></div><span class="tag">{{e.status}}</span></div>
   <button v-if="roleWrite&&projectView.status==='approved'" class="secondary" @click="projectAction='execution'">＋ 新建执行批次</button>
   <FormModal :open="projectAction==='execution'" title="新建执行批次" :error="visibleError" @close="projectAction=''">
       <form v-form-validation novalidate class="form-grid" @submit.prevent="createProjectExecution">
     <label><span class="field-caption">执行批次编号</span><input v-model="executionNumber" required placeholder="如 2026-01"/></label><label><span class="field-caption">施工说明</span><input v-model="executionDescription" placeholder="本次施工任务"/></label><div class="wide form-actions"><button class="secondary">新建执行批次</button></div>
   </form>
   </FormModal>
   <h3>阶段快照</h3><div v-for="e in projectView.events" :key="e.id" class="history">{{e.created_at}} · {{e.stage==='stocked'?'入库':'立项'}} · {{e.reason}} · 版本 {{e.project_version}}</div>
  </div></section>
  <section v-if="executionView" class="detail-overlay execution-overlay" @click.self="executionView=null"><div class="detail-panel">
   <div class="section-header"><div><h2>执行批次 {{executionView.number}}</h2><span class="tag">{{executionView.status}} · v{{executionView.version}}</span></div><button class="light" @click="executionView=null">返回项目</button></div>
   <p>{{executionView.description||'本次执行需求范围'}}</p>
   <div v-for="i in executionView.items" :key="i.id" class="scope-item">
    <h3>{{i.demand_no}} · {{i.line_name_snapshot}} {{i.tower_no_snapshot}}</h3>
    <p>{{i.operation_snapshot}} · {{i.target_object}}</p>
    <p>计划 {{fmtQty(i.planned_quantity_scaled)}} {{i.unit_snapshot}} · 已确认 {{fmtQty(i.completed_quantity_scaled)}} {{i.unit_snapshot}}</p>
    <button v-if="executionView.status==='running'&&roleWrite" class="secondary" @click="completionItem=i">确认完成量</button>

   </div>
   <FormModal :open="!!completionItem" :title="'确认实际完成量：'+(completionItem?.demand_no||'')" :error="visibleError" @close="completionItem=null">
        <form v-form-validation novalidate @submit.prevent="confirmWork(completionItem!)" class="form-grid">
     <label><span class="field-caption">本次确认量</span><input v-model="completeQuantity" data-validate="quantity" required inputmode="decimal"/></label><label><span class="field-caption">实施日期</span><input v-model="completeDate" required type="date"/></label>
     <label class="wide"><span class="field-caption">完成依据 / 验收说明</span><input v-model="completeEvidence" required/></label><div class="wide form-actions"><button class="secondary">确认实际完成量</button></div>
    </form>
   </FormModal>
   <button v-if="executionView.status==='planned'&&roleWrite" class="secondary" @click="executionAction='plan'">＋ 安排工作明细</button>
   <FormModal :open="executionAction==='plan'" title="安排本次执行明细" :error="visibleError" @close="executionAction=''">
       <form v-form-validation novalidate @submit.prevent="addExecutionPlan" class="form-grid">
    <label class="wide"><span class="field-caption">安排批准范围</span><select v-model="execScopeId" required><option value="">请选择</option><option v-for="s in eligibleExecutionScopes" :key="s.id" :value="s.id">{{s.demand_no}} · {{s.line_name_snapshot}} {{s.tower_no_snapshot}}</option></select></label>
    <label><span class="field-caption">本批次拟完成工作量</span><input v-model="execQuantity" data-validate="quantity" required inputmode="decimal"/></label><div class="form-actions"><button class="secondary">安排工作明细</button></div>
   </form>
   </FormModal>
   <div v-if="roleWrite" class="form-actions">
    <button v-if="executionView.status==='planned'" class="primary" :disabled="!executionView.items.length" @click="openReason('execution:start')">确认开工</button>
    <button v-if="executionView.status==='running'" class="primary" @click="openReason('execution:finish')">结束本次执行</button>
    <button v-if="executionView.status==='planned'" class="light" @click="openReason('execution:cancel')">取消未开工批次</button>
   </div>
   <p class="muted minor">完成量按每项批准范围核对，超计划确认会被数据库事务拒绝。实际费用与结算另行记录，不由完成量自动推算。</p>
  </div></section>
  <template v-if="nav==='access'">
    <section class="panel"><div class="section-header"><div><h2>允许访问的 IP</h2><p class="muted">逐个配置具体IP地址；保存后无需重启服务</p></div></div>
      <p class="muted">服务器识别到本次连接的地址：<strong class="mono">{{currentClientIP}}</strong>。本机 127.0.0.1 和 ::1 永久允许，用于初始化和应急管理。其他地址未加入列表时默认拒绝。</p>
      <button class="primary" @click="ipDialog=true">＋ 添加允许 IP</button>
      <FormModal :open="ipDialog" title="添加允许访问的 IP" :error="visibleError" @close="ipDialog=false">
             <form v-form-validation novalidate class="form-grid" @submit.prevent="addAllowedIP">
        <label><span class="field-caption">IP 地址</span><input v-model.trim="ipInput" required placeholder="例如 192.168.1.105 或 2001:db8::1"/></label>
        <label><span class="field-caption">设备 / 用途备注</span><input v-model.trim="ipNote" placeholder="例如 运检班组办公电脑"/></label>
        <button class="primary" :disabled="busy||!ipInput">添加允许 IP</button>
      </form>
      </FormModal>

      <FormModal :open="!!pendingRemoveIP" title="移除 IP 访问权限" :error="visibleError" @close="pendingRemoveIP=null">
       <p>确定撤销 <strong class="mono">{{pendingRemoveIP?.ip}}</strong> 的访问授权吗？撤销后，新连接将立即被拒绝。</p>
       <div class="form-actions"><button class="light" @click="pendingRemoveIP=null">取消</button><button class="primary" @click="removeAllowedIP">确认移除</button></div>
      </FormModal>
      <div class="table-wrap"><table><thead><tr><th>允许的IP</th><th>设备备注</th><th>添加时间</th><th>添加人</th><th>操作</th></tr></thead>
        <tbody><tr v-for="x in allowedIPs" :key="x.id"><td class="mono">{{x.ip}}</td><td>{{x.note||'—'}}</td><td>{{x.created_at}}</td><td>{{x.created_by_name}}</td><td><button class="link danger" @click="pendingRemoveIP=x">移除</button></td></tr><tr v-if="!allowedIPs.length"><td colspan="5" class="empty">目前没有授权任何远程 IP，仅服务器本机可以访问。</td></tr></tbody></table></div>
      <p class="muted minor">只允许精确 IP 地址，不允许填网段、IP 范围或域名。验证使用真实 TCP 连接地址，不相信浏览器传入的代理头。IP 授权不能替代账号登录；Windows 防火墙仍需单独放行服务端口。</p>
    </section>
  </template>
  <template v-if="nav==='dictionary'"><section class="panel"><div class="section-header"><h2>数据字典管理</h2><button class="primary" @click="editDict()">新增选项</button></div><p v-if="dictionaryType==='voltage'" class="muted">电压等级属于系统基础字典。线路引用同一份字典，停用后不再允许新增线路选用，已有线路关联保留。</p><div class="toolbar"><label><span class="field-caption">类别</span><select v-model="dictionaryType" @change="stage='';edit=null"><option value="voltage">电压等级</option><option v-for="t in types" :key="t.id" :value="t.id">{{t.title}}</option></select></label></div><div class="table-wrap"><table><thead><tr><th v-if="dictionaryType!=='voltage'">编码</th><th>名称</th><th>版本</th><th>顺序</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="x in dictionaryRows" :key="x.id"><td v-if="dictionaryType!=='voltage'" class="mono">{{x.code}}</td><td>{{x.name}}</td><td>v{{x.version}}</td><td>{{x.sort_order}}</td><td><span class="tag">{{x.status==='active'?'启用':'停用'}}</span></td><td><button class="link" @click="editDict(x)">配置</button></td></tr><tr v-if="!dictionaryRows.length"><td :colspan="dictionaryType==='voltage'?5:6" class="empty">尚未配置选项。请创建真实业务选项。</td></tr></tbody></table></div></section>
<FormModal :open="stage==='dictionary'" :title="edit?'调整选项 v'+edit.version:'新增选项'" :error="visibleError" size="wide" @close="stage='';edit=null">
    <form v-form-validation novalidate class="form-grid" @submit.prevent="saveDict"><label v-if="dictionaryType!=='voltage'"><span class="field-caption">编码</span><input required v-model="form.code"/></label><label><span class="field-caption">名称</span><input required v-model="form.name"/></label><label><span class="field-caption">排序</span><input type="number" v-model.number="form.sort_order"/></label><label><span class="field-caption">状态</span><select v-model="form.status"><option value="active">启用</option><option value="inactive">停用</option></select></label>
    <template v-if="dictionaryType==='operation'"><label><span class="field-caption">适用对象</span><select v-model="form.work_target_type"><option value="line">线路侧作业</option><option value="physical">共用实体作业</option><option value="both">两者适用</option></select></label><label><span class="field-caption">默认单位</span><select v-model="form.default_unit_id"><option value="">不设默认</option><option v-for="x in units" :key="x.id" :value="x.id">{{x.name}}</option></select></label><label><span class="field-caption">默认每项数量</span><input v-model="form.default_quantity" data-validate="quantity" placeholder="1"/></label><label class="wide"><span class="field-caption">默认完成标准</span><input v-model="form.completion_standard"/></label><label class="wide"><span class="field-caption">字段模板 JSON</span><textarea v-model="form.fields_json" data-validate="json" rows="2"/></label></template><div class="wide form-actions"><button type="button" class="light" @click="stage='';edit=null">取消</button><button class="primary" :disabled="busy">保存配置</button></div></form>
   </FormModal>
  </template>
  <template v-if="nav==='entry'">
   <form v-form-validation novalidate class="entry-main" @submit.prevent="submitBatch(false)">
    <section v-if="roleWrite" class="panel"><div class="section-header"><h2>{{currentDraft?'正在编辑草稿 v'+currentDraft.version:'需求草稿'}}</h2><button type="button" class="secondary" @click="draftsOpen=!draftsOpen;loadDrafts()">{{draftsOpen?'收起草稿':'查看草稿'}}（{{drafts.length}}）</button></div>
     <div v-if="draftsOpen"><p v-if="!drafts.length" class="muted">暂无未提交草稿</p><div v-for="draft in drafts" :key="draft.id" class="scope-item"><span>{{draft.updated_at}} · v{{draft.version}} · {{draft.id.slice(0,8)}}</span><button type="button" class="link" @click="restoreDraft(draft.id)">继续编辑</button></div></div>
    </section>
    <div class="entry-card">
     <section class="entry-section panel">
      <div class="entry-section-head"><div class="entry-section-title"><span class="step-number">01</span><h2>选择位置</h2></div><span class="section-note">可跨线路追加</span></div>
      <div v-if="demandLocationKind==='span'" class="scope-item"><strong>当前按档距创建需求</strong><p>已选 {{demandSpanRows.length}} 个档距。长度是台账参考，本次工程量请在共同内容或逐档预览中确认。</p><p v-for="span in demandSpanRows" :key="span.id">{{span.line_name}} {{span.start_tower_no}}—{{span.end_tower_no}} · 台账长度 {{span.length_scaled===null?'未填写':fmtQty(span.length_scaled)+'米'}}</p><button type="button" class="secondary" @click="openLedger({lineId:selectedLine,tab:'spans'})">返回线路调整所选档距</button></div>
      <template v-else>
      <label class="field-full"><span class="field-caption">选择线路 <span class="required-star" aria-hidden="true">*</span></span><select v-model="selectedLine" required><option value="">请选择线路</option><option v-for="l in lines.filter(x=>x.status==='active')" :value="l.id" :key="l.id">{{l.voltage_name}} · {{l.name}}</option></select>
      </label>
      <p class="field-hint">切换线路后已选位置仍保留，选择1基即可单条创建。</p>
      <div class="selection-tools">
       <strong>本线路已选 {{thisLineSelected}} / {{thisLineTotal}} 基</strong>
       <div class="selection-actions">
        <button type="button" class="text-button" @click="selectVisible" :disabled="!selectedLine">全选本线路</button>
        <button type="button" class="text-button" @click="removeSelectedLine" :disabled="!selectedLine">清空本线路</button>
        <button type="button" class="text-button" @click="rangeOpen=!rangeOpen">{{rangeOpen?'收起按杆段选择':'按杆段选择'}}</button>
       </div>
      </div>
      <div v-if="rangeOpen" class="range-picker">
       <label><span class="field-caption">杆段起点</span><select v-model="fromRank"><option value="">请选择</option><option v-for="x in logical.filter(x=>x.line_id===selectedLine&&x.status==='active').sort((a,b)=>a.sort_rank-b.sort_rank)" :value="x.id" :key="x.id">{{x.tower_no}}</option></select></label>
       <label><span class="field-caption">杆段终点</span><select v-model="toRank"><option value="">请选择</option><option v-for="x in logical.filter(x=>x.line_id===selectedLine&&x.status==='active').sort((a,b)=>a.sort_rank-b.sort_rank)" :value="x.id" :key="x.id">{{x.tower_no}}</option></select></label>
       <button type="button" class="secondary" @click="selectRange">追加选择</button>
      </div>
      <label class="field-full tower-filter"><span class="field-caption">筛选杆塔</span><input v-model="towerSearch" placeholder="输入杆塔号或位置编码"/>
      </label>
      <div class="tower-grid" aria-label="杆塔选择">
       <label v-for="x in thisLineTowers" :key="x.id" class="tower-card" :class="{checked:selected[x.id]&&!excluded[x.id]}"><input type="checkbox" :checked="!!selected[x.id]&&!excluded[x.id]" @change="(e)=>{selected[x.id]=(e.target as HTMLInputElement).checked;delete excluded[x.id]}"/>
        <span><strong>{{x.tower_no}}</strong><small v-if="x.circuit_position">{{x.circuit_position}}</small></span>
       </label>
       <p v-if="!thisLineTowers.length" class="empty">当前筛选下暂无可选的启用杆塔</p>
      </div>
      <div v-if="selectedLines.length" class="selected-lines">
       <span class="small-chip" v-for="l in selectedLines" :key="l.id">{{l.name}} {{selectedRows.filter(x=>x.line_id===l.id).length}} 基</span>
      </div>
      </template>
     </section>

     <section class="entry-section panel">
      <div class="entry-section-head"><div class="entry-section-title"><span class="step-number">02</span><h2>共同工作内容</h2></div><span class="section-note">应用于本批需求</span></div>
      <label class="field-full">作业对象 <span class="required-star" aria-hidden="true">*</span></label>
      <div class="segmented-work" role="group" aria-label="作业对象">
       <button type="button" :class="{chosen:common.work_target_type==='line'}" @click="common.work_target_type='line';common.operation_id=''">线路侧设备</button>
       <button type="button" :class="{chosen:common.work_target_type==='physical'}" :disabled="demandLocationKind==='span'" @click="common.work_target_type='physical';common.operation_id=''">共用物理杆塔</button>
      </div>
      <p class="field-hint">{{common.work_target_type==='line'?'各线路杆塔独立生成需求，不因共塔自动合并。':'共塔同部位的作业必须明确选择一个主位置，其他回路在关联位置中记录。'}}</p>
      <div class="form-grid entry-fields">
       <div class="field-label-group">
        <div class="inline-field-top"><span class="field-title">操作类型 <span class="required-star" aria-hidden="true">*</span></span><button type="button" v-if="roleAdmin" class="text-button small" @click="openNav('dictionary')">管理选项</button></div>
        <select aria-label="操作类型" v-model="common.operation_id" required><option value="">请选择操作类型</option><option v-for="op in ops" :key="op.id" :value="op.id">{{op.name}}</option></select>
       </div>
       <label><span class="field-caption">共同处理部位 <span class="required-star" aria-hidden="true">*</span></span><input v-model="common.target_object" required placeholder="例如 横担上部"/></label>
       <div class="field-label-group"><div class="inline-field-top"><span class="field-title">{{demandLocationKind==='span'?'每档工作量':'每基工作量'}} <span class="required-star" aria-hidden="true">*</span></span><button type="button" class="text-button small" @click="applyDefault">应用操作默认值</button></div>
        <div class="quantity-inputs"><input :aria-label="demandLocationKind==='span'?'每档工作量':'每基工作量'" v-model="common.quantity" required data-validate="quantity" inputmode="decimal" placeholder="1"/><select v-model="common.unit_id" required aria-label="计量单位"><option value="">单位</option><option v-for="x in units" :key="x.id" :value="x.id">{{x.name}}</option></select></div>
        <p class="field-hint">每个位置的本次工作量为{{common.quantity||'—'}}{{items.find(x=>x.id===common.unit_id)?.name||'单位'}}，选{{selectedRows.length}}个位置共{{Number(totalQty.toFixed(4))}}{{items.find(x=>x.id===common.unit_id)?.name||'单位'}}。</p>
       </div>
       <label><span class="field-caption">完成标准 <span class="required-star" aria-hidden="true">*</span></span><input v-model="common.completion_standard" required placeholder="按核定部位完成安装并验收合格"/></label>
       <label class="wide"><span class="field-caption">问题描述 / 实施必要性 <span class="required-star" aria-hidden="true">*</span></span><textarea v-model="common.problem_description" required rows="3" placeholder="说明存在的问题、实施必要性及作业背景"/></label>
      </div>
      <CustomFields :definitions="fieldDefinitions" v-model="common.custom_fields"/>
     </section>

     <section class="entry-section panel">
      <div class="entry-section-head"><div class="entry-section-title"><span class="step-number">03</span><h2>共同来源依据</h2></div><span class="section-note">一次填写，多条关联</span></div>
      <div v-for="(source,index) in batchSources" :key="index" class="source-card">
       <div class="source-card-head"><strong>来源 {{index+1}}</strong><button v-if="batchSources.length>1" class="text-button danger" @click="removeSource(index)">移除来源</button></div>
       <div class="form-grid entry-fields">
        <label><span class="field-caption">来源类型 <span class="required-star" aria-hidden="true">*</span></span><select v-model="source.type_id" required><option value="">请选择</option><option v-for="x in sources" :key="x.id" :value="x.id">{{x.name}}</option></select></label>
        <label><span class="field-caption">发现 / 提出日期 <span class="required-star" aria-hidden="true">*</span></span><input type="date" v-model="source.discovered_on" required/></label>
        <label><span class="field-caption">提出单位 / 人员 <span class="required-star" aria-hidden="true">*</span></span><input v-model="source.proposed_by" required placeholder="填写提出单位或人员"/></label>
        <label><span class="field-caption">来源依据编号</span><input v-model="source.external_ref" placeholder="工单、缺陷单或检查编号"/></label>
        <label class="wide"><span class="field-caption">来源说明</span><textarea v-model="source.description" rows="2" placeholder="记录来源内容与原始依据"/></label>
       </div>
      </div>
      <button type="button" class="secondary source-add" @click="addSource">＋ 添加一条来源</button>
      <div class="entry-advanced"><button type="button" class="text-button" @click="entryAdvancedOpen=!entryAdvancedOpen">{{entryAdvancedOpen?'收起附加信息':'填写优先级、期望时间'}}</button>
       <div v-if="entryAdvancedOpen" class="form-grid entry-fields advanced-fields">
        <label><span class="field-caption">优先级</span><select v-model="common.priority_id"><option value="">未设置</option><option v-for="x in priorities" :key="x.id" :value="x.id">{{x.name}}</option></select></label>
        <label><span class="field-caption">期望完成日期</span><input type="date" v-model="common.expected_on"/></label>
       </div>
      </div>
     </section>

     <section class="entry-section panel">
      <div class="entry-section-head"><div class="entry-section-title"><span class="step-number">04</span><h2>{{demandLocationKind==='span'?'逐档预览与调整':'逐基预览与调整'}}</h2></div><span class="section-note">{{selectedRows.length}} 条独立需求</span></div>
      <p class="field-hint">共同字段已填入每条需求；单独修改部位或数量仅影响对应杆塔。预览确认后提交待核实。</p>
      <div class="table-wrap"><table class="preview-table"><thead><tr><th>位置</th><th>处理部位 <span class="required-star" aria-hidden="true">*</span></th><th>工作量 <span class="required-star" aria-hidden="true">*</span></th><th v-if="fieldDefinitions.length">扩展字段</th><th></th></tr></thead>
       <tbody><tr v-for="(x,index) in selectedRows" :key="x.id" :data-row-index="index"><td><strong>{{x.tower_no}}</strong><small>{{x.line_name}}</small></td><td><input class="compact" :aria-label="'处理部位 '+x.tower_no" :value="x.target_object" required @input="overrides[x.id]={...overrides[x.id],target_object:($event.target as HTMLInputElement).value}"/></td><td><input class="compact num" :aria-label="'工作量 '+x.tower_no" inputmode="decimal" :value="x.quantity" required data-validate="quantity" @input="overrides[x.id]={...overrides[x.id],quantity:($event.target as HTMLInputElement).value}"/></td><td v-if="fieldDefinitions.length"><details><summary>逐基调整</summary><CustomFields :definitions="fieldDefinitions" :prefix="x.tower_no+' '" :model-value="x.custom_fields" @update:model-value="overrides[x.id]={...overrides[x.id],custom_fields:$event}"/></details></td><td><button type="button" class="text-button danger" @click="excluded[x.id]=true">排除</button></td></tr>
        <tr v-if="!selectedRows.length"><td colspan="4" class="empty">请先在上方勾选杆塔</td></tr></tbody></table></div>
      <div class="batch-review">
       <div><strong>本批 {{selectedRows.length}} 条需求</strong><small>{{selectedLines.length}} 条线路 · {{batchSources.length}} 条来源依据 · 独立生成</small></div>
       <div class="form-actions"><button type="button" class="light" @click="resetBatch">清空重填</button><button type="button" class="secondary" :disabled="busy" @click="submitBatch(true)">保存草稿</button><button type="submit" class="primary" :disabled="busy||!roleWrite||!selectedRows.length">提交 {{selectedRows.length}} 条核实</button></div>
      </div>
      <p v-if="lastResult" class="saved-batch">批次 {{lastResult.batch_id}} 已保存，共 {{lastResult.count}} 条。重复提交不会重复建立记录。</p>
     </section>
    </div>
   </form>
  </template>
  <template v-if="nav==='demands'"><section class="panel"><div class="section-header"><div><h2>需求列表</h2><p class="muted">当前查询结果 {{demands.length}} 条 · 导出范围与筛选一致</p></div><div class="actions"><button class="secondary" @click="exportDemands">Excel 导出</button><button v-if="roleWrite" class="primary" @click="openNav('entry')">新建需求</button></div></div><div class="toolbar"><label><span class="field-caption">状态</span><select v-model="statusFilter"><option value="">全部</option><option value="pending">待核实</option><option value="active">有效</option><option value="returned">退回</option><option value="cancelled">取消</option></select></label><label><span class="field-caption">线路</span><select v-model="lineFilter"><option value="">全部线路</option><option v-for="x in lines" :key="x.id" :value="x.id">{{x.name}}</option></select></label><label><span class="field-caption">关键词</span><input v-model="search" placeholder="编号、杆塔、问题或部位"/></label></div><div class="table-wrap"><table><thead><tr><th>编号</th><th>位置</th><th>操作与部位</th><th>工作量</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="d in demands" :key="d.id"><td class="mono">{{d.demand_no}}</td><td>{{d.line_name_snapshot}} {{d.tower_no_snapshot}}</td><td>{{d.operation_snapshot}} · {{d.target_object}}</td><td>{{fmtQty(d.quantity_scaled)}} {{d.unit_snapshot}}</td><td><span class="tag">{{statusName(d.status)}}</span></td><td><button class="link" @click="showDemand(d.id)">详情</button></td></tr><tr v-if="!demands.length"><td colspan="6" class="empty">没有符合筛选条件的需求</td></tr></tbody></table></div></section></template>
  <section v-if="detail" class="detail-overlay" @click.self="detail=null"><div class="detail-panel"><div class="section-header"><h2>{{detail.demand_no?'需求 '+detail.demand_no:'台账详情'}}</h2><button class="light" @click="detail=null">关闭 ×</button></div>
    <template v-if="detail.demand_no"><div class="info-grid"><div><small>原始线路快照</small><strong>{{detail.line_name_snapshot}} {{detail.tower_no_snapshot}}</strong></div><div><small>物理塔快照</small><strong>{{detail.physical_code_snapshot}}</strong></div><div><small>操作与版本</small><strong>{{detail.operation_snapshot}} v{{detail.operation_version}}</strong></div><div><small>工作量</small><strong>{{fmtQty(detail.quantity_scaled)}} {{detail.unit_snapshot}}</strong></div><div><small>当前状态</small><strong>{{detail.status}}</strong></div><div><small>当前版本</small><strong>v{{detail.version}}</strong></div></div>
      <p v-if="detail.project_references?.length" class="muted">已关联项目：{{detail.project_references.map((x:Rec)=>x.code).join('、')}}。工作范围保留历史依据；范围变更须办理项目变更。</p>
      <p>当前台账：{{detail.current_line_name}} {{detail.current_tower_no}} · {{detail.current_physical_code}}</p><button v-if="roleWrite&&detail.status!=='cancelled'" class="secondary" @click="openReason('revalidate')">重新核实位置</button>
      <div class="scope-item"><strong>处理部位</strong><p>{{detail.target_object}}</p>
       <strong>问题说明</strong><p>{{detail.problem_description}}</p>
       <strong>完成标准</strong><p>{{detail.completion_standard}}</p>
      </div>
      <div v-if="detail.field_definitions?.length" class="scope-item"><strong>附加业务字段</strong><CustomFields :definitions="detail.field_definitions||[]" :model-value="detail.custom_fields||{}" :disabled="true"/></div>
      <div v-if="roleWrite&&detail.status!=='cancelled'" class="form-actions"><button class="secondary" @click="openDemandEdit">编辑需求</button></div>
      <FormModal :open="!!demandEdit" title="修订需求" :error="visibleError" size="wide" @close="demandEdit=null">
       <form v-form-validation novalidate v-if="demandEdit" class="form-grid" @submit.prevent="saveDemandEdit">
        <label><span class="field-caption">具体部位</span><input v-model="demandEdit.target_object" required/></label>
        <label><span class="field-caption">工作量（{{demandEdit.unit_snapshot}}）</span><input v-model="demandEdit.quantity" data-validate="quantity" inputmode="decimal" required/></label>
        <label class="wide"><span class="field-caption">问题说明</span><textarea v-model="demandEdit.problem_description" rows="3" required/></label>
        <label class="wide"><span class="field-caption">完成标准</span><textarea v-model="demandEdit.completion_standard" rows="2" required/></label>
        <div class="wide"><CustomFields :definitions="demandEdit.field_definitions||[]" v-model="demandEdit.custom_fields"/></div>
        <label class="wide"><span class="field-caption">修订原因</span><input v-model="demandEdit.change_reason" required/></label>
        <div class="form-actions"><button type="button" class="light" @click="demandEdit=null">取消</button><button class="primary">保存修订并留痕</button></div>
       </form>
      </FormModal>
      <h3>来源与核实</h3><p v-for="x in detail.sources" :key="x.id">{{x.discovered_on}} · {{x.proposed_by}} · {{x.type_snapshot}} · {{x.description||x.external_ref||'—'}}</p><div v-if="roleVerify&&detail.status!=='cancelled'" class="form-actions"><button class="primary" @click="openReason('verify:active')">确认有效</button><button class="secondary" @click="openReason('verify:returned')">退回补充</button><button class="light" @click="openReason('verify:cancelled')">取消</button></div>
      <h3>附件依据</h3>
      <button v-if="roleWrite" class="secondary" @click="attachmentDialog=true">上传附件</button>
      <FormModal :open="attachmentDialog" title="上传需求附件" :error="visibleError" @close="attachmentDialog=false">
       <form v-form-validation novalidate @submit.prevent>
       <label><span class="field-caption">选择附件（最多15MB）</span><input type="file" required :disabled="busy" @change="uploadAttachment"/></label>
       <p class="field-hint">选中文件后立即上传，完成后自动关闭此窗口。</p>
       <div class="form-actions"><button class="light" type="button" @click="attachmentDialog=false">取消</button></div>
       </form>
      </FormModal><p v-for="file in detail.attachments" :key="file.id"><a :href="'/api/attachments/'+file.id">{{file.filename}}</a> · {{file.bytes}} 字节</p>
      <h3>历史修订</h3><p v-for="rev in detail.revisions" :key="rev.id" class="history">{{rev.changed_at}} · v{{rev.version}} · {{rev.reason}}</p>
    </template><template v-else><pre class="json-preview">{{JSON.stringify(detail,null,2)}}</pre></template>
  </div></section>
  <FormModal :open="!!reasonAction" :title="reasonTitle" @close="reasonAction=''">
   <form v-form-validation novalidate class="form-grid" @submit.prevent="submitReason">
    <label class="wide"><span class="field-caption">操作依据 / 说明</span><textarea v-model="reasonValue" rows="3" required placeholder="请填写本次操作的依据"></textarea></label>
    <p v-if="visibleError" role="alert" class="form-modal-error">{{visibleError}}</p>
    <div class="form-actions"><button type="button" class="light" @click="reasonAction=''">取消</button><button class="primary" :disabled="busy">确认</button></div>
   </form>
  </FormModal>
 </main>
 </div>
</div>
</template>

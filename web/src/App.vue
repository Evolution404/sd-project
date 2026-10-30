<script setup lang="ts">
import {ElTable,ElTableColumn} from 'element-plus';
import {ElInput,ElCheckbox,ElRadio,ElDatePicker} from 'element-plus';
import {ElSelect,ElOption} from 'element-plus';
import {ElButton} from 'element-plus';
import {computed,defineAsyncComponent,onMounted,reactive,ref,watch} from 'vue';
import {newClientId} from './utils/client-id';
import FormModal from './components/FormModal.vue';
import CustomFields from './components/CustomFields.vue';
import LedgerWorkspace from './components/LedgerWorkspace.vue';
import ApplicationShell from './components/ApplicationShell.vue';
import StatusTag from './components/StatusTag.vue';
import ReferencePriceWorkspace from './components/ReferencePriceWorkspace.vue';
import StructureCreateModal from './components/StructureCreateModal.vue';
const AuditWorkspace=defineAsyncComponent(()=>import('./components/AuditWorkspace.vue'));
const FundingWorkspace=defineAsyncComponent(()=>import('./components/FundingWorkspace.vue'));
const DictionaryWorkspace=defineAsyncComponent(()=>import('./components/DictionaryWorkspace.vue'));
const SettlementVoucherWorkspace=defineAsyncComponent(()=>import('./components/SettlementVoucherWorkspace.vue'));
const CostWorkspace=defineAsyncComponent(()=>import('./components/CostWorkspace.vue'));
const CostReconciliationWorkspace=defineAsyncComponent(()=>import('./components/CostReconciliationWorkspace.vue'));
const CompletionWorkspace=defineAsyncComponent(()=>import('./components/CompletionWorkspace.vue'));
const PlanBudgetWorkspace=defineAsyncComponent(()=>import('./components/PlanBudgetWorkspace.vue'));
const PlanSettlementWorkspace=defineAsyncComponent(()=>import('./components/PlanSettlementWorkspace.vue'));
import {vFormValidation,presentFormError,inlineErrorMessage} from './utils/form-validation';
type Rec = Record<string,any>;
function rememberedView(key:string,fallback:string){try{return sessionStorage.getItem(key)||fallback}catch{return fallback}}
const ledgerLineId=ref(rememberedView('ledger-line','')),ledgerTab=ref(rememberedView('ledger-tab','towers')),ledgerTowerId=ref(''),demandLocationKind=ref('tower'),demandSpanRows=ref<Rec[]>([]);
const nav=ref('overview'),page=ref('overview'),user=ref<Rec|null>(null);
const username=ref(''),password=ref('');
const busy=ref(false),error=ref(''),success=ref('');
const voltage=ref<Rec[]>([]),lines=ref<Rec[]>([]),physical=ref<Rec[]>([]),logical=ref<Rec[]>([]),items=ref<Rec[]>([]),types=ref<Rec[]>([]),demands=ref<Rec[]>([]);
const overview=ref<Rec>({}),detail=ref<Rec|null>(null),edit=ref<Rec|null>(null);
const allowedIPs=ref<Rec[]>([]), currentClientIP=ref(''), ipInput=ref(''), ipNote=ref('');
const frameworks=ref<Rec[]>([]),agreements=ref<Rec[]>([]),projects=ref<Rec[]>([]);
const projectView=ref<Rec|null>(null),scopeDemand=ref(''),scopeQuantity=ref('1'),scopePriceEdit=ref<Rec|null>(null);
const referencePriceOptions=ref<Rec[]>([]),selectedReferencePrice=ref('');
const scopePrice=reactive<Rec>({unit_price_yuan:'',price_source:'',price_date:new Date().toLocaleDateString('en-CA'),tax_mode:'inclusive',reason:''});
const agreementSelection=ref('');
const preliminaryAmount=ref(''),preliminaryBasis=ref(''),preliminaryCategory=ref('');
const projectApprovalVersions=ref<Rec[]>([]),projectChangeOrders=ref<Rec[]>([]);
const projectProgress=ref<Rec|null>(null),projectSettlementTotals=ref<Rec|null>(null);
const settlementDialog=ref(false),settlementForm=reactive<Rec>({}),settlementRefreshKey=ref(0);
const changeDecision=ref<Rec|null>(null),changeDecisionReason=ref('');
const changeDraft=reactive<Rec>({reason:'',action:'adjust',scope_id:'',demand_id:'',quantity:'',unit_price_yuan:'',price_source:'',price_date:new Date().toLocaleDateString('en-CA'),tax_mode:'inclusive',evidence:''});
const approvedDemandOptions=ref<Rec[]>([]);
const executionRows=ref<Rec[]>([]),executionView=ref<Rec|null>(null);
const executionDescription=ref(''),executionPlanType=ref('outage'),execScopeId=ref(''),execQuantity=ref('1');
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
const stage=ref('');
const ipDialog=ref(false),projectAction=ref(''),executionAction=ref('');
const completionItem=ref<Rec|null>(null);
const demandEdit=ref<Rec|null>(null),pendingRemoveIP=ref<Rec|null>(null),attachmentDialog=ref(false);
const reasonAction=ref(''),reasonValue=ref('');

const drafts=ref<Rec[]>([]),currentDraft=ref<Rec|null>(null),draftsOpen=ref(false);
const duplicateDialog=ref(false),duplicateFindings=ref<Rec[]>([]);
const duplicateChoices=reactive<Record<number,Rec>>({});
const batchKey=ref<string>(newClientId()),lastResult=ref<Rec|null>(null);
const newCommon=():Rec=> ({work_target_type:'line',operation_id:'',target_object:'',quantity:'1',unit_id:'',completion_standard:'',problem_description:'',priority_id:'',expected_on:'',custom_fields:{},source:{type_id:'',discovered_on:new Date().toLocaleDateString('en-CA'),proposed_by:'',description:'',external_ref:''}});
const common=reactive<Rec>(newCommon());
const initialForm:Rec={};
const form=reactive<Rec>({});
const labels:Rec={overview:'工作台',lines:'线路台账',towers:'杆塔查询',spans:'档距查询',entry:'新建需求',demands:'需求中心',dictionary:'数据字典',access:'IP访问管理',frameworks:'项目框架',agreements:'执行协议',projects:'子项目储备',prices:'检修参考单价',audit:'操作记录'};
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
const sectionLabel=computed(()=>nav.value==='entry'?'需求中心':['demands'].includes(nav.value)?'需求中心':['projects'].includes(nav.value)?'项目中心':nav.value==='prices'?'参考单价':['frameworks','agreements'].includes(nav.value)?'框架与协议':['lines','towers','spans'].includes(nav.value)?'基础台账':['dictionary','access','audit'].includes(nav.value)?'系统管理':'项目全流程');
const displayTitle=computed(()=>nav.value==='entry'?'新建需求':nav.value==='projects'?'项目中心':nav.value==='overview'?'工作台':mediaTitle.value);
const roleStageApprove=computed(()=>user.value?.role==='admin');
const roleWrite=computed(()=>user.value&&['admin','editor'].includes(user.value.role));
const roleVerify=computed(()=>user.value&&['admin','verifier'].includes(user.value.role));
const money=(value:any)=>value===null||value===undefined?'待核定':(Number(value)/100).toFixed(2);
const roleAdmin=computed(()=>user.value?.role==='admin');
const mediaTitle=computed(()=>labels[nav.value]||'');
const options=(type:string)=>items.value.filter(x=>x.type_id===type).sort((a,b)=>a.sort_order-b.sort_order);
const selectedOp=computed(()=>items.value.find(x=>x.id===common.operation_id));
const fieldDefinitions=computed<Rec[]>(()=>{try{const fields=JSON.parse(selectedOp.value?.fields_json||'[]');return Array.isArray(fields)?fields:[]}catch{return []}});
watch(()=>common.operation_id,()=>{common.custom_fields=Object.fromEntries(fieldDefinitions.value.filter(f=>f.default!==undefined).map(f=>[f.key,f.default]));for(const row of Object.values(overrides))delete row.custom_fields},{flush:'sync'});
const dateStr=(s:string)=>s?s.slice(0,10):'';
const fmtQty=(v:any)=>Number(v||0)/10000;
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
function openStructureCreate(type:string){stage.value=type;edit.value=null;Object.keys(form).forEach(k=>delete form[k]);form.name='';form.limit_yuan='';form.fiscal_year=new Date().getFullYear();form.framework_id='';form.agreement_id='';form.category_id='';}
async function saveStructure(){
 error.value='';busy.value=true;
 try{
  const result=await api('/'+stage.value,'POST',{...form});
  stage.value='';await loadStructure();notify('业务台账已保存：'+result.name);
 }catch(e){error.value=errorMessage(e)}finally{busy.value=false}
}
async function openProject(item:Rec){projectAction.value='';scopePriceEdit.value=null;
 projectView.value=await api('/projects/'+item.id);
 scopeDemand.value='';scopeQuantity.value='1';scopePriceEdit.value=null;
 agreementSelection.value=projectView.value?.agreement_id||'';
 preliminaryAmount.value=projectView.value?.preliminary_estimate_fen?String(projectView.value.preliminary_estimate_fen/100):'';
 preliminaryBasis.value=projectView.value?.preliminary_estimate_basis||'';
 preliminaryCategory.value=projectView.value?.category_id||'';
 await loadExecutions(item.id);
 await loadProjectChanges(item.id);
 await loadProjectFinancials(item.id);
}
async function loadProjectFinancials(projectId:string){
 const [progress,totals]=await Promise.all([
  api('/projects/'+projectId+'/progress'),
  api('/projects/'+projectId+'/settlement-summary')
 ]);
 if(projectView.value?.id!==projectId)return;
 projectProgress.value=progress;projectSettlementTotals.value=totals;settlementRefreshKey.value++;
}
async function refreshPlanFinancials(){
 if(!projectView.value)return;
 try{await loadProjectFinancials(projectView.value.id)}catch(e){error.value=errorMessage(e)}
}
function openSettlement(scope:Rec,original?:Rec){
 error.value='';Object.keys(settlementForm).forEach(k=>delete settlementForm[k]);
 Object.assign(settlementForm,{
  scope_id:scope.id,settlement_no:'',entry_kind:original?'reversal':'payment',
  reversal_of:original?.id||'',settlement_type:original?'':'progress',amount_yuan:'',
  occurred_on:new Date().toLocaleDateString('en-CA'),evidence:''
 });
 settlementDialog.value=true;
}
async function saveSettlement(){
 if(!projectView.value)return;error.value='';
 try{
  const id=projectView.value.id;
  await api('/projects/'+id+'/settlements','POST',{...settlementForm});
  await loadProjectFinancials(id);
  settlementDialog.value=false;
  notify(settlementForm.entry_kind==='reversal'?'结算冲销凭证已登记':'结算凭证已登记并关联项目批准版本');
 }catch(e){error.value=errorMessage(e)}
}
async function loadProjectChanges(projectId:string){
 const [versions,orders]=await Promise.all([api('/projects/'+projectId+'/approval-versions'),api('/projects/'+projectId+'/change-orders')]);
 projectApprovalVersions.value=versions;projectChangeOrders.value=orders;
}
async function createChangeDraft(){
 if(!projectView.value)return;error.value='';
 try{
 const latest=projectApprovalVersions.value[0];
 if(!latest)throw Error('缺少批准版本');
 await api('/projects/'+projectView.value.id+'/change-orders','POST',{
  reason:changeDraft.reason,base_approval_version_id:latest.id,
  changes:[{action:changeDraft.action,scope_id:changeDraft.action==='add'?undefined:changeDraft.scope_id,
    demand_id:changeDraft.action==='add'?changeDraft.demand_id:undefined,
    quantity:changeDraft.action==='remove'?undefined:changeDraft.quantity,
    unit_price_yuan:changeDraft.unit_price_yuan,price_source:changeDraft.price_source,price_date:changeDraft.price_date,tax_mode:changeDraft.tax_mode,evidence:changeDraft.evidence}]
 });
 await loadProjectChanges(projectView.value.id);
 projectAction.value='';notify('变更单草稿已保存，管理员批准后才更新项目预算和范围');
 }catch(e){error.value=errorMessage(e)}
}
function openChangeDecision(order:Rec,action:'submit'|'approve'|'reject'){
 changeDecision.value={order,action};changeDecisionReason.value='';
 error.value='';
}
async function saveChangeDecision(){
 if(!changeDecision.value||!projectView.value)return;
 error.value='';
 try{
  const {order,action}=changeDecision.value;
  await api('/change-orders/'+order.id+'/'+action,'POST',{reason:changeDecisionReason.value});
  await Promise.all([loadProjectChanges(projectView.value.id),loadStructure()]);
  projectView.value=await api('/projects/'+projectView.value.id);
  if(projectView.value)await loadProjectFinancials(projectView.value.id);
  changeDecision.value=null;changeDecisionReason.value='';
  notify(action==='submit'?'变更单已提交审批':action==='approve'?'变更批准已生效，新预算版本已建立':'变更单已驳回，批准预算未改变');
 }catch(e){error.value=errorMessage(e)}
}
function openChangeDraft(){
 Object.assign(changeDraft,{reason:'',action:'adjust',scope_id:projectView.value?.scopes?.[0]?.id||'',
 demand_id:'',quantity:'',unit_price_yuan:'',price_source:'',price_date:new Date().toLocaleDateString('en-CA'),tax_mode:'inclusive',evidence:''});
 projectAction.value='change-order';error.value='';
}
async function loadExecutions(projectId:string){executionRows.value=await api('/projects/'+projectId+'/executions')}
async function refreshExecutionFacts(){
 const id=executionView.value?.id;if(!id)return;
 try{
  const data=await api('/executions/'+id);if(executionView.value?.id!==id)return;
  executionView.value=data;
  if(projectView.value){await loadExecutions(projectView.value.id);await loadProjectFinancials(projectView.value.id)}
 }catch(e){error.value=errorMessage(e)}
}
async function createProjectExecution(){if(!projectView.value)return;error.value='';
 try{
 const r=await api('/projects/'+projectView.value.id+'/executions','POST',{description:executionDescription.value,plan_type:executionPlanType.value});
 executionDescription.value='';executionPlanType.value='outage';await loadExecutions(projectView.value.id);
 executionView.value=r;projectAction.value='';notify('检修计划已建立');
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
 await refreshExecutionFacts();notify('实际完成量已确认入账');
 }catch(e){error.value=errorMessage(e)}
}
async function saveInitialEstimate(){
 if(!projectView.value)return;
 error.value='';
 try{
 projectView.value=await api('/projects/'+projectView.value.id+'/preliminary-estimate','POST',{
  version:projectView.value.version,category_id:preliminaryCategory.value,
  amount_yuan:preliminaryAmount.value,basis:preliminaryBasis.value
 });
 projectAction.value='';await loadStructure();
 notify('项目类别与初步估算已保存，入库后保留依据快照');
 }catch(e){error.value=errorMessage(e)}
}
async function addProjectScope(){if(!projectView.value)return;
 error.value='';try{
 projectView.value=await api('/projects/'+projectView.value.id+'/scopes','POST',{version:projectView.value.version,demand_id:scopeDemand.value,quantity:scopeQuantity.value});
 scopeDemand.value='';projectAction.value='';notify('已关联需求范围');
 }catch(e){error.value=errorMessage(e)}
}
async function editScopePrice(scope:Rec){
 scopePriceEdit.value=scope;selectedReferencePrice.value='';referencePriceOptions.value=[];error.value='';
 Object.assign(scopePrice,{unit_price_yuan:scope.unit_price_fen===null?'':money(scope.unit_price_fen),price_source:scope.price_source||'',price_date:scope.price_date||new Date().toLocaleDateString('en-CA'),tax_mode:scope.tax_mode||'inclusive',reason:''});
 try{if(projectView.value)referencePriceOptions.value=await api('/projects/'+projectView.value.id+'/scopes/'+scope.id+'/reference-price-options')}catch(e){error.value=errorMessage(e)}
}
async function applyScopeReferencePrice(){
 if(!projectView.value||!scopePriceEdit.value||!selectedReferencePrice.value)return;
 const price=referencePriceOptions.value.find(x=>x.id===selectedReferencePrice.value);
 if(!price)return;
 error.value='';
 try{
  projectView.value=await api('/projects/'+projectView.value.id+'/scopes/'+scopePriceEdit.value.id+'/reference-price','POST',{
   version:projectView.value.version,catalog_id:price.id,reference_price_version_id:price.reference_price_version_id
  });
  scopePriceEdit.value=null;selectedReferencePrice.value='';notify('已引用参考价版本并保存储备估算依据');
 }catch(e){error.value=errorMessage(e)}
}
function fillPreliminaryFromDetails(){
 if(!projectView.value?.estimate?.complete){error.value='尚有未估价需求，不能生成完整估算';return}
 preliminaryAmount.value=money(projectView.value.estimate.known_total_fen);
 preliminaryBasis.value='依据当前专业需求范围、已保存单价及价格来源逐项汇总测算；以各需求估算明细和价格版本记录为准。';
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
  await loadStructure();
  if(stageName==='approve'&&projectView.value)await loadProjectChanges(projectView.value.id);
  notify(stageName==='stock'?'入库版本已冻结并保存':'立项成功，批准预算已从估算明细生成');
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
 nav.value=next;detail.value=null;edit.value=null;error.value='';
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
function addSource(){batchSources.value.push({type_id:'',discovered_on:new Date().toLocaleDateString('en-CA'),proposed_by:'',description:'',external_ref:''});}
function removeSource(index:number){if(batchSources.value.length>1)batchSources.value.splice(index,1);}
function removeSelectedLine(){for(const item of logical.value.filter(x=>x.line_id===selectedLine.value))selected[item.id]=false;}
function selectVisible(){for(const tower of thisLineTowers.value)selected[tower.id]=true;for(const tower of thisLineTowers.value)delete excluded[tower.id];}
function sourcePayload(){return batchSources.value.map(item=>({...item}));}
function applyDefault(){const op=selectedOp.value;if(!op)return;if(op.default_unit_id&&units.value.some(x=>x.id===op.default_unit_id))common.unit_id=op.default_unit_id;if(op.default_quantity_scaled)common.quantity=String(op.default_quantity_scaled/10000);if(op.completion_standard)common.completion_standard=op.completion_standard;notify('已更新共同默认值；逐行自定义保留')}
function selectRange(){if(!fromRank.value||!toRank.value){error.value='请选择起止杆塔';return}const a=logical.value.find(x=>x.id===fromRank.value),b=logical.value.find(x=>x.id===toRank.value);if(!a||!b||a.line_id!==b.line_id)return;const min=Math.min(a.sort_rank,b.sort_rank),max=Math.max(a.sort_rank,b.sort_rank);for(const t of logical.value.filter(x=>x.line_id===a.line_id&&x.sort_rank>=min&&x.sort_rank<=max&&x.status==='active'))selected[t.id]=true;notify('已按台账顺序选择区段')}
function toggleAll(){selectVisible();}
function resetBatch(){duplicateDialog.value=false;duplicateFindings.value=[];Object.keys(duplicateChoices).forEach(k=>delete duplicateChoices[Number(k)]);demandLocationKind.value='tower';demandSpanRows.value=[];currentDraft.value=null;Object.assign(common,newCommon());batchSources.value=[{type_id:'',discovered_on:new Date().toLocaleDateString('en-CA'),proposed_by:'',description:'',external_ref:''}];Object.keys(selected).forEach(k=>delete selected[k]);Object.keys(excluded).forEach(k=>delete excluded[k]);Object.keys(overrides).forEach(k=>delete overrides[k]);batchKey.value=newClientId();lastResult.value=null;}
function payload(){return {...common,source:{...sourcePayload()[0]},sources:sourcePayload(),location_kind:demandLocationKind.value,rows:selectedRows.value.map((x,index)=>({...((x.span_id)?{span_id:x.span_id,span_version:x.span_version}:{logical_tower_id:x.id}),target_object:x.target_object,quantity:x.quantity,custom_fields:overrides[x.id]?.custom_fields||{},
 duplicate_review:duplicateChoices[index]||undefined})),idempotency_key:batchKey.value,...(currentDraft.value?{draft_id:currentDraft.value.id,draft_version:currentDraft.value.version}:{})};}
function draftSummary(draft:Rec){
 try{const saved=JSON.parse(draft.draft_json);return (items.value.find(x=>x.id===saved.operation_id)?.name||'未选操作')+' · '+(saved.rows?.length||0)+' 个位置'}catch{return '待完善草稿'}
}
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
async function submitBatch(draft:boolean,duplicateChecked=false){error.value='';busy.value=true;try{
 if(draft){
  if(lastResult.value)throw Error('本批已提交，请清空重填后新建草稿');
  currentDraft.value=currentDraft.value?await api('/demand-batches/'+currentDraft.value.id,'PATCH',{version:currentDraft.value.version,draft:payload()}):await api('/demand-batches/drafts','POST',payload());
  await loadDrafts();notify('草稿已保存');return;
 }
 if(!duplicateChecked&&!lastResult.value){
  const review=await api('/demands/duplicate-candidates','POST',payload());
  const findings=(review.rows||[]).filter((x:Rec)=>x.candidates?.length);
  if(findings.length){
   duplicateFindings.value=findings;duplicateDialog.value=true;
   for(const x of findings)if(!duplicateChoices[x.index])duplicateChoices[x.index]={decision:'',candidate_id:x.candidates[0].id,reason:''};
   return;
  }
 }
 for(const finding of duplicateFindings.value){
  const review=duplicateChoices[finding.index];
  if(!review?.decision||!review?.candidate_id||!review?.reason?.trim())throw Error('每一条疑似重复需求都必须选择处理方式并填写判定依据');
 }
 const r=await api('/demand-batches/submit','POST',payload());
 lastResult.value=r;duplicateDialog.value=false;
 notify('新建 '+r.count+' 条待核实需求，关联已有需求 '+(r.linked_ids?.length||0)+' 条（'+batchSources.value.length+' 条来源）');
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
 reasonAction.value==='execution:start'?'确认开工':reasonAction.value==='execution:finish'?'结束本次执行':reasonAction.value==='execution:cancel'?'取消未开工批次':'业务确认依据');
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
<div v-if="!user" class="auth-bg"><div class="auth-card"><div class="logo">SD</div><h1>输电项目全流程管理</h1><p class="muted">使用本地服务器账号登录</p><form v-form-validation novalidate @submit.prevent="doLogin"><label><span class="field-caption">用户名</span><ElInput v-model="username" autocomplete="username" required placeholder="输入用户名"/></label><label><span class="field-caption">密码</span><ElInput v-model="password" type="password" autocomplete="current-password" required placeholder="输入密码"/></label><p v-if="visibleError" class="error">{{visibleError}}</p><ElButton native-type="submit" class="primary full" :disabled="busy">登录系统</ElButton></form><p class="minor">首次部署请在服务器运行「初始化管理员.cmd」</p></div></div>
<ApplicationShell v-else :user="user" :nav="nav" :section="sectionLabel" :title="displayTitle" @navigate="openNav" @logout="logout">
  <div v-if="nav!=='dictionary'" class="page-heading">
   <div class="breadcrumb"><span>{{sectionLabel}}</span><span class="breadcrumb-slash">/</span><strong>{{nav==='entry'?'新建需求':displayTitle}}</strong></div>
   <div class="page-heading-title"><h1>{{displayTitle}}</h1><span v-if="nav==='entry'" class="subtle-tag">逐基独立生成</span></div>
   <p class="page-description">{{nav==='entry'?'选择多个位置，共同内容填一次；逐基差异在预览中调整。':nav==='overview'?'掌握项目与需求的当前状态。':nav==='demands'?'查看、核实和跟踪每一条需求。':nav==='access'?'由管理员逐个配置允许访问服务器的 IP 地址。':nav==='projects'?'从项目储备到立项及分次执行的全过程管理。':'维护真实业务台账与版本历史。'}}</p>
  </div>
  <p v-if="visibleError" role="alert" class="alert error">{{visibleError}} <ElButton @click="error=''">×</ElButton></p><p v-if="success" role="status" class="alert ok">{{success}}</p>
  <template v-if="nav==='overview'"><div class="stats"><div v-for="(label,key) in {lines:'线路',physical:'实体杆塔',logical:'逻辑杆塔',pending:'待核实需求',active:'有效需求'}" :key="key" class="stat"><small>{{label}}</small><strong>{{overview[key]??0}}</strong></div></div><section class="panel"><div class="section-header"><div><h2>待核实事项</h2><p class="muted">基于当前数据库实际记录</p></div><ElButton class="secondary" @click="openNav('demands')">进入需求中心</ElButton></div><div v-if="!demands.filter(x=>x.status==='pending').length" class="empty">当前没有待核实需求</div><div v-else class="table-wrap"><ElTable :data="demands.filter(x=>x.status==='pending').slice(0,8)" >
<ElTableColumn><template #header>需求编号</template><template #default="{row,$index}"><template v-for="([d]) in [[row,$index]]"><div >{{d.demand_no}}</div></template></template></ElTableColumn>
<ElTableColumn><template #header>位置</template><template #default="{row,$index}"><template v-for="([d]) in [[row,$index]]"><div >{{d.line_name_snapshot}} {{d.tower_no_snapshot}}</div></template></template></ElTableColumn>
<ElTableColumn><template #header>操作</template><template #default="{row,$index}"><template v-for="([d]) in [[row,$index]]"><div >{{d.operation_snapshot}} · {{d.target_object}}</div></template></template></ElTableColumn>
<ElTableColumn><template #header>工作量</template><template #default="{row,$index}"><template v-for="([d]) in [[row,$index]]"><div >{{fmtQty(d.quantity_scaled)}} {{d.unit_snapshot}}</div></template></template></ElTableColumn>
<ElTableColumn><template #header></template><template #default="{row,$index}"><template v-for="([d]) in [[row,$index]]"><div ><ElButton class="link" @click="openNav('demands');showDemand(d.id)">查看</ElButton></div></template></template></ElTableColumn></ElTable></div></section></template>
  <LedgerWorkspace v-if="['lines','towers','spans'].includes(nav)" :user="user" :view="nav" v-model:line-id="ledgerLineId" v-model:focus-tab="ledgerTab" :focus-tower="ledgerTowerId" @workspace="openLedger" @changed="refresh" @demands="seedLedgerDemands"/>
  <ReferencePriceWorkspace v-if="nav==='prices'" :items="items" :voltage="voltage" :can-edit="roleAdmin"/>
  <FundingWorkspace v-if="['frameworks','agreements'].includes(nav)" :kind="nav" :can-write="!!roleWrite" :can-delete="roleAdmin" :can-authorize="roleAdmin" @changed="loadStructure"/>
  <template v-if="nav==='projects'">
   <section class="panel">
    <div class="section-header"><div><h2>{{mediaTitle}}</h2><p class="muted">管理：年度框架 → 子项目 → 检修计划 → 专业需求；资金：年度框架 → 协行协议 → 子项目 → 检修计划</p></div><ElButton v-if="roleWrite" class="primary" @click="openStructureCreate(nav)">新增{{mediaTitle}}</ElButton></div>
    <div class="table-wrap"><ElTable :data="projects" >
<ElTableColumn><template #header>名称</template><template #default="{row,$index}"><template v-for="([x]) in [[row,$index]]"><div >{{x.name}}</div></template></template></ElTableColumn>
<ElTableColumn><template #header>所属框架/协议</template><template #default="{row,$index}"><template v-for="([x]) in [[row,$index]]"><div >{{x.framework_name}} / {{x.agreement_name||'协议待落实'}}</div></template></template></ElTableColumn>
<ElTableColumn><template #header>已批准预算 (元)</template><template #default="{row,$index}"><template v-for="([x]) in [[row,$index]]"><div >{{money(x.approved_budget_fen)}}</div></template></template></ElTableColumn>
<ElTableColumn><template #header>状态</template><template #default="{row,$index}"><template v-for="([x]) in [[row,$index]]"><div ><StatusTag :status="x.status"/></div></template></template></ElTableColumn>
<ElTableColumn><template #header>操作</template><template #default="{row,$index}"><template v-for="([x]) in [[row,$index]]"><div ><ElButton class="link" @click="openProject(x)">需求范围与阶段</ElButton></div></template></template></ElTableColumn><template #empty><div class="empty">暂无记录，请从创建框架开始</div></template></ElTable></div>
   </section>
 <StructureCreateModal :open="stage===nav" :type="nav" :title="mediaTitle" :error="visibleError" :busy="busy"
  :form="form" :frameworks="frameworks" :agreements="agreements" :categories="options('project_category')"
  @save="saveStructure" @close="stage='';edit=null"/>
  </template>
  <section v-if="projectView" class="detail-overlay project-overlay" @click.self="projectView=null"><div class="detail-panel">
   <div class="section-header"><div><h2>{{projectView.name}}</h2><StatusTag :status="projectView.status"/></div><ElButton class="light" @click="projectView=null">关闭 ×</ElButton></div>
   <div class="info-grid"><div><small>已知估算（元）</small><strong>{{money(projectView.estimate.known_total_fen)}}</strong></div><div><small>待定价项</small><strong>{{projectView.estimate.missing_price_count}}</strong></div><div><small>批准预算（元）</small><strong>{{money(projectView.approved_budget_fen)}}</strong></div><div><small>需求范围条数</small><strong>{{projectView.estimate.total}}</strong></div></div>
   <h3>项目类别与初步估算</h3>
   <div class="toolbar">
    <span class="muted">类别：{{items.find(x=>x.id===projectView?.category_id)?.name||'待补充'}}
      · 初步估算：{{money(projectView.preliminary_estimate_fen)}} 元
      · 依据：{{projectView.preliminary_estimate_basis||'尚未提供'}}</span>
    <ElButton v-if="roleWrite&&projectView.status==='reserve'" class="secondary" @click="projectAction='preliminary'">填写初步估算</ElButton>
   </div>
   <FormModal :open="projectAction==='preliminary'" title="项目类别与初步估算" :error="visibleError" @close="projectAction=''">
     <form v-form-validation novalidate class="form-grid" @submit.prevent="saveInitialEstimate">
      <label class="wide"><span class="field-caption">项目类别</span>
       <ElSelect v-model="preliminaryCategory" required><ElOption :label="'请选择'" data-option-value="" value="">请选择</ElOption>
        <ElOption :label="String(c.name)" :data-option-value="c.id" v-for="c in options('project_category').filter(x=>x.status==='active')" :key="c.id" :value="c.id">{{c.name}}</ElOption>
       </ElSelect>
      </label>
      <label><span class="field-caption">初步估算（元）</span>
       <ElInput v-model="preliminaryAmount" required inputmode="decimal" data-validate="money" placeholder="初步核算的项目预算"/>
      </label>
      <label class="wide"><span class="field-caption">估算依据</span>
       <ElInput type="textarea" v-model="preliminaryBasis" required :rows="3" placeholder="依据名称、定额或参考价格及测算说明"/>
      </label>
      <div class="wide"><ElButton native-type="button" class="secondary" :disabled="!projectView?.estimate?.complete" @click="fillPreliminaryFromDetails">按需求单价明细计算初步估算</ElButton></div>
      <p class="muted wide">正式入库时保留此初步估算。单项价格可暂缺，但立项前必须逐项核定。</p>
      <div class="form-actions"><ElButton native-type="button" class="light" @click="projectAction=''">取消</ElButton><ElButton native-type="submit" class="primary">保存初步估算</ElButton></div>
     </form>
   </FormModal>
   <p class="muted">所属年度框架：{{projectView.framework_year}} · {{projectView.framework_name}}{{projectView.framework_deleted?'（已删除，不再允许新增立项）':''}}</p>
   <h3>关联执行协议</h3>
   <div class="toolbar"><span class="muted">{{projectView.agreement_name||agreements.find(x=>x.id===projectView?.agreement_id)?.name||'暂未关联执行协议'}}{{projectView.agreement_deleted?'（已删除，保留历史归属）':''}}</span>
    <ElButton v-if="roleWrite&&['reserve','stocked'].includes(projectView.status)" class="secondary" @click="projectAction='agreement'">设置执行协议</ElButton>
   </div>
   <FormModal :open="projectAction==='agreement'" title="选择执行协议" :error="visibleError" @close="projectAction=''">
    <form v-form-validation novalidate class="form-grid" @submit.prevent="bindProjectAgreement">
     <label class="wide"><span class="field-caption">唯一执行协议</span><ElSelect v-model="agreementSelection" required><ElOption :label="'请选择'" data-option-value="" value="">请选择</ElOption><ElOption :label="String(a.name) + ' · ' + String(a.framework_name)" :data-option-value="a.id" v-for="a in agreements.filter(x=>x.status==='active'&&x.framework_id===projectView?.framework_id)" :key="a.id" :value="a.id">{{a.name}} · {{a.framework_name}}</ElOption></ElSelect></label>
     <div class="form-actions"><ElButton native-type="button" class="light" @click="projectAction=''">取消</ElButton><ElButton native-type="submit" class="primary">确认协议归属</ElButton></div>
    </form>
   </FormModal>
   <h3>项目需求范围与估价</h3><p class="muted">每条明细引用已核实的需求版本；金额按工作量×单价计算，缺价不视为零。</p>
   <div v-for="scope in projectView.scopes" :key="scope.id" class="scope-item">
    <div class="section-header"><div><strong>{{scope.demand_no}} · {{scope.line_name_snapshot}} {{scope.tower_no_snapshot}}</strong><p class="muted">{{scope.operation_snapshot}} · {{scope.target_object}}</p></div><ElButton v-if="roleWrite&&['reserve','stocked'].includes(projectView.status)" class="link" @click="editScopePrice(scope)">估价依据</ElButton></div>
    <p>计划 {{fmtQty(scope.quantity_scaled)}} {{scope.unit_snapshot}} · 单价 {{money(scope.unit_price_fen)}} 元 · {{scope.price_source||'价格待确定'}}</p>
   </div>
   <ElButton v-if="roleWrite&&projectView.status==='reserve'" class="secondary" @click="projectAction='scope'">＋ 关联需求范围</ElButton>
   <FormModal :open="projectAction==='scope'" title="关联需求范围" :error="visibleError" @close="projectAction=''">
       <form v-form-validation novalidate class="form-grid" @submit.prevent="addProjectScope">
    <label class="wide"><span class="field-caption">纳入有效需求</span><ElSelect v-model="scopeDemand" required><ElOption :label="'请选择'" data-option-value="" value="">请选择</ElOption><ElOption :label="String(d.demand_no) + ' · ' + String(d.line_name_snapshot) + ' ' + String(d.tower_no_snapshot) + ' · ' + String(d.operation_snapshot)" :data-option-value="d.id" v-for="d in eligibleDemands" :key="d.id" :value="d.id">{{d.demand_no}} · {{d.line_name_snapshot}} {{d.tower_no_snapshot}} · {{d.operation_snapshot}}</ElOption></ElSelect></label>
    <label><span class="field-caption">本项目拟覆盖工作量</span><ElInput v-model="scopeQuantity" data-validate="quantity" required inputmode="decimal"/></label><div class="form-actions"><ElButton native-type="submit" class="secondary">关联需求</ElButton></div>
   </form>
   </FormModal>
   <FormModal :open="!!scopePriceEdit" title="核定估价依据" :error="visibleError" @close="scopePriceEdit=null">
      <form v-form-validation novalidate class="form-grid scope-editor" @submit.prevent="saveScopePrice">
    <div v-if="referencePriceOptions.length" class="wide toolbar">
      <label><span class="field-caption">参考单价目录（储备估算）</span>
       <ElSelect v-model="selectedReferencePrice"><ElOption :label="'选择适用参考价'" data-option-value="" value="">选择适用参考价</ElOption>
        <ElOption :label="String(p.title) + ' · ' + String(money(p.unit_price_fen)) + ' 元 · v' + String(p.version_no) + ' · ' + String(p.plan_type==='both'?'通用':p.plan_type==='outage'?'停电':'不停电') + String(p.voltage_name?' · '+p.voltage_name:'')" :data-option-value="p.id" v-for="p in referencePriceOptions" :key="p.id" :value="p.id">{{p.title}} · {{money(p.unit_price_fen)}} 元 · v{{p.version_no}} · {{p.plan_type==='both'?'通用':p.plan_type==='outage'?'停电':'不停电'}}{{p.voltage_name?' · '+p.voltage_name:''}}</ElOption>
       </ElSelect>
      </label>
      <ElButton native-type="button" class="secondary" :disabled="!selectedReferencePrice" @click="applyScopeReferencePrice">引用参考价</ElButton>
    </div>
    <label><span class="field-caption">核定单价（元）</span><ElInput v-model="scopePrice.unit_price_yuan" data-validate="money" inputmode="decimal" placeholder="留空代表待估价"/></label>
    <label><span class="field-caption">价格依据</span><ElInput v-model="scopePrice.price_source" placeholder="物资报价或有效定额编号"/></label>
    <label><span class="field-caption">依据日期</span><ElDatePicker type="date" value-format="YYYY-MM-DD" format="YYYY-MM-DD"  v-model="scopePrice.price_date"/></label>
    <label><span class="field-caption">税口径</span><ElSelect v-model="scopePrice.tax_mode"><ElOption :label="'含税'" data-option-value="inclusive" value="inclusive">含税</ElOption><ElOption :label="'不含税'" data-option-value="exclusive" value="exclusive">不含税</ElOption><ElOption :label="'不适用'" data-option-value="none" value="none">不适用</ElOption></ElSelect></label>
    <label class="wide"><span class="field-caption">修订原因</span><ElInput v-model="scopePrice.reason" placeholder="核定或调整依据"/></label>
    <div class="wide form-actions"><ElButton native-type="submit" class="primary">保存估价</ElButton><ElButton native-type="button" class="light" @click="scopePriceEdit=null">取消</ElButton></div>
   </form>
   </FormModal>
   <div v-if="roleStageApprove&&projectView.status==='reserve'" class="form-actions"><ElButton class="primary" :disabled="!projectView.scopes.length||!projectView.preliminary_estimate_fen||!projectView.category_id" @click="openReason('project:stock')">确认项目入库</ElButton></div>
   <div v-if="roleStageApprove&&projectView.status==='stocked'" class="form-actions"><ElButton class="primary" :disabled="!projectView.estimate.complete||!projectView.agreement_id" @click="openReason('project:approve')">确认立项及预算</ElButton></div>
   <h3>批准版本与项目变更</h3>
   <div class="scope-item">
    <p>当前批准版本：{{projectApprovalVersions.length?'第 '+projectApprovalVersions[0].version_no+' 版':'尚未立项批准'}}；
    变更单：{{projectChangeOrders.length}} 张。</p>
    <p class="muted">编制人员提交变更单后，由具有批准权限的账号核实生效；涉及在途执行的范围，须先结束或取消相关批次。所有历史版本保留。</p>
    <ElButton v-if="roleWrite&&projectView.status==='approved'" class="secondary" @click="openChangeDraft">＋ 新建变更单草稿</ElButton>
    <div v-for="c in projectChangeOrders" :key="c.id" class="scope-item">
     <div class="section-header"><strong>{{c.code}} · {{({draft:'草稿',submitted:'待批准',approved:'已批准',rejected:'已驳回'} as Rec)[c.status]}}</strong><span>{{c.reason}}</span></div>
     <p v-if="c.decision_reason" class="muted">审批意见：{{c.decision_reason}}</p>
     <div class="actions">
      <ElButton v-if="roleWrite&&c.status==='draft'" class="secondary" @click="openChangeDecision(c,'submit')">提交审批</ElButton>
      <ElButton v-if="roleStageApprove&&c.status==='submitted'" class="primary" @click="openChangeDecision(c,'approve')">批准变更</ElButton>
      <ElButton v-if="roleStageApprove&&c.status==='submitted'" class="light" @click="openChangeDecision(c,'reject')">驳回变更</ElButton>
     </div>
    </div>
   </div>
   <FormModal :open="!!changeDecision" :title="changeDecision?.action==='submit'?'提交变更审批':changeDecision?.action==='approve'?'核准项目变更':'驳回项目变更'" :error="visibleError" @close="changeDecision=null">
    <form v-form-validation novalidate class="form-grid" @submit.prevent="saveChangeDecision">
     <p class="wide muted">{{changeDecision?.order?.code}}：{{changeDecision?.order?.reason}}</p>
     <label class="wide"><span class="field-caption">处理依据及意见</span><ElInput type="textarea" v-model="changeDecisionReason" required :rows="3"/></label>
     <div class="form-actions"><ElButton native-type="button" class="light" @click="changeDecision=null">取消</ElButton><ElButton native-type="submit" class="primary">确认</ElButton></div>
    </form>
   </FormModal>
   <FormModal :open="projectAction==='change-order'" title="拟定项目变更单" :error="visibleError" size="wide" @close="projectAction=''">
    <form v-form-validation novalidate class="form-grid" @submit.prevent="createChangeDraft">

     <label><span class="field-caption">变更类型</span><ElSelect v-model="changeDraft.action" required>
      <ElOption :label="'调整原批准范围'" data-option-value="adjust" value="adjust">调整原批准范围</ElOption><ElOption :label="'新增有效需求'" data-option-value="add" value="add">新增有效需求</ElOption><ElOption :label="'拟取消批准范围'" data-option-value="remove" value="remove">拟取消批准范围</ElOption></ElSelect></label>
     <label v-if="changeDraft.action!=='add'" class="wide"><span class="field-caption">原批准范围</span>
       <ElSelect v-model="changeDraft.scope_id" required><ElOption :label="String(scope.demand_no) + ' · ' + String(scope.target_object)" :data-option-value="scope.id" v-for="scope in projectView.scopes" :key="scope.id" :value="scope.id">{{scope.demand_no}} · {{scope.target_object}}</ElOption></ElSelect></label>
     <label v-else class="wide"><span class="field-caption">新增有效需求</span><ElSelect v-model="changeDraft.demand_id" required><ElOption :label="'请选择'" data-option-value="" value="">请选择</ElOption>
       <ElOption :label="String(d.demand_no) + ' · ' + String(d.operation_snapshot)" :data-option-value="d.id" v-for="d in eligibleDemands" :key="d.id" :value="d.id">{{d.demand_no}} · {{d.operation_snapshot}}</ElOption></ElSelect></label>
     <label v-if="changeDraft.action!=='remove'"><span class="field-caption">拟调整工作量</span><ElInput v-model="changeDraft.quantity" inputmode="decimal" data-validate="quantity" required/></label>
     <label v-if="changeDraft.action!=='remove'"><span class="field-caption">拟核定单价（元，可待核）</span><ElInput v-model="changeDraft.unit_price_yuan" inputmode="decimal" data-validate="money"/></label>
     <label v-if="changeDraft.action!=='remove'"><span class="field-caption">报价/定额依据</span><ElInput v-model="changeDraft.price_source" placeholder="调整价格时注明"/></label>
     <label v-if="changeDraft.action!=='remove'"><span class="field-caption">依据日期</span><ElDatePicker type="date" value-format="YYYY-MM-DD" format="YYYY-MM-DD"  v-model="changeDraft.price_date"/></label>
     <label v-if="changeDraft.action!=='remove'"><span class="field-caption">税口径</span><ElSelect v-model="changeDraft.tax_mode"><ElOption :label="'含税'" data-option-value="inclusive" value="inclusive">含税</ElOption><ElOption :label="'不含税'" data-option-value="exclusive" value="exclusive">不含税</ElOption><ElOption :label="'不适用'" data-option-value="none" value="none">不适用</ElOption></ElSelect></label>
     <label class="wide"><span class="field-caption">变更事项的事实依据</span><ElInput type="textarea" v-model="changeDraft.evidence" :rows="2" required/></label>
     <label class="wide"><span class="field-caption">变更原因</span><ElInput type="textarea" v-model="changeDraft.reason" :rows="3" required/></label>
     <div class="wide form-actions"><ElButton native-type="button" class="light" @click="projectAction=''">取消</ElButton><ElButton native-type="submit" class="primary">仅保存草稿</ElButton></div>
    </form>
   </FormModal>
   <h3>检修计划</h3>
   <p v-if="projectSettlementTotals" class="muted" data-testid="plan-budget-allocation-summary">已核定计划预算 {{money(projectSettlementTotals.allocated_plan_budget_fen)}} 元 · 子项目未分配预算 {{money(projectSettlementTotals.unallocated_plan_budget_fen)}} 元；计划结束或取消不自动释放。</p>
   <div v-if="!executionRows.length" class="empty">尚无检修计划</div>
   <div v-for="e in executionRows" :key="e.id" class="scope-item"><div class="section-header"><div><strong>{{e.number}} · {{e.plan_type==='outage'?'停电检修':'不停电检修'}} · {{e.description}}</strong><p class="muted">{{e.item_count}} 条工作明细 · 净结算 {{money(projectSettlementTotals?.plans?.find((p:Rec)=>p.execution_id===e.id)?.settled_fen)}} 元</p></div><ElButton class="link" @click="openExecution(e.id)">进入执行</ElButton></div><StatusTag :status="e.status"/></div>
   <ElButton v-if="roleWrite&&projectView.status==='approved'" class="secondary" @click="projectAction='execution'">＋ 新建检修计划</ElButton>
   <FormModal :open="projectAction==='execution'" title="新建检修计划" :error="visibleError" @close="projectAction=''">
       <form v-form-validation novalidate class="form-grid" @submit.prevent="createProjectExecution">

     <label><span class="field-caption">检修类型</span><ElSelect v-model="executionPlanType" required><ElOption :label="'停电检修'" data-option-value="outage" value="outage">停电检修</ElOption><ElOption :label="'不停电检修'" data-option-value="non_outage" value="non_outage">不停电检修</ElOption></ElSelect></label>
     <label class="wide"><span class="field-caption">施工说明</span><ElInput v-model="executionDescription" placeholder="本次检修任务"/></label><div class="wide form-actions"><ElButton native-type="submit" class="primary">创建检修计划</ElButton></div>
   </form>
   </FormModal>
   <h3>实施与结算核对</h3>
   <p v-if="projectProgress" class="muted">当前有效批准预算 {{money(projectProgress.approved_budget_fen)}} 元 · 已登记净结算 {{money(projectProgress.settled_fen)}} 元 · 未结算批准额度 {{money(projectProgress.unsettled_approved_fen)}} 元</p>
   <p v-if="projectSettlementTotals" class="muted" data-testid="actual-cost-summary">已确认实际费用 {{money(projectSettlementTotals.actual_cost_fen)}} 元 · 待最终核对费用 {{money(projectSettlementTotals.pending_final_expense_fen)}} 元</p>
   <p v-if="projectSettlementTotals" class="muted" data-testid="settlement-allocation-summary">其中已归集至检修计划 {{money(projectSettlementTotals.allocated_fen)}} 元 · 项目级未归集 {{money(projectSettlementTotals.unallocated_fen)}} 元；两者合计为项目净结算，不重复计算。</p>
   <div v-for="scope in projectProgress?.scopes||[]" :key="scope.id" class="scope-item">
    <div class="section-header">
     <div><strong>{{scope.demand_no}} · {{scope.line_name_snapshot}} {{scope.tower_no_snapshot}}</strong>
     <p class="muted">确认实施 {{fmtQty(scope.completed_quantity_scaled)}} / 批准 {{fmtQty(scope.quantity_scaled)}} {{scope.unit_snapshot}} · 净结算 {{money(scope.settled_fen)}} 元</p></div>
     <StatusTag :status="scope.dual_status"/>
    </div>
    <ElButton v-if="roleStageApprove&&projectView.status==='approved'" class="secondary" @click="openSettlement(scope)">登记项目级未归集凭证</ElButton>
   </div>
   <SettlementVoucherWorkspace :project-id="projectView.id" :can-settle="roleStageApprove" :refresh-key="settlementRefreshKey" @changed="refreshPlanFinancials" @reverse="entry=>entry.execution_item_id?openExecution(entry.execution_id):openSettlement(projectProgress?.scopes.find((s:Rec)=>s.id===entry.project_scope_id)||{id:entry.project_scope_id},entry)"/>
   <FormModal :open="settlementDialog" :title="settlementForm.entry_kind==='reversal'?'登记结算冲销':'登记结算凭证'" :error="visibleError" @close="settlementDialog=false">
    <form v-form-validation novalidate class="form-grid" @submit.prevent="saveSettlement">
     <p class="wide muted">本入口登记项目级未归集凭证，不自动计入任何检修计划；已明确归属检修计划的结算请进入对应计划。原始凭证留存，支持冲销、更正、撤销及历史查询。当前仅管理员可登记。</p>
     <label><span class="field-caption">凭证编号</span><ElInput v-model="settlementForm.settlement_no" required/></label>
     <label v-if="settlementForm.entry_kind==='payment'"><span class="field-caption">结算性质</span>
      <ElSelect v-model="settlementForm.settlement_type" required>
       <ElOption :label="'预付款'" data-option-value="advance" value="advance">预付款</ElOption><ElOption :label="'进度结算'" data-option-value="progress" value="progress">进度结算</ElOption><ElOption :label="'终结结算'" data-option-value="final" value="final">终结结算</ElOption>
      </ElSelect>
     </label>
     <label><span class="field-caption">金额（元）</span><ElInput v-model="settlementForm.amount_yuan" data-validate="money" inputmode="decimal" required/></label>
     <label><span class="field-caption">凭证日期</span><ElDatePicker type="date" value-format="YYYY-MM-DD" format="YYYY-MM-DD" v-model="settlementForm.occurred_on"  required/></label>
     <label class="wide"><span class="field-caption">结算依据</span><ElInput type="textarea" v-model="settlementForm.evidence" :rows="3" required/></label>
     <div class="form-actions"><ElButton class="light" native-type="button" @click="settlementDialog=false">取消</ElButton><ElButton native-type="submit" class="primary">确认登记</ElButton></div>
    </form>
   </FormModal>
   <h3>阶段快照</h3><div v-for="e in projectView.events" :key="e.id" class="history">{{e.created_at}} · {{e.stage==='stocked'?'入库':'立项'}} · {{e.reason}} · 版本 {{e.project_version}}</div>
  </div></section>
  <section v-if="executionView" class="detail-overlay execution-overlay" @click.self="executionView=null"><div class="detail-panel">
   <div class="section-header"><div><h2>{{executionView.plan_type==='outage'?'停电检修':'不停电检修'}}计划 {{executionView.number}}</h2><StatusTag :status="executionView.status"/></div><ElButton class="light" @click="executionView=null">返回项目</ElButton></div>
   <p>{{executionView.description||'本次执行需求范围'}}</p>
   <div v-for="i in executionView.items" :key="i.id" class="scope-item">
    <h3>{{i.demand_no}} · {{i.line_name_snapshot}} {{i.tower_no_snapshot}}</h3>
    <p>{{i.operation_snapshot}} · {{i.target_object}}</p>
    <p>计划 {{fmtQty(i.planned_quantity_scaled)}} {{i.unit_snapshot}} · 已确认 {{fmtQty(i.completed_quantity_scaled)}} {{i.unit_snapshot}}</p>
    <ElButton v-if="executionView.status==='running'&&roleWrite" class="secondary" @click="completionItem=i">确认完成量</ElButton>

   </div>
   <FormModal :open="!!completionItem" :title="'确认实际完成量：'+(completionItem?.demand_no||'')" :error="visibleError" @close="completionItem=null">
        <form v-form-validation novalidate @submit.prevent="confirmWork(completionItem!)" class="form-grid">
     <label><span class="field-caption">本次确认量</span><ElInput v-model="completeQuantity" data-validate="quantity" required inputmode="decimal"/></label><label><span class="field-caption">实施日期</span><ElDatePicker type="date" value-format="YYYY-MM-DD" format="YYYY-MM-DD" v-model="completeDate" required /></label>
     <label class="wide"><span class="field-caption">完成依据 / 验收说明</span><ElInput v-model="completeEvidence" required/></label><div class="wide form-actions"><ElButton native-type="submit" class="secondary">确认实际完成量</ElButton></div>
    </form>
   </FormModal>
   <ElButton v-if="executionView.status==='planned'&&roleWrite" class="secondary" @click="executionAction='plan'">＋ 安排工作明细</ElButton>
   <FormModal :open="executionAction==='plan'" title="安排本次执行明细" :error="visibleError" @close="executionAction=''">
       <form v-form-validation novalidate @submit.prevent="addExecutionPlan" class="form-grid">
    <label class="wide"><span class="field-caption">安排批准范围</span><ElSelect v-model="execScopeId" required><ElOption :label="'请选择'" data-option-value="" value="">请选择</ElOption><ElOption :label="String(s.demand_no) + ' · ' + String(s.line_name_snapshot) + ' ' + String(s.tower_no_snapshot)" :data-option-value="s.id" v-for="s in eligibleExecutionScopes" :key="s.id" :value="s.id">{{s.demand_no}} · {{s.line_name_snapshot}} {{s.tower_no_snapshot}}</ElOption></ElSelect></label>
    <label><span class="field-caption">本批次拟完成工作量</span><ElInput v-model="execQuantity" data-validate="quantity" required inputmode="decimal"/></label><div class="form-actions"><ElButton native-type="submit" class="secondary">安排工作明细</ElButton></div>
   </form>
   </FormModal>
   <div v-if="roleWrite" class="form-actions">
    <ElButton v-if="executionView.status==='planned'" class="primary" :disabled="!executionView.items.length" @click="openReason('execution:start')">确认开工</ElButton>
    <ElButton v-if="executionView.status==='running'" class="primary" @click="openReason('execution:finish')">结束本次执行</ElButton>
    <ElButton v-if="executionView.status==='planned'" class="light" @click="openReason('execution:cancel')">取消未开工批次</ElButton>
   </div>
   <CompletionWorkspace :execution-id="executionView.id" :can-write="!!roleWrite" :refresh-key="settlementRefreshKey" @changed="refreshExecutionFacts"/>
   <PlanBudgetWorkspace :execution-id="executionView.id" :can-write="!!roleWrite" :can-confirm="roleAdmin" :refresh-key="settlementRefreshKey" @changed="refreshPlanFinancials"/>
   <CostWorkspace :execution-id="executionView.id" :can-write="!!roleWrite" :can-confirm="roleAdmin" :refresh-key="settlementRefreshKey" @changed="refreshPlanFinancials"/>
   <CostReconciliationWorkspace :execution-id="executionView.id" :can-confirm="roleAdmin" :refresh-key="settlementRefreshKey" @changed="refreshPlanFinancials"/>
   <PlanSettlementWorkspace :execution-id="executionView.id" :can-settle="roleStageApprove" :refresh-key="settlementRefreshKey" @changed="refreshPlanFinancials"/>
   <p class="muted minor">完成量按每项批准范围核对，不得超过本次计划数量。结算依据由独立凭证登记，不由完成量自动推算。</p>
  </div></section>
  <template v-if="nav==='access'">
    <section class="panel"><div class="section-header"><div><h2>允许访问的 IP</h2><p class="muted">逐个配置具体IP地址；保存后无需重启服务</p></div></div>
      <p class="muted">服务器识别到本次连接的地址：<strong class="mono">{{currentClientIP}}</strong>。本机 127.0.0.1 和 ::1 永久允许，用于初始化和应急管理。其他地址未加入列表时默认拒绝。</p>
      <ElButton class="primary" @click="ipDialog=true">＋ 添加允许 IP</ElButton>
      <FormModal :open="ipDialog" title="添加允许访问的 IP" :error="visibleError" @close="ipDialog=false">
             <form v-form-validation novalidate class="form-grid" @submit.prevent="addAllowedIP">
        <label><span class="field-caption">IP 地址</span><ElInput v-model.trim="ipInput" required placeholder="例如 192.168.1.105 或 2001:db8::1"/></label>
        <label><span class="field-caption">设备 / 用途备注</span><ElInput v-model.trim="ipNote" placeholder="例如 运检班组办公电脑"/></label>
        <ElButton native-type="submit" class="primary" :disabled="busy||!ipInput">添加允许 IP</ElButton>
      </form>
      </FormModal>

      <FormModal :open="!!pendingRemoveIP" title="移除 IP 访问权限" :error="visibleError" @close="pendingRemoveIP=null">
       <p>确定撤销 <strong class="mono">{{pendingRemoveIP?.ip}}</strong> 的访问授权吗？撤销后，新连接将立即被拒绝。</p>
       <div class="form-actions"><ElButton class="light" @click="pendingRemoveIP=null">取消</ElButton><ElButton class="primary" @click="removeAllowedIP">确认移除</ElButton></div>
      </FormModal>
      <div class="table-wrap"><ElTable :data="allowedIPs" >
<ElTableColumn><template #header>允许的IP</template><template #default="{row,$index}"><template v-for="([x]) in [[row,$index]]"><div class="mono">{{x.ip}}</div></template></template></ElTableColumn>
<ElTableColumn><template #header>设备备注</template><template #default="{row,$index}"><template v-for="([x]) in [[row,$index]]"><div >{{x.note||'—'}}</div></template></template></ElTableColumn>
<ElTableColumn><template #header>添加时间</template><template #default="{row,$index}"><template v-for="([x]) in [[row,$index]]"><div >{{x.created_at}}</div></template></template></ElTableColumn>
<ElTableColumn><template #header>添加人</template><template #default="{row,$index}"><template v-for="([x]) in [[row,$index]]"><div >{{x.created_by_name}}</div></template></template></ElTableColumn>
<ElTableColumn><template #header>操作</template><template #default="{row,$index}"><template v-for="([x]) in [[row,$index]]"><div ><ElButton class="link danger" @click="pendingRemoveIP=x">移除</ElButton></div></template></template></ElTableColumn><template #empty><div class="empty">目前没有授权任何远程 IP，仅服务器本机可以访问。</div></template></ElTable></div>
      <p class="muted minor">只允许精确 IP 地址，不允许填网段、IP 范围或域名。验证使用真实 TCP 连接地址，不相信浏览器传入的代理头。IP 授权不能替代账号登录；Windows 防火墙仍需单独放行服务端口。</p>
    </section>
  </template>
  <AuditWorkspace v-if="nav==='audit'&&roleAdmin"/>
  <DictionaryWorkspace v-if="nav==='dictionary'" @changed="refresh"/>
  <template v-if="nav==='entry'">
   <form v-form-validation novalidate class="entry-main" @submit.prevent="submitBatch(false)">
    <section v-if="roleWrite" class="panel"><div class="section-header"><h2>{{currentDraft?'正在编辑草稿':'需求草稿'}}</h2><ElButton native-type="button" class="secondary" @click="draftsOpen=!draftsOpen;loadDrafts()">{{draftsOpen?'收起草稿':'查看草稿'}}（{{drafts.length}}）</ElButton></div>
     <div v-if="draftsOpen"><p v-if="!drafts.length" class="muted">暂无未提交草稿</p><div v-for="draft in drafts" :key="draft.id" class="scope-item"><span>{{draftSummary(draft)}} · {{draft.updated_at}}</span><ElButton native-type="button" class="link" @click="restoreDraft(draft.id)">继续编辑</ElButton></div></div>
    </section>
    <div class="entry-card">
     <section class="entry-section panel">
      <div class="entry-section-head"><div class="entry-section-title"><span class="step-number">01</span><h2>选择位置</h2></div><span class="section-note">可跨线路追加</span></div>
      <div v-if="demandLocationKind==='span'" class="scope-item"><strong>当前按档距创建需求</strong><p>已选 {{demandSpanRows.length}} 个档距。长度是台账参考，本次工程量请在共同内容或逐档预览中确认。</p><p v-for="span in demandSpanRows" :key="span.id">{{span.line_name}} {{span.start_tower_no}}—{{span.end_tower_no}} · 台账长度 {{span.length_scaled===null?'未填写':fmtQty(span.length_scaled)+'米'}}</p><ElButton native-type="button" class="secondary" @click="openLedger({lineId:selectedLine,tab:'spans'})">返回线路调整所选档距</ElButton></div>
      <template v-else>
      <label class="field-full"><span class="field-caption">选择线路 <span class="required-star" aria-hidden="true">*</span></span><ElSelect v-model="selectedLine" required><ElOption :label="'请选择线路'" data-option-value="" value="">请选择线路</ElOption><ElOption :label="String(l.voltage_name) + ' · ' + String(l.name)" :data-option-value="l.id" v-for="l in lines.filter(x=>x.status==='active')" :value="l.id" :key="l.id">{{l.voltage_name}} · {{l.name}}</ElOption></ElSelect>
      </label>
      <p class="field-hint">切换线路后已选位置仍保留，选择1基即可单条创建。</p>
      <div class="selection-tools">
       <strong>本线路已选 {{thisLineSelected}} / {{thisLineTotal}} 基</strong>
       <div class="selection-actions">
        <ElButton native-type="button" class="text-button" @click="selectVisible" :disabled="!selectedLine">全选本线路</ElButton>
        <ElButton native-type="button" class="text-button" @click="removeSelectedLine" :disabled="!selectedLine">清空本线路</ElButton>
        <ElButton native-type="button" class="text-button" @click="rangeOpen=!rangeOpen">{{rangeOpen?'收起按杆段选择':'按杆段选择'}}</ElButton>
       </div>
      </div>
      <div v-if="rangeOpen" class="range-picker">
       <label><span class="field-caption">杆段起点</span><ElSelect v-model="fromRank"><ElOption :label="'请选择'" data-option-value="" value="">请选择</ElOption><ElOption :label="String(x.tower_no)" :data-option-value="x.id" v-for="x in logical.filter(x=>x.line_id===selectedLine&&x.status==='active').sort((a,b)=>a.sort_rank-b.sort_rank)" :value="x.id" :key="x.id">{{x.tower_no}}</ElOption></ElSelect></label>
       <label><span class="field-caption">杆段终点</span><ElSelect v-model="toRank"><ElOption :label="'请选择'" data-option-value="" value="">请选择</ElOption><ElOption :label="String(x.tower_no)" :data-option-value="x.id" v-for="x in logical.filter(x=>x.line_id===selectedLine&&x.status==='active').sort((a,b)=>a.sort_rank-b.sort_rank)" :value="x.id" :key="x.id">{{x.tower_no}}</ElOption></ElSelect></label>
       <ElButton native-type="button" class="secondary" @click="selectRange">追加选择</ElButton>
      </div>
      <label class="field-full tower-filter"><span class="field-caption">筛选杆塔</span><ElInput v-model="towerSearch" placeholder="输入杆塔号"/>
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
       <ElButton native-type="button" :class="{chosen:common.work_target_type==='line'}" @click="common.work_target_type='line';common.operation_id=''">线路侧设备</ElButton>
       <ElButton native-type="button" :class="{chosen:common.work_target_type==='physical'}" :disabled="demandLocationKind==='span'" @click="common.work_target_type='physical';common.operation_id=''">共用物理杆塔</ElButton>
      </div>
      <p class="field-hint">{{common.work_target_type==='line'?'各线路杆塔独立生成需求，不因共塔自动合并。':'共塔同部位的作业必须明确选择一个主位置，其他回路在关联位置中记录。'}}</p>
      <div class="form-grid entry-fields">
       <div class="field-label-group">
        <div class="inline-field-top"><span class="field-title">操作类型 <span class="required-star" aria-hidden="true">*</span></span><ElButton native-type="button" v-if="roleAdmin" class="text-button small" @click="openNav('dictionary')">管理选项</ElButton></div>
        <ElSelect aria-label="操作类型" v-model="common.operation_id" required><ElOption :label="'请选择操作类型'" data-option-value="" value="">请选择操作类型</ElOption><ElOption :label="String(op.name)" :data-option-value="op.id" v-for="op in ops" :key="op.id" :value="op.id">{{op.name}}</ElOption></ElSelect>
       </div>
       <label><span class="field-caption">共同处理部位 <span class="required-star" aria-hidden="true">*</span></span><ElInput v-model="common.target_object" required placeholder="例如 横担上部"/></label>
       <div class="field-label-group"><div class="inline-field-top"><span class="field-title">{{demandLocationKind==='span'?'每档工作量':'每基工作量'}} <span class="required-star" aria-hidden="true">*</span></span><ElButton native-type="button" class="text-button small" @click="applyDefault">应用操作默认值</ElButton></div>
        <div class="quantity-inputs"><ElInput :aria-label="demandLocationKind==='span'?'每档工作量':'每基工作量'" v-model="common.quantity" required data-validate="quantity" inputmode="decimal" placeholder="1"/><ElSelect v-model="common.unit_id" required aria-label="计量单位"><ElOption :label="'单位'" data-option-value="" value="">单位</ElOption><ElOption :label="String(x.name)" :data-option-value="x.id" v-for="x in units" :key="x.id" :value="x.id">{{x.name}}</ElOption></ElSelect></div>
        <p class="field-hint">每个位置的本次工作量为{{common.quantity||'—'}}{{items.find(x=>x.id===common.unit_id)?.name||'单位'}}，选{{selectedRows.length}}个位置共{{Number(totalQty.toFixed(4))}}{{items.find(x=>x.id===common.unit_id)?.name||'单位'}}。</p>
       </div>
       <label><span class="field-caption">完成标准 <span class="required-star" aria-hidden="true">*</span></span><ElInput v-model="common.completion_standard" required placeholder="按核定部位完成安装并验收合格"/></label>
       <label class="wide"><span class="field-caption">问题描述 / 实施必要性 <span class="required-star" aria-hidden="true">*</span></span><ElInput type="textarea" v-model="common.problem_description" required :rows="3" placeholder="说明存在的问题、实施必要性及作业背景"/></label>
      </div>
      <CustomFields :definitions="fieldDefinitions" v-model="common.custom_fields"/>
     </section>

     <section class="entry-section panel">
      <div class="entry-section-head"><div class="entry-section-title"><span class="step-number">03</span><h2>共同来源依据</h2></div><span class="section-note">一次填写，多条关联</span></div>
      <div v-for="(source,index) in batchSources" :key="index" class="source-card">
       <div class="source-card-head"><strong>来源 {{index+1}}</strong><ElButton native-type="submit" v-if="batchSources.length>1" class="text-button danger" @click="removeSource(index)">移除来源</ElButton></div>
       <div class="form-grid entry-fields">
        <label><span class="field-caption">来源类型 <span class="required-star" aria-hidden="true">*</span></span><ElSelect v-model="source.type_id" required><ElOption :label="'请选择'" data-option-value="" value="">请选择</ElOption><ElOption :label="String(x.name)" :data-option-value="x.id" v-for="x in sources" :key="x.id" :value="x.id">{{x.name}}</ElOption></ElSelect></label>
        <label><span class="field-caption">发现 / 提出日期 <span class="required-star" aria-hidden="true">*</span></span><ElDatePicker type="date" value-format="YYYY-MM-DD" format="YYYY-MM-DD"  v-model="source.discovered_on" required/></label>
        <label><span class="field-caption">提出单位 / 人员 <span class="required-star" aria-hidden="true">*</span></span><ElInput v-model="source.proposed_by" required placeholder="填写提出单位或人员"/></label>
        <label><span class="field-caption">来源依据编号</span><ElInput v-model="source.external_ref" placeholder="工单、缺陷单或检查编号"/></label>
        <label class="wide"><span class="field-caption">来源说明</span><ElInput type="textarea" v-model="source.description" :rows="2" placeholder="记录来源内容与原始依据"/></label>
       </div>
      </div>
      <ElButton native-type="button" class="secondary source-add" @click="addSource">＋ 添加一条来源</ElButton>
      <div class="entry-advanced"><ElButton native-type="button" class="text-button" @click="entryAdvancedOpen=!entryAdvancedOpen">{{entryAdvancedOpen?'收起附加信息':'填写优先级、期望时间'}}</ElButton>
       <div v-if="entryAdvancedOpen" class="form-grid entry-fields advanced-fields">
        <label><span class="field-caption">优先级</span><ElSelect v-model="common.priority_id"><ElOption :label="'未设置'" data-option-value="" value="">未设置</ElOption><ElOption :label="String(x.name)" :data-option-value="x.id" v-for="x in priorities" :key="x.id" :value="x.id">{{x.name}}</ElOption></ElSelect></label>
        <label><span class="field-caption">期望完成日期</span><ElDatePicker type="date" value-format="YYYY-MM-DD" format="YYYY-MM-DD"  v-model="common.expected_on"/></label>
       </div>
      </div>
     </section>

     <section class="entry-section panel">
      <div class="entry-section-head"><div class="entry-section-title"><span class="step-number">04</span><h2>{{demandLocationKind==='span'?'逐档预览与调整':'逐基预览与调整'}}</h2></div><span class="section-note">{{selectedRows.length}} 条独立需求</span></div>
      <p class="field-hint">共同字段已填入每条需求；单独修改部位或数量仅影响对应杆塔。预览确认后提交待核实。</p>
      <div class="table-wrap"><ElTable :data="selectedRows" class="preview-table">
<ElTableColumn><template #header>位置</template><template #default="{row,$index}"><template v-for="([x,index]) in [[row,$index]]"><div  :data-row-index="index"><strong>{{x.tower_no}}</strong><small>{{x.line_name}}</small></div></template></template></ElTableColumn>
<ElTableColumn><template #header>处理部位 <span class="required-star" aria-hidden="true">*</span></template><template #default="{row,$index}"><template v-for="([x,index]) in [[row,$index]]"><div  :data-row-index="index"><input class="compact" :aria-label="'处理部位 '+x.tower_no" :value="x.target_object" required @input="overrides[x.id]={...overrides[x.id],target_object:($event.target as HTMLInputElement).value}"/></div></template></template></ElTableColumn>
<ElTableColumn><template #header>工作量 <span class="required-star" aria-hidden="true">*</span></template><template #default="{row,$index}"><template v-for="([x,index]) in [[row,$index]]"><div  :data-row-index="index"><input class="compact num" :aria-label="'工作量 '+x.tower_no" inputmode="decimal" :value="x.quantity" required data-validate="quantity" @input="overrides[x.id]={...overrides[x.id],quantity:($event.target as HTMLInputElement).value}"/></div></template></template></ElTableColumn>
<ElTableColumn v-if="fieldDefinitions.length"><template #header>扩展字段</template><template #default="{row,$index}"><template v-for="([x,index]) in [[row,$index]]"><div  :data-row-index="index"><details><summary>逐基调整</summary><CustomFields :definitions="fieldDefinitions" :prefix="x.tower_no+' '" :model-value="x.custom_fields" @update:model-value="overrides[x.id]={...overrides[x.id],custom_fields:$event}"/></details></div></template></template></ElTableColumn>
<ElTableColumn><template #header></template><template #default="{row,$index}"><template v-for="([x,index]) in [[row,$index]]"><div  :data-row-index="index"><ElButton native-type="button" class="text-button danger" @click="excluded[x.id]=true">排除</ElButton></div></template></template></ElTableColumn><template #empty><div class="empty">请先在上方勾选杆塔</div></template></ElTable></div>
      <div class="batch-review">
       <div><strong>本批 {{selectedRows.length}} 条需求</strong><small>{{selectedLines.length}} 条线路 · {{batchSources.length}} 条来源依据 · 独立生成</small></div>
       <div class="form-actions"><ElButton native-type="button" class="light" @click="resetBatch">清空重填</ElButton><ElButton native-type="button" class="secondary" :disabled="busy" @click="submitBatch(true)">保存草稿</ElButton><ElButton native-type="submit" class="primary" :disabled="busy||!roleWrite||!selectedRows.length">提交 {{selectedRows.length}} 条核实</ElButton></div>
      </div>
      <p v-if="lastResult" class="saved-batch">批次 {{lastResult.batch_id}} 已保存，共 {{lastResult.count}} 条。重复提交不会重复建立记录。</p>
     </section>
    </div>
   </form>
  </template>
  <FormModal :open="duplicateDialog" title="疑似重复需求核实" :error="visibleError" size="wide" @close="duplicateDialog=false">
   <p class="muted">发现此前批次已有同位置、同操作、同部位的需求。请选择追加已有来源或确属新发的独立需求，不会自动合并工作量。</p>
   <form class="form-grid" @submit.prevent="submitBatch(false,true)">
    <div v-for="x in duplicateFindings" :key="x.index" class="wide scope-item">
     <strong>{{selectedRows[x.index]?.line_name}} {{selectedRows[x.index]?.tower_no}} · {{selectedRows[x.index]?.target_object}}</strong>
     <label><span class="field-caption">已存在的需求</span>
      <ElSelect v-model="duplicateChoices[x.index].candidate_id" required>
       <ElOption :label="String(c.demand_no) + ' · ' + String(c.status) + ' · ' + String(c.target_object)" :data-option-value="c.id" v-for="c in x.candidates" :key="c.id" :value="c.id">{{c.demand_no}} · {{c.status}} · {{c.target_object}}</ElOption>
      </ElSelect>
     </label>
     <label><span class="field-caption">核实处理</span>
      <ElSelect v-model="duplicateChoices[x.index].decision" required>
       <ElOption :label="'请选择'" data-option-value="" value="">请选择</ElOption>
       <ElOption :label="'确属新发或不同范围，另建待核实需求'" data-option-value="separate" value="separate">确属新发或不同范围，另建待核实需求</ElOption>
       <ElOption :label="'同一问题，仅把新来源关联既有需求（不增加工作量）'" data-option-value="link" v-if="roleAdmin" value="link">同一问题，仅把新来源关联既有需求（不增加工作量）</ElOption>
      </ElSelect>
     </label>
     <label><span class="field-caption">核实依据</span>
      <ElInput type="textarea" v-model="duplicateChoices[x.index].reason" :rows="2" required placeholder="说明新问题与历史问题的关系、时间和核对依据"/>
     </label>
    </div>
    <div class="form-actions"><ElButton native-type="button" class="light" @click="duplicateDialog=false">取消</ElButton><ElButton native-type="submit" class="primary">按核实结论提交</ElButton></div>
   </form>
  </FormModal>
  <template v-if="nav==='demands'"><section class="panel"><div class="section-header"><div><h2>需求列表</h2><p class="muted">当前查询结果 {{demands.length}} 条 · 导出范围与筛选一致</p></div><div class="actions"><ElButton class="secondary" @click="exportDemands">Excel 导出</ElButton><ElButton v-if="roleWrite" class="primary" @click="openNav('entry')">新建需求</ElButton></div></div><div class="toolbar"><label><span class="field-caption">状态</span><ElSelect v-model="statusFilter"><ElOption :label="'全部'" data-option-value="" value="">全部</ElOption><ElOption :label="'待核实'" data-option-value="pending" value="pending">待核实</ElOption><ElOption :label="'有效'" data-option-value="active" value="active">有效</ElOption><ElOption :label="'退回'" data-option-value="returned" value="returned">退回</ElOption><ElOption :label="'取消'" data-option-value="cancelled" value="cancelled">取消</ElOption></ElSelect></label><label><span class="field-caption">线路</span><ElSelect v-model="lineFilter"><ElOption :label="'全部线路'" data-option-value="" value="">全部线路</ElOption><ElOption :label="String(x.name)" :data-option-value="x.id" v-for="x in lines" :key="x.id" :value="x.id">{{x.name}}</ElOption></ElSelect></label><label><span class="field-caption">关键词</span><ElInput v-model="search" placeholder="编号、杆塔、问题或部位"/></label></div><div class="table-wrap"><ElTable :data="demands" >
<ElTableColumn><template #header>编号</template><template #default="{row,$index}"><template v-for="([d]) in [[row,$index]]"><div class="mono">{{d.demand_no}}</div></template></template></ElTableColumn>
<ElTableColumn><template #header>位置</template><template #default="{row,$index}"><template v-for="([d]) in [[row,$index]]"><div >{{d.line_name_snapshot}} {{d.tower_no_snapshot}}</div></template></template></ElTableColumn>
<ElTableColumn><template #header>操作与部位</template><template #default="{row,$index}"><template v-for="([d]) in [[row,$index]]"><div >{{d.operation_snapshot}} · {{d.target_object}}</div></template></template></ElTableColumn>
<ElTableColumn><template #header>工作量</template><template #default="{row,$index}"><template v-for="([d]) in [[row,$index]]"><div >{{fmtQty(d.quantity_scaled)}} {{d.unit_snapshot}}</div></template></template></ElTableColumn>
<ElTableColumn><template #header>状态</template><template #default="{row,$index}"><template v-for="([d]) in [[row,$index]]"><div ><StatusTag :status="d.status"/></div></template></template></ElTableColumn>
<ElTableColumn><template #header>操作</template><template #default="{row,$index}"><template v-for="([d]) in [[row,$index]]"><div ><ElButton class="link" @click="showDemand(d.id)">详情</ElButton></div></template></template></ElTableColumn><template #empty><div class="empty">没有符合筛选条件的需求</div></template></ElTable></div></section></template>
  <section v-if="detail" class="detail-overlay" @click.self="detail=null"><div class="detail-panel"><div class="section-header"><h2>{{detail.demand_no?'需求 '+detail.demand_no:'台账详情'}}</h2><ElButton class="light" @click="detail=null">关闭 ×</ElButton></div>
    <template v-if="detail.demand_no"><div class="info-grid"><div><small>需求位置</small><strong>{{detail.line_name_snapshot}} {{detail.tower_no_snapshot}}</strong></div><div><small>检修操作</small><strong>{{detail.operation_snapshot}}</strong></div><div><small>工作量</small><strong>{{fmtQty(detail.quantity_scaled)}} {{detail.unit_snapshot}}</strong></div><div><small>当前状态</small><StatusTag :status="detail.status"/></div></div>
      <p v-if="detail.project_references?.length" class="muted">已关联项目：{{detail.project_references.map((x:Rec)=>x.code).join('、')}}。工作范围保留历史依据；范围变更须办理项目变更。</p>
      <p>当前台账：{{detail.current_line_name}} {{detail.current_tower_no}}</p><ElButton v-if="roleWrite&&detail.status!=='cancelled'" class="secondary" @click="openReason('revalidate')">重新核实位置</ElButton>
      <div class="scope-item"><strong>处理部位</strong><p>{{detail.target_object}}</p>
       <strong>问题说明</strong><p>{{detail.problem_description}}</p>
       <strong>完成标准</strong><p>{{detail.completion_standard}}</p>
      </div>
      <div v-if="detail.field_definitions?.length" class="scope-item"><strong>附加业务字段</strong><CustomFields :definitions="detail.field_definitions||[]" :model-value="detail.custom_fields||{}" :disabled="true"/></div>
      <div v-if="roleWrite&&detail.status!=='cancelled'" class="form-actions"><ElButton class="secondary" @click="openDemandEdit">编辑需求</ElButton></div>
      <FormModal :open="!!demandEdit" title="修订需求" :error="visibleError" size="wide" @close="demandEdit=null">
       <form v-form-validation novalidate v-if="demandEdit" class="form-grid" @submit.prevent="saveDemandEdit">
        <label><span class="field-caption">具体部位</span><ElInput v-model="demandEdit.target_object" required/></label>
        <label><span class="field-caption">工作量（{{demandEdit.unit_snapshot}}）</span><ElInput v-model="demandEdit.quantity" data-validate="quantity" inputmode="decimal" required/></label>
        <label class="wide"><span class="field-caption">问题说明</span><ElInput type="textarea" v-model="demandEdit.problem_description" :rows="3" required/></label>
        <label class="wide"><span class="field-caption">完成标准</span><ElInput type="textarea" v-model="demandEdit.completion_standard" :rows="2" required/></label>
        <div class="wide"><CustomFields :definitions="demandEdit.field_definitions||[]" v-model="demandEdit.custom_fields"/></div>
        <label class="wide"><span class="field-caption">修订原因</span><ElInput v-model="demandEdit.change_reason" required/></label>
        <div class="form-actions"><ElButton native-type="button" class="light" @click="demandEdit=null">取消</ElButton><ElButton native-type="submit" class="primary">保存修订并留痕</ElButton></div>
       </form>
      </FormModal>
      <h3>来源与核实</h3><p v-for="x in detail.sources" :key="x.id">{{x.discovered_on}} · {{x.proposed_by}} · {{x.type_snapshot}} · {{x.description||x.external_ref||'—'}}</p><div v-if="roleVerify&&detail.status!=='cancelled'" class="form-actions"><ElButton class="primary" @click="openReason('verify:active')">确认有效</ElButton><ElButton class="secondary" @click="openReason('verify:returned')">退回补充</ElButton><ElButton class="light" @click="openReason('verify:cancelled')">取消</ElButton></div>
      <h3>附件依据</h3>
      <ElButton v-if="roleWrite" class="secondary" @click="attachmentDialog=true">上传附件</ElButton>
      <FormModal :open="attachmentDialog" title="上传需求附件" :error="visibleError" @close="attachmentDialog=false">
       <form v-form-validation novalidate @submit.prevent>
       <label><span class="field-caption">选择附件（最多15MB）</span><input type="file" required :disabled="busy" @change="uploadAttachment"/></label>
       <p class="field-hint">选中文件后立即上传，完成后自动关闭此窗口。</p>
       <div class="form-actions"><ElButton class="light" native-type="button" @click="attachmentDialog=false">取消</ElButton></div>
       </form>
      </FormModal><p v-for="file in detail.attachments" :key="file.id"><a :href="'/api/attachments/'+file.id">{{file.filename}}</a> · {{file.bytes}} 字节</p>
      <h3>历史修订</h3><p v-for="rev in detail.revisions" :key="rev.id" class="history">{{rev.changed_at}} · v{{rev.version}} · {{rev.reason}}</p>
    </template><template v-else><pre class="json-preview">{{JSON.stringify(detail,null,2)}}</pre></template>
  </div></section>
  <FormModal :open="!!reasonAction" :title="reasonTitle" @close="reasonAction=''">
   <form v-form-validation novalidate class="form-grid" @submit.prevent="submitReason">
    <label class="wide"><span class="field-caption">操作依据 / 说明</span><ElInput type="textarea" v-model="reasonValue" :rows="3" required placeholder="请填写本次操作的依据"></ElInput></label>
    <p v-if="visibleError" role="alert" class="form-modal-error">{{visibleError}}</p>
    <div class="form-actions"><ElButton native-type="button" class="light" @click="reasonAction=''">取消</ElButton><ElButton native-type="submit" class="primary" :disabled="busy">确认</ElButton></div>
   </form>
  </FormModal>
</ApplicationShell>
</template>

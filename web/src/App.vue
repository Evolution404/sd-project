<script setup lang="ts">
import {computed,onMounted,reactive,ref,watch} from 'vue';
import {newClientId} from './utils/client-id';
type Rec = Record<string,any>;
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
const overrides=reactive<Record<string,{target_object?:string,quantity?:string}>>({});
const excluded=reactive<Record<string,boolean>>({});
const stage=ref(''),dictionaryType=ref('operation');
const batchKey=ref<string>(newClientId()),lastResult=ref<Rec|null>(null);
const common=reactive<Rec>({work_target_type:'line',operation_id:'',target_object:'',quantity:'1',unit_id:'',completion_standard:'',problem_description:'',priority_id:'',expected_on:'',source:{type_id:'',discovered_on:new Date().toLocaleDateString('en-CA'),proposed_by:'',description:'',external_ref:''}});
const initialForm:Rec={};
const form=reactive<Rec>({});
const labels:Rec={overview:'工作台',voltage:'电压等级',lines:'线路台账',physical:'物理杆塔',logical:'逻辑杆塔',entry:'批量需求录入',demands:'需求中心',dictionary:'系统字典',access:'IP访问管理',frameworks:'项目框架',agreements:'执行协议',projects:'子项目储备'};
const tabs=['overview','entry','demands','voltage','lines','physical','logical','dictionary'];
const ops=computed(()=>items.value.filter(x=>x.type_id==='operation'&&x.status==='active'&&(x.work_target_type===common.work_target_type||x.work_target_type==='both')));
const units=computed(()=>items.value.filter(x=>x.type_id==='unit'&&x.status==='active'));
const sources=computed(()=>items.value.filter(x=>x.type_id==='source'&&x.status==='active'));
const priorities=computed(()=>items.value.filter(x=>x.type_id==='priority'&&x.status==='active'));
const thisLineTowers=computed(()=>logical.value.filter(x=>x.line_id===selectedLine.value&&x.status==='active'&&(!towerSearch.value||[x.tower_no,x.logical_code,x.physical_code].some(y=>String(y||'').toLowerCase().includes(towerSearch.value.toLowerCase())))).sort((a,b)=>a.sort_rank-b.sort_rank));
const selectedRows=computed<Rec[]>(()=>logical.value.filter(x=>selected[x.id]&&!excluded[x.id]).map(x=>({...x,quantity:overrides[x.id]?.quantity??String(common.quantity),target_object:overrides[x.id]?.target_object??String(common.target_object)})));
const totalQty=computed(()=>selectedRows.value.reduce((acc,x)=>acc+(Number(x.quantity)||0),0));
const thisLineSelected=computed(()=>logical.value.filter(x=>x.line_id===selectedLine.value&&selected[x.id]&&!excluded[x.id]).length);
const thisLineTotal=computed(()=>logical.value.filter(x=>x.line_id===selectedLine.value&&x.status==='active').length);
const selectedLines=computed(()=>lines.value.filter(l=>selectedRows.value.some(x=>x.line_id===l.id)));
const sectionLabel=computed(()=>nav.value==='entry'?'需求中心':['demands'].includes(nav.value)?'需求中心':['projects'].includes(nav.value)?'项目中心':['frameworks','agreements'].includes(nav.value)?'框架与协议':['voltage','lines','physical','logical'].includes(nav.value)?'基础台账':['dictionary','access'].includes(nav.value)?'系统管理':'项目全流程');
const displayTitle=computed(()=>nav.value==='entry'?'批量新建需求':nav.value==='projects'?'项目中心':nav.value==='overview'?'工作台':mediaTitle.value);
const roleWrite=computed(()=>user.value&&['admin','editor'].includes(user.value.role));
const roleVerify=computed(()=>user.value&&['admin','verifier'].includes(user.value.role));
const money=(value:any)=>value===null||value===undefined?'待核定':(Number(value)/100).toFixed(2);
const projectStage=(value:string)=>({reserve:'储备编制',stocked:'已入库',approved:'已立项',closed:'已结项'} as Rec)[value]||value;
const roleAdmin=computed(()=>user.value?.role==='admin');
const mediaTitle=computed(()=>labels[nav.value]||'');
const options=(type:string)=>items.value.filter(x=>x.type_id===type).sort((a,b)=>a.sort_order-b.sort_order);
const selectedOp=computed(()=>items.value.find(x=>x.id===common.operation_id));
const dateStr=(s:string)=>s?s.slice(0,10):'';
const fmtQty=(v:any)=>Number(v||0)/1000;
const statusName=(v:string)=>({pending:'待核实',active:'有效',returned:'退回',cancelled:'取消'} as Record<string,string>)[v]||v;
const errorMessage=(e:any)=>e?.message||'网络请求失败';
function notify(msg:string){success.value=msg;setTimeout(()=>{if(success.value===msg)success.value=''},4000)}
async function api(path:string,method='GET',body?:any){
 const res=await fetch('/api'+path,{method,credentials:'same-origin',headers:{...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 const data=await res.json();
 if(!res.ok)throw Error(data.error+(data.details?'：'+data.details.map((x:any)=>'第'+x.row+'行 '+x.message).join('；'):''));
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
async function openProject(item:Rec){
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
 executionView.value=r;notify('执行批次已建立');
 }catch(e){error.value=errorMessage(e)}
}
async function openExecution(id:string){executionView.value=await api('/executions/'+id);execScopeId.value='';execQuantity.value='1'}
async function addExecutionPlan(){if(!executionView.value)return;error.value='';
 try{
 executionView.value=await api('/executions/'+executionView.value.id+'/items','POST',{version:executionView.value.version,scope_id:execScopeId.value,quantity:execQuantity.value});
 if(projectView.value)await loadExecutions(projectView.value.id);execScopeId.value='';notify('本次需求工作量已安排');
 }catch(e){error.value=errorMessage(e)}
}
async function executionStage(action:'start'|'finish'|'cancel'){if(!executionView.value)return;
 const reason=window.prompt(action==='start'?'请输入开工依据：':action==='finish'?'请输入本次完成/未完成情况与结束依据：':'请输入取消依据：');
 if(!reason?.trim())return;error.value='';
 try{
 executionView.value=await api('/executions/'+executionView.value.id+'/'+action,'POST',{version:executionView.value.version,reason});
 if(projectView.value)await loadExecutions(projectView.value.id);notify('批次状态已更新');
 }catch(e){error.value=errorMessage(e)}
}
async function confirmWork(item:Rec){if(!executionView.value)return;error.value='';
 try{
 executionView.value=await api('/executions/'+executionView.value.id+'/items/'+item.id+'/complete','POST',{
  idempotency_key:newClientId(),quantity:completeQuantity.value,occurred_on:completeDate.value,evidence:completeEvidence.value
 });
 completeQuantity.value='';completeEvidence.value='';
 if(projectView.value)await loadExecutions(projectView.value.id);notify('实际完成量已确认入账');
 }catch(e){error.value=errorMessage(e)}
}
async function addProjectScope(){if(!projectView.value)return;
 error.value='';try{
 projectView.value=await api('/projects/'+projectView.value.id+'/scopes','POST',{version:projectView.value.version,demand_id:scopeDemand.value,quantity:scopeQuantity.value});
 scopeDemand.value='';notify('已关联需求范围');
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
 try{projectView.value=await api('/projects/'+projectView.value.id+'/agreement','POST',{version:projectView.value.version,agreement_id:agreementSelection.value,reason:'项目落实执行协议'});notify('已绑定唯一执行协议')}catch(e){error.value=errorMessage(e)}
}
async function advance(stageName:'stock'|'approve'){if(!projectView.value)return;
 const reason=window.prompt(stageName==='stock'?'请输入入库依据及完整性说明：':'请输入立项批准依据：');
 if(!reason?.trim())return;
 error.value='';try{
 projectView.value=await api('/projects/'+projectView.value.id+'/'+stageName,'POST',{version:projectView.value.version,reason});
 await loadStructure();notify(stageName==='stock'?'入库版本已冻结并保存':'立项成功，批准预算已从估算明细生成');
 }catch(e){error.value=errorMessage(e)}
}
async function loadAccess(){const result=await api('/access/ips');allowedIPs.value=result.entries;currentClientIP.value=result.current_ip}
async function addAllowedIP(){error.value='';busy.value=true;try{
 await api('/access/ips','POST',{ip:ipInput.value,note:ipNote.value});
 ipInput.value='';ipNote.value='';await loadAccess();notify('访问IP已授权，立即生效');
 }catch(e){error.value=errorMessage(e)}finally{busy.value=false}}
async function removeAllowedIP(entry:Rec){
 if(!window.confirm('移除 '+entry.ip+' 的访问授权？该IP的新请求将立即被拒绝。'))return;
 error.value='';try{await api('/access/ips/'+entry.id,'DELETE');await loadAccess();notify('已撤销 '+entry.ip+' 的访问权限')}catch(e){error.value=errorMessage(e)}
}
async function loadDemands(){const query=new URLSearchParams();if(statusFilter.value)query.set('status',statusFilter.value);if(search.value)query.set('search',search.value);if(lineFilter.value)query.set('line_id',lineFilter.value);demands.value=await api('/demands?'+query.toString())}
async function openNav(next:string){
 nav.value=next;detail.value=null;edit.value=null;error.value='';sidebarMobile.value=false;
 expandedGroup.value=['frameworks','agreements'].includes(next)?'frameworks':['voltage','lines','physical','logical'].includes(next)?'masters':['dictionary','access'].includes(next)?'system':'';
 if(next==='demands')await loadDemands();else if(next==='overview')await refresh();else if(next==='access')await loadAccess();else if(['frameworks','agreements','projects'].includes(next))await loadStructure()}
function toggleMenu(group:string,landing:string){
 if(nav.value===landing)expandedGroup.value=expandedGroup.value===group?'':group;
 else void openNav(landing);
}
function addSource(){batchSources.value.push({type_id:'',discovered_on:new Date().toLocaleDateString('en-CA'),proposed_by:'',description:'',external_ref:''});}
function removeSource(index:number){if(batchSources.value.length>1)batchSources.value.splice(index,1);}
function removeSelectedLine(){for(const item of logical.value.filter(x=>x.line_id===selectedLine.value))selected[item.id]=false;}
function selectVisible(){for(const tower of thisLineTowers.value)selected[tower.id]=true;for(const tower of thisLineTowers.value)delete excluded[tower.id];}
function sourcePayload(){return batchSources.value.map(item=>({...item}));}
function newForm(){edit.value=null;Object.keys(form).forEach(k=>delete form[k]);form.status='active';form.sort_rank=logical.value.filter(x=>x.line_id===form.line_id).length+1;form.version=undefined;}
function openCreate(){newForm();stage.value=nav.value;}
function openEdit(row:Rec){edit.value=row;Object.keys(form).forEach(k=>delete form[k]);Object.assign(form,row);stage.value=nav.value;}
function collectionFor(tab:string){return tab==='voltage'?voltage.value:tab==='lines'?lines.value:tab==='physical'?physical.value:logical.value;}
function endpoint(tab:string){return ({voltage:'/voltage-levels',lines:'/lines',physical:'/physical-towers',logical:'/logical-towers'} as Rec)[tab]}
function fieldsFor(tab:string){
 return ({voltage:[['code','电压编码'],['name','电压名称']],lines:[['line_code','线路编码'],['name','线路名称']],physical:[['tower_code','实体编码'],['asset_no','资产编号'],['tower_type','塔型'],['longitude','经度'],['latitude','纬度']],logical:[['logical_code','位置编码'],['tower_no','杆塔编号'],['display_name','习惯称呼'],['sort_rank','沿线顺序'],['circuit_position','回路位置']]} as Rec)[tab]||[];
}
async function saveMaster(){error.value='';busy.value=true;try{
 const path=endpoint(stage.value)+(edit.value?'/'+edit.value.id:'');
 const result=await api(path,edit.value?'PATCH':'POST',{...form,reason:form.reason||'业务台账维护'});
 notify('已保存到数据库');edit.value=null;stage.value='';await refresh();return result;
 }catch(e){error.value=errorMessage(e)}finally{busy.value=false}}
async function showMaster(row:Rec){try{detail.value=await api(endpoint(nav.value)+'/'+row.id);stage.value='history'}catch(e){error.value=errorMessage(e)}}
async function saveDict(){error.value='';busy.value=true;try{
 const body={...form,type_id:dictionaryType.value,fields:form.fields_json?JSON.parse(form.fields_json):[]};
 const path='/dictionary-items'+(edit.value?'/'+edit.value.id:'');
 await api(path,edit.value?'PATCH':'POST',body);stage.value='';edit.value=null;notify('字典选项已持久化');await refresh()
 }catch(e){error.value=errorMessage(e)}finally{busy.value=false}}
function editDict(x?:Rec){edit.value=x||null;Object.keys(form).forEach(k=>delete form[k]);Object.assign(form,x||{code:'',name:'',status:'active',sort_order:100,work_target_type:'line',default_quantity:'1',fields_json:'[]'});if(x?.default_quantity_milli)form.default_quantity=String(x.default_quantity_milli/1000);stage.value='dictionary'}
function applyDefault(){const op=selectedOp.value;if(!op)return;if(op.default_unit_id)common.unit_id=op.default_unit_id;if(op.default_quantity_milli)common.quantity=String(op.default_quantity_milli/1000);if(op.completion_standard)common.completion_standard=op.completion_standard;notify('已更新共同默认值；逐行自定义保留')}
function selectRange(){if(!fromRank.value||!toRank.value){error.value='请选择起止杆塔';return}const a=logical.value.find(x=>x.id===fromRank.value),b=logical.value.find(x=>x.id===toRank.value);if(!a||!b||a.line_id!==b.line_id)return;const min=Math.min(a.sort_rank,b.sort_rank),max=Math.max(a.sort_rank,b.sort_rank);for(const t of logical.value.filter(x=>x.line_id===a.line_id&&x.sort_rank>=min&&x.sort_rank<=max&&x.status==='active'))selected[t.id]=true;notify('已按台账顺序选择区段')}
function toggleAll(){selectVisible();}
function resetBatch(){batchSources.value=[{type_id:'',discovered_on:new Date().toLocaleDateString('en-CA'),proposed_by:'',description:'',external_ref:''}];Object.keys(selected).forEach(k=>delete selected[k]);Object.keys(excluded).forEach(k=>delete excluded[k]);Object.keys(overrides).forEach(k=>delete overrides[k]);batchKey.value=newClientId();lastResult.value=null;}
function payload(){return {...common,source:{...sourcePayload()[0]},sources:sourcePayload(),rows:selectedRows.value.map(x=>({logical_tower_id:x.id,target_object:x.target_object,quantity:x.quantity})),idempotency_key:batchKey.value};}
async function submitBatch(draft:boolean){error.value='';busy.value=true;try{if(draft){const r=await api('/demand-batches/drafts','POST',payload());notify('草稿已保存，编号：'+r.id);return}
 const r=await api('/demand-batches/submit','POST',payload());lastResult.value=r;notify('成功创建 '+r.count+' 条待核实需求（'+batchSources.value.length+' 条来源分别关联）');await refresh();await loadDemands()
 }catch(e){error.value=errorMessage(e)}finally{busy.value=false}}
async function showDemand(id:string){try{detail.value=await api('/demands/'+id);stage.value='demand'}catch(e){error.value=errorMessage(e)}}
async function verify(status:string){if(!detail.value)return;const reason=window.prompt('请填写核实意见及依据：');if(!reason?.trim())return;error.value='';try{detail.value=await api('/demands/'+detail.value.id+'/verify','POST',{status,version:detail.value.version,reason});await loadDemands();notify('核实结果已保存')}catch(e){error.value=errorMessage(e)}}
async function reviseDemand(){if(!detail.value)return;const reason=window.prompt('本次修订原因：');if(!reason?.trim())return;error.value='';try{
 detail.value=await api('/demands/'+detail.value.id,'PATCH',{...detail.value,quantity:String(detail.value.quantity_milli/1000),reason});notify('修订已保存并保留历史');await loadDemands()
 }catch(e){error.value=errorMessage(e)}}
function exportDemands(){const q=new URLSearchParams();if(statusFilter.value)q.set('status',statusFilter.value);if(search.value)q.set('search',search.value);if(lineFilter.value)q.set('line_id',lineFilter.value);window.location.href='/api/demands/export.xlsx?'+q.toString()}
onMounted(async()=>{try{user.value=(await api('/auth/me')).user;await refresh()}catch{user.value=null}});
watch([statusFilter,search,lineFilter],()=>{if(user.value&&nav.value==='demands')loadDemands().catch(e=>error.value=errorMessage(e))});
</script>
<template>
<div v-if="!user" class="auth-bg"><div class="auth-card"><div class="logo">SD</div><h1>输电项目全流程管理</h1><p class="muted">使用本地服务器账号登录</p><form @submit.prevent="doLogin"><label>用户名<input v-model="username" autocomplete="username" required placeholder="输入用户名"/></label><label>密码<input v-model="password" type="password" autocomplete="current-password" required placeholder="输入密码"/></label><p v-if="error" class="error">{{error}}</p><button class="primary full" :disabled="busy">登录系统</button></form><p class="minor">首次部署请在服务器运行「初始化管理员.cmd」</p></div></div>
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
  <div v-if="['entry','demands'].includes(nav)" class="nav-submenu"><button :class="{active:nav==='entry'}" @click="openNav('entry')">批量新建需求</button><button :class="{active:nav==='demands'}" @click="openNav('demands')">需求台账</button></div>
  <button class="nav-primary" :class="{active:nav==='projects'}" @click="openNav('projects')"><span class="nav-icon">▱</span>项目中心</button>
  <button class="nav-primary" :class="{active:['frameworks','agreements'].includes(nav)}" @click="toggleMenu('frameworks','frameworks')"><span class="nav-icon">♧</span>框架与协议<span class="nav-chevron">{{expandedGroup==='frameworks'?'⌄':'›'}}</span></button>
  <div v-if="expandedGroup==='frameworks'" class="nav-submenu"><button :class="{active:nav==='frameworks'}" @click="openNav('frameworks')">项目框架</button><button :class="{active:nav==='agreements'}" @click="openNav('agreements')">执行协议</button></div>
  <button class="nav-primary" :class="{active:['voltage','lines','physical','logical'].includes(nav)}" @click="toggleMenu('masters','lines')"><span class="nav-icon">⚑</span>基础台账<span class="nav-chevron">{{expandedGroup==='masters'?'⌄':'›'}}</span></button>
  <div v-if="expandedGroup==='masters'" class="nav-submenu"><button :class="{active:nav==='voltage'}" @click="openNav('voltage')">电压等级</button><button :class="{active:nav==='lines'}" @click="openNav('lines')">线路台账</button><button :class="{active:nav==='physical'}" @click="openNav('physical')">物理杆塔</button><button :class="{active:nav==='logical'}" @click="openNav('logical')">逻辑杆塔</button></div>
  <button v-if="roleAdmin" class="nav-primary" :class="{active:['dictionary','access'].includes(nav)}" @click="toggleMenu('system','access')"><span class="nav-icon">⚙</span>系统管理<span class="nav-chevron">{{expandedGroup==='system'?'⌄':'›'}}</span></button>
  <div v-if="roleAdmin&&expandedGroup==='system'" class="nav-submenu"><button :class="{active:nav==='dictionary'}" @click="openNav('dictionary')">系统字典</button><button :class="{active:nav==='access'}" @click="openNav('access')">IP访问管理</button></div>
  <div class="sidebar-footer"><div><strong>{{user.username}}</strong><small>{{user.role}}</small></div><button class="light" @click="logout">退出</button></div>
 </aside>
 <main class="main">
  <div class="page-heading">
   <div class="breadcrumb"><span>{{sectionLabel}}</span><span class="breadcrumb-slash">/</span><strong>{{nav==='entry'?'批量新建':displayTitle}}</strong></div>
   <div class="page-heading-title"><h1>{{displayTitle}}</h1><span v-if="nav==='entry'" class="subtle-tag">逐基独立生成</span></div>
   <p class="page-description">{{nav==='entry'?'选择多个位置，共同内容填一次；逐基差异在预览中调整。':nav==='overview'?'掌握项目与需求的当前状态。':nav==='demands'?'查看、核实和跟踪每一条需求。':nav==='access'?'由管理员逐个配置允许访问服务器的 IP 地址。':nav==='projects'?'从项目储备到立项及分次执行的全过程管理。':'维护真实业务台账与版本历史。'}}</p>
  </div>
  <p v-if="error" role="alert" class="alert error">{{error}} <button @click="error=''">×</button></p><p v-if="success" role="status" class="alert ok">{{success}}</p>
  <template v-if="nav==='overview'"><div class="stats"><div v-for="(label,key) in {lines:'线路',physical:'实体杆塔',logical:'逻辑杆塔',pending:'待核实需求',active:'有效需求'}" :key="key" class="stat"><small>{{label}}</small><strong>{{overview[key]??0}}</strong></div></div><section class="panel"><div class="section-header"><div><h2>待核实事项</h2><p class="muted">基于当前数据库实际记录</p></div><button class="secondary" @click="openNav('demands')">进入需求中心</button></div><div v-if="!demands.filter(x=>x.status==='pending').length" class="empty">当前没有待核实需求</div><div v-else class="table-wrap"><table><thead><tr><th>需求编号</th><th>位置</th><th>操作</th><th>工作量</th><th></th></tr></thead><tbody><tr v-for="d in demands.filter(x=>x.status==='pending').slice(0,8)" :key="d.id"><td>{{d.demand_no}}</td><td>{{d.line_name_snapshot}} {{d.tower_no_snapshot}}</td><td>{{d.operation_snapshot}} · {{d.target_object}}</td><td>{{fmtQty(d.quantity_milli)}} {{d.unit_snapshot}}</td><td><button class="link" @click="openNav('demands');showDemand(d.id)">查看</button></td></tr></tbody></table></div></section></template>
  <template v-if="['voltage','lines','physical','logical'].includes(nav)">
   <section class="panel"><div class="section-header"><div><h2>{{mediaTitle}}列表</h2><p class="muted">稳定编码与名称独立，历史修改保留</p></div><button v-if="roleWrite" class="primary" @click="openCreate">新增{{mediaTitle}}</button></div>
   <div class="table-wrap"><table><thead><tr><th>编码</th><th>名称或杆塔号</th><th v-if="nav==='logical'">线路</th><th v-if="nav==='logical'">实体塔</th><th v-if="nav==='lines'">电压等级</th><th>状态</th><th>操作</th></tr></thead>
    <tbody><tr v-for="x in collectionFor(nav)" :key="x.id"><td class="mono">{{x.code||x.line_code||x.tower_code||x.logical_code}}</td><td>{{x.name||x.tower_no||x.tower_type||'—'}}</td><td v-if="nav==='logical'">{{x.line_name}} / 序号{{x.sort_rank}}</td><td v-if="nav==='logical'">{{x.physical_code||'待关联'}}</td><td v-if="nav==='lines'">{{x.voltage_name}}</td><td><span class="tag">{{x.status}}</span></td><td class="actions"><button class="link" @click="showMaster(x)">详情</button><button v-if="roleWrite" class="link" @click="openEdit(x)">编辑</button></td></tr><tr v-if="!collectionFor(nav).length"><td colspan="7" class="empty">尚无台账，请通过新增录入真实信息</td></tr></tbody></table></div></section>
   <section v-if="stage===nav" class="panel form-panel"><div class="section-header"><h2>{{edit?'编辑':'新增'}}{{mediaTitle}}</h2><button class="light" @click="stage='';edit=null">关闭</button></div>
    <form @submit.prevent="saveMaster" class="form-grid">
     <label v-for="[key,label] in fieldsFor(nav)" :key="key">{{label}} <input v-model="form[key]" :disabled="!!edit&&['code','line_code','tower_code','logical_code'].includes(key)" :required="['code','line_code','tower_code','logical_code','name','tower_no','sort_rank'].includes(key)"/></label>
     <label v-if="nav==='lines'">所属电压<select v-model="form.voltage_level_id" :disabled="!!edit" required><option value="">请选择</option><option v-for="x in voltage.filter(x=>x.status==='active')" :key="x.id" :value="x.id">{{x.name}}</option></select></label>
     <label v-if="nav==='logical'">所属线路<select v-model="form.line_id" :disabled="!!edit" required><option value="">请选择</option><option v-for="x in lines.filter(x=>x.status==='active')" :key="x.id" :value="x.id">{{x.name}}</option></select></label>
     <label v-if="nav==='logical'">对应物理塔<select v-model="form.physical_tower_id"><option value="">待核实</option><option v-for="x in physical.filter(x=>x.status==='active')" :key="x.id" :value="x.id">{{x.tower_code}} {{x.tower_type}}</option></select></label>
     <label>状态<select v-model="form.status"><option value="active">启用</option><option v-if="nav==='logical'" value="draft">草稿</option><option value="inactive">停用</option><option v-if="nav==='physical'" value="retired">退役</option></select></label>
     <label v-if="edit" class="wide">调整原因<input v-model="form.reason" placeholder="名称变化、实体纠错或换塔的依据"/></label>
     <label v-if="edit&&nav==='logical'">实体变化类型<select v-model="form.change_kind"><option value="">未改变实体</option><option value="correction">关联纠错</option><option value="replacement">实际换塔</option></select></label>
     <div class="wide form-actions"><button class="primary" :disabled="busy">保存台账</button></div>
    </form>
   </section>
  </template>
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
   <section v-if="stage===nav" class="panel form-panel"><div class="section-header"><h2>创建{{mediaTitle}}</h2><button class="light" @click="stage=''">关闭</button></div>
    <form class="form-grid" @submit.prevent="saveStructure">
     <label>业务编码<input v-model.trim="form.code" required placeholder="唯一稳定业务编码"/></label>
     <label>名称<input v-model.trim="form.name" required/></label>
     <label v-if="nav!=='projects'">授权额度（元）<input v-model.trim="form.limit_yuan" required inputmode="decimal" placeholder="100000.00"/></label>
     <label v-if="nav==='agreements'">所属框架<select v-model="form.framework_id" required><option value="">请选择</option><option v-for="f in frameworks.filter(x=>x.status==='active')" :key="f.id" :value="f.id">{{f.name}}</option></select></label>
     <label v-if="nav==='projects'">拟归属执行协议（储备阶段可不选）<select v-model="form.agreement_id"><option value="">待落实</option><option v-for="a in agreements.filter(x=>x.status==='active')" :key="a.id" :value="a.id">{{a.name}} · {{a.framework_name}}</option></select></label>
     <label v-if="nav==='projects'">储备类别<select v-model="form.category_id"><option value="">待分类</option><option v-for="c in options('category').filter(x=>x.status==='active')" :key="c.id" :value="c.id">{{c.name}}</option></select></label>
     <div class="wide form-actions"><button class="primary" :disabled="busy">保存</button></div>
    </form>
   </section>
  </template>
  <section v-if="projectView" class="detail-overlay" @click.self="projectView=null"><div class="detail-panel">
   <div class="section-header"><div><h2>{{projectView.code}} · {{projectView.name}}</h2><span class="tag">{{projectStage(projectView.status)}} · v{{projectView.version}}</span></div><button class="light" @click="projectView=null">关闭 ×</button></div>
   <div class="info-grid"><div><small>已知估算（元）</small><strong>{{money(projectView.estimate.known_total_fen)}}</strong></div><div><small>待定价项</small><strong>{{projectView.estimate.missing_price_count}}</strong></div><div><small>批准预算（元）</small><strong>{{money(projectView.approved_budget_fen)}}</strong></div><div><small>需求范围条数</small><strong>{{projectView.estimate.total}}</strong></div></div>
   <h3>关联执行协议</h3><div class="toolbar">
    <label>唯一执行协议<select v-model="agreementSelection" :disabled="!roleWrite||['approved','closed'].includes(projectView.status)"><option value="">待落实</option><option v-for="a in agreements.filter(x=>x.status==='active')" :key="a.id" :value="a.id">{{a.name}} · {{a.framework_name}}</option></select></label>
    <button v-if="roleWrite&&['reserve','stocked'].includes(projectView.status)" class="secondary" :disabled="!agreementSelection" @click="bindProjectAgreement">确认协议归属</button>
   </div>
   <h3>项目需求范围与估价</h3><p class="muted">每条明细引用已核实的需求版本；金额按工作量×单价计算，缺价不视为零。</p>
   <div v-for="scope in projectView.scopes" :key="scope.id" class="scope-item">
    <div class="section-header"><div><strong>{{scope.demand_no}} · {{scope.line_name_snapshot}} {{scope.tower_no_snapshot}}</strong><p class="muted">{{scope.operation_snapshot}} · {{scope.target_object}}</p></div><button v-if="roleWrite&&['reserve','stocked'].includes(projectView.status)" class="link" @click="editScopePrice(scope)">估价依据</button></div>
    <p>计划 {{fmtQty(scope.quantity_milli)}} {{scope.unit_snapshot}} · 单价 {{money(scope.unit_price_fen)}} 元 · {{scope.price_source||'价格待确定'}}</p>
   </div>
   <form v-if="roleWrite&&projectView.status==='reserve'" class="form-grid" @submit.prevent="addProjectScope">
    <label class="wide">纳入有效需求<select v-model="scopeDemand" required><option value="">请选择</option><option v-for="d in eligibleDemands" :key="d.id" :value="d.id">{{d.demand_no}} · {{d.line_name_snapshot}} {{d.tower_no_snapshot}} · {{d.operation_snapshot}}</option></select></label>
    <label>本项目拟覆盖工作量<input v-model="scopeQuantity" required inputmode="decimal"/></label><div class="form-actions"><button class="secondary">关联需求</button></div>
   </form>
   <form v-if="scopePriceEdit" class="form-grid scope-editor" @submit.prevent="saveScopePrice">
    <label>核定单价（元）<input v-model="scopePrice.unit_price_yuan" inputmode="decimal" placeholder="留空代表待估价"/></label>
    <label>价格依据<input v-model="scopePrice.price_source" placeholder="物资报价或有效定额编号"/></label>
    <label>依据日期<input type="date" v-model="scopePrice.price_date"/></label>
    <label>税口径<select v-model="scopePrice.tax_mode"><option value="inclusive">含税</option><option value="exclusive">不含税</option><option value="none">不适用</option></select></label>
    <label class="wide">修订原因<input v-model="scopePrice.reason" placeholder="核定或调整依据"/></label>
    <div class="wide form-actions"><button class="primary">保存估价</button><button type="button" class="light" @click="scopePriceEdit=null">取消</button></div>
   </form>
   <div v-if="roleWrite&&projectView.status==='reserve'" class="form-actions"><button class="primary" :disabled="!projectView.scopes.length" @click="advance('stock')">确认项目入库</button></div>
   <div v-if="roleWrite&&projectView.status==='stocked'" class="form-actions"><button class="primary" :disabled="!projectView.estimate.complete||!projectView.agreement_id" @click="advance('approve')">确认立项及预算</button></div>
   <h3>分次执行</h3>
   <div v-if="!executionRows.length" class="empty">尚无执行批次</div>
   <div v-for="e in executionRows" :key="e.id" class="scope-item"><div class="section-header"><div><strong>{{e.number}} · {{e.description}}</strong><p class="muted">{{e.item_count}} 条计划 · 确认工作量 {{fmtQty(e.completed_quantity_milli)}}（不同单位不能合计核算）</p></div><button class="link" @click="openExecution(e.id)">进入执行</button></div><span class="tag">{{e.status}}</span></div>
   <form v-if="roleWrite&&projectView.status==='approved'" class="form-grid" @submit.prevent="createProjectExecution">
     <label>执行批次编号<input v-model="executionNumber" required placeholder="如 2026-01"/></label><label>施工说明<input v-model="executionDescription" placeholder="本次施工任务"/></label><div class="wide form-actions"><button class="secondary">新建执行批次</button></div>
   </form>
   <h3>阶段快照</h3><div v-for="e in projectView.events" :key="e.id" class="history">{{e.created_at}} · {{e.stage==='stocked'?'入库':'立项'}} · {{e.reason}} · 版本 {{e.project_version}}</div>
  </div></section>
  <section v-if="executionView" class="detail-overlay execution-overlay" @click.self="executionView=null"><div class="detail-panel">
   <div class="section-header"><div><h2>执行批次 {{executionView.number}}</h2><span class="tag">{{executionView.status}} · v{{executionView.version}}</span></div><button class="light" @click="executionView=null">返回项目</button></div>
   <p>{{executionView.description||'本次执行需求范围'}}</p>
   <div v-for="i in executionView.items" :key="i.id" class="scope-item">
    <h3>{{i.demand_no}} · {{i.line_name_snapshot}} {{i.tower_no_snapshot}}</h3>
    <p>{{i.operation_snapshot}} · {{i.target_object}}</p>
    <p>计划 {{fmtQty(i.planned_quantity_milli)}} {{i.unit_snapshot}} · 已确认 {{fmtQty(i.completed_quantity_milli)}} {{i.unit_snapshot}}</p>
    <form v-if="executionView.status==='running'&&roleWrite" @submit.prevent="confirmWork(i)" class="form-grid">
     <label>本次确认量<input v-model="completeQuantity" required inputmode="decimal"/></label><label>实施日期<input v-model="completeDate" required type="date"/></label>
     <label class="wide">完成依据 / 验收说明<input v-model="completeEvidence" required/></label><div class="wide form-actions"><button class="secondary">确认实际完成量</button></div>
    </form>
   </div>
   <form v-if="executionView.status==='planned'&&roleWrite" @submit.prevent="addExecutionPlan" class="form-grid">
    <label class="wide">安排批准范围<select v-model="execScopeId" required><option value="">请选择</option><option v-for="s in eligibleExecutionScopes" :key="s.id" :value="s.id">{{s.demand_no}} · {{s.line_name_snapshot}} {{s.tower_no_snapshot}}</option></select></label>
    <label>本批次拟完成工作量<input v-model="execQuantity" required inputmode="decimal"/></label><div class="form-actions"><button class="secondary">安排工作明细</button></div>
   </form>
   <div v-if="roleWrite" class="form-actions">
    <button v-if="executionView.status==='planned'" class="primary" :disabled="!executionView.items.length" @click="executionStage('start')">确认开工</button>
    <button v-if="executionView.status==='running'" class="primary" @click="executionStage('finish')">结束本次执行</button>
    <button v-if="executionView.status==='planned'" class="light" @click="executionStage('cancel')">取消未开工批次</button>
   </div>
   <p class="muted minor">完成量按每项批准范围核对，超计划确认会被数据库事务拒绝。实际费用与结算另行记录，不由完成量自动推算。</p>
  </div></section>
  <template v-if="nav==='access'">
    <section class="panel"><div class="section-header"><div><h2>允许访问的 IP</h2><p class="muted">逐个配置具体IP地址；保存后无需重启服务</p></div></div>
      <p class="muted">服务器识别到本次连接的地址：<strong class="mono">{{currentClientIP}}</strong>。本机 127.0.0.1 和 ::1 永久允许，用于初始化和应急管理。其他地址未加入列表时默认拒绝。</p>
      <form class="toolbar" @submit.prevent="addAllowedIP">
        <label>IP 地址<input v-model.trim="ipInput" required placeholder="例如 192.168.1.105 或 2001:db8::1"/></label>
        <label>设备 / 用途备注<input v-model.trim="ipNote" placeholder="例如 运检班组办公电脑"/></label>
        <button class="primary" :disabled="busy||!ipInput">添加允许 IP</button>
      </form>
      <div class="table-wrap"><table><thead><tr><th>允许的IP</th><th>设备备注</th><th>添加时间</th><th>添加人</th><th>操作</th></tr></thead>
        <tbody><tr v-for="x in allowedIPs" :key="x.id"><td class="mono">{{x.ip}}</td><td>{{x.note||'—'}}</td><td>{{x.created_at}}</td><td>{{x.created_by_name}}</td><td><button class="link danger" @click="removeAllowedIP(x)">移除</button></td></tr><tr v-if="!allowedIPs.length"><td colspan="5" class="empty">目前没有授权任何远程 IP，仅服务器本机可以访问。</td></tr></tbody></table></div>
      <p class="muted minor">只允许精确 IP 地址，不允许填网段、IP 范围或域名。验证使用真实 TCP 连接地址，不相信浏览器传入的代理头。IP 授权不能替代账号登录；Windows 防火墙仍需单独放行服务端口。</p>
    </section>
  </template>
  <template v-if="nav==='dictionary'"><section class="panel"><div class="section-header"><h2>业务字典维护</h2><button class="primary" @click="editDict()">新增选项</button></div><div class="toolbar"><label>类别<select v-model="dictionaryType"><option v-for="t in types" :key="t.id" :value="t.id">{{t.title}}</option></select></label></div><div class="table-wrap"><table><thead><tr><th>编码</th><th>名称</th><th>版本</th><th>顺序</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="x in options(dictionaryType)" :key="x.id"><td class="mono">{{x.code}}</td><td>{{x.name}}</td><td>v{{x.version}}</td><td>{{x.sort_order}}</td><td><span class="tag">{{x.status==='active'?'启用':'停用'}}</span></td><td><button class="link" @click="editDict(x)">配置</button></td></tr><tr v-if="!options(dictionaryType).length"><td colspan="6" class="empty">尚未配置选项。请创建真实业务选项。</td></tr></tbody></table></div></section>
   <section v-if="stage==='dictionary'" class="panel form-panel"><div class="section-header"><h2>{{edit?'调整选项 v'+edit.version:'新增选项'}}</h2><button class="light" @click="stage=''">关闭</button></div><form class="form-grid" @submit.prevent="saveDict"><label>编码<input required v-model="form.code"/></label><label>名称<input required v-model="form.name"/></label><label>排序<input type="number" v-model.number="form.sort_order"/></label><label>状态<select v-model="form.status"><option value="active">启用</option><option value="inactive">停用</option></select></label>
    <template v-if="dictionaryType==='operation'"><label>适用对象<select v-model="form.work_target_type"><option value="line">线路侧作业</option><option value="physical">共用实体作业</option><option value="both">两者适用</option></select></label><label>默认单位<select v-model="form.default_unit_id"><option value="">不设默认</option><option v-for="x in units" :key="x.id" :value="x.id">{{x.name}}</option></select></label><label>默认每项数量<input v-model="form.default_quantity" placeholder="1"/></label><label class="wide">默认完成标准<input v-model="form.completion_standard"/></label><label class="wide">字段模板 JSON<textarea v-model="form.fields_json" rows="2"/></label></template><div class="wide form-actions"><button class="primary" :disabled="busy">保存配置</button></div></form></section>
  </template>
  <template v-if="nav==='entry'">
   <div class="entry-main">
    <div class="entry-card">
     <section class="entry-section panel">
      <div class="entry-section-head"><div class="entry-section-title"><span class="step-number">01</span><h2>批量选择位置</h2></div><span class="section-note">可跨线路追加</span></div>
      <label class="field-full">选择线路 <span class="required-star">*</span>
       <select v-model="selectedLine"><option value="">请选择线路</option><option v-for="l in lines.filter(x=>x.status==='active')" :value="l.id" :key="l.id">{{l.voltage_name}} · {{l.name}}</option></select>
      </label>
      <p class="field-hint">切换线路后已选位置仍保留，选择1基即可单条创建。</p>
      <div class="selection-tools">
       <strong>本线路已选 {{thisLineSelected}} / {{thisLineTotal}} 基</strong>
       <div class="selection-actions">
        <button class="text-button" @click="selectVisible" :disabled="!selectedLine">全选本线路</button>
        <button class="text-button" @click="removeSelectedLine" :disabled="!selectedLine">清空本线路</button>
        <button class="text-button" @click="rangeOpen=!rangeOpen">{{rangeOpen?'收起按杆段选择':'按杆段选择'}}</button>
       </div>
      </div>
      <div v-if="rangeOpen" class="range-picker">
       <label>杆段起点<select v-model="fromRank"><option value="">请选择</option><option v-for="x in logical.filter(x=>x.line_id===selectedLine&&x.status==='active').sort((a,b)=>a.sort_rank-b.sort_rank)" :value="x.id" :key="x.id">{{x.tower_no}}</option></select></label>
       <label>杆段终点<select v-model="toRank"><option value="">请选择</option><option v-for="x in logical.filter(x=>x.line_id===selectedLine&&x.status==='active').sort((a,b)=>a.sort_rank-b.sort_rank)" :value="x.id" :key="x.id">{{x.tower_no}}</option></select></label>
       <button class="secondary" @click="selectRange">追加选择</button>
      </div>
      <label class="field-full tower-filter">筛选杆塔
       <input v-model="towerSearch" placeholder="输入杆塔号或位置编码"/>
      </label>
      <div class="tower-grid" aria-label="杆塔选择">
       <label v-for="x in thisLineTowers" :key="x.id" class="tower-card" :class="{checked:selected[x.id]&&!excluded[x.id]}">
        <input type="checkbox" :checked="!!selected[x.id]&&!excluded[x.id]" @change="(e)=>{selected[x.id]=(e.target as HTMLInputElement).checked;delete excluded[x.id]}"/>
        <span><strong>{{x.tower_no}}</strong><small v-if="x.circuit_position">{{x.circuit_position}}</small></span>
       </label>
       <p v-if="!thisLineTowers.length" class="empty">当前筛选下暂无可选的启用杆塔</p>
      </div>
      <div v-if="selectedLines.length" class="selected-lines">
       <span class="small-chip" v-for="l in selectedLines" :key="l.id">{{l.name}} {{selectedRows.filter(x=>x.line_id===l.id).length}} 基</span>
      </div>
     </section>

     <section class="entry-section panel">
      <div class="entry-section-head"><div class="entry-section-title"><span class="step-number">02</span><h2>共同工作内容</h2></div><span class="section-note">应用于本批需求</span></div>
      <label class="field-full">作业对象 <span class="required-star">*</span></label>
      <div class="segmented-work" role="group" aria-label="作业对象">
       <button :class="{chosen:common.work_target_type==='line'}" @click="common.work_target_type='line';common.operation_id=''">线路侧设备</button>
       <button :class="{chosen:common.work_target_type==='physical'}" @click="common.work_target_type='physical';common.operation_id=''">共用物理杆塔</button>
      </div>
      <p class="field-hint">{{common.work_target_type==='line'?'各线路杆塔独立生成需求，不因共塔自动合并。':'共塔同部位的作业必须明确选择一个主位置，其他回路在关联位置中记录。'}}</p>
      <div class="form-grid entry-fields">
       <div class="field-label-group">
        <div class="inline-field-top"><span class="field-title">操作类型 <span class="required-star">*</span></span><button v-if="roleAdmin" class="text-button small" @click="openNav('dictionary')">管理选项</button></div>
        <select aria-label="操作类型" v-model="common.operation_id"><option value="">请选择操作类型</option><option v-for="op in ops" :key="op.id" :value="op.id">{{op.name}}</option></select>
       </div>
       <label>共同处理部位 <span class="required-star">*</span><input v-model="common.target_object" placeholder="例如 横担上部"/></label>
       <div class="field-label-group"><div class="inline-field-top"><span class="field-title">每基工作量 <span class="required-star">*</span></span><button class="text-button small" @click="applyDefault">应用操作默认值</button></div>
        <div class="quantity-inputs"><input aria-label="每基工作量" v-model="common.quantity" inputmode="decimal" placeholder="1"/><select v-model="common.unit_id" aria-label="计量单位"><option value="">单位</option><option v-for="x in units" :key="x.id" :value="x.id">{{x.name}}</option></select></div>
        <p class="field-hint">如每基安装{{common.quantity||'—'}}{{items.find(x=>x.id===common.unit_id)?.name||'单位'}}，选{{selectedRows.length}}基共{{Number(totalQty.toFixed(3))}}{{items.find(x=>x.id===common.unit_id)?.name||'单位'}}。</p>
       </div>
       <label>完成标准 <span class="required-star">*</span><input v-model="common.completion_standard" placeholder="按核定部位完成安装并验收合格"/></label>
       <label class="wide">问题描述 / 实施必要性 <span class="required-star">*</span><textarea v-model="common.problem_description" rows="3" placeholder="说明存在的问题、实施必要性及作业背景"/></label>
      </div>
     </section>

     <section class="entry-section panel">
      <div class="entry-section-head"><div class="entry-section-title"><span class="step-number">03</span><h2>共同来源依据</h2></div><span class="section-note">一次填写，多条关联</span></div>
      <div v-for="(source,index) in batchSources" :key="index" class="source-card">
       <div class="source-card-head"><strong>来源 {{index+1}}</strong><button v-if="batchSources.length>1" class="text-button danger" @click="removeSource(index)">移除来源</button></div>
       <div class="form-grid entry-fields">
        <label>来源类型 <span class="required-star">*</span><select v-model="source.type_id"><option value="">请选择</option><option v-for="x in sources" :key="x.id" :value="x.id">{{x.name}}</option></select></label>
        <label>发现 / 提出日期 <span class="required-star">*</span><input type="date" v-model="source.discovered_on"/></label>
        <label>提出单位 / 人员 <span class="required-star">*</span><input v-model="source.proposed_by" placeholder="填写提出单位或人员"/></label>
        <label>来源依据编号<input v-model="source.external_ref" placeholder="工单、缺陷单或检查编号"/></label>
        <label class="wide">来源说明<textarea v-model="source.description" rows="2" placeholder="记录来源内容与原始依据"/></label>
       </div>
      </div>
      <button class="secondary source-add" @click="addSource">＋ 添加一条来源</button>
      <div class="entry-advanced"><button class="text-button" @click="entryAdvancedOpen=!entryAdvancedOpen">{{entryAdvancedOpen?'收起附加信息':'填写优先级、期望时间'}}</button>
       <div v-if="entryAdvancedOpen" class="form-grid entry-fields advanced-fields">
        <label>优先级<select v-model="common.priority_id"><option value="">未设置</option><option v-for="x in priorities" :key="x.id" :value="x.id">{{x.name}}</option></select></label>
        <label>期望完成日期<input type="date" v-model="common.expected_on"/></label>
       </div>
      </div>
     </section>

     <section class="entry-section panel">
      <div class="entry-section-head"><div class="entry-section-title"><span class="step-number">04</span><h2>逐基预览与调整</h2></div><span class="section-note">{{selectedRows.length}} 条独立需求</span></div>
      <p class="field-hint">共同字段已填入每条需求；单独修改部位或数量仅影响对应杆塔。预览确认后提交待核实。</p>
      <div class="table-wrap"><table class="preview-table"><thead><tr><th>位置</th><th>处理部位</th><th>工作量</th><th></th></tr></thead>
       <tbody><tr v-for="x in selectedRows" :key="x.id"><td><strong>{{x.tower_no}}</strong><small>{{x.line_name}}</small></td><td><input class="compact" :aria-label="'处理部位 '+x.tower_no" :value="x.target_object" @input="overrides[x.id]={...overrides[x.id],target_object:($event.target as HTMLInputElement).value}"/></td><td><input class="compact num" :aria-label="'工作量 '+x.tower_no" inputmode="decimal" :value="x.quantity" @input="overrides[x.id]={...overrides[x.id],quantity:($event.target as HTMLInputElement).value}"/></td><td><button class="text-button danger" @click="excluded[x.id]=true">排除</button></td></tr>
        <tr v-if="!selectedRows.length"><td colspan="4" class="empty">请先在上方勾选杆塔</td></tr></tbody></table></div>
      <div class="batch-review">
       <div><strong>本批 {{selectedRows.length}} 条需求</strong><small>{{selectedLines.length}} 条线路 · {{batchSources.length}} 条来源依据 · 独立生成</small></div>
       <div class="form-actions"><button class="light" @click="resetBatch">清空重填</button><button class="secondary" :disabled="busy" @click="submitBatch(true)">保存草稿</button><button class="primary" :disabled="busy||!roleWrite||!selectedRows.length" @click="submitBatch(false)">提交 {{selectedRows.length}} 条核实</button></div>
      </div>
      <p v-if="lastResult" class="saved-batch">批次 {{lastResult.batch_id}} 已保存，共 {{lastResult.count}} 条。重复提交不会重复建立记录。</p>
     </section>
    </div>
   </div>
  </template>
  <template v-if="nav==='demands'"><section class="panel"><div class="section-header"><div><h2>需求列表</h2><p class="muted">当前查询结果 {{demands.length}} 条 · 导出范围与筛选一致</p></div><div class="actions"><button class="secondary" @click="exportDemands">Excel 导出</button><button v-if="roleWrite" class="primary" @click="openNav('entry')">批量新建</button></div></div><div class="toolbar"><label>状态<select v-model="statusFilter"><option value="">全部</option><option value="pending">待核实</option><option value="active">有效</option><option value="returned">退回</option><option value="cancelled">取消</option></select></label><label>线路<select v-model="lineFilter"><option value="">全部线路</option><option v-for="x in lines" :key="x.id" :value="x.id">{{x.name}}</option></select></label><label>关键词<input v-model="search" placeholder="编号、杆塔、问题或部位"/></label></div><div class="table-wrap"><table><thead><tr><th>编号</th><th>位置</th><th>操作与部位</th><th>工作量</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="d in demands" :key="d.id"><td class="mono">{{d.demand_no}}</td><td>{{d.line_name_snapshot}} {{d.tower_no_snapshot}}</td><td>{{d.operation_snapshot}} · {{d.target_object}}</td><td>{{fmtQty(d.quantity_milli)}} {{d.unit_snapshot}}</td><td><span class="tag">{{statusName(d.status)}}</span></td><td><button class="link" @click="showDemand(d.id)">详情</button></td></tr><tr v-if="!demands.length"><td colspan="6" class="empty">没有符合筛选条件的需求</td></tr></tbody></table></div></section></template>
  <section v-if="detail" class="detail-overlay" @click.self="detail=null"><div class="detail-panel"><div class="section-header"><h2>{{detail.demand_no?'需求 '+detail.demand_no:'台账详情'}}</h2><button class="light" @click="detail=null">关闭 ×</button></div>
    <template v-if="detail.demand_no"><div class="info-grid"><div><small>原始线路快照</small><strong>{{detail.line_name_snapshot}} {{detail.tower_no_snapshot}}</strong></div><div><small>物理塔快照</small><strong>{{detail.physical_code_snapshot}}</strong></div><div><small>操作与版本</small><strong>{{detail.operation_snapshot}} v{{detail.operation_version}}</strong></div><div><small>工作量</small><strong>{{fmtQty(detail.quantity_milli)}} {{detail.unit_snapshot}}</strong></div><div><small>当前状态</small><strong>{{detail.status}}</strong></div><div><small>当前版本</small><strong>v{{detail.version}}</strong></div></div>
      <label>具体部位<input v-model="detail.target_object" :disabled="!roleWrite"/></label><label>问题说明<textarea rows="3" v-model="detail.problem_description" :disabled="!roleWrite"/></label><label>完成标准<textarea rows="2" v-model="detail.completion_standard" :disabled="!roleWrite"/></label><div v-if="roleWrite" class="form-actions"><button class="secondary" @click="reviseDemand">保存修订并留痕</button></div>
      <h3>来源与核实</h3><p v-for="x in detail.sources" :key="x.id">{{x.discovered_on}} · {{x.proposed_by}} · {{x.type_snapshot}} · {{x.description||x.external_ref||'—'}}</p><div v-if="roleVerify&&detail.status!=='cancelled'" class="form-actions"><button class="primary" @click="verify('active')">确认有效</button><button class="secondary" @click="verify('returned')">退回补充</button><button class="light" @click="verify('cancelled')">取消</button></div>
      <h3>历史修订</h3><p v-for="rev in detail.revisions" :key="rev.id" class="history">{{rev.changed_at}} · v{{rev.version}} · {{rev.reason}}</p>
    </template><template v-else><pre class="json-preview">{{JSON.stringify(detail,null,2)}}</pre></template>
  </div></section>
 </main>
 </div>
</div>
</template>

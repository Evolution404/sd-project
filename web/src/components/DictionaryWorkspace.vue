<script setup lang="ts">
import {computed,nextTick,onMounted,reactive,ref,watch} from 'vue';
import {ElAlert,ElButton,ElCard,ElConfigProvider,ElDescriptions,ElDescriptionsItem,ElDialog,ElForm,ElFormItem,ElIcon,ElInput,ElMenu,ElMenuItem,ElSubMenu,ElOption,ElPagination,ElSegmented,ElSelect,ElStatistic,ElTable,ElTableColumn,ElTag,type FormInstance,type MenuInstance} from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import {ArrowDown,ArrowUp,Box,Collection,Connection,Download,InfoFilled,Lightning,Location,Operation,Plus,Search,SetUp,Tools,WarningFilled} from '@element-plus/icons-vue';
import OperationFieldsEditor from './OperationFieldsEditor.vue';
import '../styles/element-plus';
import '../styles/dictionary.css';
type Row=Record<string,any>;
const emit=defineEmits<{changed:[]}>();
const groups=ref<Row[]>([]),categoryMenu=ref<MenuInstance>();
const categories=ref<Row[]>([]),items=ref<Row[]>([]),stats=ref<Row>({builtin:0,active:0,referenced:0,attention:0});
const category=ref('voltage'),query=ref(''),statusFilter=ref(''),origin=ref(''),page=ref(1),pageSize=ref(12);
const loading=ref(false),busy=ref(false),error=ref(''),notice=ref(''),dialog=ref(false),explanation=ref(false);
const edit=ref<Row|null>(null),focused=ref<Row|null>(null),selection=ref<Row[]>([]),statusDialog=ref(false),statusTargets=ref<Row[]>([]),nextStatus=ref('inactive');
const deletionOpen=ref(false),deletion=ref<Row|null>(null);
const form=reactive<Row>({}),formRef=ref<FormInstance>(),formError=ref('');
const selectedCategory=computed(()=>categories.value.find(x=>x.id===category.value));
const icons:Row={voltage:Lightning,unit:Box,source:Collection,priority:WarningFilled,project_category:Collection,operation:Tools,tower_structure:Location,tower_purpose:SetUp,category:Operation};
const categoryRows=computed(()=>items.value.filter(x=>x.type_id===category.value).slice().sort((a,b)=>a.sort_order-b.sort_order||a.name.localeCompare(b.name)));
const filtered=computed(()=>categoryRows.value.filter(item=>(!statusFilter.value||item.status===statusFilter.value)&&(!origin.value||(origin.value==='builtin'?item.builtin:!item.builtin))&&
 (!query.value.trim()||[item.name,item.code,...item.uses.flat()].join(' ').toLowerCase().includes(query.value.trim().toLowerCase()))));
const visible=computed(()=>filtered.value.slice((page.value-1)*pageSize.value,page.value*pageSize.value));
const units=computed(()=>items.value.filter(x=>x.type_id==='unit'&&(x.status==='active'||x.id===form.default_unit_id)));
const metricCards=computed(()=>[
 {label:'系统内置词条',value:stats.value.builtin,description:'系统预置的常用基础数据',icon:Box,color:'blue'},
 {label:'启用中',value:stats.value.active,description:'当前可在业务录入中选择',icon:Operation,color:'green'},
 {label:'被业务引用',value:stats.value.referenced,description:'已有台账或业务记录引用的词条',icon:Connection,color:'purple'},
 {label:'待完善',value:stats.value.attention,description:'尚未配置可用默认单位的启用操作',icon:WarningFilled,color:'orange'}
]);
watch(()=>selectedCategory.value?.group_id,async group=>{await nextTick();if(group)categoryMenu.value?.open(group)});
watch([category,query,statusFilter,origin,pageSize],()=>{page.value=1;selection.value=[];focused.value=null});
watch(()=>filtered.value.length,()=>{page.value=Math.max(1,Math.min(page.value,Math.ceil(filtered.value.length/pageSize.value)))});
async function api(path:string,body?:Row,method=body?'POST':'GET'){
 const response=await fetch('/api'+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
 const result=await response.json();if(!response.ok)throw Error(result.error||'配置操作失败');return result;
}
async function load(){
 loading.value=true;
 try{const data=await api('/dictionary-workspace');categories.value=data.categories;groups.value=data.groups;items.value=data.items;stats.value=data.stats;
  if(focused.value)focused.value=items.value.find(x=>x.id===focused.value?.id)||null;
 }catch(e){error.value=(e as Error).message}finally{loading.value=false}
}
function choose(value:string){category.value=value;error.value='';notice.value=''}
function open(item?:Row){
 error.value='';formError.value='';
 try{
  const fields=JSON.parse(item?.fields_json||'[]');if(!Array.isArray(fields))throw Error('附加字段配置无法读取，请联系管理员核查');
  Object.keys(form).forEach(key=>delete form[key]);
  Object.assign(form,{name:item?.name||'',status:item?.status||'active',work_target_type:item?.work_target_type||'line',
   default_unit_id:item?.default_unit_id||'',default_quantity:item?.default_quantity_scaled==null?'':String(item.default_quantity_scaled/10000),
   completion_standard:item?.completion_standard||'',fields,version:item?.version});
  edit.value=item||null;dialog.value=true;
 }catch(e){error.value=(e as Error).message}
}
async function save(){
 if(busy.value||!await formRef.value?.validate().catch(()=>false))return;
 busy.value=true;formError.value='';
 try{
  const body:Row={name:form.name.trim(),status:form.status,version:form.version};
  if(category.value!=='voltage')body.type_id=category.value;
  if(category.value==='operation')Object.assign(body,{work_target_type:form.work_target_type,default_unit_id:form.default_unit_id||null,
   default_quantity:form.default_quantity===''?null:form.default_quantity,completion_standard:form.completion_standard,
   fields:form.fields.map((f:Row)=>f.type==='select'?{...f,options:f.options.map((x:string)=>x.trim()).filter(Boolean)}:f)});
  await api((category.value==='voltage'?'/voltage-levels':'/dictionary-items')+(edit.value?'/'+edit.value.id:''),body,edit.value?'PATCH':'POST');
  dialog.value=false;await load();emit('changed');notice.value='词条已保存';
 }catch(e){formError.value=(e as Error).message}finally{busy.value=false}
}
async function move(item:Row,direction:number){
 if(busy.value)return;busy.value=true;error.value='';
 try{
  const ordered=categoryRows.value.slice(),index=ordered.findIndex(x=>x.id===item.id),target=index+direction;
  if(target<0||target>=ordered.length)return;
  [ordered[index],ordered[target]]=[ordered[target],ordered[index]];
  await api('/dictionary-order/'+category.value,{rows:ordered.map(x=>({id:x.id,version:x.version}))});await load();emit('changed');notice.value='显示顺序已更新';
 }catch(e){error.value=(e as Error).message;await load()}finally{busy.value=false}
}
function requestStatus(targets:Row[],status:string){statusTargets.value=targets;nextStatus.value=status;formError.value='';statusDialog.value=true}
async function confirmStatus(){
 busy.value=true;formError.value='';
 try{
  await api('/dictionary-status/'+category.value,{rows:statusTargets.value.map(x=>({id:x.id,version:x.version})),status:nextStatus.value});
  statusDialog.value=false;selection.value=[];await load();emit('changed');notice.value='已'+(nextStatus.value==='active'?'启用':'停用')+' '+statusTargets.value.length+' 个词条';
 }catch(e){formError.value=(e as Error).message;await load()}finally{busy.value=false}
}
function exportRows(){
 const params=new URLSearchParams({type:category.value,status:statusFilter.value,origin:origin.value,search:query.value});
 window.location.href='/api/dictionary-workspace/export.xlsx?'+params;
}
const quantityRule={validator:(_rule:unknown,value:unknown,callback:(error?:Error)=>void)=>{
 const text=String(value??'');callback(text!==''&&(!/^\d+(\.\d{1,4})?$/.test(text)||Number(text)<=0)?new Error('请输入大于零、最多四位小数的数量'):undefined);
},trigger:'blur'};
async function requestDeletion(item:Row){
 if(busy.value)return;busy.value=true;formError.value='';
 try{deletion.value=await api('/dictionary-deletion/'+category.value+'/'+item.id);deletionOpen.value=true}catch(e){error.value=(e as Error).message}finally{busy.value=false}
}
async function confirmDeletion(){
 if(!deletion.value||busy.value)return;busy.value=true;formError.value='';
 const item=deletion.value.item;
 try{await api('/dictionary-deletion/'+item.type_id+'/'+item.id,{version:item.version},'DELETE');deletionOpen.value=false;focused.value=null;selection.value=[];await load();emit('changed');notice.value='词条已删除'}catch(e){
  formError.value=(e as Error).message;
  try{deletion.value=await api('/dictionary-deletion/'+item.type_id+'/'+item.id)}catch{}
 }finally{busy.value=false}
}
function disableDeletionItem(){if(!deletion.value)return;const item=deletion.value.item;deletionOpen.value=false;requestStatus([item],'inactive')}
const date=(value:string)=>value?new Date(value).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'}):'—';
onMounted(load);
</script>
<template>
 <ElConfigProvider :locale="zhCn">
  <div class="dictionary-ui dictionary-workspace" aria-label="数据字典工作区" :aria-busy="loading">
   <header class="dictionary-heading"><span class="dictionary-heading-icon"><ElIcon><Collection/></ElIcon></span><div><h1>数据字典</h1><p>系统预置常用基础数据，支持补充、停用、排序和查看应用领域。</p></div></header>
   <div class="dictionary-metrics"><ElCard v-for="metric in metricCards" :key="metric.label" shadow="never"><div class="dictionary-metric"><span :class="['dictionary-metric-icon',metric.color]"><ElIcon><component :is="metric.icon"/></ElIcon></span><div><ElStatistic :title="metric.label" :value="metric.value"/><small>{{metric.description}}</small></div></div></ElCard></div>
   <div class="dictionary-toolbar">
    <ElInput v-model="query" aria-label="搜索字典" placeholder="搜索名称、编码或应用领域" :prefix-icon="Search" clearable/>
    <ElSelect v-model="category" aria-label="字典类型" :disabled="busy"><ElOption v-for="type in categories" :key="type.id" :value="type.id" :label="type.title"/></ElSelect>
    <ElSelect v-model="statusFilter" aria-label="状态筛选" :empty-values="[null,undefined]"><ElOption label="全部状态" value=""/><ElOption label="启用" value="active"/><ElOption label="停用" value="inactive"/></ElSelect>
    <ElSegmented v-model="origin" aria-label="词条来源" :options="[{label:'全部',value:''},{label:'系统内置',value:'builtin'},{label:'自定义',value:'custom'}]"/>
    <div class="dictionary-toolbar-actions"><ElButton :disabled="!selection.length||busy" @click="requestStatus(selection,'inactive')">批量停用{{selection.length?'（'+selection.length+'）':''}}</ElButton><ElButton :icon="Download" @click="exportRows">导出</ElButton><ElButton type="primary" :icon="Plus" :disabled="loading||busy" @click="open()">新增词条</ElButton></div>
   </div>
   <ElAlert v-if="error" :title="error" type="error" show-icon :closable="false"/>
   <p v-if="notice" class="dictionary-notice" role="status">{{notice}}</p>
   <div class="dictionary-columns">
    <ElCard shadow="never" class="dictionary-categories"><template #header><strong>字典分类</strong></template>
     <ElMenu ref="categoryMenu" :default-active="category" :default-openeds="[selectedCategory?.group_id||'common']" unique-opened aria-label="字典分类" @select="choose">
      <ElSubMenu v-for="group in groups" :key="group.id" :index="group.id" :aria-label="group.title"><template #title><strong>{{group.title}}</strong><span class="dictionary-group-count">{{categories.filter(x=>x.group_id===group.id).length}}</span></template>
       <ElMenuItem v-for="type in categories.filter(x=>x.group_id===group.id)" :key="type.id" :index="type.id" :aria-label="type.title"><ElIcon><component :is="icons[type.id]||Collection"/></ElIcon><div class="dictionary-category-copy"><div><strong>{{type.title}}</strong><ElTag size="small" type="info" round>{{items.filter(x=>x.type_id===type.id).length}} 项</ElTag></div></div></ElMenuItem>
      </ElSubMenu>
     </ElMenu>
     <ElButton link type="primary" :icon="InfoFilled" @click="explanation=true">系统内置项说明</ElButton>
    </ElCard>
    <ElCard shadow="never" class="dictionary-table-card"><template #header><div class="dictionary-table-heading"><span class="dictionary-category-symbol"><ElIcon><component :is="icons[category]||Collection"/></ElIcon></span><div><h2>{{selectedCategory?.title}}</h2><p>{{selectedCategory?.uses.map((x:string[])=>x[1]).join('；')}}</p></div></div><div class="dictionary-tags"><ElTag size="small" effect="light">{{categoryRows.length}} 个词条</ElTag><ElTag size="small" type="success" effect="light">停用保留历史引用</ElTag><ElTag v-if="category==='operation'" size="small" type="info">支持附加业务字段</ElTag></div></template>
     <ElTable :data="visible" row-key="id" highlight-current-row empty-text="没有符合筛选条件的词条" @current-change="focused=$event" @selection-change="selection=$event">
      <ElTableColumn type="selection" width="42" :selectable="()=>!busy"/>
      <ElTableColumn prop="name" label="名称" min-width="105"><template #default="{row}"><strong class="dictionary-item-name">{{row.name}}</strong><span v-if="row.needs_attention" class="dictionary-attention">待设可用单位</span></template></ElTableColumn>

      <ElTableColumn label="来源" width="85"><template #default="{row}"><ElTag :type="row.builtin?'primary':'info'" size="small" round>{{row.builtin?'系统内置':'自定义'}}</ElTag></template></ElTableColumn>
      <ElTableColumn label="状态" width="70"><template #default="{row}"><ElTag :type="row.status==='active'?'success':'info'" size="small" round>{{row.status==='active'?'启用':'停用'}}</ElTag></template></ElTableColumn>
      <ElTableColumn label="最后更新" width="100"><template #default="{row}">{{date(row.updated_at)}}</template></ElTableColumn>
      <ElTableColumn label="操作" width="195" fixed="right"><template #default="{row}"><div class="dictionary-row-actions"><ElButton link type="primary" :disabled="busy" @click.stop="open(row)">编辑</ElButton><ElButton link :type="row.status==='active'?'danger':'success'" :disabled="busy" @click.stop="requestStatus([row],row.status==='active'?'inactive':'active')">{{row.status==='active'?'停用':'启用'}}</ElButton><ElButton v-if="!row.builtin" link type="danger" :disabled="busy" @click.stop="requestDeletion(row)">删除</ElButton><ElButton link :icon="ArrowUp" :aria-label="'上移 '+row.name" :disabled="busy||categoryRows[0]?.id===row.id" @click.stop="move(row,-1)"/><ElButton link :icon="ArrowDown" :aria-label="'下移 '+row.name" :disabled="busy||categoryRows.at(-1)?.id===row.id" @click.stop="move(row,1)"/></div></template></ElTableColumn>
     </ElTable>
     <div class="dictionary-pagination"><span>共 {{filtered.length}} 项</span><ElPagination v-model:current-page="page" v-model:page-size="pageSize" :total="filtered.length" :page-sizes="[12,24,48]" layout="prev, pager, next" small :hide-on-single-page="true"/></div>
    </ElCard>
    <aside class="dictionary-explanation"><ElCard shadow="never"><template #header><strong>类别用途 / 维护说明</strong></template><h3><ElIcon><Location/></ElIcon> 本类数据用在哪里？</h3><ul class="dictionary-uses"><li v-for="(use,index) in selectedCategory?.uses" :key="use[0]"><span>{{Number(index)+1}}</span><div><strong>{{use[0]}}</strong><p>{{use[1]}}</p></div></li></ul>
     <div v-if="focused" class="dictionary-reference"><strong>{{focused.name}}</strong><p>当前关联 {{focused.usage_count}} 条台账或业务记录{{['tower_structure','tower_purpose'].includes(category)?'（按当前名称匹配）':''}}。</p><p v-if="focused.configuration_usage_count">另用于 {{focused.configuration_usage_count}} 个操作类型的默认单位。</p><small>包含停用和历史业务记录；需求快照保持录入时的内容。</small></div><p v-else class="dictionary-selection-hint">选择一行，可查看该词条的实际引用数量。</p>
    </ElCard><ElCard shadow="never"><template #header><strong>维护说明</strong></template><ElDescriptions :column="1" direction="vertical"><ElDescriptionsItem label="名称">业务页面显示的名称。</ElDescriptionsItem><ElDescriptionsItem label="系统内置">系统预置，可编辑、停用和调整顺序。</ElDescriptionsItem><ElDescriptionsItem label="状态">停用后新录入不可选，历史记录继续保留。</ElDescriptionsItem><ElDescriptionsItem label="排序">使用表格中的上移、下移调整下拉选项顺序。</ElDescriptionsItem></ElDescriptions><ElButton link type="primary" :icon="InfoFilled" @click="explanation=true">查看内置项说明</ElButton></ElCard></aside>
   </div>
  </div>
  <ElDialog v-model="dialog" :title="edit?'编辑词条':'新增词条'" class="dictionary-ui dictionary-dialog form-panel" :width="category==='operation'?'760px':'520px'" align-center append-to-body destroy-on-close :close-on-click-modal="false" :close-on-press-escape="!busy" :show-close="!busy">
   <ElAlert v-if="edit?.builtin" title="系统内置词条：调整后立即用于新业务录入，已有记录保留原始依据。" type="info" :closable="false" show-icon/>
   <ElForm ref="formRef" :model="form" label-position="top" @submit.prevent="save" :disabled="busy" :validate-on-rule-change="false">
    <div class="dictionary-form-grid"><ElFormItem label="名称" prop="name" :rules="[{required:true,whitespace:true,message:'请填写名称',trigger:'blur'}]"><ElInput v-model="form.name" aria-label="名称" maxlength="80"/></ElFormItem><ElFormItem label="状态" prop="status"><ElSelect v-model="form.status" aria-label="状态"><ElOption value="active" label="启用"/><ElOption value="inactive" label="停用"/></ElSelect></ElFormItem>
     <template v-if="category==='operation'"><ElFormItem label="适用对象" prop="work_target_type"><ElSelect v-model="form.work_target_type" aria-label="适用对象"><ElOption value="line" label="线路侧作业"/><ElOption value="physical" label="共用实体作业"/><ElOption value="both" label="两者适用"/></ElSelect></ElFormItem><ElFormItem label="默认单位" prop="default_unit_id"><ElSelect v-model="form.default_unit_id" aria-label="默认单位" clearable><ElOption v-for="unit in units" :key="unit.id" :label="unit.name+(unit.status==='inactive'?'（已停用）':'')" :value="unit.id" :disabled="unit.status!=='active'"/></ElSelect></ElFormItem><ElFormItem label="默认每项数量" prop="default_quantity" :rules="[quantityRule]"><ElInput v-model="form.default_quantity" aria-label="默认每项数量" placeholder="不设默认"/></ElFormItem><ElFormItem label="默认完成标准" prop="completion_standard"><ElInput v-model="form.completion_standard" aria-label="默认完成标准"/></ElFormItem><OperationFieldsEditor v-model="form.fields"/></template>
    </div>
    <p v-if="formError" role="alert" class="dictionary-form-error">{{formError}}</p>
    <div class="dictionary-dialog-footer"><ElButton :disabled="busy" @click="dialog=false">取消</ElButton><ElButton type="primary" native-type="submit" :loading="busy">保存配置</ElButton></div>
   </ElForm>
  </ElDialog>
  <ElDialog v-model="statusDialog" :title="nextStatus==='active'?'启用词条':'停用词条'" class="dictionary-ui dictionary-dialog" width="480px" align-center append-to-body :close-on-click-modal="false" :close-on-press-escape="!busy" :show-close="!busy"><p>确认{{nextStatus==='active'?'启用':'停用'}} {{statusTargets.length}} 个词条？</p><p class="dictionary-status-names">{{statusTargets.map(x=>x.name).join('、')}}</p><ElAlert :title="nextStatus==='inactive'?'停用后，新业务录入不再提供这些选项；已有引用和历史记录继续保留。':'启用后，这些词条可重新用于业务录入。'" type="info" :closable="false"/><p v-if="formError" class="dictionary-form-error" role="alert">{{formError}}</p><template #footer><ElButton :disabled="busy" @click="statusDialog=false">取消</ElButton><ElButton :type="nextStatus==='active'?'primary':'danger'" :loading="busy" @click="confirmStatus">确认{{nextStatus==='active'?'启用':'停用'}}</ElButton></template></ElDialog>
  <ElDialog v-model="deletionOpen" title="删除词条" class="dictionary-ui dictionary-dialog" width="560px" align-center append-to-body :close-on-click-modal="false" :close-on-press-escape="!busy" :show-close="!busy">
   <template v-if="deletion"><p><strong>{{deletion.item.name}}</strong></p><ElAlert :title="deletion.reason" :type="deletion.deletable?'warning':'info'" show-icon :closable="false"/>
    <ElTable v-if="deletion.references.length" :data="deletion.references" size="small"><ElTableColumn prop="domain" label="引用位置"/><ElTableColumn prop="count" label="记录数" width="80"/></ElTable>
    <p v-if="deletion.deletable" class="dictionary-deletion-note">删除后将从词条列表移除，操作及配置历史仍保留在审计记录中。</p>
    <p v-if="formError" class="dictionary-form-error" role="alert">{{formError}}</p>
   </template><template #footer><ElButton :disabled="busy" @click="deletionOpen=false">取消</ElButton><ElButton v-if="deletion?.deletable" type="danger" :loading="busy" @click="confirmDeletion">确认删除</ElButton><ElButton v-else-if="deletion?.item.status==='active'" type="primary" :disabled="busy" @click="disableDeletionItem">停用并保留</ElButton></template>
  </ElDialog>
  <ElDialog v-model="explanation" title="系统内置项说明" class="dictionary-ui dictionary-dialog" width="540px" align-center append-to-body><ElAlert title="常用选项已预置，可以直接使用，也可以按实际业务调整。" type="info" show-icon :closable="false"/><ElDescriptions :column="1" direction="vertical"><ElDescriptionsItem label="数据来源">“系统内置”按系统预置记录识别，其他新增词条显示为“自定义”。</ElDescriptionsItem><ElDescriptionsItem label="安全维护">支持补充、改名、停用和排序。系统内置项可停用；没有引用的自定义词条可删除，已被引用的词条保留并可停用。</ElDescriptionsItem><ElDescriptionsItem label="引用统计">按当前数据库中直接关联的台账、需求、来源、项目及参考价格记录统计（不将操作默认配置计为业务引用）；杆塔结构和用途按当前名称匹配。</ElDescriptionsItem><ElDescriptionsItem label="待完善口径">仅统计尚未配置可用默认单位的启用操作类型，便于补齐常用录入默认值。</ElDescriptionsItem></ElDescriptions><template #footer><ElButton type="primary" @click="explanation=false">知道了</ElButton></template></ElDialog>
 </ElConfigProvider>
</template>

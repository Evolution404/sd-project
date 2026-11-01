<script setup lang="ts">
import {useResponsiveDescriptions} from '../utils/responsive-descriptions';
import {requestApi} from '../api/client';
import {computed,reactive,ref,watch} from 'vue';
import {ElAlert,ElButton,ElCard,ElDescriptions,ElDescriptionsItem,ElDialog,ElForm,ElFormItem,ElInput,ElOption,ElSelect,ElTable,ElTableColumn,ElTag,type FormInstance} from 'element-plus';
const responsiveColumns=useResponsiveDescriptions(2);
type Row=Record<string,any>;
const props=defineProps<{kind:string;canWrite:boolean;canDelete:boolean;canAuthorize:boolean}>();
const emit=defineEmits<{changed:[]}>();
const rows=ref<Row[]>([]),frameworks=ref<Row[]>([]),selected=ref<Row|null>(null),preview=ref<Row|null>(null);
const query=ref(''),status=ref(''),dialog=ref(''),busy=ref(false),error=ref(''),notice=ref(''),form=reactive<Row>({}),formRef=ref<FormInstance>();
const availableFrameworks=computed(()=>{const parents=frameworks.value.slice();if(form.framework_id&&!parents.some(x=>x.id===form.framework_id)&&selected.value?.framework_name)parents.push({id:form.framework_id,name:selected.value.framework_name,status:'deleted'});return parents});
const guarded=computed(()=>dialog.value==='edit'&&!!selected.value?.approved_count&&!props.canAuthorize);
const title=computed(()=>props.kind==='frameworks'?'项目框架':'执行协议');
const filtered=computed(()=>rows.value.filter(x=>(!status.value||x.status===status.value)&&x.name.toLowerCase().includes(query.value.toLowerCase())));
const money=(value:number)=>(value/100).toFixed(2);
const api=(path:string,method='GET',body?:Row)=>requestApi(path,method,body);
async function load(){
 busy.value=true;error.value='';try{const [data,parents]=await Promise.all([api('/'+props.kind+(status.value==='deleted'?'?status=deleted':'')),api('/frameworks')]);rows.value=data;frameworks.value=parents}catch(e){error.value=(e as Error).message}finally{busy.value=false}
}
async function open(action:string,item?:Row){
 error.value='';notice.value='';
 try{
  const data=item?await api('/'+props.kind+'/'+item.id):null;selected.value=data;
  Object.keys(form).forEach(key=>delete form[key]);
  if(action==='delete')preview.value=await api('/'+props.kind+'/'+item!.id+'/deletion');
  Object.assign(form,{name:data?.name||'',fiscal_year:data?.fiscal_year||new Date().getFullYear(),limit_yuan:data?money(data.limit_fen):'',status:data?.status||'active',framework_id:data?.framework_id||'',reason:''});dialog.value=action;
 }catch(e){error.value=(e as Error).message}
}
async function save(){
 if(busy.value||!await formRef.value?.validate().catch(()=>false))return;
 busy.value=true;error.value='';
 try{
  const body:Row={name:form.name,limit_yuan:form.limit_yuan,...(props.kind==='frameworks'?{fiscal_year:form.fiscal_year}:{framework_id:form.framework_id})};
  if(dialog.value==='edit')Object.assign(body,{version:selected.value!.version,status:form.status,reason:form.reason});
  if(dialog.value==='delete'){await api('/'+props.kind+'/'+selected.value!.id,'DELETE',{version:selected.value!.version,reason:form.reason,preview_token:preview.value?.token});notice.value='记录已删除，历史关联和资金占用保留'}
  else{await api('/'+props.kind+(dialog.value==='edit'?'/'+selected.value!.id:''),dialog.value==='edit'?'PATCH':'POST',body);notice.value='记录已保存'}
  dialog.value='';await load();emit('changed');
 }catch(e){error.value=(e as Error).message;if(dialog.value==='delete'&&selected.value){try{preview.value=await api('/'+props.kind+'/'+selected.value.id+'/deletion');selected.value=preview.value!.item}catch{}}}finally{busy.value=false}
}
const amountRules=[{required:true,message:'请填写授权额度',trigger:'blur'},{validator:(_rule:unknown,value:unknown,callback:(error?:Error)=>void)=>{const text=String(value??'');callback(!/^\d+(\.\d{1,2})?$/.test(text)||Number(text)<=0?new Error('请输入大于零、最多两位小数的金额'):undefined)},trigger:'blur'}];
watch(()=>props.kind,()=>{dialog.value='';status.value='';query.value='';notice.value='';void load()},{immediate:true});
watch(status,load);
</script>
<template>
 <section class="dictionary-ui funding-workspace">
  <ElCard shadow="never"><template #header><div class="section-header"><div><h2>{{title}}</h2><p class="muted">查看授权额度、项目预算和结算占用，修改和删除均保留历史依据。</p></div><ElButton v-if="canWrite" type="primary" :disabled="busy" @click="open('new')">新增{{title}}</ElButton></div></template>
   <div class="funding-toolbar"><ElInput v-model="query" aria-label="搜索名称" placeholder="搜索名称" clearable/><ElSelect v-model="status" aria-label="状态筛选" :empty-values="[null,undefined]"><ElOption label="全部正常记录" value=""/><ElOption label="启用" value="active"/><ElOption label="停用" value="inactive"/><ElOption label="已删除" value="deleted"/></ElSelect></div>
   <ElAlert v-if="error&&!dialog" :title="error" type="error" :closable="false"/><p v-if="notice" role="status" class="dictionary-notice">{{notice}}</p>
   <ElTable :data="filtered" row-key="id" empty-text="暂无符合条件的记录"><ElTableColumn prop="name" label="名称" min-width="180"/><ElTableColumn v-if="kind==='frameworks'" prop="fiscal_year" label="年度" width="90"/><ElTableColumn v-else label="所属框架" min-width="160"><template #default="{row}">{{row.framework_name}}{{row.framework_deleted?'（已删除）':''}}</template></ElTableColumn><ElTableColumn label="授权额度（元）" min-width="150"><template #default="{row}">{{money(row.limit_fen)}}</template></ElTableColumn><ElTableColumn label="已批准项目预算（元）" min-width="165"><template #default="{row}">{{money(kind==='frameworks'?(row.approved_project_budget_fen??row.approved_budget_fen??0):row.approved_budget_fen??0)}}</template></ElTableColumn><ElTableColumn label="状态" width="85"><template #default="{row}"><ElTag :type="row.status==='active'?'success':'info'">{{row.status==='deleted'?'已删除':row.status==='active'?'启用':'停用'}}</ElTag></template></ElTableColumn><ElTableColumn label="操作" width="180"><template #default="{row}"><ElButton link type="primary" :disabled="busy" @click="open('detail',row)">详情</ElButton><ElButton v-if="canWrite&&row.status!=='deleted'" link type="primary" :disabled="busy" @click="open('edit',row)">编辑</ElButton><ElButton v-if="canDelete&&row.status!=='deleted'" link type="danger" :disabled="busy" @click="open('delete',row)">删除</ElButton></template></ElTableColumn></ElTable>
  </ElCard>
  <ElDialog :model-value="!!dialog" @update:model-value="value=>{if(!value)dialog=''}" :title="dialog==='new'?'创建'+title:dialog==='edit'?'编辑'+title:dialog==='delete'?'删除'+title:title+'详情'" class="dictionary-ui dictionary-dialog" :width="dialog==='detail'?'800px':'560px'" align-center append-to-body destroy-on-close :close-on-click-modal="false" :close-on-press-escape="!busy" :show-close="!busy">
   <template v-if="dialog==='detail'&&selected"><ElDescriptions :column="responsiveColumns" border><ElDescriptionsItem label="名称">{{selected.name}}</ElDescriptionsItem><ElDescriptionsItem label="状态">{{selected.status==='deleted'?'已删除':selected.status==='active'?'启用':'停用'}}</ElDescriptionsItem><ElDescriptionsItem v-if="kind==='frameworks'" label="框架年度">{{selected.fiscal_year}}</ElDescriptionsItem><ElDescriptionsItem label="授权额度（元）">{{money(selected.limit_fen)}}</ElDescriptionsItem><ElDescriptionsItem label="批准项目预算（元）">{{money(selected.approved_budget_fen)}}</ElDescriptionsItem><ElDescriptionsItem label="已分配计划预算（元）">{{money(selected.allocated_plan_budget_fen)}}</ElDescriptionsItem><ElDescriptionsItem label="实际费用（元）">{{money(selected.actual_cost_fen)}}</ElDescriptionsItem><ElDescriptionsItem label="归集净结算（元）">{{money(selected.settled_fen)}}</ElDescriptionsItem><ElDescriptionsItem v-if="kind==='frameworks'" label="协议授权合计（元）">{{money(selected.agreement_limit_fen)}}</ElDescriptionsItem><ElDescriptionsItem v-else label="所属框架">{{selected.framework_name}}</ElDescriptionsItem></ElDescriptions>
    <h3>关联子项目</h3><ElTable :data="selected.projects" empty-text="暂无关联子项目"><ElTableColumn prop="name" label="名称"/><ElTableColumn label="批准预算（元）"><template #default="{row}">{{row.approved_budget_fen==null?'尚未批准':money(row.approved_budget_fen)}}</template></ElTableColumn></ElTable>
    <h3>修改与删除历史</h3><div v-for="event in selected.history" :key="event.id" class="funding-history"><strong>{{event.action==='delete'?'删除':event.action==='update'?'修改':'创建'}}</strong><span>{{event.actor_name}} · {{event.created_at}}</span><p>{{event.reason||'初始登记'}}</p><p v-if="event.action==='update'">名称：{{event.before.name}} → {{event.after.name}}；授权额度：{{money(event.before.limit_fen)}} → {{money(event.after.limit_fen)}} 元</p><p v-if="event.action==='update'&&event.before.fiscal_year!==event.after.fiscal_year">年度：{{event.before.fiscal_year}} → {{event.after.fiscal_year}}</p><p v-if="event.action==='update'&&event.before.status!==event.after.status">状态：{{event.before.status==='active'?'启用':'停用'}} → {{event.after.status==='active'?'启用':'停用'}}</p></div>
   </template>
   <ElForm v-else novalidate ref="formRef" :model="form" label-position="top" :disabled="busy" @submit.prevent="save">
    <template v-if="dialog==='delete'"><ElAlert :title="preview?.description||''" type="warning" :closable="false" show-icon/><p>{{selected?.name}}：关联 {{preview?.references.projects.length||0}} 个子项目{{kind==='frameworks'?'、'+(preview?.references.agreements.length||0)+' 份协议':''}}。</p></template>
    <template v-else><ElAlert v-if="dialog==='edit'&&kind==='frameworks'&&selected?.projects.length" title="修改年度会改变关联项目的当前年度归类；原批准依据与历史记录继续保留。" type="info" :closable="false"/><ElAlert v-if="guarded" title="已有正式项目，当前账号可维护名称；额度、年度和状态需管理员调整。" type="info" :closable="false"/><ElFormItem label="名称" prop="name" :rules="[{required:true,whitespace:true,message:'请填写名称',trigger:'blur'}]"><ElInput v-model="form.name" aria-label="名称"/></ElFormItem><ElFormItem v-if="kind==='frameworks'" label="框架年度" prop="fiscal_year" :rules="[{required:true,message:'请填写框架年度',trigger:'blur'},{validator:(_r:any,value:any,cb:any)=>cb(Number.isInteger(Number(value))&&Number(value)>=2000&&Number(value)<=2100?undefined:new Error('请输入2000至2100之间的整数年度')),trigger:'blur'}]"><ElInput :disabled="guarded" v-model="form.fiscal_year" aria-label="框架年度" type="number" :min="2000" :max="2100"/></ElFormItem><ElFormItem label="授权额度（元）" prop="limit_yuan" :rules="amountRules"><ElInput :disabled="guarded" v-model="form.limit_yuan" aria-label="授权额度（元）"/></ElFormItem><ElFormItem v-if="kind==='agreements'" label="所属框架" prop="framework_id" :rules="[{required:true,message:'请选择所属框架',trigger:'change'}]"><ElSelect v-model="form.framework_id" aria-label="所属框架" :disabled="dialog==='edit'&&!!selected?.projects.length"><ElOption v-for="parent in availableFrameworks.filter(x=>x.status==='active'||x.id===form.framework_id)" :key="parent.id" :label="parent.name+(parent.status==='deleted'?'（已删除）':parent.status==='inactive'?'（停用）':'')" :value="parent.id" :disabled="parent.status!=='active'"/></ElSelect><small v-if="dialog==='edit'&&selected?.projects.length" class="muted">已有子项目，所属框架不能单独改挂。</small></ElFormItem><ElFormItem v-if="dialog==='edit'" label="状态"><ElSelect :disabled="guarded" v-model="form.status" aria-label="状态"><ElOption label="启用" value="active"/><ElOption label="停用" value="inactive"/></ElSelect></ElFormItem></template>
    <ElFormItem v-if="dialog!=='new'" :label="dialog==='delete'?'删除依据':'变更依据'" prop="reason" :rules="[{required:true,whitespace:true,message:'请填写操作依据',trigger:'blur'}]"><ElInput v-model="form.reason" :aria-label="dialog==='delete'?'删除依据':'变更依据'" type="textarea" :rows="2"/></ElFormItem><p v-if="error" role="alert" class="dictionary-form-error">{{error}}</p><div class="dictionary-dialog-footer"><ElButton :disabled="busy" @click="dialog=''">取消</ElButton><ElButton :type="dialog==='delete'?'danger':'primary'" native-type="submit" :loading="busy">{{dialog==='delete'?'确认删除':'保存'}}</ElButton></div>
   </ElForm>
  </ElDialog>
 </section>
</template>
<style scoped>
.funding-toolbar{display:flex;gap:12px;margin-bottom:16px}.funding-toolbar>.el-input{max-width:330px}.funding-toolbar>.el-select{width:170px}.section-header{margin-bottom:0}.funding-history{padding:14px 0;border-bottom:1px solid #e6edf7;font-size:12px}.funding-history>span{margin-left:12px;color:#8c9db2}.funding-history p{margin:7px 0 0;color:#6f849f}
</style>

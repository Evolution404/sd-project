<script setup lang="ts">
import {computed,reactive,ref,watch} from 'vue';
import {ElAlert,ElButton,ElCheckbox,ElDescriptions,ElDescriptionsItem,ElDialog,ElForm,ElFormItem,ElInput,ElOption,ElSelect,ElTable,ElTableColumn,ElTag} from 'element-plus';
import type {FormInstance} from 'element-plus';
import {settlementApi as api} from '../utils/settlement-api';
import {newClientId} from '../utils/client-id';
type Row=Record<string,any>;
const props=defineProps<{projectId:string;executionId?:string;canSettle:boolean;refreshKey?:number}>();
const emit=defineEmits<{changed:[];reverse:[entry:Row]}>();
const rows=ref<Row[]>([]),status=ref('active'),query=ref(''),loading=ref(false),busy=ref(false),error=ref(''),notice=ref('');
const mode=ref<''|'detail'|'correct'|'void'>(''),detail=ref<Row|null>(null),preview=ref<Row|null>(null);
const form=reactive<Row>({}),formRef=ref<FormInstance>(),formError=ref(''),confirmed=ref(false);
const fieldErrors=reactive<Record<string,string>>({});
const clearFieldErrors=()=>Object.keys(fieldErrors).forEach(key=>delete fieldErrors[key]);
const money=(n:number)=>Number(n/100).toFixed(2);
const nature=(e:Row)=>e.entry_kind==='reversal'?'冲销':({advance:'预付款',progress:'进度结算',final:'最终结算'} as Row)[e.settlement_type];
const required=(label:string)=>[{required:true,whitespace:true,message:'请填写'+label,trigger:'blur'}];
const amountRules=[...required('金额'),{validator:(_r:any,v:string,cb:any)=>cb(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(v)&&Number(v)>0?undefined:new Error('请输入大于零、最多两位小数的金额')),trigger:'blur'}];
const filtered=computed(()=>rows.value.filter(e=>!query.value.trim()||[e.settlement_no,e.evidence,e.demand_no,e.plan_number].some(x=>String(x||'').includes(query.value.trim()))));
const remaining=(row:Row)=>row.amount_fen-rows.value.filter(e=>e.status==='active'&&e.reversal_of===row.id).reduce((s,e)=>s+e.amount_fen,0);
let readSequence=0;
async function refresh(){
 const sequence=++readSequence;loading.value=true;error.value='';
 try{
  const params=new URLSearchParams({status:status.value});if(props.executionId)params.set('execution_id',props.executionId);
  const result=await api('/projects/'+props.projectId+'/settlements?'+params);
  if(sequence===readSequence)rows.value=result;
 }catch(e){if(sequence===readSequence)error.value=(e as Error).message}
 finally{if(sequence===readSequence)loading.value=false}
}
watch(()=>[props.projectId,props.executionId],()=>{mode.value='';rows.value=[];query.value='';status.value='active';refresh()},{immediate:true});
watch(()=>[form.settlement_no,form.amount_yuan,form.occurred_on],clearFieldErrors);
watch(()=>props.refreshKey,refresh);watch(status,refresh);watch(confirmed,value=>{if(value)formError.value=''})
async function showDetail(row:Row){
 error.value='';try{detail.value=await api('/settlements/'+row.id);mode.value='detail'}catch(e){error.value=(e as Error).message}
}
async function openAction(row:Row,action:'correct'|'void'){
 error.value='';formError.value='';clearFieldErrors();
 try{
  detail.value=await api('/settlements/'+row.id);
  const e=detail.value!.entry;
  if(e.status!=='active')throw Error('凭证已撤销，请刷新后查看历史');
  if(action==='void')preview.value=await api('/settlements/'+row.id+'/void-preview');
  Object.assign(form,{settlement_no:e.settlement_no,settlement_type:e.settlement_type,amount_yuan:money(e.amount_fen),occurred_on:e.occurred_on,evidence:e.evidence,reason:'',request_key:newClientId()});
  confirmed.value=false;mode.value=action;
 }catch(e){error.value=(e as Error).message}
}
async function submit(){
 if(busy.value||!detail.value)return;
 if(!await formRef.value?.validate().catch(()=>false))return;
 if(mode.value==='void'&&preview.value!.affected.length>1&&!confirmed.value){formError.value='请确认同时撤销下列关联冲销凭证';return}
 busy.value=true;formError.value='';clearFieldErrors();
 try{
  const entry=detail.value.entry,action=mode.value;
  const body:Row={request_key:form.request_key,version:entry.version,reason:form.reason};
  if(action==='correct')Object.assign(body,{settlement_no:form.settlement_no,settlement_type:form.settlement_type,amount_yuan:form.amount_yuan,occurred_on:form.occurred_on,evidence:form.evidence});
  else {body.preview_token=preview.value!.preview_token;body.affected_ids=preview.value!.affected.map((e:Row)=>e.id)}
  await api('/settlements/'+entry.id,action==='correct'?'PATCH':'DELETE',body);
  mode.value='';notice.value=action==='correct'?'凭证已更正，资金汇总已更新':'凭证已撤销，可在已撤销记录中查询';
  await refresh();emit('changed');
 }catch(e){
  const message=(e as Error).message;
  const field=mode.value==='correct'?(message.includes('编号')?'settlement_no':message.includes('日期')?'occurred_on':/金额|预算|净结算/.test(message)?'amount_yuan':''):'';
  if(field)fieldErrors[field]=message;else formError.value=message;
 }finally{busy.value=false}
}
</script>
<template>
 <section class="dictionary-ui voucher-workspace" aria-label="结算凭证管理">
  <div class="voucher-toolbar"><h4>结算凭证</h4><ElInput v-model="query" clearable placeholder="搜索凭证、依据、专业需求" aria-label="搜索凭证"/><ElSelect v-model="status" aria-label="凭证状态"><ElOption label="有效凭证" value="active"/><ElOption label="已撤销凭证" value="voided"/><ElOption label="全部凭证（含历史）" value="all"/></ElSelect><ElButton :loading="loading" @click="refresh">刷新凭证</ElButton></div>
  <p v-if="error" role="alert" class="dictionary-form-error">{{error}}</p><p v-if="notice" role="status" class="voucher-notice">{{notice}}</p>
  <ElTable :data="filtered" row-key="id" empty-text="暂无符合条件的结算凭证" aria-label="结算凭证列表">
   <ElTableColumn prop="settlement_no" label="凭证编号" min-width="155"/><ElTableColumn label="性质" width="100"><template #default="{row}">{{nature(row)}}</template></ElTableColumn>
   <ElTableColumn label="需求 / 归属" min-width="170"><template #default="{row}">{{row.demand_no}}<small class="voucher-sub">{{row.plan_number||'项目级未归集'}}</small></template></ElTableColumn>
   <ElTableColumn label="金额（元）" width="130" align="right"><template #default="{row}">{{row.entry_kind==='reversal'?'-':''}}{{money(row.amount_fen)}}</template></ElTableColumn>
   <ElTableColumn prop="occurred_on" label="日期" width="115"/><ElTableColumn label="状态" width="90"><template #default="{row}"><ElTag :type="row.status==='active'?'success':'info'">{{row.status==='active'?'有效':'已撤销'}}</ElTag></template></ElTableColumn>
   <ElTableColumn label="操作" min-width="220"><template #default="{row}"><ElButton link type="primary" @click="showDetail(row)">详情 / 历史</ElButton><template v-if="canSettle&&row.status==='active'"><ElButton link type="primary" @click="openAction(row,'correct')">更正</ElButton><ElButton link type="danger" @click="openAction(row,'void')">撤销</ElButton><ElButton v-if="row.entry_kind==='payment'&&remaining(row)>0" link type="primary" @click="emit('reverse',row)">{{executionId?'冲销余额':row.execution_item_id?'进入计划冲销':'登记冲销'}}</ElButton></template></template></ElTableColumn>
  </ElTable>
  <ElDialog :model-value="mode==='detail'" title="结算凭证详情与历史" width="1000px" class="dictionary-ui dictionary-dialog" append-to-body align-center destroy-on-close @close="mode=''">
   <template v-if="detail"><ElDescriptions :column="3" border><ElDescriptionsItem label="凭证编号">{{detail.entry.settlement_no}}</ElDescriptionsItem><ElDescriptionsItem label="当前状态">{{detail.entry.status==='active'?'有效':'已撤销'}}</ElDescriptionsItem><ElDescriptionsItem label="当前金额（元）">{{money(detail.entry.amount_fen)}}</ElDescriptionsItem><ElDescriptionsItem label="子项目">{{detail.entry.project_name}}</ElDescriptionsItem><ElDescriptionsItem label="检修计划">{{detail.entry.plan_number||'项目级未归集'}}</ElDescriptionsItem><ElDescriptionsItem label="专业需求">{{detail.entry.demand_no}}</ElDescriptionsItem><ElDescriptionsItem label="批准版本">第 {{detail.entry.approval_version_no}} 版</ElDescriptionsItem><ElDescriptionsItem label="结算依据" :span="2">{{detail.entry.evidence}}</ElDescriptionsItem></ElDescriptions>
    <h4>原始登记与历次处理</h4><ElTable :data="detail.versions" max-height="320"><ElTableColumn label="版本" width="65"><template #default="{row}">{{row.version}}</template></ElTableColumn><ElTableColumn label="操作" width="80"><template #default="{row}">{{row.action==='record'?'原始登记':row.action==='correct'?'更正':'撤销'}}</template></ElTableColumn><ElTableColumn prop="settlement_no" label="当时编号" min-width="140"/><ElTableColumn label="金额（元）" width="120"><template #default="{row}">{{money(row.amount_fen)}}</template></ElTableColumn><ElTableColumn prop="occurred_on" label="凭证日期" width="115"/><ElTableColumn label="当时性质" width="100"><template #default="{row}">{{nature({...row,entry_kind:detail.entry.entry_kind})}}</template></ElTableColumn><ElTableColumn prop="evidence" label="当时凭证依据" min-width="150"/><ElTableColumn prop="reason" label="操作依据" min-width="150"/><ElTableColumn prop="changed_by_name" label="经办人" width="95"/><ElTableColumn prop="changed_at" label="操作时间" width="205"/></ElTable>
    <h4>正向与冲销凭证追溯</h4><ElTable :data="detail.related" @row-click="showDetail"><ElTableColumn prop="settlement_no" label="凭证编号"/><ElTableColumn label="性质"><template #default="{row}">{{nature(row)}}</template></ElTableColumn><ElTableColumn label="金额（元）"><template #default="{row}">{{money(row.amount_fen)}}</template></ElTableColumn><ElTableColumn label="状态"><template #default="{row}">{{row.status==='active'?'有效':'已撤销'}}</template></ElTableColumn><ElTableColumn label="操作"><template #default="{row}"><ElButton link type="primary" @click.stop="showDetail(row)">查看此凭证</ElButton></template></ElTableColumn></ElTable>
   </template>
  </ElDialog>
  <ElDialog :model-value="mode==='correct'||mode==='void'" :title="mode==='correct'?'更正结算凭证':'撤销结算凭证'" width="780px" class="dictionary-ui dictionary-dialog" append-to-body align-center destroy-on-close :close-on-click-modal="false" :close-on-press-escape="!busy" :show-close="!busy" @close="!busy&&(mode='')">
   <ElForm ref="formRef" :model="form" label-position="top" novalidate @submit.prevent="submit">
    <template v-if="mode==='correct'"><ElAlert title="原始凭证和历次更正均保留；本次更正沿用原项目、检修工作项和批准依据。" type="info" :closable="false"/><div class="voucher-form-grid">
     <ElFormItem label="凭证编号" prop="settlement_no" :error="fieldErrors.settlement_no" :rules="required('凭证编号')"><ElInput v-model.trim="form.settlement_no" aria-label="凭证编号"/></ElFormItem>
     <ElFormItem v-if="detail?.entry.entry_kind==='payment'" label="结算性质" prop="settlement_type" :rules="required('结算性质')"><ElSelect v-model="form.settlement_type" aria-label="结算性质"><ElOption label="预付款" value="advance"/><ElOption label="进度结算" value="progress"/><ElOption label="最终结算" value="final"/></ElSelect></ElFormItem>
     <ElFormItem label="金额（元）" prop="amount_yuan" :error="fieldErrors.amount_yuan" :rules="amountRules"><ElInput v-model.trim="form.amount_yuan" aria-label="金额（元）"/></ElFormItem><ElFormItem label="凭证日期" prop="occurred_on" :error="fieldErrors.occurred_on" :rules="required('凭证日期')"><ElInput v-model="form.occurred_on" type="date" aria-label="凭证日期"/></ElFormItem>
    </div><ElFormItem label="结算依据" prop="evidence" :rules="required('结算依据')"><ElInput v-model="form.evidence" type="textarea" aria-label="结算依据"/></ElFormItem></template>
    <template v-else-if="preview"><ElAlert title="撤销后不再计入净结算，原始凭证及处理历史继续保留。" type="warning" :closable="false"/><p>本次净结算变化：<strong>{{preview.net_change_fen>0?'+':''}}{{money(preview.net_change_fen)}} 元</strong></p><ElTable :data="preview.affected"><ElTableColumn prop="settlement_no" label="将撤销的凭证"/><ElTableColumn label="性质"><template #default="{row}">{{nature(row)}}</template></ElTableColumn><ElTableColumn label="金额（元）"><template #default="{row}">{{row.entry_kind==='reversal'?'-':''}}{{money(row.amount_fen)}}</template></ElTableColumn></ElTable><ElCheckbox v-if="preview.affected.length>1" v-model="confirmed">确认同时撤销表中关联冲销凭证，避免形成负数净结算</ElCheckbox></template>
    <ElFormItem :label="mode==='correct'?'更正依据':'撤销依据'" prop="reason" :rules="required(mode==='correct'?'更正依据':'撤销依据')"><ElInput v-model="form.reason" type="textarea" :aria-label="mode==='correct'?'更正依据':'撤销依据'" :rows="2"/></ElFormItem>
    <p v-if="formError" role="alert" class="dictionary-form-error">{{formError}}</p><div class="dictionary-dialog-footer"><ElButton :disabled="busy" @click="mode=''">取消</ElButton><ElButton :type="mode==='void'?'danger':'primary'" native-type="submit" :loading="busy">{{mode==='void'?'确认撤销':'保存更正'}}</ElButton></div>
   </ElForm>
  </ElDialog>
 </section>
</template>
<style scoped>
.voucher-workspace{margin-top:20px}.voucher-toolbar{display:flex;align-items:center;gap:12px;margin-bottom:12px}.voucher-toolbar h4{margin:0 auto 0 0;white-space:nowrap}.voucher-toolbar>.el-input{width:240px}.voucher-toolbar>.el-select{width:190px}.voucher-sub{display:block;color:#8493a9;font-size:12px;margin-top:4px}.voucher-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 20px;margin-top:16px}.voucher-notice{color:#258260;font-size:13px}.el-checkbox{margin:14px 0}
</style>

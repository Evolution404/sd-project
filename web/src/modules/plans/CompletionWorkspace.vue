<script setup lang="ts">
import {useResponsiveDescriptions} from '../../shared/utils/responsive-descriptions';
import {computed,reactive,ref,watch} from 'vue';
import {ElAlert,ElButton,ElDescriptions,ElDescriptionsItem,ElDialog,ElForm,ElFormItem,ElInput,ElDatePicker,ElOption,ElSelect,ElTable,ElTableColumn,ElTag,type FormInstance} from 'element-plus';
import {settlementApi as api} from '../../shared/utils/settlement-api';
import {newClientId} from '../../shared/utils/client-id';
const responsiveColumns=useResponsiveDescriptions(2);
type Row=Record<string,any>;
const props=defineProps<{executionId:string;canWrite:boolean;refreshKey?:number}>();
const emit=defineEmits<{changed:[]}>();
const rows=ref<Row[]>([]),status=ref('active'),query=ref(''),error=ref(''),notice=ref(''),loading=ref(false),busy=ref(false);
const mode=ref<''|'detail'|'correct'|'void'>(''),detail=ref<Row|null>(null),preview=ref<Row|null>(null);
const form=reactive<Row>({}),formRef=ref<FormInstance>(),formError=ref(''),quantityError=ref('');
const qty=(n:number)=>Number(n/10000).toFixed(4).replace(/\.?0+$/,'');
const money=(n:number)=>(n/100).toFixed(2);
const required=(label:string)=>[{required:true,whitespace:true,message:'请填写'+label,trigger:'blur'}];
const quantityRules=[...required('完成量'),{validator:(_r:any,v:string,cb:any)=>cb(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,4})?$/.test(v)&&Number(v)>0?undefined:new Error('请输入大于零、最多四位小数的完成量')),trigger:'blur'}];
const filtered=computed(()=>rows.value.filter(r=>!query.value.trim()||[r.demand_no,r.evidence].some(v=>String(v).includes(query.value.trim()))));
let sequence=0;
async function refresh(){
 const seq=++sequence;loading.value=true;error.value='';
 try{const result=await api('/executions/'+props.executionId+'/completion-records?status='+status.value);if(seq===sequence)rows.value=result}
 catch(e){if(seq===sequence)error.value=(e as Error).message}finally{if(seq===sequence)loading.value=false}
}
watch(()=>props.executionId,()=>{mode.value='';rows.value=[];status.value='active';notice.value='';refresh()},{immediate:true});
watch(status,refresh);watch(()=>props.refreshKey,refresh);watch(()=>form.quantity,()=>quantityError.value='');
async function open(row:Row,action:'detail'|'correct'|'void'){
 error.value='';formError.value='';quantityError.value='';const id=props.executionId;
 try{
  const result=await api('/completion-records/'+row.id);if(id!==props.executionId)return;detail.value=result;
  if(action==='void'){const impact=await api('/completion-records/'+row.id+'/void-preview');if(id!==props.executionId)return;preview.value=impact}
  Object.assign(form,{quantity:qty(result.entry.quantity_scaled),occurred_on:result.entry.occurred_on,evidence:result.entry.evidence,reason:'',request_key:newClientId()});mode.value=action;
 }catch(e){error.value=(e as Error).message}
}
async function submit(){
 if(busy.value||!detail.value||!await formRef.value?.validate().catch(()=>false))return;
 busy.value=true;formError.value='';quantityError.value='';
 try{
  const body:Row={version:detail.value.entry.version,request_key:form.request_key,reason:form.reason};
  if(mode.value==='correct')Object.assign(body,{quantity:form.quantity,occurred_on:form.occurred_on,evidence:form.evidence});
  else body.preview_token=preview.value!.preview_token;
  await api('/completion-records/'+detail.value.entry.id,mode.value==='correct'?'PATCH':'DELETE',body);
  notice.value=mode.value==='correct'?'完成记录已更正，工作量已重新核对':'完成记录已撤销，可在历史中查询';mode.value='';await refresh();emit('changed');
 }catch(e){const message=(e as Error).message;if(mode.value==='correct'&&/工作量|完成量|批准范围/.test(message))quantityError.value=message;else formError.value=message}
 finally{busy.value=false}
}
</script>
<template>
 <section class="dictionary-ui completion-workspace" aria-label="实际完成记录">
  <div class="completion-toolbar"><h3>实际完成记录</h3><ElInput v-model="query" clearable placeholder="搜索专业需求或验收依据" aria-label="搜索完成记录"/><ElSelect v-model="status" aria-label="完成记录状态"><ElOption label="有效完成记录" value="active"/><ElOption label="已撤销记录" value="voided"/><ElOption label="全部记录" value="all"/></ElSelect><ElButton :loading="loading" @click="refresh">刷新记录</ElButton></div>
  <p v-if="error" role="alert" class="dictionary-form-error">{{error}}</p><p v-if="notice" role="status" class="dictionary-notice">{{notice}}</p>
  <ElTable :data="filtered" row-key="id" empty-text="暂无符合条件的完成记录"><ElTableColumn prop="demand_no" label="专业需求" width="150"/><ElTableColumn label="完成量" width="140"><template #default="{row}">{{qty(row.quantity_scaled)}} {{row.unit_snapshot}}</template></ElTableColumn><ElTableColumn prop="occurred_on" label="实施日期" width="115"/><ElTableColumn prop="evidence" label="实施 / 验收依据" min-width="200"/><ElTableColumn prop="confirmed_by_name" label="确认人" width="100"/><ElTableColumn label="状态" width="95"><template #default="{row}"><ElTag :type="row.status==='active'?'success':'info'">{{row.status==='active'?'有效':'已撤销'}}</ElTag></template></ElTableColumn><ElTableColumn label="操作" min-width="195"><template #default="{row}"><ElButton link type="primary" @click="open(row,'detail')">详情 / 历史</ElButton><template v-if="canWrite&&row.status==='active'"><ElButton link type="primary" @click="open(row,'correct')">更正</ElButton><ElButton link type="danger" @click="open(row,'void')">撤销</ElButton></template></template></ElTableColumn></ElTable>
  <ElDialog :model-value="!!mode" :title="mode==='detail'?'完成记录详情与历史':mode==='correct'?'更正完成记录':'撤销完成记录'" width="900px" class="dictionary-ui dictionary-dialog" append-to-body align-center destroy-on-close :close-on-click-modal="false" :close-on-press-escape="!busy" :show-close="!busy" @close="!busy&&(mode='')">
   <template v-if="mode==='detail'&&detail"><ElDescriptions :column="responsiveColumns" border><ElDescriptionsItem label="专业需求">{{detail.entry.demand_no}}</ElDescriptionsItem><ElDescriptionsItem label="检修计划">{{detail.entry.plan_number}}</ElDescriptionsItem><ElDescriptionsItem label="记录完成量">{{qty(detail.entry.quantity_scaled)}} {{detail.entry.unit_snapshot}}</ElDescriptionsItem><ElDescriptionsItem label="状态">{{detail.entry.status==='active'?'有效':'已撤销，不计入完成量'}}</ElDescriptionsItem><ElDescriptionsItem label="实施日期">{{detail.entry.occurred_on}}</ElDescriptionsItem><ElDescriptionsItem label="实施 / 验收依据">{{detail.entry.evidence}}</ElDescriptionsItem></ElDescriptions><h4>原始确认与历次处理</h4><ElTable :data="detail.versions"><ElTableColumn prop="version" label="版本" width="65"/><ElTableColumn label="操作" width="85"><template #default="{row}">{{({record:'原始确认',correct:'更正',void:'撤销'} as Row)[row.action]}}</template></ElTableColumn><ElTableColumn label="完成量" width="100"><template #default="{row}">{{qty(row.quantity_scaled)}}</template></ElTableColumn><ElTableColumn prop="occurred_on" label="实施日期" width="115"/><ElTableColumn prop="evidence" label="当时验收依据" min-width="180"/><ElTableColumn prop="reason" label="操作依据" min-width="180"/><ElTableColumn prop="changed_by_name" label="经办人" width="95"/><ElTableColumn prop="changed_at" label="操作时间" width="210"/></ElTable></template>
   <ElForm v-else ref="formRef" :model="form" label-position="top" novalidate @submit.prevent="submit">
    <template v-if="mode==='correct'"><ElAlert title="保留原始确认和历次更正。更正不改变所属计划、工作项及采用的批准依据。" type="info" :closable="false"/><div class="completion-fields"><ElFormItem label="完成量" prop="quantity" :rules="quantityRules" :error="quantityError"><ElInput v-model.trim="form.quantity" aria-label="完成量" inputmode="decimal"/></ElFormItem><ElFormItem label="实施日期" prop="occurred_on" :rules="required('实施日期')"><ElDatePicker v-model="form.occurred_on" aria-label="实施日期" type="date" value-format="YYYY-MM-DD" format="YYYY-MM-DD"/></ElFormItem></div><ElFormItem label="实施 / 验收依据" prop="evidence" :rules="required('实施 / 验收依据')"><ElInput v-model="form.evidence" type="textarea" aria-label="实施 / 验收依据"/></ElFormItem></template>
    <template v-else-if="preview"><ElAlert title="撤销后不计入当前完成量，原始记录、计划及结算凭证继续保留。" type="warning" :closable="false"/><ElDescriptions :column="responsiveColumns" border><ElDescriptionsItem label="专业需求">{{preview.entry.demand_no}}</ElDescriptionsItem><ElDescriptionsItem label="本次减少完成量">{{qty(-preview.quantity_change_scaled)}} {{preview.entry.unit_snapshot}}</ElDescriptionsItem><ElDescriptionsItem label="释放可安排工作量">{{qty(preview.released_quantity_scaled)}} {{preview.entry.unit_snapshot}}</ElDescriptionsItem><ElDescriptionsItem label="范围占用变化">{{qty(preview.scope_committed_before_scaled)}} → {{qty(preview.scope_committed_after_scaled)}}</ElDescriptionsItem></ElDescriptions><p class="muted">执行中的计划继续预留原安排量；结束计划按有效完成量占用范围。</p><template v-if="preview.blocking_settlements.length"><ElAlert title="撤销将使下列有效终结结算失去完成依据。请先按真实依据更正或撤销关联凭证，再处理完成记录；不会自动改账。" type="error" :closable="false"/><ElTable :data="preview.blocking_settlements"><ElTableColumn prop="settlement_no" label="关联结算凭证"/><ElTableColumn label="有效净额（元）"><template #default="{row}">{{money(row.net_fen)}}</template></ElTableColumn></ElTable></template></template>
    <ElFormItem :label="mode==='correct'?'更正依据':'撤销依据'" prop="reason" :rules="required(mode==='correct'?'更正依据':'撤销依据')"><ElInput v-model="form.reason" :aria-label="mode==='correct'?'更正依据':'撤销依据'" type="textarea" :rows="2"/></ElFormItem><p v-if="formError" role="alert" class="dictionary-form-error">{{formError}}</p><div class="dictionary-dialog-footer"><ElButton :disabled="busy" @click="mode=''">取消</ElButton><ElButton native-type="submit" :type="mode==='void'?'danger':'primary'" :loading="busy">{{mode==='void'?'确认撤销':'保存更正'}}</ElButton></div>
   </ElForm>
  </ElDialog>
 </section>
</template>
<style scoped>
.completion-workspace{margin:22px 0}.completion-toolbar{display:flex;align-items:center;gap:10px;margin-bottom:12px}.completion-toolbar h3{margin-right:auto;white-space:nowrap}.completion-toolbar>.el-input{width:240px}.completion-toolbar>.el-select{width:170px}.completion-fields{display:grid;grid-template-columns:1fr 1fr;gap:20px}

@media(max-width:1350px){
 .completion-toolbar{flex-wrap:wrap}
 .completion-toolbar h3{flex-basis:100%;margin:0}
 .completion-toolbar>.el-input{flex:1 1 200px;min-width:145px;width:auto}
 .completion-toolbar>.el-select{flex:0 1 170px;width:auto}
}
@media(max-width:900px){.completion-fields{grid-template-columns:minmax(0,1fr)}}
</style>

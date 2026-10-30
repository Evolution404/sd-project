<script setup lang="ts">
import {ElDialog} from 'element-plus';
import {requestApi} from '../api/client';
import {ElForm} from 'element-plus';
import {ElTable,ElTableColumn} from 'element-plus';
import {ElInput,ElCheckbox,ElRadio,ElDatePicker} from 'element-plus';
import {ElSelect,ElOption} from 'element-plus';
import {ElButton} from 'element-plus';
import {computed,reactive,ref,watch} from 'vue';
import SettlementVoucherWorkspace from './SettlementVoucherWorkspace.vue';
import {ElFormItem,type FormInstance} from 'element-plus';

type Row=Record<string,any>;
type PlanSummary=Row&{items:Row[],entries:Row[]};
const props=defineProps<{executionId:string;canSettle:boolean;refreshKey?:number}>();
const emit=defineEmits<{changed:[]}>();
const summary=ref<PlanSummary|null>(null);
const error=ref(''),formError=ref(''),notice=ref('');
const loading=ref(false),saving=ref(false),refreshKey=ref(0);
const dialog=ref<''|'record'|'reverse'>('');
const form=reactive<Row>({});
const recordRef=ref<FormInstance>(),reverseRef=ref<FormInstance>();
const required=(name:string)=>[{required:true,message:'请填写'+name,trigger:'blur'}];
const selected=(name:string)=>[{required:true,message:'请选择'+name,trigger:'change'}];
const amountRules=[...required('结算金额'),{pattern:/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/,message:'金额最多两位小数',trigger:'blur'}];
async function validateSubmit(instance:FormInstance|undefined){
 if(await instance?.validate().catch(()=>false))await submit();
}

const money=(fen:number|null|undefined)=>fen==null?'—':(fen/100).toFixed(2);
const qty=(scaled:number|null|undefined)=>scaled==null?'—':(scaled/10000).toFixed(4).replace(/\.?0+$/,'');
const date=()=>new Date().toLocaleDateString('en-CA');
const settlementName=(value:string|null)=>({advance:'预付款',progress:'进度结算',final:'最终结算'} as Record<string,string>)[value||'']||'—';
const itemName=(id:string)=>summary.value?.items.find(i=>i.id===id)?.demand_no||'未知工作项';
const canRecord=computed(()=>props.canSettle&&summary.value?.project_status==='approved'&&summary.value.status!=='cancelled');
const remainingByOriginal=computed<Row[]>(()=>{
 const rows:Row[]=summary.value?.entries||[];
 return rows.filter(x=>x.entry_kind==='payment').map(row=>{
  const reversed=rows.filter(x=>x.entry_kind==='reversal'&&x.reversal_of===row.id)
   .reduce((total,x)=>total+x.amount_fen,0);
  return {...row,remaining_fen:row.amount_fen-reversed};
 }).filter(x=>x.remaining_fen>0);
});
const api=(path:string,method='GET',body?:Row)=>requestApi(path,method,body);
async function refresh(){
 if(!props.executionId){summary.value=null;return}
 const requested=props.executionId;
 loading.value=true;error.value='';
 try{
  const result=await api('/executions/'+encodeURIComponent(requested)+'/settlements');
  if(props.executionId===requested){summary.value=result as PlanSummary;refreshKey.value++}
 }catch(e){if(props.executionId===requested)error.value=(e as Error).message}
 finally{if(props.executionId===requested)loading.value=false}
}
watch(()=>props.refreshKey,refresh);
watch(()=>props.executionId,()=>{dialog.value='';notice.value='';summary.value=null;refresh()},{immediate:true});
function openRecord(itemId?:string){
 if(!canRecord.value||!summary.value?.items.length)return;
 Object.keys(form).forEach(k=>delete form[k]);
 Object.assign(form,{execution_item_id:itemId||summary.value.items[0].id,
  settlement_no:'',settlement_type:'progress',amount_yuan:'',
  occurred_on:date(),evidence:'',reversal_of:''});
 formError.value='';dialog.value='record';
}
function openReversal(original?:Row){
 if(!props.canSettle||!remainingByOriginal.value.length)return;
 const row=(original&&remainingByOriginal.value.find(e=>e.id===original.id))||remainingByOriginal.value[0];
 Object.keys(form).forEach(k=>delete form[k]);
 Object.assign(form,{execution_item_id:row.execution_item_id,reversal_of:row.id,
  settlement_no:'',amount_yuan:money(row.remaining_fen),occurred_on:date(),evidence:''});
 formError.value='';dialog.value='reverse';
}
function updateReversal(value:string){
 const original=remainingByOriginal.value.find(x=>x.id===value);
 if(original){form.execution_item_id=original.execution_item_id;form.amount_yuan=money(original.remaining_fen)}
}
async function submit(){
 if(saving.value||!props.executionId)return;
 saving.value=true;formError.value='';
 try{
  const body:Row={execution_item_id:form.execution_item_id,
   settlement_no:form.settlement_no,amount_yuan:form.amount_yuan,
   occurred_on:form.occurred_on,evidence:form.evidence,
   entry_kind:dialog.value==='reverse'?'reversal':'payment'};
  if(dialog.value==='reverse')body.reversal_of=form.reversal_of;
  else body.settlement_type=form.settlement_type;
  await api('/executions/'+encodeURIComponent(props.executionId)+'/settlements','POST',body);
  dialog.value='';notice.value=body.entry_kind==='reversal'?'冲销凭证已登记':'结算凭证已登记';
  await refresh();emit('changed');
 }catch(e){formError.value=(e as Error).message}finally{saving.value=false}
}
</script>

<template>
 <section class="plan-finance" aria-label="检修计划结算">
  <div class="plan-finance-heading">
   <div><h3>检修计划结算</h3><p class="muted">凭证按具体检修工作明细归集。项目级未归集金额不会自动计入本计划。</p></div>
   <ElButton native-type="button" class="secondary" :disabled="loading" @click="refresh">刷新</ElButton>
  </div>
  <p v-if="loading" class="muted" role="status">正在读取结算凭证</p>
  <p v-if="error" role="alert" class="plan-finance-error">{{error}}</p>
  <p v-if="notice" role="status" class="plan-finance-notice">{{notice}}</p>
  <template v-if="summary">
   <div class="plan-finance-metrics">
    <div><small>已登记净结算</small><strong>{{money(summary.settled_fen)}} <span>元</span></strong></div>
    <div><small>工作项</small><strong>{{summary.item_count}} <span>项</span></strong></div>
    <div><small>计划工作量估算</small><strong>{{summary.estimate_complete?money(summary.planned_estimate_fen):'有待定价项'}} <span v-if="summary.estimate_complete">元</span></strong></div>
   </div>
   <p class="plan-finance-disclaimer">计划工作量估算来源于批准范围单价快照，并非独立核定的计划预算；结算登记也不代表实际付款。</p>
   <div class="plan-finance-actions">
    <ElButton v-if="canRecord&&summary.items.length" native-type="button" class="primary" @click="openRecord()">登记结算凭证</ElButton>
    <ElButton v-if="canSettle&&remainingByOriginal.length" native-type="button" class="secondary" @click="openReversal()">登记冲销</ElButton>
   </div>
   <h4>检修工作明细</h4>
   <div class="table-wrap">
    <ElTable :data="summary.items" >
<ElTableColumn><template #header>专业需求</template><template #default="{row,$index}"><template v-for="([item]) in [[row,$index]]"><div >{{item.demand_no}}</div></template></template></ElTableColumn>
<ElTableColumn><template #header>计划工作量</template><template #default="{row,$index}"><template v-for="([item]) in [[row,$index]]"><div class="mono">{{qty(item.planned_quantity_scaled)}}</div></template></template></ElTableColumn>
<ElTableColumn><template #header>实际完成量</template><template #default="{row,$index}"><template v-for="([item]) in [[row,$index]]"><div class="mono">{{qty(item.completed_quantity_scaled)}}</div></template></template></ElTableColumn>
<ElTableColumn><template #header>工作量估算（元）</template><template #default="{row,$index}"><template v-for="([item]) in [[row,$index]]"><div class="mono">{{money(item.planned_estimate_fen)}}</div></template></template></ElTableColumn>
<ElTableColumn><template #header>净结算（元）</template><template #default="{row,$index}"><template v-for="([item]) in [[row,$index]]"><div class="mono">{{money(item.settled_fen)}}</div></template></template></ElTableColumn>
<ElTableColumn v-if="canSettle"><template #header>操作</template><template #default="{row,$index}"><template v-for="([item]) in [[row,$index]]"><div ><ElButton v-if="canRecord" native-type="button" class="link" @click="openRecord(item.id)">登记结算</ElButton></div></template></template></ElTableColumn><template #empty><div class="empty">尚未安排检修工作明细</div></template></ElTable>
   </div>
   <SettlementVoucherWorkspace :project-id="summary.project_id" :execution-id="executionId" :can-settle="canSettle" :refresh-key="refreshKey" @reverse="openReversal" @changed="refresh();emit('changed')"/>
  </template>
 </section>
 <ElDialog :model-value="dialog==='record'" title="登记检修计划结算"  width="860px" @close="!saving&&(dialog='')" class="business-modal form-panel" :destroy-on-close="true" :close-on-click-modal="true" :close-on-press-escape="true" :lock-scroll="false"><p v-if="formError" class="form-modal-error" role="alert">{{formError}}</p>
  <ElForm ref="recordRef" :model="form" label-position="top" novalidate class="form-grid" @submit.prevent="validateSubmit(recordRef)">
   <ElFormItem class="wide" label="检修工作项" prop="execution_item_id" :rules="selected('检修工作项')"><ElSelect v-model="form.execution_item_id" required>
     <ElOption :label="String(item.demand_no) + ' · 计划 ' + String(qty(item.planned_quantity_scaled))" :data-option-value="item.id" v-for="item in summary?.items||[]" :key="item.id" :value="item.id">{{item.demand_no}} · 计划 {{qty(item.planned_quantity_scaled)}}</ElOption>
   </ElSelect></ElFormItem>
   <ElFormItem label="结算性质" prop="settlement_type" :rules="selected('结算性质')"><ElSelect v-model="form.settlement_type" required>
    <ElOption :label="'预付款'" data-option-value="advance" value="advance">预付款</ElOption><ElOption :label="'进度结算'" data-option-value="progress" value="progress">进度结算</ElOption><ElOption :label="'最终结算'" data-option-value="final" value="final">最终结算</ElOption>
   </ElSelect></ElFormItem>
   <ElFormItem label="凭证编号" prop="settlement_no" :rules="required('凭证编号')"><ElInput v-model.trim="form.settlement_no" required maxlength="80"/></ElFormItem>
   <ElFormItem label="结算金额（元）" prop="amount_yuan" :rules="amountRules"><ElInput v-model.trim="form.amount_yuan" data-validate="money" required inputmode="decimal"/></ElFormItem>
   <ElFormItem label="凭证日期" prop="occurred_on" :rules="required('凭证日期')"><ElDatePicker type="date" value-format="YYYY-MM-DD" format="YYYY-MM-DD" v-model="form.occurred_on"  required/></ElFormItem>
   <ElFormItem class="wide" label="结算依据" prop="evidence" :rules="required('结算依据')"><ElInput type="textarea" v-model.trim="form.evidence" :rows="3" required/></ElFormItem>
   <p class="wide muted">最终结算要求本计划对应工作项已有结束后的实际完成记录。凭证支持更正、撤销和历史查询，原始登记继续保留。</p>
   <div class="wide form-actions"><ElButton native-type="button" class="light" :disabled="saving" @click="dialog=''">取消</ElButton><ElButton native-type="submit" class="primary" :disabled="saving">确认登记</ElButton></div>
  </ElForm>
 </ElDialog>
 <ElDialog :model-value="dialog==='reverse'" title="冲销原始结算凭证"  width="860px" @close="!saving&&(dialog='')" class="business-modal form-panel" :destroy-on-close="true" :close-on-click-modal="true" :close-on-press-escape="true" :lock-scroll="false"><p v-if="formError" class="form-modal-error" role="alert">{{formError}}</p>
  <ElForm ref="reverseRef" :model="form" label-position="top" novalidate class="form-grid" @submit.prevent="validateSubmit(reverseRef)">
   <ElFormItem class="wide" label="原始凭证（仅显示未全部冲销的正向凭证）" prop="reversal_of" :rules="selected('原始凭证（仅显示未全部冲销的正向凭证）')">
    <ElSelect v-model="form.reversal_of" required @change="updateReversal(form.reversal_of)">
     <ElOption :label="String(entry.settlement_no) + ' · ' + String(itemName(entry.execution_item_id)) + ' · 剩余 ' + String(money(entry.remaining_fen)) + ' 元'" :data-option-value="entry.id" v-for="entry in remainingByOriginal" :key="entry.id" :value="entry.id">{{entry.settlement_no}} · {{itemName(entry.execution_item_id)}} · 剩余 {{money(entry.remaining_fen)}} 元</ElOption>
    </ElSelect>
   </ElFormItem>
   <ElFormItem label="冲销凭证编号" prop="settlement_no" :rules="required('冲销凭证编号')"><ElInput v-model.trim="form.settlement_no" required maxlength="80"/></ElFormItem>
   <ElFormItem label="本次冲销金额（元）" prop="amount_yuan" :rules="amountRules"><ElInput v-model.trim="form.amount_yuan" data-validate="money" required inputmode="decimal"/></ElFormItem>
   <ElFormItem label="凭证日期" prop="occurred_on" :rules="required('凭证日期')"><ElDatePicker type="date" value-format="YYYY-MM-DD" format="YYYY-MM-DD" v-model="form.occurred_on"  required/></ElFormItem>
   <ElFormItem class="wide" label="冲销依据" prop="evidence" :rules="required('冲销依据')"><ElInput type="textarea" v-model.trim="form.evidence" :rows="3" required/></ElFormItem>
   <p class="wide muted">冲销保留原始凭证、批准版本和检修计划归属。不能超过该凭证的剩余未冲销金额。</p>
   <div class="wide form-actions"><ElButton native-type="button" class="light" :disabled="saving" @click="dialog=''">取消</ElButton><ElButton native-type="submit" class="primary" :disabled="saving">确认冲销</ElButton></div>
  </ElForm>
 </ElDialog>
</template>
<style scoped>
.plan-finance{display:grid;gap:12px;margin-top:18px}
.plan-finance-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.plan-finance-heading h3{margin:0 0 5px}
.plan-finance-heading p{margin:0}
.plan-finance-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.plan-finance-metrics>div{padding:13px 16px;border:1px solid var(--line,#dfe5ec);border-radius:12px;background:var(--panel,#fff)}
.plan-finance-metrics small{display:block;color:var(--muted,#657281);margin-bottom:7px}
.plan-finance-metrics strong{font-size:20px;font-variant-numeric:tabular-nums}
.plan-finance-metrics strong span{font-size:12px;font-weight:400}
.plan-finance-actions{display:flex;gap:10px;flex-wrap:wrap}
.plan-finance-disclaimer{margin:0;font-size:12px;color:var(--muted,#657281)}
.plan-finance-error{color:#a32929}.plan-finance-notice{color:#216444}
.plan-finance-reversal{color:#a32929}
.plan-finance-evidence{max-width:240px;word-break:break-word}
.plan-finance h4{margin:12px 0 0}

</style>

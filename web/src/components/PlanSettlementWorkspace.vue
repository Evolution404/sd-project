<script setup lang="ts">
import {computed,reactive,ref,watch} from 'vue';
import FormModal from './FormModal.vue';
import SettlementVoucherWorkspace from './SettlementVoucherWorkspace.vue';
import {vFormValidation} from '../utils/form-validation';

type Row=Record<string,any>;
type PlanSummary=Row&{items:Row[],entries:Row[]};
const props=defineProps<{executionId:string;canSettle:boolean;refreshKey?:number}>();
const emit=defineEmits<{changed:[]}>();
const summary=ref<PlanSummary|null>(null);
const error=ref(''),formError=ref(''),notice=ref('');
const loading=ref(false),saving=ref(false),refreshKey=ref(0);
const dialog=ref<''|'record'|'reverse'>('');
const form=reactive<Row>({});
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
async function api(path:string,method='GET',body?:Row){
 const response=await fetch('/api'+path,{method,credentials:'same-origin',
  headers:body?{'Content-Type':'application/json'}:{},
  body:body?JSON.stringify(body):undefined});
 let data:Row;
 try{data=await response.json()}catch{throw Error('无法读取结算服务返回的数据')}
 if(!response.ok)throw Error(data.error||'业务操作失败');
 return data;
}
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
   <button type="button" class="secondary" :disabled="loading" @click="refresh">刷新</button>
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
    <button v-if="canRecord&&summary.items.length" type="button" class="primary" @click="openRecord()">登记结算凭证</button>
    <button v-if="canSettle&&remainingByOriginal.length" type="button" class="secondary" @click="openReversal()">登记冲销</button>
   </div>
   <h4>检修工作明细</h4>
   <div class="table-wrap">
    <table>
     <thead><tr><th>专业需求</th><th>计划工作量</th><th>实际完成量</th><th>工作量估算（元）</th><th>净结算（元）</th><th v-if="canSettle">操作</th></tr></thead>
     <tbody>
      <tr v-for="item in summary.items" :key="item.id">
       <td>{{item.demand_no}}</td>
       <td class="mono">{{qty(item.planned_quantity_scaled)}}</td>
       <td class="mono">{{qty(item.completed_quantity_scaled)}}</td>
       <td class="mono">{{money(item.planned_estimate_fen)}}</td>
       <td class="mono">{{money(item.settled_fen)}}</td>
       <td v-if="canSettle"><button v-if="canRecord" type="button" class="link" @click="openRecord(item.id)">登记结算</button></td>
      </tr>
      <tr v-if="!summary.items.length"><td :colspan="canSettle?6:5" class="empty">尚未安排检修工作明细</td></tr>
     </tbody>
    </table>
   </div>
   <SettlementVoucherWorkspace :project-id="summary.project_id" :execution-id="executionId" :can-settle="canSettle" :refresh-key="refreshKey" @reverse="openReversal" @changed="refresh();emit('changed')"/>
  </template>
 </section>
 <FormModal :open="dialog==='record'" title="登记检修计划结算" :error="formError" size="wide" @close="!saving&&(dialog='')">
  <form v-form-validation novalidate class="form-grid" @submit.prevent="submit">
   <label class="wide"><span class="field-caption">检修工作项</span><select v-model="form.execution_item_id" required>
     <option v-for="item in summary?.items||[]" :key="item.id" :value="item.id">{{item.demand_no}} · 计划 {{qty(item.planned_quantity_scaled)}}</option>
   </select></label>
   <label><span class="field-caption">结算性质</span><select v-model="form.settlement_type" required>
    <option value="advance">预付款</option><option value="progress">进度结算</option><option value="final">最终结算</option>
   </select></label>
   <label><span class="field-caption">凭证编号</span><input v-model.trim="form.settlement_no" required maxlength="80"/></label>
   <label><span class="field-caption">结算金额（元）</span><input v-model.trim="form.amount_yuan" data-validate="money" required inputmode="decimal"/></label>
   <label><span class="field-caption">凭证日期</span><input v-model="form.occurred_on" type="date" required/></label>
   <label class="wide"><span class="field-caption">结算依据</span><textarea v-model.trim="form.evidence" rows="3" required/></label>
   <p class="wide muted">最终结算要求本计划对应工作项已有结束后的实际完成记录。凭证支持更正、撤销和历史查询，原始登记继续保留。</p>
   <div class="wide form-actions"><button type="button" class="light" :disabled="saving" @click="dialog=''">取消</button><button class="primary" :disabled="saving">确认登记</button></div>
  </form>
 </FormModal>
 <FormModal :open="dialog==='reverse'" title="冲销原始结算凭证" :error="formError" size="wide" @close="!saving&&(dialog='')">
  <form v-form-validation novalidate class="form-grid" @submit.prevent="submit">
   <label class="wide"><span class="field-caption">原始凭证（仅显示未全部冲销的正向凭证）</span>
    <select v-model="form.reversal_of" required @change="updateReversal(form.reversal_of)">
     <option v-for="entry in remainingByOriginal" :key="entry.id" :value="entry.id">{{entry.settlement_no}} · {{itemName(entry.execution_item_id)}} · 剩余 {{money(entry.remaining_fen)}} 元</option>
    </select>
   </label>
   <label><span class="field-caption">冲销凭证编号</span><input v-model.trim="form.settlement_no" required maxlength="80"/></label>
   <label><span class="field-caption">本次冲销金额（元）</span><input v-model.trim="form.amount_yuan" data-validate="money" required inputmode="decimal"/></label>
   <label><span class="field-caption">凭证日期</span><input v-model="form.occurred_on" type="date" required/></label>
   <label class="wide"><span class="field-caption">冲销依据</span><textarea v-model.trim="form.evidence" rows="3" required/></label>
   <p class="wide muted">冲销保留原始凭证、批准版本和检修计划归属。不能超过该凭证的剩余未冲销金额。</p>
   <div class="wide form-actions"><button type="button" class="light" :disabled="saving" @click="dialog=''">取消</button><button class="primary" :disabled="saving">确认冲销</button></div>
  </form>
 </FormModal>
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

<script setup lang="ts">
import {reactive,ref,watch} from 'vue';
import {ElAlert,ElButton,ElCheckbox,ElDialog,ElForm,ElFormItem,ElInput,ElOption,ElSelect,ElTable,ElTableColumn,type FormInstance} from 'element-plus';
import {settlementApi as api} from '../utils/settlement-api';
import {newClientId} from '../utils/client-id';
type Row=Record<string,any>;
const props=defineProps<{executionId:string;canConfirm:boolean;refreshKey?:number}>(),emit=defineEmits<{changed:[]}>();
const rows=ref<Row[]>([]),expenses=ref<Row[]>([]),vouchers=ref<Row[]>([]),cost=ref<Row|null>(null),selected=ref<Row|null>(null),history=ref<Row[]>([]);
const status=ref('active'),mode=ref(''),error=ref(''),formError=ref(''),notice=ref(''),busy=ref(false),form=reactive<Row>({}),formRef=ref<FormInstance>();
const money=(n:number)=>(n/100).toFixed(2),required=(label:string)=>[{required:true,message:'请填写'+label,trigger:'blur'}];
const positiveRules=[...required('费用份额'),{validator:(_r:any,v:string,cb:any)=>cb(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(v)&&Number(v)>0?undefined:new Error('请输入大于零、最多两位小数的费用份额')),trigger:'blur'}];
const settledRules=[...required('核定结算额'),{validator:(_r:any,v:string,cb:any)=>cb(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(v)?undefined:new Error('结算额为非负数，最多两位小数')),trigger:'blur'}];
let sequence=0;
async function refresh(){const n=++sequence;error.value='';try{const [r,c,s]=await Promise.all([api('/executions/'+props.executionId+'/cost-reconciliations?status='+status.value),api('/executions/'+props.executionId+'/costs'),api('/executions/'+props.executionId+'/settlements')]);if(n!==sequence)return;rows.value=r;expenses.value=c.entries;vouchers.value=s.entries.filter((v:Row)=>v.entry_kind==='payment')}catch(e){if(n===sequence)error.value=(e as Error).message}}
watch(()=>props.executionId,()=>{mode.value='';rows.value=[];refresh()},{immediate:true});watch([status,()=>props.refreshKey],refresh);
async function loadCost(){cost.value=form.cost_entry_id?await api('/costs/'+form.cost_entry_id):null;if(mode.value==='new')form.execution_item_id=cost.value?.allocations[0]?.execution_item_id||''}
async function open(action:string,row?:Row){
 error.value='';formError.value='';const id=props.executionId;
 try{await refresh();if(error.value||id!==props.executionId)return;selected.value=row||null;if(row){const d=await api('/cost-reconciliations/'+row.record_id);selected.value={...row,...d.entry};history.value=d.versions}
 const r=selected.value;
 Object.assign(form,{cost_entry_id:r?.cost_entry_id||expenses.value[0]?.entry_id||'',execution_item_id:r?.execution_item_id||'',settlement_entry_id:r?.settlement_entry_id||'',expense_amount_yuan:r?money(r.expense_amount_fen):'',settled_amount_yuan:r?money(r.settled_amount_fen):'',is_final:r?!!r.is_final:false,evidence:action==='delete'?'':r?.evidence||'',request_key:newClientId()});
 mode.value=action;await loadCost();if(id!==props.executionId)mode.value='';
 }catch(e){error.value=(e as Error).message}
}
async function submit(){
 if(busy.value||!await formRef.value?.validate().catch(()=>false))return;busy.value=true;formError.value='';
 try{
  let body:Row={request_key:form.request_key,evidence:form.evidence};
  if(mode.value!=='delete'){
   const s=vouchers.value.find(v=>v.id===form.settlement_entry_id);
   if(!s||!cost.value)throw Error('请选择有效费用和结算凭证');
   Object.assign(body,{cost_entry_id:form.cost_entry_id,cost_version:cost.value.entry.version_no,settlement_entry_id:s.id,settlement_version:s.version||1,execution_item_id:form.execution_item_id,expense_amount_yuan:form.expense_amount_yuan,settled_amount_yuan:form.settled_amount_yuan,is_final:form.is_final});
  }
  if(mode.value==='new')await api('/executions/'+props.executionId+'/cost-reconciliations','POST',body);
  else{body.version=selected.value!.version_no;await api('/cost-reconciliations/'+selected.value!.record_id,mode.value==='delete'?'DELETE':'PATCH',body)}
  mode.value='';notice.value='费用结算核对已更新，金额与待核对份额已重算';await refresh();emit('changed');
 }catch(e){formError.value=(e as Error).message}finally{busy.value=false}
}
</script>
<template>
 <section class="dictionary-ui reconciliation-workspace" aria-label="费用结算核对">
  <div class="reconciliation-heading"><h3>费用结算核对</h3><ElButton v-if="canConfirm" type="primary" @click="open('new')">登记核对</ElButton><ElSelect v-model="status" aria-label="核对记录状态"><ElOption label="有效核对" value="active"/><ElOption label="已撤销核对" value="voided"/><ElOption label="全部核对" value="all"/></ElSelect><ElButton @click="refresh">刷新核对</ElButton></div><p>分别记录对应费用份额和核定结算额，差额作为核减或调整依据。待最终核对费用按费用份额计算。</p><p v-if="error" role="alert" class="dictionary-form-error">{{error}}</p><p v-if="notice" role="status" class="dictionary-notice">{{notice}}</p>
  <ElTable :data="rows" row-key="record_id" empty-text="暂无符合条件的核对记录"><ElTableColumn prop="cost_name" label="费用" min-width="145"/><ElTableColumn prop="demand_no" label="专业需求" width="140"/><ElTableColumn prop="settlement_no" label="结算凭证" min-width="145"/><ElTableColumn label="费用份额（元）" width="130"><template #default="{row}">{{money(row.expense_amount_fen)}}</template></ElTableColumn><ElTableColumn label="结算额（元）" width="125"><template #default="{row}">{{money(row.settled_amount_fen)}}</template></ElTableColumn><ElTableColumn label="差额（元）" width="115"><template #default="{row}">{{money(row.expense_amount_fen-row.settled_amount_fen)}}</template></ElTableColumn><ElTableColumn label="状态" width="110"><template #default="{row}">{{row.status==='voided'?'已撤销':row.is_final?'最终核对':'阶段核对'}}</template></ElTableColumn><ElTableColumn label="操作" min-width="195"><template #default="{row}"><ElButton link type="primary" @click="open('history',row)">详情 / 历史</ElButton><template v-if="canConfirm&&row.status==='active'"><ElButton link type="primary" @click="open('edit',row)">更正</ElButton><ElButton link type="danger" @click="open('delete',row)">撤销</ElButton></template></template></ElTableColumn></ElTable>
  <ElDialog :model-value="!!mode" :title="mode==='new'?'登记费用结算核对':mode==='edit'?'更正费用结算核对':mode==='delete'?'撤销费用结算核对':'费用结算核对历史'" width="920px" class="dictionary-ui dictionary-dialog" append-to-body align-center destroy-on-close :close-on-click-modal="false" :close-on-press-escape="!busy" :show-close="!busy" @close="!busy&&(mode='')">
   <ElTable v-if="mode==='history'" :data="history"><ElTableColumn prop="version_no" label="版本" width="70"/><ElTableColumn label="状态" width="110"><template #default="{row}">{{row.status==='voided'?'撤销':row.is_final?'最终核对':'阶段核对'}}</template></ElTableColumn><ElTableColumn label="费用份额（元）" width="140"><template #default="{row}">{{money(row.expense_amount_fen)}}</template></ElTableColumn><ElTableColumn label="结算额（元）" width="130"><template #default="{row}">{{money(row.settled_amount_fen)}}</template></ElTableColumn><ElTableColumn prop="evidence" label="核对 / 差异依据" min-width="220"/><ElTableColumn prop="confirmed_by_name" label="经办人" width="100"/><ElTableColumn prop="confirmed_at" label="操作时间" width="210"/></ElTable>
   <ElForm v-else ref="formRef" :model="form" label-position="top" novalidate @submit.prevent="submit">
    <ElAlert v-if="mode==='delete'" title="撤销核对关系后释放双方的对应份额，原费用与结算凭证不变，核对历史保留。" type="warning" :closable="false"/>
    <template v-else><ElAlert title="仅核对同一检修工作项的费用与正向结算；项目级未归集金额不会自动摊入计划。" type="info" :closable="false"/><ElFormItem label="实际费用" prop="cost_entry_id" :rules="required('实际费用')"><ElSelect v-model="form.cost_entry_id" aria-label="实际费用" :disabled="mode==='edit'" @change="loadCost"><ElOption v-for="c in expenses" :key="c.entry_id" :value="c.entry_id" :label="c.name+' · '+money(c.amount_fen)+' 元'"/></ElSelect></ElFormItem><ElFormItem label="对应工作项" prop="execution_item_id" :rules="required('对应工作项')"><ElSelect v-model="form.execution_item_id" aria-label="对应工作项" :disabled="mode==='edit'"><ElOption v-for="a in cost?.allocations||[]" :key="a.execution_item_id" :value="a.execution_item_id" :label="a.demand_no+' · 费用 '+money(a.amount_fen)+' 元'"/></ElSelect></ElFormItem><ElFormItem label="结算凭证" prop="settlement_entry_id" :rules="required('结算凭证')"><ElSelect v-model="form.settlement_entry_id" aria-label="结算凭证" :disabled="mode==='edit'"><ElOption v-for="s in vouchers.filter(v=>v.execution_item_id===form.execution_item_id)" :key="s.id" :value="s.id" :label="s.settlement_no+' · '+money(s.amount_fen)+' 元'"/></ElSelect></ElFormItem><div class="reconciliation-fields"><ElFormItem label="对应费用份额（元）" prop="expense_amount_yuan" :rules="positiveRules"><ElInput v-model="form.expense_amount_yuan" aria-label="对应费用份额（元）"/></ElFormItem><ElFormItem label="核定结算额（元）" prop="settled_amount_yuan" :rules="settledRules"><ElInput v-model="form.settled_amount_yuan" aria-label="核定结算额（元）"/></ElFormItem></div><ElCheckbox v-model="form.is_final">本次对应费用份额已最终核对</ElCheckbox></template>
    <ElFormItem :label="mode==='delete'?'撤销依据':'核对 / 差异依据'" prop="evidence" :rules="required(mode==='delete'?'撤销依据':'核对 / 差异依据')"><ElInput v-model="form.evidence" :aria-label="mode==='delete'?'撤销依据':'核对 / 差异依据'" type="textarea" :rows="3"/></ElFormItem><p v-if="formError" role="alert" class="dictionary-form-error">{{formError}}</p><div class="dictionary-dialog-footer"><ElButton :disabled="busy" @click="mode=''">取消</ElButton><ElButton native-type="submit" :type="mode==='delete'?'danger':'primary'" :loading="busy">{{mode==='delete'?'确认撤销核对':'保存核对'}}</ElButton></div>
   </ElForm>
  </ElDialog>
 </section>
</template>
<style scoped>
.reconciliation-workspace{margin:22px 0}.reconciliation-heading{display:flex;align-items:center;gap:10px}.reconciliation-heading h3{margin-right:auto}.reconciliation-heading>.el-select{width:160px}.reconciliation-fields{display:grid;grid-template-columns:1fr 1fr;gap:20px}.reconciliation-workspace>p:not(.dictionary-form-error):not(.dictionary-notice){font-size:12px;color:#8291a6}
</style>

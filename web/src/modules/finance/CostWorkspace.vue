<script setup lang="ts">
import {useResponsiveDescriptions} from '../../shared/utils/responsive-descriptions';
import {computed,reactive,ref,watch} from 'vue';
import {ElAlert,ElButton,ElDescriptions,ElDescriptionsItem,ElDialog,ElForm,ElFormItem,ElInput,ElDatePicker,ElOption,ElSelect,ElTable,ElTableColumn,type FormInstance} from 'element-plus';
import {settlementApi as api} from '../../shared/utils/settlement-api';
import {newClientId} from '../../shared/utils/client-id';
const responsiveColumns=useResponsiveDescriptions(3);
type Row=Record<string,any>;
const props=defineProps<{executionId:string;canWrite:boolean;canConfirm:boolean;refreshKey?:number}>(),emit=defineEmits<{changed:[]}>();
const data=ref<Row|null>(null),mode=ref(''),selected=ref<Row|null>(null),detail=ref<Row|null>(null),status=ref('active'),draftStatus=ref('draft');
const error=ref(''),formError=ref(''),notice=ref(''),busy=ref(false),loading=ref(false),form=reactive<Row>({}),formRef=ref<FormInstance>();
const money=(n:number|null|undefined)=>n==null?'未核定':(n/100).toFixed(2);
const required=(label:string)=>[{required:true,whitespace:true,message:'请填写'+label,trigger:'blur'}];
const amountRules=[...required('费用金额'),{validator:(_r:any,v:string,cb:any)=>cb(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(v)&&Number(v)>0?undefined:new Error('请输入大于零、最多两位小数的金额')),trigger:'blur'}];
const itemName=(id:string)=>data.value?.items.find((i:Row)=>i.id===id)?.demand_no||'历史工作项';
const title=computed(()=>({new:'编制实际费用',edit:'编辑费用草稿',correct:'编制费用更正',void:'撤销已确认费用',deleteDraft:'删除费用草稿',confirm:'确认实际费用',history:'费用详情与历史',draftHistory:'费用草稿详情与历史'} as Row)[mode.value]||'');
const choices=computed(()=>{const list:Row[]=[...(data.value?.categories||[])];if(form.category_id&&!list.some(c=>c.id===form.category_id))list.push({id:form.category_id,name:detail.value?.entry.category_snapshot?.name||'历史费用类别（已删除或停用）'});return list});
let seq=0;
async function refresh(){const n=++seq;loading.value=true;error.value='';try{const d=await api('/executions/'+props.executionId+'/costs?status='+status.value+'&draft_status='+draftStatus.value);if(n===seq)data.value=d}catch(e){if(n===seq)error.value=(e as Error).message}finally{if(n===seq)loading.value=false}}
watch(()=>props.executionId,()=>{mode.value='';data.value=null;refresh()},{immediate:true});watch([status,draftStatus,()=>props.refreshKey],refresh);
async function open(action:string,row?:Row){
 formError.value='';error.value='';const id=props.executionId;
 try{
  await refresh();if(error.value||id!==props.executionId)return;selected.value=row||null;detail.value=null;
  let source:Row={};
  if(['history','correct','void'].includes(action)){detail.value=await api('/costs/'+row!.entry_id);source={...detail.value!.entry,allocations:detail.value!.allocations,entry_id:row!.entry_id,base_version:detail.value!.entry.version_no}}
  else if(row){source=await api('/cost-drafts/'+row.id);selected.value=source;if(action==='draftHistory')detail.value=source;if(source.entry_id){detail.value=await api('/costs/'+source.entry_id);source.base_version=detail.value!.entry.version_no}}
  if(id!==props.executionId)return;
  Object.assign(form,{entry_id:source.entry_id||null,base_version:source.base_version||0,kind:source.kind||'record',name:source.name||'',category_id:source.category_id||data.value?.categories[0]?.id||'',occurred_on:source.occurred_on||new Date().toLocaleDateString('en-CA'),amount_yuan:source.amount_fen?money(source.amount_fen):'',evidence:source.evidence||'',reason:'',request_key:newClientId(),allocations:(source.allocations||[{execution_item_id:data.value?.items[0]?.id||'',amount_fen:0}]).map((a:Row)=>({execution_item_id:a.execution_item_id,amount_yuan:a.amount_fen?money(a.amount_fen):''}))});
  if(action==='edit')form.reason=source.reason||'';
  mode.value=action;
 }catch(e){error.value=(e as Error).message}
}
async function submit(){
 if(busy.value||!await formRef.value?.validate().catch(()=>false))return;
 busy.value=true;formError.value='';
 try{
  const action=mode.value;
  if(action==='confirm')await api('/cost-drafts/'+selected.value!.id+'/confirm','POST',{version:selected.value!.version,request_key:form.request_key});
  else if(action==='deleteDraft')await api('/cost-drafts/'+selected.value!.id,'DELETE',{version:selected.value!.version,reason:form.reason});
  else{
   const body:Row={entry_id:form.entry_id,base_version:form.base_version,kind:action==='void'?'void':form.kind,reason:form.reason};
   if(body.kind!=='void')Object.assign(body,{name:form.name,category_id:form.category_id,occurred_on:form.occurred_on,amount_yuan:form.amount_yuan,evidence:form.evidence,allocations:form.allocations.length===1?[{execution_item_id:form.allocations[0].execution_item_id,amount_yuan:form.amount_yuan}]:form.allocations});
   if(action==='edit'){body.version=selected.value!.version;await api('/cost-drafts/'+selected.value!.id,'PATCH',body)}else await api('/executions/'+props.executionId+'/cost-drafts','POST',body);
  }
  mode.value='';notice.value=action==='confirm'?'费用已确认，实际费用及待核对份额已更新':action==='deleteDraft'?'费用草稿已删除':'费用草稿已保存，管理员确认后生效';await refresh();emit('changed');
 }catch(e){formError.value=(e as Error).message}finally{busy.value=false}
}
</script>
<template>
 <section class="dictionary-ui cost-workspace" aria-label="实际费用管理">
  <div class="cost-heading"><h3>实际费用</h3><ElButton v-if="canWrite" type="primary" @click="open('new')">编制费用</ElButton><ElButton :loading="loading" @click="refresh">刷新费用</ElButton></div>
  <p v-if="error" role="alert" class="dictionary-form-error">{{error}}</p><p v-if="notice" role="status" class="dictionary-notice">{{notice}}</p>
  <template v-if="data"><ElDescriptions :column="responsiveColumns" border><ElDescriptionsItem label="已确认实际费用（元）"><strong data-testid="actual-cost-total">{{money(data.actual_cost_fen)}}</strong></ElDescriptionsItem><ElDescriptionsItem label="计划核定预算（元）">{{money(data.confirmed_budget_fen)}}</ElDescriptionsItem><ElDescriptionsItem label="待最终核对费用（元）"><span data-testid="pending-final-cost">{{money(data.pending_final_expense_fen)}}</span></ElDescriptionsItem></ElDescriptions><ElAlert v-if="data.budget_variance_fen>0" :title="'实际费用超过计划预算 '+money(data.budget_variance_fen)+' 元；真实费用保留，请核对原因并按实际需要办理预算调整。'" type="warning" :closable="false"/><ElAlert v-if="data.project_budget_variance_fen>0" :title="'子项目实际费用超过批准预算 '+money(data.project_budget_variance_fen)+' 元，真实费用保留，请核对并办理必要的预算调整。'" type="warning" :closable="false"/><p class="cost-hint">费用按受益工作项分摊；与结算、实际付款分别核算。草稿不计实际费用，管理员确认后生效。</p>
   <div class="cost-heading"><h4>已确认费用</h4><ElSelect v-model="status" aria-label="费用状态"><ElOption label="有效费用" value="active"/><ElOption label="已撤销费用" value="voided"/><ElOption label="全部费用" value="all"/></ElSelect></div>
   <ElTable :data="data.entries" row-key="entry_id" empty-text="暂无符合条件的已确认费用"><ElTableColumn prop="name" label="费用名称" min-width="150"/><ElTableColumn label="类别" width="120"><template #default="{row}">{{row.category_snapshot.name}}</template></ElTableColumn><ElTableColumn label="金额（元）" width="125"><template #default="{row}">{{money(row.amount_fen)}}</template></ElTableColumn><ElTableColumn prop="occurred_on" label="发生日期" width="115"/><ElTableColumn label="状态" width="95"><template #default="{row}">{{row.status==='active'?'有效':'已撤销'}}</template></ElTableColumn><ElTableColumn label="操作" min-width="200"><template #default="{row}"><ElButton link type="primary" @click="open('history',row)">详情 / 历史</ElButton><template v-if="canWrite&&row.status==='active'"><ElButton link type="primary" @click="open('correct',row)">更正</ElButton><ElButton link type="danger" @click="open('void',row)">撤销</ElButton></template></template></ElTableColumn></ElTable>
   <div class="cost-heading"><h4>费用草稿</h4><ElSelect v-model="draftStatus" aria-label="费用草稿状态"><ElOption label="待确认草稿" value="draft"/><ElOption label="已确认草稿" value="confirmed"/><ElOption label="已删除草稿" value="deleted"/><ElOption label="全部草稿" value="all"/></ElSelect></div>
   <ElTable :data="data.drafts" row-key="id" empty-text="暂无符合条件的费用草稿"><ElTableColumn prop="name" label="费用名称" min-width="160"/><ElTableColumn label="金额（元）" width="125"><template #default="{row}">{{money(row.amount_fen)}}</template></ElTableColumn><ElTableColumn label="类型 / 状态" width="170"><template #default="{row}">{{row.kind==='void'?'撤销费用':row.base_version>0?'费用更正':'费用登记'}} · {{({draft:'待确认',confirmed:'已确认',deleted:'已删除'} as Row)[row.status]}}</template></ElTableColumn><ElTableColumn prop="created_by_name" label="编制人" width="100"/><ElTableColumn label="操作" min-width="240"><template #default="{row}"><ElButton link type="primary" @click="open('draftHistory',row)">详情 / 历史</ElButton><template v-if="row.status==='draft'"><ElButton v-if="canWrite" link type="primary" @click="open('edit',row)">编辑</ElButton><ElButton v-if="canWrite" link type="danger" @click="open('deleteDraft',row)">删除</ElButton><ElButton v-if="canConfirm" link type="primary" @click="open('confirm',row)">确认费用</ElButton></template></template></ElTableColumn></ElTable>
  </template>
  <ElDialog :model-value="!!mode" :title="title" width="940px" class="dictionary-ui dictionary-dialog" append-to-body align-center destroy-on-close :close-on-click-modal="false" :close-on-press-escape="!busy" :show-close="!busy" @close="!busy&&(mode='')">
   <template v-if="mode==='history'&&detail"><ElDescriptions :column="Math.min(2,responsiveColumns)" border><ElDescriptionsItem label="名称">{{detail.entry.name}}</ElDescriptionsItem><ElDescriptionsItem label="金额（元）">{{money(detail.entry.amount_fen)}}</ElDescriptionsItem><ElDescriptionsItem label="费用类别">{{detail.entry.category_snapshot.name}}</ElDescriptionsItem><ElDescriptionsItem label="费用凭据 / 依据">{{detail.entry.evidence}}</ElDescriptionsItem></ElDescriptions><h4>工作项分摊</h4><ElTable :data="detail.allocations"><ElTableColumn prop="demand_no" label="专业需求"/><ElTableColumn label="分摊金额（元）"><template #default="{row}">{{money(row.amount_fen)}}</template></ElTableColumn></ElTable><h4>费用核定历史</h4><ElTable :data="detail.versions"><ElTableColumn type="expand"><template #default="{row}"><ElTable :data="row.allocations"><ElTableColumn label="当时受益工作项"><template #default="{row:a}">{{itemName(a.execution_item_id)}}</template></ElTableColumn><ElTableColumn label="当时分摊金额（元）"><template #default="{row:a}">{{money(a.amount_fen)}}</template></ElTableColumn></ElTable></template></ElTableColumn><ElTableColumn label="当时费用类别" width="130"><template #default="{row}">{{row.category_snapshot.name}}</template></ElTableColumn><ElTableColumn prop="version_no" label="版本" width="70"/><ElTableColumn label="操作" width="100"><template #default="{row}">{{row.status==='voided'?'撤销':'确认 / 更正'}}</template></ElTableColumn><ElTableColumn label="金额（元）" width="130"><template #default="{row}">{{money(row.amount_fen)}}</template></ElTableColumn><ElTableColumn prop="evidence" label="费用依据" min-width="180"/><ElTableColumn prop="reason" label="操作依据" min-width="160"/><ElTableColumn prop="confirmed_by_name" label="确认人" width="105"/><ElTableColumn prop="confirmed_at" label="确认时间" width="205"/></ElTable></template>
   <template v-else-if="mode==='draftHistory'&&selected"><p>{{selected.name}} · {{money(selected.amount_fen)}} 元 · {{selected.evidence}}</p><ElTable :data="selected.history"><ElTableColumn prop="actor_name" label="经办人" width="110"/><ElTableColumn prop="action" label="操作" width="100"/><ElTableColumn prop="reason" label="操作依据"/><ElTableColumn prop="created_at" label="时间" width="210"/></ElTable></template>
   <ElForm v-else ref="formRef" :model="form" label-position="top" novalidate @submit.prevent="submit">
    <template v-if="mode==='confirm'"><ElAlert title="确认后计入实际费用，超预算仍保留真实发生额；不会自动修改预算、结算或付款。" type="warning" :closable="false"/><p>{{selected?.kind==='void'?'撤销费用':'确认费用'}}：{{selected?.name}} · {{money(selected?.amount_fen)}} 元</p><p>{{selected?.reason||selected?.evidence}}</p><ElTable :data="selected?.allocations||[]"><ElTableColumn label="受益工作项"><template #default="{row}">{{itemName(row.execution_item_id)}}</template></ElTableColumn><ElTableColumn label="分摊金额（元）"><template #default="{row}">{{money(row.amount_fen)}}</template></ElTableColumn></ElTable></template>
    <template v-else-if="mode==='deleteDraft'"><ElAlert title="只删除编制草稿，不改变已确认费用。删除后仍可查询历史。" type="warning" :closable="false"/><ElFormItem label="删除依据" prop="reason" :rules="required('删除依据')"><ElInput v-model="form.reason" type="textarea" aria-label="删除依据"/></ElFormItem></template>
    <template v-else-if="mode==='void'||form.kind==='void'"><ElAlert title="先保存撤销草稿，管理员确认后才移出有效费用；不会删除结算和实施记录。有有效费用结算核对时，须先处理核对记录。" type="warning" :closable="false"/><p>{{form.name}} · {{form.amount_yuan}} 元</p><ElFormItem label="撤销依据" prop="reason" :rules="required('撤销依据')"><ElInput v-model="form.reason" type="textarea" aria-label="撤销依据"/></ElFormItem></template>
    <template v-else><div class="cost-fields"><ElFormItem label="费用名称" prop="name" :rules="required('费用名称')"><ElInput v-model="form.name" aria-label="费用名称"/></ElFormItem><ElFormItem label="费用类别" prop="category_id" :rules="required('费用类别')"><ElSelect v-model="form.category_id" aria-label="费用类别"><ElOption v-for="c in choices" :key="c.id" :label="c.name" :value="c.id"/></ElSelect></ElFormItem><ElFormItem label="费用金额（元）" prop="amount_yuan" :rules="amountRules"><ElInput v-model="form.amount_yuan" aria-label="费用金额（元）" inputmode="decimal"/></ElFormItem><ElFormItem label="发生日期" prop="occurred_on" :rules="required('发生日期')"><ElDatePicker v-model="form.occurred_on" aria-label="发生日期" type="date" value-format="YYYY-MM-DD" format="YYYY-MM-DD"/></ElFormItem></div><ElFormItem label="费用凭据 / 依据" prop="evidence" :rules="required('费用凭据 / 依据')"><ElInput v-model="form.evidence" type="textarea" aria-label="费用凭据 / 依据"/></ElFormItem><ElFormItem v-if="form.entry_id" label="更正依据" prop="reason" :rules="required('更正依据')"><ElInput v-model="form.reason" type="textarea" aria-label="更正依据"/></ElFormItem><h4>受益工作项与分摊</h4><p>一个工作项时整笔直接归属；多个工作项时逐项填写金额，合计必须等于费用总额。</p><div v-for="(a,index) in form.allocations" :key="index" class="cost-allocation"><ElFormItem label="受益工作项" :prop="'allocations.'+index+'.execution_item_id'" :rules="required('受益工作项')"><ElSelect v-model="a.execution_item_id" aria-label="受益工作项"><ElOption v-for="i in data?.items||[]" :key="i.id" :label="i.demand_no" :value="i.id"/></ElSelect></ElFormItem><ElFormItem v-if="form.allocations.length>1" label="分摊金额（元）" :prop="'allocations.'+index+'.amount_yuan'" :rules="amountRules"><ElInput v-model="a.amount_yuan" aria-label="分摊金额（元）"/></ElFormItem><span v-else>{{form.amount_yuan||'待填写'}} 元</span><ElButton v-if="form.allocations.length>1" link type="danger" @click="form.allocations.splice(index,1)">移除</ElButton></div><ElButton @click="form.allocations.push({execution_item_id:'',amount_yuan:''})">添加分摊工作项</ElButton></template>
    <p v-if="formError" role="alert" class="dictionary-form-error">{{formError}}</p><div class="dictionary-dialog-footer"><ElButton :disabled="busy" @click="mode=''">取消</ElButton><ElButton :type="mode==='deleteDraft'||mode==='void'?'danger':'primary'" native-type="submit" :loading="busy">{{mode==='confirm'?'确认入账':mode==='deleteDraft'?'确认删除草稿':'保存费用草稿'}}</ElButton></div>
   </ElForm>
  </ElDialog>
 </section>
</template>
<style scoped>
.cost-workspace{margin:22px 0}.cost-heading{display:flex;align-items:center;gap:10px;margin:14px 0}.cost-heading h3,.cost-heading h4{margin:0 auto 0 0}.cost-heading>.el-select{width:180px}.cost-hint{color:#8392a6;font-size:12px}.cost-fields{display:grid;grid-template-columns:1fr 1fr;gap:0 20px}.cost-allocation{display:flex;align-items:center;gap:12px;margin:10px 0}.cost-allocation>.el-form-item:first-child{width:310px}.cost-allocation>.el-form-item{width:190px}

@media(max-width:1350px){.cost-heading{flex-wrap:wrap}}
@media(max-width:900px){
 .cost-fields{grid-template-columns:minmax(0,1fr)}
 .cost-allocation{flex-wrap:wrap}
 .cost-allocation>.el-form-item:first-child,.cost-allocation>.el-form-item{max-width:100%;width:100%}
}
</style>

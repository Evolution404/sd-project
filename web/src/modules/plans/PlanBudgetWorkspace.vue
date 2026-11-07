<script setup lang="ts">
import {useResponsiveDescriptions} from '../../shared/utils/responsive-descriptions';
import {computed,reactive,ref,watch} from 'vue';
import {ElAlert,ElButton,ElDescriptions,ElDescriptionsItem,ElDialog,ElForm,ElFormItem,ElInput,ElOption,ElSelect,ElTable,ElTableColumn,ElTag,type FormInstance} from 'element-plus';
import {settlementApi as api} from '../../shared/utils/settlement-api';
import {newClientId} from '../../shared/utils/client-id';
const responsiveColumns=useResponsiveDescriptions(3);
type Row=Record<string,any>;
const props=defineProps<{executionId:string;canWrite:boolean;canConfirm:boolean;refreshKey?:number}>();
const emit=defineEmits<{changed:[]}>();
const summary=ref<Row|null>(null),selected=ref<Row|null>(null),draftDetail=ref<Row|null>(null);
const loading=ref(false),busy=ref(false),error=ref(''),notice=ref(''),formError=ref(''),amountError=ref('');
const mode=ref<''|'new'|'edit'|'release'|'deleteDraft'|'confirm'|'history'|'draftHistory'>('');
const status=ref('draft'),form=reactive<Row>({}),formRef=ref<FormInstance>();
const money=(v:number|null|undefined)=>v==null?'未核定':(v/100).toFixed(2);
const stateName=(value:string)=>({draft:'待确认',confirmed:'已确认',deleted:'已删除'} as Row)[value]||value;
const drafts=computed<Row[]>(()=>summary.value?.drafts.filter((d:Row)=>status.value==='all'||d.status===status.value)||[]);
const isRelease=computed(()=>mode.value==='release'||mode.value==='edit'&&selected.value?.kind==='release');
const amountRules=[{required:true,message:'请填写预算金额',trigger:'blur'},
 {validator:(_r:any,v:string,cb:any)=>cb(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(v)&&Number(v)>0?undefined:new Error('请输入大于零、最多两位小数的预算金额')),trigger:'blur'}];
let sequence=0;
async function refresh(){
 const request=++sequence,id=props.executionId;loading.value=true;error.value='';
 try{const data=await api('/executions/'+id+'/budget?draft_status='+status.value);if(request===sequence)summary.value=data}
 catch(e){if(request===sequence)error.value=(e as Error).message}
 finally{if(request===sequence)loading.value=false}
}
watch(()=>props.executionId,()=>{mode.value='';summary.value=null;notice.value='';status.value='draft';refresh()},{immediate:true});
watch(()=>form.amount_yuan,()=>amountError.value='');watch(status,refresh);watch(()=>props.refreshKey,refresh);
async function open(action:typeof mode.value,row?:Row){
 error.value='';formError.value='';amountError.value='';
 const id=props.executionId;
 try{
  await refresh();if(error.value||id!==props.executionId||!summary.value)return;
  selected.value=row?await api('/plan-budget-drafts/'+row.id):null;
  if(id!==props.executionId)return;
  if(action==='draftHistory')draftDetail.value=selected.value;
  const d=selected.value;
  Object.assign(form,{amount_yuan:d?money(d.amount_fen):summary.value.current?.kind==='set'?money(summary.value.current.amount_fen):'',basis:d?.basis||'',reason:'',request_key:newClientId(),
   base_budget_version:summary.value.budget_version,project_approval_version_id:summary.value.project_approval_version_id});
  mode.value=action;
 }catch(e){error.value=(e as Error).message}
}
async function submit(){
 if(busy.value||!summary.value)return;
 const action=mode.value;
 if(['new','edit','release','deleteDraft'].includes(action)&&!await formRef.value?.validate().catch(()=>false))return;
 busy.value=true;formError.value='';amountError.value='';
 try{
  if(action==='confirm')await api('/plan-budget-drafts/'+selected.value!.id+'/confirm','POST',{version:selected.value!.version,request_key:form.request_key});
  else if(action==='deleteDraft')await api('/plan-budget-drafts/'+selected.value!.id,'DELETE',{version:selected.value!.version,reason:form.reason});
  else{
   const body:Row={kind:isRelease.value?'release':'set',basis:form.basis,
    base_budget_version:form.base_budget_version,project_approval_version_id:form.project_approval_version_id};
   if(!isRelease.value)body.amount_yuan=form.amount_yuan;
   if(action==='edit'){body.version=selected.value!.version;await api('/plan-budget-drafts/'+selected.value!.id,'PATCH',body)}
   else await api('/executions/'+props.executionId+'/budget-drafts','POST',body);
  }
  mode.value='';notice.value=action==='confirm'?'预算已确认，分配额度已更新':action==='deleteDraft'?'预算草稿已删除，核定预算保持不变':'预算草稿已保存，管理员确认后生效';
  await refresh();emit('changed');
 }catch(e){const message=(e as Error).message;if(['new','edit'].includes(action)&&/金额/.test(message))amountError.value=message;else formError.value=message}
 finally{busy.value=false}
}
const stale=(d:Row)=>d.base_budget_version!==summary.value?.budget_version||d.project_approval_version_id!==summary.value?.project_approval_version_id;
</script>
<template>
 <section class="dictionary-ui plan-budget-workspace" aria-label="检修计划预算">
  <div class="budget-heading"><h3>检修计划预算</h3><ElButton :loading="loading" @click="refresh">刷新预算</ElButton></div>
  <p v-if="loading" role="status">正在读取预算</p><p v-if="error" role="alert" class="dictionary-form-error">{{error}}</p><p v-if="notice" role="status" class="dictionary-notice">{{notice}}</p>
  <template v-if="summary">
   <ElDescriptions :column="responsiveColumns" border><ElDescriptionsItem label="本计划核定预算（元）"><strong data-testid="plan-confirmed-budget">{{summary.budget_status==='released'?'已撤销（0.00）':money(summary.current?.amount_fen)}}</strong></ElDescriptionsItem><ElDescriptionsItem label="子项目批准预算（元）">{{money(summary.project_approved_budget_fen)}}</ElDescriptionsItem><ElDescriptionsItem label="子项目未分配预算（元）"><span data-testid="project-unallocated-budget">{{money(summary.project_unallocated_budget_fen)}}</span></ElDescriptionsItem><ElDescriptionsItem label="子项目已分配计划预算（元）">{{money(summary.allocated_budget_fen)}}</ElDescriptionsItem><ElDescriptionsItem label="本计划已确认净结算（元）">{{money(summary.settled_fen)}}</ElDescriptionsItem><ElDescriptionsItem label="核定预算减净结算（元）">{{summary.current?money(summary.budget_minus_settled_fen):'尚未核定预算'}}</ElDescriptionsItem><ElDescriptionsItem label="已确认实际费用（元）">{{money(summary.actual_cost_fen)}}</ElDescriptionsItem></ElDescriptions>
   <p class="budget-hint">核定预算由人工编制、管理员确认。计划结束或取消不自动释放预算；调减和撤销须重新确认。预算、结算与实际付款分别核算。</p>
   <ElAlert v-if="summary.current&&summary.budget_minus_settled_fen<0" :title="'已确认净结算超过当前计划核定预算 '+money(-summary.budget_minus_settled_fen)+' 元，请核对预算与结算依据。'" type="warning" :closable="false"/>
   <div class="budget-actions"><ElButton v-if="canWrite" type="primary" @click="open('new')">{{summary.budget_status==='active'?'编制预算调整':'编制预算'}}</ElButton><ElButton v-if="canWrite&&summary.budget_status==='active'" type="danger" plain @click="open('release')">删除当前预算</ElButton><ElButton @click="open('history')">预算历史</ElButton><ElSelect v-model="status" aria-label="预算草稿状态"><ElOption label="待确认草稿" value="draft"/><ElOption label="已确认草稿" value="confirmed"/><ElOption label="已删除草稿" value="deleted"/><ElOption label="全部草稿" value="all"/></ElSelect></div>
   <ElTable :data="drafts" row-key="id" aria-label="预算草稿列表" empty-text="暂无符合条件的预算草稿">
    <ElTableColumn label="类型" width="105"><template #default="{row}">{{row.kind==='release'?'撤销预算':'核定 / 调整'}}</template></ElTableColumn><ElTableColumn label="拟核定金额（元）" width="145" align="right"><template #default="{row}">{{money(row.amount_fen)}}</template></ElTableColumn><ElTableColumn prop="basis" label="编制依据" min-width="220"/><ElTableColumn prop="created_by_name" label="编制人" width="105"/><ElTableColumn label="状态" min-width="140"><template #default="{row}"><ElTag :type="row.status==='draft'?'warning':'info'">{{stateName(row.status)}}</ElTag><small v-if="row.status==='draft'&&stale(row)" class="budget-stale">依据已变化，需编辑核对</small></template></ElTableColumn><ElTableColumn label="操作" min-width="225"><template #default="{row}"><ElButton link type="primary" @click="open('draftHistory',row)">详情 / 历史</ElButton><template v-if="row.status==='draft'"><ElButton v-if="canWrite" link type="primary" @click="open('edit',row)">编辑</ElButton><ElButton v-if="canWrite" link type="danger" @click="open('deleteDraft',row)">删除</ElButton><ElButton v-if="canConfirm" link type="primary" @click="open('confirm',row)">核定</ElButton></template></template></ElTableColumn>
   </ElTable>
  </template>
  <ElDialog :model-value="!!mode" :title="({new:'编制计划预算',edit:'编辑预算草稿',release:'删除当前计划预算',deleteDraft:'删除预算草稿',confirm:'确认计划预算',history:'计划预算历史',draftHistory:'预算草稿详情与历史'} as Row)[mode]" width="900px" class="dictionary-ui dictionary-dialog" append-to-body align-center destroy-on-close :close-on-click-modal="false" :close-on-press-escape="!busy" :show-close="!busy" @close="!busy&&(mode='')">
   <template v-if="mode==='history'"><p>历次核定版本保留，只有最新版本计入当前预算分配。</p><ElTable :data="summary?.versions||[]" empty-text="尚无已核定预算"><ElTableColumn prop="version_no" label="版本" width="65"/><ElTableColumn label="操作" width="90"><template #default="{row}">{{row.kind==='release'?'明确撤销':'核定预算'}}</template></ElTableColumn><ElTableColumn label="原金额（元）" width="130"><template #default="{row}">{{row.previous_amount_fen==null?'首次核定':money(row.previous_amount_fen)}}</template></ElTableColumn><ElTableColumn label="核定金额（元）" width="140"><template #default="{row}">{{money(row.amount_fen)}}</template></ElTableColumn><ElTableColumn prop="basis" label="核定依据" min-width="190"/><ElTableColumn prop="confirmed_by_name" label="确认人" width="110"/><ElTableColumn prop="confirmed_at" label="确认时间" width="210"/><ElTableColumn prop="project_approval_version_no" label="项目批准版本" width="120"/></ElTable></template>
   <template v-else-if="mode==='draftHistory'&&draftDetail"><ElDescriptions :column="Math.min(2,responsiveColumns)" border><ElDescriptionsItem label="状态">{{stateName(draftDetail.status)}}</ElDescriptionsItem><ElDescriptionsItem label="金额（元）">{{money(draftDetail.amount_fen)}}</ElDescriptionsItem><ElDescriptionsItem label="依据" :span="Math.min(2,responsiveColumns)">{{draftDetail.basis}}</ElDescriptionsItem></ElDescriptions><ElTable :data="draftDetail.history"><ElTableColumn prop="actor_name" label="经办人" width="110"/><ElTableColumn label="操作" width="100"><template #default="{row}">{{({create:'创建',update:'编辑',delete:'删除',confirm:'核定'} as Row)[row.action]}}</template></ElTableColumn><ElTableColumn label="当时金额（元）" width="150"><template #default="{row}">{{money(row.after?.amount_fen)}}</template></ElTableColumn><ElTableColumn prop="reason" label="操作依据" min-width="200"/><ElTableColumn prop="created_at" label="操作时间" width="210"/></ElTable></template>
   <ElForm v-else ref="formRef" :model="form" label-position="top" novalidate @submit.prevent="submit">
    <template v-if="mode==='confirm'&&selected"><ElAlert v-if="stale(selected)" title="编制依据已变化，请先编辑草稿核对新预算和项目批准依据。" type="error" :closable="false"/><ElAlert v-else :title="selected.kind==='release'?'确认后释放本计划核定预算，结算和实施记录继续保留。':'确认后计入子项目计划预算分配；历史核定版本继续保留。'" type="warning" :closable="false"/><ElDescriptions :column="Math.min(2,responsiveColumns)" border><ElDescriptionsItem label="本次核定金额（元）">{{money(selected.amount_fen)}}</ElDescriptionsItem><ElDescriptionsItem label="本计划最多可分配（元）">{{money(summary?.max_plan_budget_fen)}}</ElDescriptionsItem><ElDescriptionsItem label="原核定金额（元）">{{summary?.current?money(summary.current.amount_fen):'未核定'}}</ElDescriptionsItem><ElDescriptionsItem label="已确认净结算（元）">{{money(summary?.settled_fen)}}</ElDescriptionsItem><ElDescriptionsItem label="核定依据" :span="Math.min(2,responsiveColumns)">{{selected.basis}}</ElDescriptionsItem></ElDescriptions></template>
    <template v-else-if="mode==='deleteDraft'"><ElAlert title="只删除此编制草稿，不改变已核定预算、不释放现有预算占用。删除记录仍可查询。" type="warning" :closable="false"/><p>拟核定金额：{{money(selected?.amount_fen)}} 元；{{selected?.basis}}</p><ElFormItem label="删除依据" prop="reason" :rules="[{required:true,whitespace:true,message:'请填写删除依据',trigger:'blur'}]"><ElInput v-model="form.reason" type="textarea" aria-label="删除依据"/></ElFormItem></template>
    <template v-else><ElAlert :title="isRelease?'保存撤销草稿后，还需管理员核定才释放预算；原预算和全部实施、结算记录保留。':'保存草稿不占用预算；管理员确认时检查各计划合计不得超过子项目批准预算。'" type="info" :closable="false"/><p>子项目批准预算 {{money(summary?.project_approved_budget_fen)}} 元 · 本计划最多可分配 {{money(summary?.max_plan_budget_fen)}} 元</p><p v-if="isRelease">当前核定预算 {{money(summary?.current?.amount_fen)}} 元，确认后为 0.00 元；净结算保持 {{money(summary?.settled_fen)}} 元。</p><ElFormItem v-else label="预算金额（元）" prop="amount_yuan" :rules="amountRules" :error="amountError"><ElInput v-model.trim="form.amount_yuan" aria-label="预算金额（元）" inputmode="decimal"/></ElFormItem><ElFormItem :label="isRelease?'撤销依据':'预算编制依据'" prop="basis" :rules="[{required:true,whitespace:true,message:isRelease?'请填写撤销依据':'请填写预算编制依据',trigger:'blur'}]"><ElInput v-model="form.basis" :aria-label="isRelease?'撤销依据':'预算编制依据'" type="textarea" :rows="3"/></ElFormItem></template>
    <p v-if="formError" role="alert" class="dictionary-form-error">{{formError}}</p><div class="dictionary-dialog-footer"><ElButton :disabled="busy" @click="mode=''">取消</ElButton><ElButton native-type="submit" :type="['deleteDraft','release'].includes(mode)?'danger':'primary'" :loading="busy">{{mode==='confirm'?'确认核定':mode==='deleteDraft'?'确认删除草稿':'保存草稿'}}</ElButton></div>
   </ElForm>
  </ElDialog>
 </section>
</template>
<style scoped>
.plan-budget-workspace{margin:22px 0;padding:18px;border:1px solid #e1e9f5;border-radius:10px;background:#fff}.budget-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:15px}.budget-heading h3{margin:0}.budget-hint{font-size:12px;color:#8291a6;margin:14px 0}.budget-actions{display:flex;align-items:center;gap:8px;margin:14px 0}.budget-actions>.el-select{width:170px;margin-left:auto}.budget-stale{display:block;color:#d98030;margin-top:5px}.plan-budget-workspace :deep(.el-descriptions__label){width:155px}

@media(max-width:1350px){
 .budget-actions{flex-wrap:wrap}
 .budget-actions>.el-select{margin-left:0;max-width:100%;flex:0 1 170px}
}
@media(max-width:900px){.plan-budget-workspace{padding:12px}.plan-budget-workspace :deep(.el-descriptions__label){width:42%}}
</style>

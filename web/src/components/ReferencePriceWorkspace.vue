<script setup lang="ts">
import {ElDialog} from 'element-plus';
import {requestApi} from '../api/client';
import {ElForm} from 'element-plus';
import {ElTable,ElTableColumn} from 'element-plus';
import {ElInput,ElCheckbox,ElRadio,ElDatePicker} from 'element-plus';
import {ElSelect,ElOption} from 'element-plus';
import {ElButton} from 'element-plus';
import {computed,onMounted,reactive,ref} from 'vue';
import StatusTag from './StatusTag.vue';
import {ElFormItem,type FormInstance} from 'element-plus';
type Row=Record<string,any>;
const props=defineProps<{items:Row[],voltage:Row[],canEdit:boolean}>();
const rows=ref<Row[]>([]),versions=ref<Row[]>([]),loading=ref(false),error=ref(''),edit=ref<Row|null>(null),dialog=ref<'new'|'revise'|'status'|'versions'|''>('');
const activeFilter=ref('active'),query=ref('');
const form=reactive<Row>({});
const editFormRef=ref<FormInstance>(),statusFormRef=ref<FormInstance>();
const required=(name:string)=>[{required:true,message:'请填写'+name,trigger:'blur'}];
const selected=(name:string)=>[{required:true,message:'请选择'+name,trigger:'change'}];
const priceRules=[...required('参考单价'),{pattern:/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/,message:'金额最多两位小数',trigger:'blur'}];
const date=()=>new Date().toLocaleDateString('en-CA');
const operations=computed(()=>props.items.filter(x=>x.type_id==='operation'&&x.status==='active'));
const units=computed(()=>props.items.filter(x=>x.type_id==='unit'&&x.status==='active'));
const filtered=computed(()=>rows.value.filter(x=>(!activeFilter.value||x.status===activeFilter.value)&&
 [x.code,x.title,x.operation_name,x.specification].some(v=>String(v||'').toLowerCase().includes(query.value.trim().toLowerCase()))));
const money=(v:number)=>(v/100).toFixed(2);
const planName=(v:string)=>({both:'通用',outage:'停电检修',non_outage:'不停电检修'} as Record<string,string>)[v]||v;
const api=(path:string,method='GET',body?:Row)=>requestApi(path,method,body);
async function refresh(){loading.value=true;error.value='';try{rows.value=await api('/reference-prices')}catch(e){error.value=(e as Error).message}finally{loading.value=false}}
function defaults(){
 Object.keys(form).forEach(k=>delete form[k]);
 Object.assign(form,{title:'',operation_id:'',unit_id:'',voltage_level_id:'',plan_type:'both',
  specification:'',unit_price_yuan:'',price_source:'',price_date:date(),tax_mode:'inclusive',
  effective_on:date(),basis:'',reason:''});
}
function openNew(){if(!props.canEdit)return;edit.value=null;defaults();dialog.value='new';error.value=''}
function openRevision(item:Row){
 if(!props.canEdit)return;
 edit.value=item;defaults();
 Object.assign(form,{unit_price_yuan:money(item.unit_price_fen),price_source:item.price_source,price_date:item.price_date,
  tax_mode:item.tax_mode,effective_on:item.effective_on,basis:item.basis,reason:''});
 dialog.value='revise';error.value='';
}
function openStatus(item:Row){if(!props.canEdit)return;edit.value=item;defaults();dialog.value='status';error.value=''}
async function openVersions(item:Row){
 edit.value=item;error.value='';
 try{versions.value=await api('/reference-prices/'+item.id+'/versions');dialog.value='versions'}catch(e){error.value=(e as Error).message}
}
async function saveValidated(formInstance:FormInstance|undefined){if(await formInstance?.validate().catch(()=>false))await save()}
async function save(){
 error.value='';
 try{
  if(dialog.value==='new')await api('/reference-prices','POST',form);
  else if(dialog.value==='revise')await api('/reference-prices/'+edit.value!.id,'PATCH',{...form,version:edit.value!.version});
  else if(dialog.value==='status')await api('/reference-prices/'+edit.value!.id+'/status','POST',{
   version:edit.value!.version,status:edit.value!.status==='active'?'inactive':'active',reason:form.reason});
  dialog.value='';edit.value=null;await refresh();
 }catch(e){error.value=(e as Error).message}
}
onMounted(refresh);
</script>
<template>
 <section class="panel">
  <div class="section-header">
   <div><h2>检修参考单价</h2><p class="muted">用于储备估算，正式预算与结算另行核定。</p></div>
   <ElButton v-if="canEdit" class="primary" @click="openNew">新增参考价</ElButton>
  </div>
  <div class="toolbar">
   <label><span class="field-caption">状态</span><ElSelect v-model="activeFilter"><ElOption :label="'启用'" data-option-value="active" value="active">启用</ElOption><ElOption :label="'全部'" data-option-value="" value="">全部</ElOption><ElOption :label="'停用'" data-option-value="inactive" value="inactive">停用</ElOption></ElSelect></label>
   <label><span class="field-caption">关键词</span><ElInput v-model.trim="query" placeholder="作业、名称或规格"/></label>
   <ElButton class="secondary" @click="refresh">刷新</ElButton>
  </div>
  <p v-if="error&&!dialog" role="alert" class="alert error">{{error}}</p>
  <p v-if="loading" class="muted">正在读取参考价目录</p>
  <div class="table-wrap"><ElTable :data="filtered" >
<ElTableColumn><template #header>名称</template><template #default="{row,$index}"><template v-for="([p]) in [[row,$index]]"><div ><strong>{{p.title}}</strong></div></template></template></ElTableColumn>
<ElTableColumn><template #header>检修操作</template><template #default="{row,$index}"><template v-for="([p]) in [[row,$index]]"><div >{{p.operation_name}}</div></template></template></ElTableColumn>
<ElTableColumn><template #header>适用范围</template><template #default="{row,$index}"><template v-for="([p]) in [[row,$index]]"><div >{{planName(p.plan_type)}} · {{p.voltage_name||'不限电压'}}<div v-if="p.specification" class="muted">{{p.specification}}</div></div></template></template></ElTableColumn>
<ElTableColumn><template #header>参考单价</template><template #default="{row,$index}"><template v-for="([p]) in [[row,$index]]"><div >{{money(p.unit_price_fen)}} 元 / {{p.unit_name}}<div class="muted">{{p.price_source}}</div></div></template></template></ElTableColumn>
<ElTableColumn><template #header>版本</template><template #default="{row,$index}"><template v-for="([p]) in [[row,$index]]"><div >v{{p.version_no}}<div class="muted">{{p.effective_on}} 起</div></div></template></template></ElTableColumn>
<ElTableColumn><template #header>状态</template><template #default="{row,$index}"><template v-for="([p]) in [[row,$index]]"><div ><StatusTag :status="p.status" :label="p.status==='active'?'启用':'停用'"/></div></template></template></ElTableColumn>
<ElTableColumn><template #header>操作</template><template #default="{row,$index}"><template v-for="([p]) in [[row,$index]]"><div ><ElButton class="link" @click="openVersions(p)">历史版本</ElButton>
      <ElButton v-if="canEdit&&p.status==='active'" class="link" @click="openRevision(p)">修订单价</ElButton>
      <ElButton v-if="canEdit" class="link" @click="openStatus(p)">{{p.status==='active'?'停用':'启用'}}</ElButton>
     </div></template></template></ElTableColumn><template #empty><div class="empty">暂无符合条件的参考价</div></template></ElTable></div>
 </section>
 <ElDialog :model-value="dialog==='new'||dialog==='revise'" :title="dialog==='new'?'新增检修参考价':'修订参考单价'"  width="860px" @close="dialog=''" class="business-modal form-panel" :destroy-on-close="true" :close-on-click-modal="true" :close-on-press-escape="true" :lock-scroll="false"><p v-if="error" class="form-modal-error" role="alert">{{error}}</p>
  <ElForm ref="editFormRef" :model="form" label-position="top" novalidate class="form-grid" @submit.prevent="saveValidated(editFormRef)">
   <template v-if="dialog==='new'">
    <ElFormItem label="价格项目名称" prop="title" :rules="required('价格项目名称')"><ElInput v-model.trim="form.title" required/></ElFormItem>
    <ElFormItem label="检修操作" prop="operation_id" :rules="selected('检修操作')"><ElSelect v-model="form.operation_id" required><ElOption :label="'请选择'" data-option-value="" value="">请选择</ElOption><ElOption :label="String(x.name)" :data-option-value="x.id" v-for="x in operations" :key="x.id" :value="x.id">{{x.name}}</ElOption></ElSelect></ElFormItem>
    <ElFormItem label="计价单位" prop="unit_id" :rules="selected('计价单位')"><ElSelect v-model="form.unit_id" required><ElOption :label="'请选择'" data-option-value="" value="">请选择</ElOption><ElOption :label="String(x.name)" :data-option-value="x.id" v-for="x in units" :key="x.id" :value="x.id">{{x.name}}</ElOption></ElSelect></ElFormItem>
    <ElFormItem label="检修方式" prop="plan_type" :rules="selected('检修方式')"><ElSelect v-model="form.plan_type" required><ElOption :label="'停电与不停电通用'" data-option-value="both" value="both">停电与不停电通用</ElOption><ElOption :label="'停电检修'" data-option-value="outage" value="outage">停电检修</ElOption><ElOption :label="'不停电检修'" data-option-value="non_outage" value="non_outage">不停电检修</ElOption></ElSelect></ElFormItem>
    <ElFormItem label="适用电压等级" prop="voltage_level_id"><ElSelect v-model="form.voltage_level_id"><ElOption :label="'不限电压等级'" data-option-value="" value="">不限电压等级</ElOption><ElOption :label="String(x.name)" :data-option-value="x.id" v-for="x in voltage.filter(x=>x.status==='active')" :key="x.id" :value="x.id">{{x.name}}</ElOption></ElSelect></ElFormItem>
    <ElFormItem class="wide" label="适用设备 / 规格说明" prop="specification"><ElInput v-model.trim="form.specification"/></ElFormItem>
   </template>
   <ElFormItem label="参考单价（元）" prop="unit_price_yuan" :rules="priceRules"><ElInput v-model.trim="form.unit_price_yuan" data-validate="money" inputmode="decimal" required/></ElFormItem>
   <ElFormItem label="税口径" prop="tax_mode"><ElSelect v-model="form.tax_mode"><ElOption :label="'含税'" data-option-value="inclusive" value="inclusive">含税</ElOption><ElOption :label="'不含税'" data-option-value="exclusive" value="exclusive">不含税</ElOption><ElOption :label="'不适用'" data-option-value="none" value="none">不适用</ElOption></ElSelect></ElFormItem>
   <ElFormItem label="价格来源" prop="price_source" :rules="required('价格来源')"><ElInput v-model.trim="form.price_source" required placeholder="定额、报价或历史结算依据"/></ElFormItem>
   <ElFormItem label="依据日期" prop="price_date" :rules="required('依据日期')"><ElDatePicker type="date" value-format="YYYY-MM-DD" format="YYYY-MM-DD" v-model="form.price_date"  required/></ElFormItem>
   <ElFormItem label="生效日期" prop="effective_on" :rules="required('生效日期')"><ElDatePicker type="date" value-format="YYYY-MM-DD" format="YYYY-MM-DD" v-model="form.effective_on"  required/></ElFormItem>
   <ElFormItem class="wide" label="价格测算说明" prop="basis" :rules="required('价格测算说明')"><ElInput type="textarea" v-model.trim="form.basis" :rows="2" required/></ElFormItem>
   <ElFormItem v-if="dialog==='revise'" class="wide" label="修订原因" prop="reason" :rules="required('修订原因')"><ElInput type="textarea" v-model.trim="form.reason" :rows="2" required/></ElFormItem>
   <div class="wide form-actions"><ElButton native-type="button" class="light" @click="dialog=''">取消</ElButton><ElButton native-type="submit" class="primary">保存{{dialog==='new'?'参考价':'新版本'}}</ElButton></div>
  </ElForm>
 </ElDialog>
 <ElDialog :model-value="dialog==='status'" :title="edit?.status==='active'?'停用参考价':'启用参考价'"  @close="dialog=''" width="620px" class="business-modal form-panel" :destroy-on-close="true" :close-on-click-modal="true" :close-on-press-escape="true" :lock-scroll="false"><p v-if="error" class="form-modal-error" role="alert">{{error}}</p>
  <ElForm ref="statusFormRef" :model="form" label-position="top" novalidate class="form-grid" @submit.prevent="saveValidated(statusFormRef)">
   <p class="wide">项目 {{edit?.title}}</p>
   <ElFormItem class="wide" label="状态变更依据" prop="reason" :rules="required('状态变更依据')"><ElInput type="textarea" v-model.trim="form.reason" required/></ElFormItem>
   <div class="wide form-actions"><ElButton native-type="button" class="light" @click="dialog=''">取消</ElButton><ElButton native-type="submit" class="primary">确认</ElButton></div>
  </ElForm>
 </ElDialog>
 <ElDialog :model-value="dialog==='versions'" :title="'价格历史：'+(edit?.title||'')" width="860px" @close="dialog=''" class="business-modal form-panel" :destroy-on-close="true" :close-on-click-modal="true" :close-on-press-escape="true" :lock-scroll="false">
  <div v-for="v in versions" :key="v.id" class="scope-item">
   <strong>v{{v.version_no}} · {{money(v.unit_price_fen)}} 元 / {{edit?.unit_name}}</strong>
   <p class="muted">来源：{{v.price_source}} · 日期 {{v.price_date}} · {{v.tax_mode==='inclusive'?'含税':v.tax_mode==='exclusive'?'不含税':'不适用'}}</p>
   <p>{{v.basis}}</p><p class="muted">修订说明：{{v.reason}}</p>
  </div>
  <div class="form-actions"><ElButton class="secondary" @click="dialog=''">关闭</ElButton></div>
 </ElDialog>
</template>

<script setup lang="ts">
import {computed,onMounted,reactive,ref} from 'vue';
import FormModal from './FormModal.vue';
import StatusTag from './StatusTag.vue';
import {vFormValidation} from '../utils/form-validation';
type Row=Record<string,any>;
const props=defineProps<{items:Row[],voltage:Row[],canEdit:boolean}>();
const rows=ref<Row[]>([]),versions=ref<Row[]>([]),loading=ref(false),error=ref(''),edit=ref<Row|null>(null),dialog=ref<'new'|'revise'|'status'|'versions'|''>('');
const activeFilter=ref('active'),query=ref('');
const form=reactive<Row>({});
const date=()=>new Date().toLocaleDateString('en-CA');
const operations=computed(()=>props.items.filter(x=>x.type_id==='operation'&&x.status==='active'));
const units=computed(()=>props.items.filter(x=>x.type_id==='unit'&&x.status==='active'));
const filtered=computed(()=>rows.value.filter(x=>(!activeFilter.value||x.status===activeFilter.value)&&
 [x.code,x.title,x.operation_name,x.specification].some(v=>String(v||'').toLowerCase().includes(query.value.trim().toLowerCase()))));
const money=(v:number)=>(v/100).toFixed(2);
const planName=(v:string)=>({both:'通用',outage:'停电检修',non_outage:'不停电检修'} as Record<string,string>)[v]||v;
async function api(path:string,method='GET',body?:Row){
 const res=await fetch('/api'+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,credentials:'same-origin'});
 const data=await res.json();
 if(!res.ok)throw Error(data.error||'业务操作失败');
 return data;
}
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
   <button v-if="canEdit" class="primary" @click="openNew">新增参考价</button>
  </div>
  <div class="toolbar">
   <label><span class="field-caption">状态</span><select v-model="activeFilter"><option value="active">启用</option><option value="">全部</option><option value="inactive">停用</option></select></label>
   <label><span class="field-caption">关键词</span><input v-model.trim="query" placeholder="作业、名称或规格"/></label>
   <button class="secondary" @click="refresh">刷新</button>
  </div>
  <p v-if="error&&!dialog" role="alert" class="alert error">{{error}}</p>
  <p v-if="loading" class="muted">正在读取参考价目录</p>
  <div class="table-wrap"><table>
   <thead><tr><th>名称</th><th>检修操作</th><th>适用范围</th><th>参考单价</th><th>版本</th><th>状态</th><th>操作</th></tr></thead>
   <tbody>
    <tr v-for="p in filtered" :key="p.id">
     <td><strong>{{p.title}}</strong></td>
     <td>{{p.operation_name}}</td>
     <td>{{planName(p.plan_type)}} · {{p.voltage_name||'不限电压'}}<div v-if="p.specification" class="muted">{{p.specification}}</div></td>
     <td>{{money(p.unit_price_fen)}} 元 / {{p.unit_name}}<div class="muted">{{p.price_source}}</div></td>
     <td>v{{p.version_no}}<div class="muted">{{p.effective_on}} 起</div></td>
     <td><StatusTag :status="p.status" :label="p.status==='active'?'启用':'停用'"/></td>
     <td><button class="link" @click="openVersions(p)">历史版本</button>
      <button v-if="canEdit&&p.status==='active'" class="link" @click="openRevision(p)">修订单价</button>
      <button v-if="canEdit" class="link" @click="openStatus(p)">{{p.status==='active'?'停用':'启用'}}</button>
     </td>
    </tr>
    <tr v-if="!filtered.length&&!loading"><td colspan="7" class="empty">暂无符合条件的参考价</td></tr>
   </tbody>
  </table></div>
 </section>
 <FormModal :open="dialog==='new'||dialog==='revise'" :title="dialog==='new'?'新增检修参考价':'修订参考单价'" :error="error" size="wide" @close="dialog=''">
  <form v-form-validation novalidate class="form-grid" @submit.prevent="save">
   <template v-if="dialog==='new'">
    <label><span class="field-caption">价格项目名称</span><input v-model.trim="form.title" required/></label>
    <label><span class="field-caption">检修操作</span><select v-model="form.operation_id" required><option value="">请选择</option><option v-for="x in operations" :key="x.id" :value="x.id">{{x.name}}</option></select></label>
    <label><span class="field-caption">计价单位</span><select v-model="form.unit_id" required><option value="">请选择</option><option v-for="x in units" :key="x.id" :value="x.id">{{x.name}}</option></select></label>
    <label><span class="field-caption">检修方式</span><select v-model="form.plan_type" required><option value="both">停电与不停电通用</option><option value="outage">停电检修</option><option value="non_outage">不停电检修</option></select></label>
    <label><span class="field-caption">适用电压等级</span><select v-model="form.voltage_level_id"><option value="">不限电压等级</option><option v-for="x in voltage.filter(x=>x.status==='active')" :key="x.id" :value="x.id">{{x.name}}</option></select></label>
    <label class="wide"><span class="field-caption">适用设备 / 规格说明</span><input v-model.trim="form.specification"/></label>
   </template>
   <label><span class="field-caption">参考单价（元）</span><input v-model.trim="form.unit_price_yuan" data-validate="money" inputmode="decimal" required/></label>
   <label><span class="field-caption">税口径</span><select v-model="form.tax_mode"><option value="inclusive">含税</option><option value="exclusive">不含税</option><option value="none">不适用</option></select></label>
   <label><span class="field-caption">价格来源</span><input v-model.trim="form.price_source" required placeholder="定额、报价或历史结算依据"/></label>
   <label><span class="field-caption">依据日期</span><input v-model="form.price_date" type="date" required/></label>
   <label><span class="field-caption">生效日期</span><input v-model="form.effective_on" type="date" required/></label>
   <label class="wide"><span class="field-caption">价格测算说明</span><textarea v-model.trim="form.basis" rows="2" required/></label>
   <label v-if="dialog==='revise'" class="wide"><span class="field-caption">修订原因</span><textarea v-model.trim="form.reason" rows="2" required/></label>
   <div class="wide form-actions"><button type="button" class="light" @click="dialog=''">取消</button><button class="primary">保存{{dialog==='new'?'参考价':'新版本'}}</button></div>
  </form>
 </FormModal>
 <FormModal :open="dialog==='status'" :title="edit?.status==='active'?'停用参考价':'启用参考价'" :error="error" @close="dialog=''">
  <form v-form-validation novalidate class="form-grid" @submit.prevent="save">
   <p class="wide">项目 {{edit?.title}}</p>
   <label class="wide"><span class="field-caption">状态变更依据</span><textarea v-model.trim="form.reason" required/></label>
   <div class="wide form-actions"><button type="button" class="light" @click="dialog=''">取消</button><button class="primary">确认</button></div>
  </form>
 </FormModal>
 <FormModal :open="dialog==='versions'" :title="'价格历史：'+(edit?.title||'')" size="wide" @close="dialog=''">
  <div v-for="v in versions" :key="v.id" class="scope-item">
   <strong>v{{v.version_no}} · {{money(v.unit_price_fen)}} 元 / {{edit?.unit_name}}</strong>
   <p class="muted">来源：{{v.price_source}} · 日期 {{v.price_date}} · {{v.tax_mode==='inclusive'?'含税':v.tax_mode==='exclusive'?'不含税':'不适用'}}</p>
   <p>{{v.basis}}</p><p class="muted">修订说明：{{v.reason}}</p>
  </div>
  <div class="form-actions"><button class="secondary" @click="dialog=''">关闭</button></div>
 </FormModal>
</template>

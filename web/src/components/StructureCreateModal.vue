<script setup lang="ts">
import {ElDialog} from 'element-plus';
import {ElForm,ElFormItem,type FormInstance} from 'element-plus';
import {ElInput,ElCheckbox,ElRadio,ElDatePicker} from 'element-plus';
import {ElSelect,ElOption} from 'element-plus';
import {ElButton} from 'element-plus';
import {computed,ref} from 'vue';
type Row=Record<string,any>;
const props=defineProps<{
 open:boolean;type:string;title:string;error:string;busy:boolean;
 form:Row;frameworks:Row[];agreements:Row[];categories:Row[];
}>();
const emit=defineEmits<{save:[];close:[]}>();
const formRef=ref<FormInstance>();
const required=(text:string)=>[{required:true,message:'请填写'+text,trigger:'blur'}];
const selected=(text:string)=>[{required:true,message:'请选择'+text,trigger:'change'}];
const moneyRules=[
 {required:true,message:'请输入授权额度',trigger:'blur'},
 {pattern:/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/,message:'金额最多两位小数',trigger:'blur'}
];
const yearRules=[{
 validator:(_rule:unknown,value:unknown,callback:(error?:Error)=>void)=>{
  const year=Number(value);
  callback(Number.isInteger(year)&&year>=2000&&year<=2100?undefined:new Error('年份必须为2000至2100之间的整数'));
 },trigger:'blur'
}];
async function submit(){
 if(props.busy)return;
 const ok=await formRef.value?.validate().catch(()=>false);
 if(ok)emit('save');
}
const availableFrameworks=computed(()=>props.frameworks.filter(x=>x.status==='active'));
const availableAgreements=computed(()=>props.agreements.filter(x=>x.status==='active'&&x.framework_id===props.form.framework_id));
</script>
<template>
 <ElDialog :model-value="open" :title="'创建'+title"  @close="emit('close')" width="620px" class="business-modal form-panel" :destroy-on-close="true" :close-on-click-modal="true" :close-on-press-escape="true" :lock-scroll="false"><p v-if="error" class="form-modal-error" role="alert">{{error}}</p>
  <ElForm ref="formRef" :model="form" label-position="top" novalidate class="form-grid" @submit.prevent="submit">
   <ElFormItem label="名称" prop="name" :rules="required('名称')"><ElInput v-model.trim="form.name" required/></ElFormItem>
   <ElFormItem v-if="type==='frameworks'" label="框架年度" prop="fiscal_year" :rules="yearRules"><ElInput v-model.number="form.fiscal_year" type="number" min="2000" max="2100" required/></ElFormItem>
   <ElFormItem v-if="type!=='projects'" label="授权额度（元）" prop="limit_yuan" :rules="moneyRules"><ElInput v-model.trim="form.limit_yuan" data-validate="money" required inputmode="decimal" placeholder="100000.00"/></ElFormItem>
   <ElFormItem v-if="type==='agreements'" label="所属框架" prop="framework_id" :rules="selected('所属框架')"><ElSelect v-model="form.framework_id" required><ElOption :label="'请选择'" data-option-value="" value="">请选择</ElOption><ElOption :label="String(f.name)" :data-option-value="f.id" v-for="f in availableFrameworks" :key="f.id" :value="f.id">{{f.name}}</ElOption></ElSelect></ElFormItem>
   <ElFormItem v-if="type==='projects'" label="所属年度框架" prop="framework_id" :rules="selected('所属年度框架')"><ElSelect v-model="form.framework_id" required @change="form.agreement_id=''"><ElOption :label="'请选择'" data-option-value="" value="">请选择</ElOption><ElOption :label="String(f.fiscal_year) + ' · ' + String(f.name)" :data-option-value="f.id" v-for="f in availableFrameworks" :key="f.id" :value="f.id">{{f.fiscal_year}} · {{f.name}}</ElOption></ElSelect></ElFormItem>
   <ElFormItem v-if="type==='projects'" label="拟归属执行协议（储备阶段可不选）" prop="agreement_id"><ElSelect v-model="form.agreement_id"><ElOption :label="'待落实'" data-option-value="" value="">待落实</ElOption><ElOption :label="String(a.name) + ' · ' + String(a.framework_name)" :data-option-value="a.id" v-for="a in availableAgreements" :key="a.id" :value="a.id">{{a.name}} · {{a.framework_name}}</ElOption></ElSelect></ElFormItem>
   <ElFormItem v-if="type==='projects'" label="储备类别" prop="category_id"><ElSelect v-model="form.category_id"><ElOption :label="'待分类'" data-option-value="" value="">待分类</ElOption><ElOption :label="String(c.name)" :data-option-value="c.id" v-for="c in categories.filter(x=>x.status==='active')" :key="c.id" :value="c.id">{{c.name}}</ElOption></ElSelect></ElFormItem>
   <div class="wide form-actions"><ElButton native-type="button" class="light" @click="emit('close')">取消</ElButton><ElButton native-type="submit" class="primary" :disabled="busy">保存</ElButton></div>
  </ElForm>
 </ElDialog>
</template>

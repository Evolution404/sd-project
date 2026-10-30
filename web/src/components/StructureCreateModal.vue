<script setup lang="ts">
import {ElDialog} from 'element-plus';
import {ElForm} from 'element-plus';
import {ElInput,ElCheckbox,ElRadio,ElDatePicker} from 'element-plus';
import {ElSelect,ElOption} from 'element-plus';
import {ElButton} from 'element-plus';
import {computed} from 'vue';
import {vFormValidation} from '../utils/form-validation';
type Row=Record<string,any>;
const props=defineProps<{
 open:boolean;type:string;title:string;error:string;busy:boolean;
 form:Row;frameworks:Row[];agreements:Row[];categories:Row[];
}>();
const emit=defineEmits<{save:[];close:[]}>();
const availableFrameworks=computed(()=>props.frameworks.filter(x=>x.status==='active'));
const availableAgreements=computed(()=>props.agreements.filter(x=>x.status==='active'&&x.framework_id===props.form.framework_id));
</script>
<template>
 <ElDialog :model-value="open" :title="'创建'+title"  @close="emit('close')" width="620px" class="business-modal form-panel" :destroy-on-close="true" :close-on-click-modal="true" :close-on-press-escape="true" :lock-scroll="false"><p v-if="error" class="form-modal-error" role="alert">{{error}}</p>
  <ElForm v-form-validation novalidate class="form-grid" @submit.prevent="emit('save')">
   <label><span class="field-caption">名称</span><ElInput v-model.trim="form.name" required/></label>
   <label v-if="type==='frameworks'"><span class="field-caption">框架年度</span><ElInput v-model.number="form.fiscal_year" type="number" min="2000" max="2100" required/></label>
   <label v-if="type!=='projects'"><span class="field-caption">授权额度（元）</span><ElInput v-model.trim="form.limit_yuan" data-validate="money" required inputmode="decimal" placeholder="100000.00"/></label>
   <label v-if="type==='agreements'"><span class="field-caption">所属框架</span><ElSelect v-model="form.framework_id" required><ElOption :label="'请选择'" data-option-value="" value="">请选择</ElOption><ElOption :label="String(f.name)" :data-option-value="f.id" v-for="f in availableFrameworks" :key="f.id" :value="f.id">{{f.name}}</ElOption></ElSelect></label>
   <label v-if="type==='projects'"><span class="field-caption">所属年度框架</span><ElSelect v-model="form.framework_id" required @change="form.agreement_id=''"><ElOption :label="'请选择'" data-option-value="" value="">请选择</ElOption><ElOption :label="String(f.fiscal_year) + ' · ' + String(f.name)" :data-option-value="f.id" v-for="f in availableFrameworks" :key="f.id" :value="f.id">{{f.fiscal_year}} · {{f.name}}</ElOption></ElSelect></label>
   <label v-if="type==='projects'"><span class="field-caption">拟归属执行协议（储备阶段可不选）</span><ElSelect v-model="form.agreement_id"><ElOption :label="'待落实'" data-option-value="" value="">待落实</ElOption><ElOption :label="String(a.name) + ' · ' + String(a.framework_name)" :data-option-value="a.id" v-for="a in availableAgreements" :key="a.id" :value="a.id">{{a.name}} · {{a.framework_name}}</ElOption></ElSelect></label>
   <label v-if="type==='projects'"><span class="field-caption">储备类别</span><ElSelect v-model="form.category_id"><ElOption :label="'待分类'" data-option-value="" value="">待分类</ElOption><ElOption :label="String(c.name)" :data-option-value="c.id" v-for="c in categories.filter(x=>x.status==='active')" :key="c.id" :value="c.id">{{c.name}}</ElOption></ElSelect></label>
   <div class="wide form-actions"><ElButton native-type="button" class="light" @click="emit('close')">取消</ElButton><ElButton native-type="submit" class="primary" :disabled="busy">保存</ElButton></div>
  </ElForm>
 </ElDialog>
</template>

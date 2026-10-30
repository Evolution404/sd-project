<script setup lang="ts">
import {computed} from 'vue';
import FormModal from './FormModal.vue';
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
 <FormModal :open="open" :title="'创建'+title" :error="error" @close="emit('close')">
  <form v-form-validation novalidate class="form-grid" @submit.prevent="emit('save')">
   <label><span class="field-caption">名称</span><input v-model.trim="form.name" required/></label>
   <label v-if="type==='frameworks'"><span class="field-caption">框架年度</span><input v-model.number="form.fiscal_year" type="number" min="2000" max="2100" required/></label>
   <label v-if="type!=='projects'"><span class="field-caption">授权额度（元）</span><input v-model.trim="form.limit_yuan" data-validate="money" required inputmode="decimal" placeholder="100000.00"/></label>
   <label v-if="type==='agreements'"><span class="field-caption">所属框架</span><select v-model="form.framework_id" required><option value="">请选择</option><option v-for="f in availableFrameworks" :key="f.id" :value="f.id">{{f.name}}</option></select></label>
   <label v-if="type==='projects'"><span class="field-caption">所属年度框架</span><select v-model="form.framework_id" required @change="form.agreement_id=''"><option value="">请选择</option><option v-for="f in availableFrameworks" :key="f.id" :value="f.id">{{f.fiscal_year}} · {{f.name}}</option></select></label>
   <label v-if="type==='projects'"><span class="field-caption">拟归属执行协议（储备阶段可不选）</span><select v-model="form.agreement_id"><option value="">待落实</option><option v-for="a in availableAgreements" :key="a.id" :value="a.id">{{a.name}} · {{a.framework_name}}</option></select></label>
   <label v-if="type==='projects'"><span class="field-caption">储备类别</span><select v-model="form.category_id"><option value="">待分类</option><option v-for="c in categories.filter(x=>x.status==='active')" :key="c.id" :value="c.id">{{c.name}}</option></select></label>
   <div class="wide form-actions"><button type="button" class="light" @click="emit('close')">取消</button><button class="primary" :disabled="busy">保存</button></div>
  </form>
 </FormModal>
</template>

<script setup lang="ts">
import {ElButton,ElCard,ElFormItem,ElInput,ElDatePicker,ElOption,ElSelect} from 'element-plus';
import {newClientId} from '../../shared/utils/client-id';
type Field=Record<string,any>;
const props=defineProps<{modelValue:Field[]}>();
const emit=defineEmits<{ 'update:modelValue':[value:Field[]] }>();
function update(index:number,patch:Field){emit('update:modelValue',props.modelValue.map((field,i)=>i===index?{...field,...patch}:field))}
function add(){emit('update:modelValue',[...props.modelValue,{key:'f'+newClientId().replaceAll('-',''),label:'',type:'text',required:false}])}
function remove(index:number){emit('update:modelValue',props.modelValue.filter((_,i)=>i!==index))}
function changeType(index:number,type:string){
 const field:Field={...props.modelValue[index],type};delete field.default;
 if(type==='select')field.options=[];else delete field.options;
 emit('update:modelValue',props.modelValue.map((old,i)=>i===index?field:old));
}
function setDefault(index:number,value:string){
 const field={...props.modelValue[index]};
 if(value==='')delete field.default;
 else field.default=field.type==='number'?(Number.isFinite(Number(value))?Number(value):value):field.type==='boolean'?value==='true':value;
 emit('update:modelValue',props.modelValue.map((old,i)=>i===index?field:old));
}
const optionsRule={validator:(_rule:unknown,value:unknown,callback:(error?:Error)=>void)=>{
 const options=Array.isArray(value)?value.map(x=>String(x).trim()).filter(Boolean):[];
 callback(!options.length?new Error('请填写可选内容，每行一个'):new Set(options).size!==options.length?new Error('可选内容不能重复'):undefined);
},trigger:'blur'};
</script>
<template>
 <section class="dictionary-field-editor"><div class="dictionary-field-editor-heading"><strong>附加业务字段</strong><ElButton type="primary" link :disabled="modelValue.length>=50" @click="add">＋ 添加业务字段</ElButton></div><p class="dictionary-field-hint">按需添加设备规格、相位等内容，字段名称和选项以后可以调整。</p>
  <ElCard v-for="(field,index) in modelValue" :key="field.key" shadow="never" class="dictionary-custom-field"><template #header><div class="dictionary-field-editor-heading"><strong>字段 {{index+1}}</strong><ElButton link type="danger" :aria-label="'移除字段 '+(index+1)" @click="remove(index)">移除</ElButton></div></template>
   <div class="dictionary-form-grid"><ElFormItem label="字段名称" :prop="'fields.'+index+'.label'" :rules="[{required:true,whitespace:true,message:'请填写字段名称',trigger:'blur'}]"><ElInput :model-value="field.label" aria-label="字段名称" maxlength="80" @update:model-value="update(index,{label:$event})"/></ElFormItem>
    <ElFormItem label="填写方式"><ElSelect :model-value="field.type" aria-label="填写方式" @update:model-value="changeType(index,$event)"><ElOption value="text" label="文本"/><ElOption value="number" label="数字"/><ElOption value="select" label="下拉选择"/><ElOption value="boolean" label="是 / 否"/><ElOption value="date" label="日期"/></ElSelect></ElFormItem>
    <ElFormItem label="是否必填"><ElSelect :model-value="!!field.required" aria-label="是否必填" @update:model-value="update(index,{required:$event})"><ElOption :value="false" label="选填"/><ElOption :value="true" label="必填"/></ElSelect></ElFormItem>
    <ElFormItem label="默认值"><ElSelect v-if="field.type==='select'||field.type==='boolean'" :model-value="field.default===undefined?'':String(field.default)" aria-label="默认值" @update:model-value="setDefault(index,$event)"><ElOption value="" label="不设默认"/><template v-if="field.type==='boolean'"><ElOption value="true" label="是"/><ElOption value="false" label="否"/></template><template v-else><ElOption v-for="(option,i) in field.options" :key="i" :value="option" :label="option"/></template></ElSelect><ElDatePicker v-else-if="field.type==='date'" :model-value="field.default??''" type="date" value-format="YYYY-MM-DD" format="YYYY-MM-DD" aria-label="默认值" placeholder="可留空" @update:model-value="setDefault(index,$event||'')"/><ElInput v-else :model-value="field.default??''" aria-label="默认值" :inputmode="field.type==='number'?'decimal':undefined" placeholder="可留空" @update:model-value="setDefault(index,$event)"/></ElFormItem>
    <ElFormItem v-if="field.type==='select'" label="可选内容（每行一个）" :prop="'fields.'+index+'.options'" :rules="[optionsRule]" required class="dictionary-form-wide"><ElInput :model-value="(field.options||[]).join('\n')" aria-label="可选内容（每行一个）" type="textarea" :rows="3" @update:model-value="update(index,{options:$event.split(/\r?\n/)})"/></ElFormItem>
   </div>
  </ElCard>
 </section>
</template>

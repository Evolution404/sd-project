<script setup lang="ts">
import {ElInput,ElSelect,ElOption,ElCheckbox,ElDatePicker} from 'element-plus';
type Rec=Record<string,any>;
const props=defineProps<{definitions:Rec[],modelValue:Rec,disabled?:boolean,prefix?:string}>();
const emit=defineEmits<{(event:'update:modelValue',value:Rec):void}>();
function set(key:string,value:any){emit('update:modelValue',{...props.modelValue,[key]:value})}
</script>
<template>
 <div v-if="definitions.length" class="form-grid custom-fields">
  <label v-for="field in definitions" :key="field.key">
   <span class="field-caption">{{prefix||''}}{{field.label}}<span v-if="field.required" class="required-star" aria-hidden="true"> *</span></span>
   <ElSelect v-if="field.type==='select'" :model-value="modelValue[field.key]??''" :disabled="disabled" :aria-label="(prefix||'')+field.label" :aria-required="!!field.required" filterable clearable @update:model-value="v=>set(field.key,v)">
    <ElOption label="请选择" value=""/>
    <ElOption v-for="option in field.options" :key="option" :label="String(option)" :data-option-value="String(option)" :value="option"/>
   </ElSelect>
   <ElCheckbox v-else-if="field.type==='boolean'" :model-value="modelValue[field.key]===true" :disabled="disabled" :aria-label="(prefix||'')+field.label" @change="v=>set(field.key,!!v)"/>
   <ElDatePicker v-else-if="field.type==='date'" type="date" value-format="YYYY-MM-DD" :model-value="modelValue[field.key]??''" :disabled="disabled" :aria-label="(prefix||'')+field.label" @update:model-value="v=>set(field.key,v)"/>
   <ElInput v-else :model-value="String(modelValue[field.key]??'')" :disabled="disabled" :required="!!field.required" :type="field.type==='number'?'number':'text'" :step="field.type==='number'?'any':undefined" :aria-label="(prefix||'')+field.label" @update:model-value="v=>set(field.key,field.type==='number'&&v!==''?Number(v):v)"/>
  </label>
 </div>
</template>

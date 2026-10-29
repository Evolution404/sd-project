<script setup lang="ts">
type Rec=Record<string,any>;
const props=defineProps<{definitions:Rec[],modelValue:Rec,disabled?:boolean,prefix?:string}>();
const emit=defineEmits<{(event:'update:modelValue',value:Rec):void}>();
function set(key:string,value:any){emit('update:modelValue',{...props.modelValue,[key]:value})}
</script>
<template>
 <div class="form-grid custom-fields" v-if="definitions.length">
  <label v-for="field in definitions" :key="field.key"><span class="field-caption">{{prefix||''}}{{field.label}}<span v-if="field.required" class="required-star" aria-hidden="true"> *</span></span><select :required="!!field.required" v-if="field.type==='select'" :aria-label="(prefix||'')+field.label" :value="modelValue[field.key]??''" :disabled="disabled" @change="set(field.key,($event.target as HTMLSelectElement).value)"><option value="">请选择</option><option v-for="option in field.options" :key="option" :value="option">{{option}}</option></select>
   <input v-else-if="field.type==='boolean'" type="checkbox" :aria-label="(prefix||'')+field.label" :checked="modelValue[field.key]===true" :disabled="disabled" @change="set(field.key,($event.target as HTMLInputElement).checked)"/>
   <input v-else :required="!!field.required" :type="field.type==='number'?'number':field.type==='date'?'date':'text'" :step="field.type==='number'?'any':undefined" :aria-label="(prefix||'')+field.label" :value="modelValue[field.key]??''" :disabled="disabled" @input="set(field.key,field.type==='number'&&($event.target as HTMLInputElement).value!==''?Number(($event.target as HTMLInputElement).value):($event.target as HTMLInputElement).value)"/>
  </label>
 </div>
</template>

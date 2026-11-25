<template>
  <div class="w-full">
    <el-descriptions v-if="selected" border :column="2" class="mb-2">
      <el-descriptions-item v-for="column in columns" :key="column.key" :label="column.label">{{selected[column.key] ?? "—"}}</el-descriptions-item>
    </el-descriptions>
    <el-space wrap>
      <el-button :disabled="disabled" @click="open=true">选择{{title}}</el-button>
      <el-button v-if="clearable && modelValue" :disabled="disabled" @click="choose([])">清空</el-button>
    </el-space>
    <NativeRecordPicker v-if="open" single :title="'选择'+title" placeholder="搜索设备" confirm-label="确认选择"
      :columns="columns" :loader="load" :selectable="canSelect" @confirm="choose" @close="open=false"/>
  </div>
</template>
<script setup lang="ts">
import {computed,ref,watch} from "vue";
import NativeRecordPicker from "./NativeRecordPicker.vue";
import { equipmentReferenceColumns } from "./equipment-reference-columns";
import {getEquipment,listEquipment,type EquipmentRow,type EquipmentKind} from "@/api/business/equipment";
const props=defineProps<{modelValue?:string|null;kind:EquipmentKind;title:string;lineId?:string;mainOnly?:boolean;clearable?:boolean;disabled?:boolean}>();
const emit=defineEmits<{"update:modelValue":[value:string|null]}>();
const open=ref(false),selected=ref<EquipmentRow>();
let generation=0;
const columns=computed(() => equipmentReferenceColumns(props.kind));
watch(()=>[props.kind,props.modelValue] as const,async ([kind,id])=>{
  const token=++generation;
  if(!id){selected.value=undefined;return}
  if(selected.value?.id===id)return;
  selected.value=undefined;
  try{const row=await getEquipment(kind,id,true);if(token===generation)selected.value=row}catch{if(token===generation)selected.value=undefined}
},{immediate:true});
function load(keyword:string,page:number){return listEquipment(props.kind,{page,size:20,keyword,lineId:props.lineId,lineKind:props.mainOnly?"main":undefined,filters:{status:"active"}})}
function canSelect(row:EquipmentRow){return !row.deleted&&row.status==="active"&&(!props.lineId||row.line_id===props.lineId)&&(!props.mainOnly||row.line_kind==="main")}
function choose(rows:EquipmentRow[]){selected.value=rows[0];open.value=false;emit("update:modelValue",rows[0]?.id??null)}
</script>

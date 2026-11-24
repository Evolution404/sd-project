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
import {getEquipment,listEquipment,type EquipmentRow,type EquipmentKind} from "@/api/business/equipment";
const props=defineProps<{modelValue?:string|null;kind:EquipmentKind;title:string;lineId?:string;mainOnly?:boolean;clearable?:boolean;disabled?:boolean}>();
const emit=defineEmits<{"update:modelValue":[value:string|null]}>();
const open=ref(false),selected=ref<EquipmentRow>();
let generation=0;
const columns=computed<{key:keyof EquipmentRow;label:string;width?:number}[]>(()=>props.kind==="lines"?[
  {key:"name",label:"线路名称",width:180},{key:"voltage_level_name",label:"电压等级"},{key:"line_code",label:"线路编号"}
]:props.kind==="physical"?[
  {key:"tower_code",label:"物理杆塔编号"},{key:"asset_no",label:"现场铭牌"},{key:"tower_material_label",label:"杆塔材质"},{key:"model",label:"型号"}
]:[
  {key:"line_id_label",label:"所属线路",width:180},{key:"voltage_level_name",label:"电压等级"},{key:"tower_no",label:"杆塔号"},{key:"logical_code",label:"逻辑杆塔编号"}
]);
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

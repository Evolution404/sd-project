<script setup lang="ts">
import { computed, ref } from "vue";
import { exactScaledDecimalText, formatScaledDecimal, quantityFitsUnitPrecision } from "../../../shared/utils/fixed-scale";
import type { MaterialDraft } from "../types/demand";
import BusinessDraftGrid, { type DraftGridColumn } from "../../../shared/ui/BusinessDraftGrid.vue";
import DemandMaterialPicker from "./DemandMaterialPicker.vue";

const props = defineProps<{ rows: MaterialDraft[] }>();
const emit = defineEmits<{
  add: [rows: MaterialDraft[]];
  remove: [ids: string[]];
  invalid: [id: string, value: boolean];
}>();
const selected = ref<string[]>([]);
const opening = ref(false);
const grid = ref<{undo:()=>void;redo:()=>void}|null>(null);
const invalidTexts=ref<Record<string,string>>({});
const draftRows=computed(()=>props.rows.map(row=>({
  id:row.id,name:row.name,model:row.model,specification:row.specification,
  quantity_text:formatScaledDecimal(row.quantity_scaled,4),
  unit:row.unit,
})));
const columns:DraftGridColumn[]=[
  {field:"name",title:"物资名称",minWidth:175},
  {field:"model",title:"型号",minWidth:130},
  {field:"specification",title:"规格",minWidth:130},
  {field:"quantity_text",title:"预计数量",minWidth:165,editable:true},
  {field:"unit",title:"计量单位",minWidth:115},
];
function onChange(id:string,field:string,text:string) {
  if(field!=="quantity_text")return;
  const row=props.rows.find(item=>item.id===id);
  if(!row)return;
  const scaled=exactScaledDecimalText(text,4);
  let error="";
  if(!text.trim())error="预计数量不能为空";
  else if(scaled===null)error="数量格式不正确，最多允许4位小数且不能超过安全整数";
  else if(!quantityFitsUnitPrecision(scaled,row.precision??-1))
    error=row.precision===0?"此物资计量单位只能填写整数数量":
      row.precision===undefined?"正式单位数量精度未确定":"此物资最多允许"+row.precision+"位小数";
  if(error) invalidTexts.value={...invalidTexts.value,[id]:error};
  else {
    const next={...invalidTexts.value};delete next[id];invalidTexts.value=next;
    row.quantity_scaled=scaled!;
  }
  emit("invalid",id,Boolean(error));
}
function removeSelection() {
  emit("remove",selected.value);
  selected.value=[];
}
</script>
<template>
  <div class="toolbar">
    <ElButton data-guide-action="demands.material" @click="opening=true">添加预计物资</ElButton>
    <ElButton data-guide-action="demands.material-remove" :disabled="!selected.length" type="danger" plain
      @click="removeSelection">移除选中物资</ElButton>
    <ElButton :disabled="!rows.length" @click="grid?.undo()">撤销单元格编辑</ElButton>
    <ElButton :disabled="!rows.length" @click="grid?.redo()">重做单元格编辑</ElButton>
    <span class="muted">双击预计数量编辑 · 支持从 Excel 粘贴多行数据 · 保存时生成正式需求版本</span>
  </div>
  <BusinessDraftGrid ref="grid" :rows="draftRows" :columns="columns" :errors="invalidTexts"
    grid-key="demand:materials-editor" @change="onChange" @selection-change="selected=$event"/>
  <DemandMaterialPicker v-model:open="opening" :existing="rows" @add="emit('add',$event)"/>
</template>

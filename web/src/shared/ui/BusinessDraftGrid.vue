<script setup lang="ts">
import { computed, h, nextTick, onBeforeUnmount, onMounted, ref, render, shallowRef, watch } from "vue";
import { ElButton, ElMessage } from "element-plus";
import { TabulatorFull as Tabulator, type ColumnDefinition } from "tabulator-tables";

export interface DraftGridColumn {
  field: string;
  title: string;
  width?: number;
  minWidth?: number;
  editable?: boolean;
}
export interface DraftGridRow {
  id: string;
  [key: string]: string | number | boolean | null | undefined;
}
const props = defineProps<{
  rows: DraftGridRow[];
  columns: DraftGridColumn[];
  errors?: Record<string,string>;
  gridKey: string;
  mode?: "view" | "edit";
}>();
const emit = defineEmits<{
  (e:"change", id:string, field:string, value:string):void;
  (e:"selection-change", ids:string[]):void;
}>();
const host=ref<HTMLElement>();
const table=shallowRef<Tabulator | null>(null);
const renderedControls=new Set<HTMLElement>();
function mountControl(vnode:Parameters<typeof render>[0],container:HTMLElement){
  render(vnode,container);renderedControls.add(container);
}
function unmountControls(){
  for(const container of renderedControls)render(null,container);
  renderedControls.clear();
}

const selectedIds=ref<string[]>([]);
const editables=computed(()=>props.columns.filter(column=>column.editable).map(column=>column.field));
const signature=computed(()=>props.rows.map(row=>row.id).join("|"));
let baseline=new Map<string,Record<string,string>>();
let initialized=false;
function copyRows(){return props.rows.map(row=>({...row}));}
function snapshot(rows:DraftGridRow[]) {
  baseline=new Map(rows.map(row=>[row.id,Object.fromEntries(editables.value.map(field=>[field,String(row[field]??"")]))]));
}
function syncChanges(data:unknown[]){
  if(!initialized || props.mode!=="edit")return;
  for(const item of data) {
    if(!item || typeof item!=="object" || !("id" in item))continue;
    const row=item as DraftGridRow;
    const previous=baseline.get(String(row.id));
    if(!previous)continue;
    for(const field of editables.value){
      const value=String(row[field]??"");
      if(previous[field]!==value) {
        previous[field]=value;
        emit("change",String(row.id),field,value);
      }
    }
  }
}
function onRowSelectPointer(event:PointerEvent) {
  if(event.button!==0 || props.mode!=="edit")return;
  const button=(event.target as HTMLElement).closest<HTMLElement>("[data-grid-select-id]");
  if(!button)return;
  event.preventDefault();
  event.stopPropagation();
  const key=button.dataset.gridSelectId;
  if(!key)return;
  const selected=new Set(selectedIds.value);
  if(selected.has(key))selected.delete(key);else selected.add(key);
  selectedIds.value=[...selected];
  emit("selection-change",selectedIds.value);
  table.value?.redraw();
}
/** Only permit paste into existing, contiguous writable draft columns and rows. */
function guardPaste(event:ClipboardEvent){
  if(props.mode!=="edit")return;
  const instance=table.value;
  const range=instance?.getRanges()[0];
  const clipboard=event.clipboardData?.getData("text/plain");
  if(!instance || !range || clipboard===undefined)return;
  const columns=instance.getColumns().filter(column=>column.isVisible());
  const startField=range.getColumns()[0]?.getField();
  const startColumn=columns.findIndex(column=>column.getField()===startField);
  const allRows=instance.getRows();
  const firstRow=range.getRows()[0];
  const startRow=allRows.findIndex(row=>String(row.getIndex())===String(firstRow?.getIndex()));
  const lines=clipboard.replace(/\r\n/g,"\n").replace(/\r/g,"\n").replace(/\n$/,"").split("\n");
  const width=Math.max(...lines.map(line=>line.split("\t").length));
  const fields=columns.slice(startColumn,startColumn+width).map(column=>column.getField());
  const allowed=new Set(editables.value);
  if(startColumn<0 || startRow<0 || fields.length!==width ||
    startRow+lines.length>allRows.length || fields.some(field=>!allowed.has(field))){
    event.preventDefault();
    event.stopImmediatePropagation();
    ElMessage.error("粘贴范围包含只读字段或超出已有明细。请从可编辑列开始粘贴，并保证有足够的行");
  }
}
function columns():ColumnDefinition[] {
  const selector:ColumnDefinition={
    title:"选择",field:"__business_select",minWidth:46,width:58,resizable:false,headerSort:false,
    editable:false,
    formatter:cell=>{
      const id=String(cell.getRow().getData().id);
      const container=document.createElement("span");
      mountControl(h(ElButton,{
        text:true,size:"small",class:"draft-select-row",
        "data-grid-select-id":id,role:"checkbox",
        "aria-label":"选择"+String(cell.getRow().getData().name||"明细"),
        "aria-checked":String(selectedIds.value.includes(id))
      },()=>selectedIds.value.includes(id)?"☑":"☐"),container);
      return container;
    }
  };
  return [...(props.mode==="edit"?[selector]:[]),...props.columns.map((column):ColumnDefinition=>({
    field:column.field,title:column.title,
    width:column.width,minWidth:column.minWidth??125,
    resizable:true,headerSort:false,editable:props.mode==="edit"&&Boolean(column.editable),
    editor:props.mode==="edit"&&column.editable?"input":undefined,
    formatter:props.mode==="edit"&&column.editable?undefined:"plaintext",
    cssClass:props.mode==="edit"&&column.editable?"business-draft-editable":"business-draft-readonly",
  }))];
}
function replaceRows(){
  if(!table.value)return;
  unmountControls();
  const rows=copyRows();snapshot(rows);
  selectedIds.value=selectedIds.value.filter(id=>rows.some(row=>row.id===id));
  emit("selection-change",selectedIds.value);
  void table.value.setData(rows);
}
function undo(){table.value?.undo();}
function redo(){table.value?.redo();}
onMounted(async()=>{
  await nextTick();
  if(!host.value)return;
  const rows=copyRows();snapshot(rows);
  const instance=new Tabulator(host.value,{
    index:"id",data:rows,columns:columns(),layout:"fitColumns",
    height:"auto",placeholder:"暂无明细",editTriggerEvent:"dblclick",
    selectableRows:false,
    selectableRange:props.mode==="edit"?1:false,
    selectableRangeColumns:props.mode==="edit",selectableRangeRows:props.mode==="edit",
    selectableRangeClearCells:false,
    clipboard:props.mode==="edit",clipboardCopyRowRange:"range",
    clipboardPasteParser:"range",clipboardPasteAction:"range",
    clipboardCopyConfig:{columnHeaders:false,rowHeaders:false},clipboardCopyStyled:false,
    history:props.mode==="edit",
  });
  instance.on("dataChanged",data=>syncChanges(data));
  instance.on("historyUndo",()=>syncChanges(instance.getData()));
  instance.on("historyRedo",()=>syncChanges(instance.getData()));
  table.value=instance;initialized=true;
});
onBeforeUnmount(()=>{initialized=false;unmountControls();table.value?.destroy();table.value=null;});
watch(signature,replaceRows);
defineExpose({undo,redo});
</script>
<template>
  <div class="business-draft-grid" :class="mode === 'edit' ? 'is-editing' : 'is-viewing'" :data-grid-key="gridKey">
    <div ref="host" class="business-draft-host" aria-label="Excel式草稿编辑表" @pointerdown.capture="onRowSelectPointer" @paste.capture="guardPaste"></div>
    <div v-if="errors && Object.keys(errors).length" class="business-draft-errors" role="alert">
      <div v-for="(error,id) in errors" :key="id">{{ rows.find(row=>row.id===id)?.name??id }} · {{ error }}</div>
    </div>
  </div>
</template>
<style scoped>
.business-draft-grid{width:100%;min-width:0}
.business-draft-host{width:100%;overflow:hidden;border:1px solid var(--edge);border-radius:8px;font-size:13px}
.business-draft-grid :deep(.tabulator){
  background:var(--surface);color:var(--ink);border:0;font:inherit;
}
.business-draft-grid :deep(.tabulator-header),
.business-draft-grid :deep(.tabulator-header .tabulator-col){
  background:var(--table-heading)!important;
  color:var(--table-heading-ink)!important;
  border-color:var(--edge)!important;
}
.business-draft-grid :deep(.tabulator-col-title){
  color:var(--table-heading-ink)!important;
  font-size:13px;font-weight:600;
}
.business-draft-grid :deep(.tabulator .tabulator-row){
  background:var(--surface)!important;color:var(--ink)!important;
  border-bottom:1px solid var(--edge)!important;min-height:42px;
}
.business-draft-grid :deep(.tabulator .tabulator-row-even){
  background:var(--surface-subtle)!important;
}
.business-draft-grid :deep(.tabulator .tabulator-row:hover){
  background:var(--table-row-hover)!important;
}
.business-draft-grid :deep(.tabulator .tabulator-cell){
  background:transparent!important;color:var(--ink)!important;
  border-right:1px solid var(--edge)!important;
  padding:10px 12px;vertical-align:middle;
}
.business-draft-grid.is-editing :deep(.business-draft-editable){
  background:transparent!important;color:var(--ink)!important;
  font-weight:400;cursor:cell;
}
.business-draft-grid.is-editing :deep(.business-draft-editable:hover){
  background:var(--brand-soft)!important;
}
.business-draft-grid.is-editing :deep(.tabulator .tabulator-cell.tabulator-range-selected){
  outline:2px solid var(--brand-primary);outline-offset:-2px;
}
.business-draft-grid :deep(.tabulator-cell[tabulator-field="quantity_text"]){
  font-variant-numeric:tabular-nums;
}
.business-draft-grid :deep(.draft-select-row){
  color:var(--brand-primary);padding:2px 8px;font-size:18px;
}
.business-draft-errors{color:var(--el-color-danger);font-size:12px;padding:8px 2px}
</style>

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
  if(!initialized)return;
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
  if(event.button!==0)return;
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
  return [selector,...props.columns.map((column):ColumnDefinition=>({
    field:column.field,title:column.title,
    width:column.width,minWidth:column.minWidth??125,
    resizable:true,headerSort:false,editable:column.editable ?? false,
    editor:column.editable?"input":undefined,
    formatter:column.editable?undefined:"plaintext",
    cssClass:column.editable?"business-draft-editable":"business-draft-readonly",
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
    selectableRange:1,selectableRangeColumns:true,selectableRangeRows:true,
    selectableRangeClearCells:false,
    clipboard:true,clipboardCopyRowRange:"range",clipboardPasteParser:"range",clipboardPasteAction:"range",
    clipboardCopyConfig:{columnHeaders:false,rowHeaders:false},clipboardCopyStyled:false,
    history:true,
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
  <div class="business-draft-grid" :data-grid-key="gridKey">
    <div ref="host" class="business-draft-host" aria-label="Excel式草稿编辑表" @pointerdown.capture="onRowSelectPointer" @paste.capture="guardPaste"></div>
    <div v-if="errors && Object.keys(errors).length" class="business-draft-errors" role="alert">
      <div v-for="(error,id) in errors" :key="id">{{ rows.find(row=>row.id===id)?.name??id }} · {{ error }}</div>
    </div>
  </div>
</template>
<style scoped>
.business-draft-grid{width:100%;min-width:0}
.business-draft-host{width:100%;border:1px solid var(--edge);border-radius:7px;font-size:13px}
.business-draft-grid :deep(.tabulator){background:var(--surface);color:var(--ink);border:0;font-family:inherit}
.business-draft-grid :deep(.tabulator-header),.business-draft-grid :deep(.tabulator-col){background:var(--table-heading)!important;color:var(--table-heading-ink);border-color:var(--edge)}
.business-draft-grid :deep(.tabulator-row){background:var(--surface);color:var(--ink);border-bottom:1px solid var(--edge)}
.business-draft-grid :deep(.tabulator-row-even){background:var(--surface-subtle)}
.business-draft-grid :deep(.tabulator-row:hover){background:var(--table-row-hover)}
.business-draft-grid :deep(.tabulator-cell){border-color:var(--edge)}
.business-draft-grid :deep(.business-draft-editable){color:var(--brand-primary);font-weight:600;background:var(--brand-soft)}
.business-draft-grid :deep(.tabulator-cell[tabulator-field="quantity_text"]){font-variant-numeric:tabular-nums}
.business-draft-grid :deep(.draft-select-row){border:0;background:transparent;color:var(--brand-primary);padding:2px 8px;font-size:18px;cursor:pointer}
.business-draft-errors{color:var(--el-color-danger);font-size:12px;padding:8px 2px}
</style>

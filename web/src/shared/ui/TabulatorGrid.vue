<script setup lang="ts" generic="TRow extends { id: string }">
import { computed, h, nextTick, onBeforeUnmount, onMounted, ref, render, shallowRef, watch } from "vue";
import { ElButton } from "element-plus";
import { TabulatorFull as Tabulator, type ColumnDefinition, type CellComponent } from "tabulator-tables";
import { formatVisibleDateTime } from "../utils/datetime";
import ExcelColumnFilter, { type FacetPage, type FacetValue } from "./ExcelColumnFilter.vue";

export interface GridColumn {
  key: string;
  label: string;
  minWidth?: number;
  /** Server projection key used for sorting and filtering (defaults to key). */
  queryKey?: string;
  hideable?: boolean;
  defaultVisible?: boolean;
}
type Preference = { order: string[]; hidden: string[]; widths: Record<string,number> };
const props = defineProps<{
  rows: TRow[];
  columns: GridColumn[];
  tableKey: string;
  loading?: boolean;
  detailColumn?: string;
  sortKey?: string;
  sortDirection?: "asc" | "desc" | "";
  filters: Record<string,(FacetValue)[]>;
  getValues: (field: string, term: string, offset: number) => Promise<FacetPage>;
}>();
const emit = defineEmits<{
  (e:"open-detail", row: TRow):void;
  (e:"sort-change", value:{key:string;direction:"asc"|"desc"|""}):void;
  (e:"filter-change", filters:Record<string,FacetValue[]>):void;
  (e:"clear-search"):void;
}>();
const host = ref<HTMLElement>();
const table = shallowRef<Tabulator | null>(null);
const renderedControls=new Set<HTMLElement>();
function mountControl(vnode:Parameters<typeof render>[0],container:HTMLElement){
  render(vnode,container);renderedControls.add(container);
}
function unmountControls(){
  for(const container of renderedControls)render(null,container);
  renderedControls.clear();
}
function unmountRowControls(){
  for(const container of renderedControls){
    if(!container.classList.contains("grid-row-control"))continue;
    render(null,container);renderedControls.delete(container);
  }
}

const settings = ref(false);
const activeFilter = ref<GridColumn | null>(null);
const filterCoords = ref({left:0,top:0});
const pref = ref<Preference>({order:[],hidden:[],widths:{}});
const allColumns = computed(() => [...props.columns].sort((a,b) => {
  const ai=pref.value.order.indexOf(a.key),bi=pref.value.order.indexOf(b.key);
  return (ai<0?999:ai)-(bi<0?999:bi);
}));
function readPref() {
  try {
    const saved = JSON.parse(localStorage.getItem("sd-grid:" + props.tableKey) || "null") as Preference | null;
    pref.value = saved && Array.isArray(saved.order) && Array.isArray(saved.hidden) && saved.widths
      ? saved : {order:[],hidden:props.columns.filter(c=>c.defaultVisible===false).map(c=>c.key),widths:{}};
  } catch {
    pref.value={order:[],hidden:[],widths:{}};
  }
}
function savePref() {localStorage.setItem("sd-grid:" + props.tableKey,JSON.stringify(pref.value));}
function switchColumn(key:string, show:boolean) {
  const col=props.columns.find(c=>c.key===key);
  if (!col || col.hideable===false) return;
  const hidden=new Set(pref.value.hidden);
  if(show) hidden.delete(key); else hidden.add(key);
  if (!props.columns.some(c=>!hidden.has(c.key))) return;
  pref.value.hidden=[...hidden];savePref();buildColumns();
}
function moveColumn(key:string,diff:number) {
  const order=allColumns.value.map(c=>c.key),i=order.indexOf(key),target=i+diff;
  if (target<0 || target>=order.length) return;
  order.splice(i,1);order.splice(target,0,key);
  pref.value.order=order;savePref();buildColumns();
}
function filterAnchor(button:HTMLElement, col:GridColumn) {
  activeFilter.value=col;
  const rect=button.getBoundingClientRect();
  const width=Math.min(330,window.innerWidth-22);
  filterCoords.value={left:Math.max(10,Math.min(window.innerWidth-width-10,rect.right-width)),top:Math.min(window.innerHeight-400,rect.bottom+6)};
  if (filterCoords.value.top<10) filterCoords.value.top=10;
}
function buildColumn(column:GridColumn):ColumnDefinition {
  const viewKey=column.key;
  return {
    field:viewKey,title:column.label,minWidth:column.minWidth ?? 125,
    width:pref.value.widths[viewKey],visible:column.hideable===false || !pref.value.hidden.includes(viewKey),
    headerSort:false,resizable:true,editable:false,
    titleFormatter:()=>{
      const root=document.createElement("span");root.className="grid-header-title";
      const text=document.createElement("span");text.textContent=column.label;root.append(text);
      const button=document.createElement("span");
      button.className="grid-filter-container";
      button.dataset.gridFilter=viewKey;
      mountControl(h(ElButton,{
        text:true,size:"small",
        class:["grid-filter-trigger",...(props.filters[column.queryKey ?? viewKey]!==undefined?["is-active"]:[])],
        "aria-label":"筛选"+column.label,
        onPointerdown:(event:PointerEvent)=>{event.stopPropagation();filterAnchor(button,column);}
      },()=> "▾"),button);
      root.append(button);return root;
    },
    formatter:(cell:CellComponent)=>{
      const row=cell.getRow().getData() as TRow;
      const value=column.key==="unit_id" ? Reflect.get(row,"unit_id_label") : cell.getValue();
      if(column.key==="status"){
        const tag=document.createElement("span");tag.className="grid-status";
        tag.textContent=Reflect.get(row,"deleted")?"已删除":value==="active"?"有效":"停用";
        return tag;
      }
      if(column.key===props.detailColumn){
        const container=document.createElement("span");
        container.className="grid-row-control";
        mountControl(h(ElButton,{
          type:"primary",link:true,
          class:"cell-link grid-detail-link",
          "data-grid-record-id":row.id
        },()=>String(value??"—")),container);
        return container;
      }
      const span=document.createElement("span");
      span.textContent=String(formatVisibleDateTime(value,column.key)??"—");
      return span;
    },
  };
}
function buildColumns(){
  unmountControls();
  const definitions=allColumns.value.map(buildColumn);
  if(table.value) table.value.setColumns(definitions);
}
function onGridDetailPointer(event: PointerEvent) {
  if (event.button !== 0) return;
  const source=event.target as HTMLElement;
  const button=source.closest<HTMLElement>(".grid-detail-link");
  if (!button) return;
  event.stopPropagation();
  const selected=props.rows.find(row=>row.id===button.dataset.gridRecordId);
  if (selected) emit("open-detail",selected);
}
function closeFilter() {activeFilter.value=null;}
function applyFilter(field:string,values:FacetValue[] | null){
  const next={...props.filters};
  if(values===null)delete next[field];
  else next[field]=values;
  emit("filter-change",next);closeFilter();
}
function setSort(field:string,direction:"asc"|"desc"|""){
  emit("sort-change",{key:direction?field:"",direction});
  closeFilter();
}
function dismiss(event:PointerEvent) {
  const target=event.target as HTMLElement;
  if(!target.closest(".excel-grid-popup") && !target.closest(".grid-filter-trigger")) closeFilter();
}
function dismissKey(event:KeyboardEvent) {if(event.key==="Escape"&&activeFilter.value)closeFilter();}
function refreshGridData(){
  if(!table.value)return;
  unmountRowControls();
  void table.value.replaceData(props.rows.map(row=>({...row})));
}
onMounted(async()=>{
  readPref();
  await nextTick();
  if(!host.value)return;
  const instance=new Tabulator(host.value,{
    index:"id",data:props.rows.map(row=>({...row})),
    columns:allColumns.value.map(buildColumn),
    layout:"fitColumns",placeholder:"暂无记录",
    height:"auto",
    selectableRange:1,selectableRangeColumns:true,selectableRangeRows:true,
    clipboard:"copy",clipboardCopyRowRange:"range",clipboardCopyConfig:{columnHeaders:false},
    renderVerticalBuffer:150,
  });
  instance.on("columnResized",column=>{
    const key=column.getField(),width=column.getWidth();
    if(key){pref.value.widths={...pref.value.widths,[key]:width};savePref();}
  });
  table.value=instance;
  document.addEventListener("pointerdown",dismiss);
  document.addEventListener("keydown",dismissKey);
});
onBeforeUnmount(()=>{
  document.removeEventListener("pointerdown",dismiss);
  document.removeEventListener("keydown",dismissKey);
  unmountControls();
  table.value?.destroy();table.value=null;
});
watch(()=>props.rows,refreshGridData);
watch(()=>props.columns,()=>buildColumns(),{deep:true});
watch(()=>props.filters,()=>buildColumns(),{deep:true});
function reset(){pref.value={order:[],hidden:[],widths:{}};savePref();buildColumns();}
defineExpose({openSettings:()=>{settings.value=true;},reset});
</script>
<template>
  <div class="business-tabulator">
    <div v-if="loading" class="grid-loading" role="status">正在加载…</div>
    <div ref="host" class="grid-host" aria-label="业务数据表" @pointerdown.capture="onGridDetailPointer"></div>
    <Teleport to="body">
      <div v-if="activeFilter" class="excel-grid-popup" :style="{left:filterCoords.left+'px',top:filterCoords.top+'px'}">
        <ExcelColumnFilter :key="activeFilter.key" :field="activeFilter.queryKey??activeFilter.key" :label="activeFilter.label"
          :selected="filters[activeFilter.queryKey??activeFilter.key]"
          :sort="sortKey===(activeFilter.queryKey??activeFilter.key)?sortDirection:''"
          :get-values="getValues" @apply="applyFilter" @sort="setSort" @close="closeFilter"/>
      </div>
    </Teleport>
    <ElDialog v-model="settings" title="自定义表格列" width="500px" append-to-body>
      <p class="muted">调整显示、顺序和列宽；设置自动保存在本机浏览器。</p>
      <div v-for="column in allColumns" :key="column.key" class="grid-column-setting">
        <ElCheckbox :model-value="!pref.hidden.includes(column.key)" :disabled="column.hideable===false"
          @change="switchColumn(column.key,Boolean($event))">{{ column.label }}</ElCheckbox>
        <ElButton text size="small" :aria-label="'上移'+column.label" @click="moveColumn(column.key,-1)">↑</ElButton>
        <ElButton text size="small" :aria-label="'下移'+column.label" @click="moveColumn(column.key,1)">↓</ElButton>
      </div>
      <template #footer><ElButton @click="reset">恢复默认</ElButton><ElButton type="primary" @click="settings=false">完成</ElButton></template>
    </ElDialog>
  </div>
</template>
<style scoped>
.business-tabulator{position:relative;width:100%;min-width:0}
.grid-loading{position:absolute;right:10px;top:10px;color:var(--muted);z-index:3;background:var(--surface)}
.grid-host{min-width:0;border-radius:7px;border:1px solid var(--edge);font-size:13px}
.excel-grid-popup{position:fixed;z-index:3000}
.grid-column-setting{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--edge)}
.grid-column-setting .el-checkbox{margin-right:auto}
.business-tabulator :deep(.tabulator){background:var(--surface);border:0;color:var(--ink);font-family:inherit}
.business-tabulator :deep(.tabulator-header){background:var(--table-heading);border-bottom:1px solid var(--edge);color:var(--table-heading-ink)}
.business-tabulator :deep(.tabulator-col){background:var(--table-heading)!important;border-color:var(--edge)}
.business-tabulator :deep(.tabulator-row){background:var(--surface);color:var(--ink);border-bottom:1px solid var(--edge)}
.business-tabulator :deep(.tabulator-row.tabulator-row-even){background:var(--surface-subtle)}
.business-tabulator :deep(.tabulator-row:hover){background:var(--table-row-hover)}
.business-tabulator :deep(.tabulator-cell){border-color:var(--edge)}
.business-tabulator :deep(.grid-header-title){display:flex;align-items:center;justify-content:space-between;gap:6px;min-width:0}
.business-tabulator :deep(.grid-header-title>span){overflow:hidden;text-overflow:ellipsis}
.business-tabulator :deep(.grid-filter-trigger){border:0;background:transparent;color:var(--muted);font:inherit;font-size:15px;cursor:pointer;padding:2px 5px;border-radius:4px}
.business-tabulator :deep(.grid-filter-trigger.is-active){color:var(--brand-primary);background:var(--brand-soft)}
.business-tabulator :deep(.grid-detail-link){color:var(--brand-primary);border:0;padding:0;background:transparent;font:inherit;cursor:pointer}
.business-tabulator :deep(.grid-status){display:inline-block;padding:2px 7px;border-radius:4px;background:var(--brand-soft)}
</style>

<script setup lang="ts" generic="TRow extends { id: string }">
import { computed, h, nextTick, onBeforeUnmount, onMounted, ref, render, shallowRef, watch } from "vue";
import { ElButton } from "element-plus";
import { TabulatorFull as Tabulator, type ColumnDefinition, type CellComponent, type SorterFromTable } from "tabulator-tables";
import { formatVisibleDateTime } from "../utils/datetime";
import ExcelColumnFilter from "./ExcelColumnFilter.vue";

export type FacetValue = string | null;
export interface FacetPage {
  items: { value: FacetValue; count: number }[];
  total: number;
  offset: number;
  limit: number;
}
export interface GridColumn {
  key: string;
  label: string;
  minWidth?: number;
  queryKey?: string;
  hideable?: boolean;
  defaultVisible?: boolean;
}
type Preference = { order: string[]; hidden: string[]; widths: Record<string, number> };
const props = defineProps<{
  rows: TRow[];
  columns: GridColumn[];
  tableKey: string;
  loading?: boolean;
  detailColumn?: string;
  sortKey?: string;
  sortDirection?: "asc" | "desc" | "";
  filters: Record<string, FacetValue[]>;
  getValues: (field: string, term: string, offset: number) => Promise<FacetPage>;
}>();
const emit = defineEmits<{
  (e:"open-detail", row:TRow):void;
  (e:"sort-change", value:{key:string;direction:"asc"|"desc"|""}):void;
  (e:"filter-change", filters:Record<string,FacetValue[]>):void;
}>();
const host=ref<HTMLElement>();
const table=shallowRef<Tabulator | null>(null);
const settings=ref(false);
const activeFilter=ref<GridColumn|null>(null);
const filterCoords=ref({left:0,top:0});
const headerButtons=new Map<string,HTMLElement>();
const pref=ref<Preference>({order:[],hidden:[],widths:{}});
const mountedControls=new Set<HTMLElement>();
let ready=false;
let ignoreNativeEvents=false;
const allColumns=computed(()=>[...props.columns].sort((a,b)=>{
  const ai=pref.value.order.indexOf(a.key),bi=pref.value.order.indexOf(b.key);
  return (ai<0?999:ai)-(bi<0?999:bi);
}));
function field(column:GridColumn){return column.queryKey??(column.key==="unit_id"?"unit_id_label":column.key);}
function mountControl(vnode:Parameters<typeof render>[0],container:HTMLElement){
  render(vnode,container);mountedControls.add(container);
}
function cleanupControls(){
  for(const el of mountedControls)render(null,el);
  mountedControls.clear();
}
function cleanupRowControls(){
  for(const el of mountedControls){
    if(!el.classList.contains("grid-row-control"))continue;
    render(null,el);mountedControls.delete(el);
  }
}
function readPref(){
  try{
    const saved=JSON.parse(localStorage.getItem("sd-grid:"+props.tableKey)||"null") as Preference|null;
    pref.value=saved&&Array.isArray(saved.order)&&Array.isArray(saved.hidden)&&saved.widths
      ? saved:{order:[],hidden:props.columns.filter(c=>c.defaultVisible===false).map(c=>c.key),widths:{}};
  }catch{
    pref.value={order:[],hidden:[],widths:{}};
  }
}
function savePref(){localStorage.setItem("sd-grid:"+props.tableKey,JSON.stringify(pref.value));}
function switchColumn(key:string,show:boolean){
  const col=props.columns.find(c=>c.key===key);
  if(!col||col.hideable===false)return;
  const hidden=new Set(pref.value.hidden);
  if(show)hidden.delete(key);else hidden.add(key);
  if(!props.columns.some(c=>!hidden.has(c.key)))return;
  pref.value.hidden=[...hidden];savePref();buildColumns();
}
function moveColumn(key:string,diff:number){
  const order=allColumns.value.map(c=>c.key),i=order.indexOf(key),target=i+diff;
  if(target<0||target>=order.length)return;
  order.splice(i,1);order.splice(target,0,key);
  pref.value.order=order;savePref();buildColumns();
}
function closeFilter(){activeFilter.value=null;}
function filterAnchor(button:HTMLElement,col:GridColumn){
  if(activeFilter.value?.key===col.key){closeFilter();return;}
  activeFilter.value=col;
  const rect=button.getBoundingClientRect();
  const width=Math.min(336,window.innerWidth-24);
  const top=Math.min(Math.max(8,window.innerHeight-448),rect.bottom+6);
  filterCoords.value={
    left:Math.max(10,Math.min(window.innerWidth-width-10,rect.right-width)),
    top:Math.max(8,top),
  };
}
function updateHeaderButton(column:GridColumn){
  const container=headerButtons.get(column.key);
  if(!container)return;
  const query=field(column);
  const direction=props.sortKey===query?props.sortDirection??"":"";
  const filtered=Object.prototype.hasOwnProperty.call(props.filters,query);
  mountControl(h(ElButton,{
    text:true,size:"small",
    class:["grid-column-heading",...(filtered?["is-filtered"]:[])],
    "data-grid-filter":column.key,
    "aria-label":column.label+"：筛选和排序"+(filtered?"，已筛选":"")+
      (direction==="asc"?"，升序":direction==="desc"?"，降序":""),
    "aria-haspopup":"dialog",
    "aria-expanded":activeFilter.value?.key===column.key,
    onClick:(event:MouseEvent)=>{event.stopPropagation();filterAnchor(container,column);}
  },()=>[
    h("span",{class:"grid-column-label"},column.label),
    h("span",{class:"grid-column-indicators"},[
      direction?h("span",{class:"grid-sort-symbol"},direction==="asc"?"↑":"↓"):null,
      h("span",{class:"grid-column-arrow"},"▾"),
    ])
  ]),container);
}
function updateHeaderButtons(){
  for(const col of props.columns)updateHeaderButton(col);
}
function dismissFilter(event:PointerEvent){
  const target=event.target as HTMLElement;
  if(!target.closest(".excel-grid-popup")&&!target.closest(".grid-column-heading"))closeFilter();
}
function dismissFilterKey(event:KeyboardEvent){
  if(event.key==="Escape"&&activeFilter.value)closeFilter();
}
function applyFilter(query:string,values:FacetValue[]|null){
  const next={...props.filters};
  if(values===null)delete next[query];
  else next[query]=values;
  emit("filter-change",next);
  closeFilter();
}
function setSort(query:string,direction:"asc"|"desc"|""){
  const instance=table.value;
  const view=props.columns.find(col=>field(col)===query)?.key??query;
  if(instance){
    if(direction)instance.setSort(view,direction);
    else instance.clearSort();
  }else emit("sort-change",{key:direction?query:"",direction});
  closeFilter();
}
function buildColumn(column:GridColumn):ColumnDefinition{
  const key=column.key;
  return {
    field:key,title:column.label,minWidth:column.minWidth??125,
    width:pref.value.widths[key],
    visible:column.hideable===false||!pref.value.hidden.includes(key),
    widthGrow:key==="name"?1.8:key==="note"?1.7:key==="unit_id"||key==="status"?0.8:1.15,
    headerSort:false,resizable:true,editable:false,
    titleFormatter:()=>{
      const container=document.createElement("span");
      container.className="grid-header-container";
      headerButtons.set(key,container);
      updateHeaderButton(column);
      return container;
    },
    formatter:(cell:CellComponent)=>{
      const row=cell.getRow().getData() as TRow;
      const raw=key==="unit_id"?Reflect.get(row,"unit_id_label"):cell.getValue();
      if(key==="status"){
        const label=document.createElement("span");
        label.className="grid-status";
        label.textContent=Reflect.get(row,"deleted")?"已删除":raw==="active"?"有效":"停用";
        return label;
      }
      if(key===props.detailColumn){
        const container=document.createElement("span");container.className="grid-row-control";
        mountControl(h(ElButton,{type:"primary",link:true,class:"cell-link grid-detail-link",
          "data-grid-record-id":row.id},()=>String(raw??"—")),container);
        return container;
      }
      const span=document.createElement("span");
      span.textContent=String(formatVisibleDateTime(raw,key)??"—");
      return span;
    },
  };
}
function buildColumns(){
  cleanupControls();
  headerButtons.clear();
  if(table.value)table.value.setColumns(allColumns.value.map(buildColumn));
}
function onGridDetailPointer(event:PointerEvent){
  if(event.button!==0)return;
  const button=(event.target as HTMLElement).closest<HTMLElement>(".grid-detail-link");
  if(!button)return;
  event.stopPropagation();
  const item=props.rows.find(row=>row.id===button.dataset.gridRecordId);
  if(item)emit("open-detail",item);
}
function nativeSorting(sorters:SorterFromTable[]){
  if(!ready||ignoreNativeEvents)return;
  const first=sorters[0];
  const next={key:props.columns.find(col=>col.key===first?.field)?.queryKey??first?.field??"",
    direction:first?.dir??""};
  if(next.key!==props.sortKey||next.direction!==props.sortDirection)emit("sort-change",next);
}
function synchronizeNativeSort(){
  const instance=table.value;
  if(!ready||!instance)return;
  const current=instance.getSorters()[0];
  const key=props.sortKey??"";
  const direction=props.sortDirection??"";
  if((current?.field??"")===key&&(current?.dir??"")===direction)return;
  ignoreNativeEvents=true;
  try{
    if(key&&direction)instance.setSort(key,direction);
    else instance.clearSort();
  }finally{
    ignoreNativeEvents=false;
  }
}
function refreshGridData(){
  if(!table.value)return;
  cleanupRowControls();
  void table.value.replaceData(props.rows.map(row=>({...row})));
}
function reset(){
  pref.value={order:[],hidden:[],widths:{}};savePref();buildColumns();
}
onMounted(async()=>{
  readPref();
  await nextTick();
  if(!host.value)return;
  const instance=new Tabulator(host.value,{
    index:"id",data:props.rows.map(row=>({...row})),columns:allColumns.value.map(buildColumn),
    layout:"fitColumns",height:"auto",placeholder:"暂无记录",
    // Tabulator retains the native remote sorter, while the user-requested reference
    // presentation controls filtering through the existing SQL-backed API.
    sortMode:"remote",filterMode:"remote",
    columnHeaderSortMulti:false,
    initialSort:props.sortKey&&props.sortDirection?
      [{column:props.sortKey,dir:props.sortDirection}]:[],
    selectableRows:false,selectableRange:false,clipboard:false,
    renderVerticalBuffer:150,
  });
  instance.on("dataSorting",nativeSorting);
  instance.on("columnResized",column=>{
    const key=column.getField(),width=column.getWidth();
    if(key){pref.value.widths={...pref.value.widths,[key]:width};savePref();}
  });
  table.value=instance;
  ready=true;
  document.addEventListener("pointerdown",dismissFilter);
  document.addEventListener("keydown",dismissFilterKey);
});
onBeforeUnmount(()=>{
  ready=false;
  document.removeEventListener("pointerdown",dismissFilter);
  document.removeEventListener("keydown",dismissFilterKey);
  cleanupControls();headerButtons.clear();table.value?.destroy();table.value=null;
});
watch(()=>props.rows,refreshGridData);
watch(()=>props.columns,buildColumns,{deep:true});
watch(()=>props.filters,updateHeaderButtons,{deep:true});
watch(()=>[props.sortKey,props.sortDirection],()=>{
  synchronizeNativeSort();
  updateHeaderButtons();
});
defineExpose({openSettings:()=>{settings.value=true;},reset});
</script>
<template>
  <div class="business-tabulator">
    <div v-if="loading" class="grid-loading" role="status">正在加载…</div>
    <div ref="host" class="grid-host" aria-label="业务数据表" @pointerdown.capture="onGridDetailPointer"></div>
    <Teleport to="body">
      <div v-if="activeFilter" class="excel-grid-popup"
        :style="{left:filterCoords.left+'px',top:filterCoords.top+'px'}">
        <ExcelColumnFilter :key="activeFilter.key"
          :field="field(activeFilter)" :label="activeFilter.label"
          :selected="filters[field(activeFilter)]"
          :sort="sortKey===field(activeFilter)?sortDirection:''"
          :get-values="getValues"
          @apply="applyFilter" @sort="setSort" @close="closeFilter"/>
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
.grid-host{min-width:0;overflow:hidden;border-radius:8px;border:1px solid var(--edge);font-size:13px}
.excel-grid-popup{position:fixed;z-index:3000}
.grid-column-setting{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--edge)}
.grid-column-setting .el-checkbox{margin-right:auto}
.business-tabulator :deep(.tabulator){background:var(--surface);border:0;color:var(--ink);font-family:inherit;font-size:13px}
.business-tabulator :deep(.tabulator-header){background:var(--table-heading)!important;border-bottom:1px solid var(--edge)!important;color:var(--table-heading-ink)!important}
.business-tabulator :deep(.tabulator-header .tabulator-col){background:var(--table-heading)!important;border-right:1px solid var(--edge)!important;color:var(--table-heading-ink)!important}
.business-tabulator :deep(.tabulator-header .tabulator-col .tabulator-col-title){color:var(--table-heading-ink)!important;font-size:12px;font-weight:500;padding:0}
.business-tabulator :deep(.tabulator-header .tabulator-col .tabulator-col-content){padding:0}
.business-tabulator :deep(.grid-header-container){display:block;width:100%;height:100%}
.business-tabulator :deep(.grid-column-heading){
 display:flex;align-items:center;justify-content:space-between;gap:8px;
 min-height:41px;width:100%;padding:8px 10px;margin:0;border:0;
 background:transparent;color:var(--table-heading-ink);text-align:left;
 font-size:12px;font-weight:600;border-radius:0;
}
.business-tabulator :deep(.grid-column-heading>span){
 width:100%;min-width:0;display:flex;align-items:center;justify-content:space-between;gap:8px;
}
.business-tabulator :deep(.grid-column-heading:hover){background:#e2eeea;color:#345e59}
.business-tabulator :deep(.grid-column-heading.is-filtered){background:#dceee7;color:#066f66}
.business-tabulator :deep(.grid-column-label){
 min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.business-tabulator :deep(.grid-column-indicators){
 display:flex;align-items:center;gap:4px;color:#718b87;font-size:12px;
}
.business-tabulator :deep(.grid-sort-symbol){color:#087f75;font-size:15px;font-weight:700}
.business-tabulator :deep(.grid-column-heading.is-filtered .grid-column-arrow){
 color:#087f75;background:#bbded0;border-radius:3px;padding:0 3px;
}
.business-tabulator :deep(.tabulator .tabulator-row){background:var(--surface)!important;color:var(--ink)!important;border-bottom:1px solid var(--edge)!important;min-height:42px}
.business-tabulator :deep(.tabulator .tabulator-row.tabulator-row-even){background:var(--surface-subtle)!important}
.business-tabulator :deep(.tabulator .tabulator-row:hover){background:var(--table-row-hover)!important}
.business-tabulator :deep(.tabulator .tabulator-cell){background:transparent!important;color:var(--ink)!important;border-right:1px solid var(--edge)!important;padding:10px 12px;vertical-align:middle}
.business-tabulator :deep(.tabulator .tabulator-cell:focus-visible){outline:2px solid var(--brand-primary);outline-offset:-2px}
.business-tabulator :deep(.grid-detail-link){color:var(--brand-primary)!important;padding:0;font-weight:500}
.business-tabulator :deep(.grid-status){display:inline-block;padding:3px 9px;border-radius:5px;background:var(--brand-soft);color:var(--brand-primary)}
</style>

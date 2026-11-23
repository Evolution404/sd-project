<script setup lang="ts" generic="TRow extends { id: string }">
import { computed, h, nextTick, onBeforeUnmount, onMounted, ref, render, shallowRef, watch } from "vue";
import { ElButton } from "element-plus";
import { TabulatorFull as Tabulator, type ColumnDefinition, type CellComponent, type Filter, type SorterFromTable } from "tabulator-tables";
import { formatVisibleDateTime } from "../utils/datetime";

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
async function nativeValues(column:GridColumn){
  const key=field(column);
  const list:{value:string;label:string}[]=[];
  let offset=0,total=1;
  while(offset<total){
    const page=await props.getValues(key,"",offset);
    total=page.total;
    if(total>256)throw new Error("候选值超过256项，当前原生多选筛选试点不支持全部加载");
    if(!page.items.length)break;
    for(const item of page.items){
      const value=item.value===null?"":item.value;
      const label=item.value===null?"(空值)":item.value;
      list.push({value,label:key==="status"?(value==="active"?"有效":value==="inactive"?"停用":label):label});
    }
    offset+=page.items.length;
  }
  return list;
}
function buildColumn(column:GridColumn):ColumnDefinition{
  const key=field(column);
  return {
    field:key,title:column.label,minWidth:column.minWidth??125,
    width:pref.value.widths[column.key],
    visible:column.hideable===false||!pref.value.hidden.includes(column.key),
    widthGrow:column.key==="name"?1.8:column.key==="note"?1.7:column.key==="unit_id"||column.key==="status"?0.8:1.15,
    headerSort:true,headerSortTristate:true,resizable:true,editable:false,
    // Entire header filter and sorting UI belongs to Tabulator.
    headerFilter:"list",
    headerFilterParams:{
      valuesLookup:()=>nativeValues(column),
      multiselect:true,clearable:true,sort:"asc",
      placeholderLoading:"正在读取候选值…",
      placeholderEmpty:"无候选值",
    } as unknown as ColumnDefinition["headerFilterParams"],
    headerFilterEmptyCheck:(value:unknown)=>value===undefined||value===null||value===""||(Array.isArray(value)&&value.length===0),
    formatter:(cell:CellComponent)=>{
      const row=cell.getRow().getData() as TRow;
      const raw=cell.getValue();
      if(column.key==="status"){
        const label=document.createElement("span");
        label.className="grid-status";
        label.textContent=Reflect.get(row,"deleted")?"已删除":raw==="active"?"有效":"停用";
        return label;
      }
      if(column.key===props.detailColumn){
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
function nativeFiltering(filters:Filter[]){
  if(!ready||ignoreNativeEvents)return;
  const next:Record<string,FacetValue[]>={};
  for(const filter of filters){
    const values=Array.isArray(filter.value)?filter.value:[filter.value];
    if(!values.length)continue;
    next[filter.field]=values.map(value=>value===""?null:String(value));
  }
  if(JSON.stringify(next)!==JSON.stringify(props.filters))emit("filter-change",next);
}
function nativeSorting(sorters:SorterFromTable[]){
  if(!ready||ignoreNativeEvents)return;
  const first=sorters[0];
  const next={key:first?.field??"",direction:first?.dir??""};
  if(next.key!==props.sortKey||next.direction!==props.sortDirection)emit("sort-change",next);
}
function synchronizeNativeFilters(){
  const instance=table.value;
  if(!ready||!instance)return;
  const actual=new Map(instance.getHeaderFilters().map(item=>[
    item.field,Array.isArray(item.value)?item.value:[item.value],
  ]));
  ignoreNativeEvents=true;
  try {
    for(const col of props.columns){
      const key=field(col);
      const desired=props.filters[key]?.map(item=>item??"")??[];
      const current=actual.get(key)??[];
      if(JSON.stringify(desired)!==JSON.stringify(current))
        instance.setHeaderFilterValue(key,desired);
    }
  }finally{
    ignoreNativeEvents=false;
  }
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
    // Native Tabulator manages the header controls and sort/filter state.
    // Existing SQLite services execute the actual remote queries after dataFiltering/dataSorting.
    sortMode:"remote",filterMode:"remote",
    columnHeaderSortMulti:false,
    initialSort:props.sortKey&&props.sortDirection?
      [{column:props.sortKey,dir:props.sortDirection}]:[],
    initialHeaderFilter:Object.entries(props.filters).map(([key,value])=>({
      field:key,value:value.map(item=>item??""),
    })),
    selectableRows:false,selectableRange:false,clipboard:false,
    renderVerticalBuffer:150,
  });
  instance.on("dataFiltering",nativeFiltering);
  instance.on("dataSorting",nativeSorting);
  instance.on("columnResized",column=>{
    const key=column.getField(),width=column.getWidth();
    if(key){pref.value.widths={...pref.value.widths,[key]:width};savePref();}
  });
  table.value=instance;
  ready=true;
});
onBeforeUnmount(()=>{
  ready=false;cleanupControls();table.value?.destroy();table.value=null;
});
watch(()=>props.rows,refreshGridData);
watch(()=>props.columns,buildColumns,{deep:true});
watch(()=>props.filters,synchronizeNativeFilters,{deep:true});
watch(()=>[props.sortKey,props.sortDirection],synchronizeNativeSort);
defineExpose({openSettings:()=>{settings.value=true;},reset});
</script>
<template>
  <div class="business-tabulator">
    <div v-if="loading" class="grid-loading" role="status">正在加载…</div>
    <div ref="host" class="grid-host" aria-label="业务数据表" @pointerdown.capture="onGridDetailPointer"></div>
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
.grid-column-setting{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--edge)}
.grid-column-setting .el-checkbox{margin-right:auto}
.business-tabulator :deep(.tabulator){background:var(--surface);border:0;color:var(--ink);font-family:inherit;font-size:13px}
.business-tabulator :deep(.tabulator-header){background:var(--table-heading)!important;border-bottom:1px solid var(--edge)!important;color:var(--table-heading-ink)!important}
.business-tabulator :deep(.tabulator-header .tabulator-col){background:var(--table-heading)!important;border-right:1px solid var(--edge)!important;color:var(--table-heading-ink)!important}
.business-tabulator :deep(.tabulator-header .tabulator-col .tabulator-col-title){color:var(--table-heading-ink)!important;font-size:13px;font-weight:600}
.business-tabulator :deep(.tabulator .tabulator-row){background:var(--surface)!important;color:var(--ink)!important;border-bottom:1px solid var(--edge)!important;min-height:42px}
.business-tabulator :deep(.tabulator .tabulator-row.tabulator-row-even){background:var(--surface-subtle)!important}
.business-tabulator :deep(.tabulator .tabulator-row:hover){background:var(--table-row-hover)!important}
.business-tabulator :deep(.tabulator .tabulator-cell){background:transparent!important;color:var(--ink)!important;border-right:1px solid var(--edge)!important;padding:10px 12px;vertical-align:middle}
.business-tabulator :deep(.tabulator .tabulator-cell:focus-visible){outline:2px solid var(--brand-primary);outline-offset:-2px}
.business-tabulator :deep(.grid-detail-link){color:var(--brand-primary)!important;padding:0;font-weight:500}
.business-tabulator :deep(.grid-status){display:inline-block;padding:3px 9px;border-radius:5px;background:var(--brand-soft);color:var(--brand-primary)}
.business-tabulator :deep(.tabulator-header-filter){margin-top:6px}
.business-tabulator :deep(.tabulator-header-filter input){border-radius:5px;background:var(--surface);color:var(--ink);border:1px solid var(--edge);max-width:100%;padding:3px 5px}
</style>

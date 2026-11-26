<template>
  <el-dialog :model-value="true" :title="title" append-to-body align-center width="min(95vw, 960px)"
    :close-on-click-modal="false" @close="emit('close')">
    <el-space wrap class="mb-3">
      <slot name="filters" />
      <el-input v-model="keyword" clearable :placeholder="placeholder" @keyup.enter="search"/>
      <el-button :loading="loading" @click="search">查询</el-button>
      <template v-if="loadFiltered && !single">
        <el-button :disabled="loading || !total" @click="changeFiltered(true)">全选筛选结果</el-button>
        <el-button :disabled="loading || !total || !selected.length" @click="changeFiltered(false)">取消筛选结果</el-button>
        <el-button :disabled="loading || !selected.length" @click="setSelection([])">清空全部已选</el-button>
      </template>
      <el-text type="info">已选 {{selected.length}} 条</el-text>
    </el-space>
    <el-alert v-if="error" type="error" :title="error" :closable="false" class="mb-3"/>
    <el-table :data="rows" ref="table" row-key="id" border max-height="400" v-loading="loading"
      @select="selectionChanged" @select-all="selectionChanged">
      <el-table-column v-if="!single" type="selection" width="48" :selectable="selectable"/>
      <el-table-column v-else label="选择" width="76">
        <template #default="{row}"><el-button link :type="selected[0]?.id===row.id?'success':'primary'" :disabled="selectable?.(row)===false" @click="selected=[row]">{{selected[0]?.id===row.id?'已选':'选择'}}</el-button></template>
      </el-table-column>
      <el-table-column v-for="column in columns" :key="column.key" :prop="column.key"
        :label="column.label" :min-width="column.width||120" show-overflow-tooltip>
        <template #default="{row}">{{column.format?column.format(row):row[column.key]??"—"}}</template>
      </el-table-column>
    </el-table>
    <el-pagination class="mt-3" v-model:current-page="page" :page-size="20" :total="total"
      layout="total, prev, pager, next" @current-change="load"/>
    <template #footer>
      <el-button :disabled="saving" @click="emit('close')">取消</el-button>
      <el-button :data-guide-action="confirmGuide" type="primary" :loading="saving"
        :disabled="!selected.length||loading||saving" @click="emit('confirm',selected.slice())">
        {{confirmLabel}}（{{selected.length}}）
      </el-button>
    </template>
  </el-dialog>
</template>
<script setup lang="ts" generic="T extends {id:string}">
import {nextTick,onBeforeUnmount,onMounted,ref,shallowRef,watch} from "vue";
import type {TableInstance} from "element-plus";
const props=defineProps<{
  title:string;placeholder:string;confirmLabel:string;confirmGuide?:string;saving?:boolean;single?:boolean;
  columns:{key:keyof T & string;label:string;width?:number;format?:(row:T)=>string}[];
  loader:(keyword:string,page:number)=>Promise<{items:T[];total:number}>;
  filterKey?:string;
  loadFiltered?:(keyword:string)=>Promise<T[]>;
  selectionLimit?:number;
  selectable?:(row:T)=>boolean;
}>();
const emit=defineEmits<{close:[];confirm:[rows:T[]]}>();
const rows=shallowRef<T[]>([]),selected=shallowRef<T[]>([]);
const table=ref<TableInstance>();
const keyword=ref(""),page=ref(1),total=ref(0),loading=ref(false),error=ref("");
let applied="",sequence=0;
function setSelection(value:T[]){
  if(props.selectionLimit!==undefined&&value.length>props.selectionLimit){
    error.value=`最多还能选择 ${props.selectionLimit} 条，当前选择已保留`;
  }else {
    selected.value=value;
    error.value="";
  }
  reflectSelection();
}
function reflectSelection(){
  if(props.single)return;
  const ids=new Set(selected.value.map(row=>row.id));
  table.value?.clearSelection();
  for(const row of rows.value)if(ids.has(row.id))table.value?.toggleRowSelection(row,true,false);
}
function selectionChanged(value:T[]){
  const visibleIds=new Set(rows.value.map(row=>row.id));
  setSelection([...selected.value.filter(row=>!visibleIds.has(row.id)),
    ...value.filter(row=>props.selectable?.(row)!==false)]);
}
async function changeFiltered(add:boolean){
  if(!props.loadFiltered||loading.value)return;
  const current=++sequence;loading.value=true;error.value="";
  try{
    const matches=await props.loadFiltered(applied);
    if(current!==sequence)return;
    const next=new Map(selected.value.map(row=>[row.id,row]));
    for(const row of matches){
      if(!add)next.delete(row.id);
      else if(props.selectable?.(row)!==false)next.set(row.id,row);
    }
    setSelection([...next.values()]);
  }catch(cause){if(current===sequence)error.value=cause instanceof Error?cause.message:String(cause)}
  finally{if(current===sequence)loading.value=false}
}
async function load(){
  const current=++sequence;loading.value=true;error.value="";
  try{
    const result=await props.loader(applied,page.value);
    if(current!==sequence)return;
    rows.value=result.items;total.value=result.total;
    await nextTick();
    if(current===sequence)reflectSelection();
  }catch(cause){
    if(current===sequence){
      rows.value=[];total.value=0;
      error.value=cause instanceof Error?cause.message:String(cause);
    }
  }
  finally{if(current===sequence)loading.value=false}
}
function search(){
  applied=keyword.value.trim();page.value=1;void load();
}
watch(()=>props.filterKey,search);
onMounted(load);
onBeforeUnmount(()=>{sequence++});
</script>

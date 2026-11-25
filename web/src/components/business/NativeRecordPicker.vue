<template>
  <el-dialog :model-value="true" :title="title" append-to-body align-center width="min(95vw, 960px)"
    :close-on-click-modal="false" @close="emit('close')">
    <el-space wrap class="mb-3">
      <el-input v-model="keyword" clearable :placeholder="placeholder" @keyup.enter="search"/>
      <el-button :loading="loading" @click="search">查询</el-button>
      <el-text type="info">已选 {{selected.length}} 条</el-text>
    </el-space>
    <el-alert v-if="error" type="error" :title="error" :closable="false" class="mb-3"/>
    <el-table :data="rows" ref="table" row-key="id" border max-height="400" v-loading="loading"
      @selection-change="selectionChanged">
      <el-table-column v-if="!single" type="selection" width="48" reserve-selection :selectable="selectable"/>
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
import {onBeforeUnmount,onMounted,ref,shallowRef} from "vue";
import type {TableInstance} from "element-plus";
const props=defineProps<{
  title:string;placeholder:string;confirmLabel:string;confirmGuide?:string;saving?:boolean;single?:boolean;
  columns:{key:keyof T & string;label:string;width?:number;format?:(row:T)=>string}[];
  loader:(keyword:string,page:number)=>Promise<{items:T[];total:number}>;
  selectable?:(row:T)=>boolean;
}>();
const emit=defineEmits<{close:[];confirm:[rows:T[]]}>();
const rows=shallowRef<T[]>([]),selected=shallowRef<T[]>([]);
const table=ref<TableInstance>();
const keyword=ref(""),page=ref(1),total=ref(0),loading=ref(false),error=ref("");
let applied="",sequence=0;
function selectionChanged(value:T[]){selected.value=value.filter(row=>props.selectable?.(row)!==false)}
async function load(){
  const current=++sequence;loading.value=true;error.value="";
  try{
    const result=await props.loader(applied,page.value);
    if(current!==sequence)return;
    rows.value=result.items;total.value=result.total;
  }catch(cause){if(current===sequence)error.value=cause instanceof Error?cause.message:String(cause)}
  finally{if(current===sequence)loading.value=false}
}
function search(){
  applied=keyword.value.trim();page.value=1;void load();
}
onMounted(load);
onBeforeUnmount(()=>{sequence++});
</script>

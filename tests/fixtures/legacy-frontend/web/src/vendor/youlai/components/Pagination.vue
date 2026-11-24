<!-- Adapted from vue3-element-admin 4.13.0 src/components/Pagination/index.vue
     MIT; imported explicitly for this project's no-auto-import Vue build. -->
<script setup lang="ts">
import { watch } from "vue";
interface Props {
  total?:number;
  pageSizes?:number[];
  layout?:string;
  background?:boolean;
  hidden?:boolean;
  disabled?:boolean;
}
const props=withDefaults(defineProps<Props>(),{
  total:0,pageSizes:()=>[10,20,50,100],
  layout:"total, sizes, prev, pager, next, jumper",background:true,hidden:false,disabled:false,
});
const emit=defineEmits<{pagination:[query:{page:number;limit:number}]}>();
const currentPage=defineModel<number>("page",{default:1});
const pageSize=defineModel<number>("limit",{default:10});
watch(()=>props.total,newVal=>{
  const lastPage=Math.ceil(newVal/pageSize.value);
  if(newVal>0&&currentPage.value>lastPage){
    currentPage.value=lastPage;
    emit("pagination",{page:currentPage.value,limit:pageSize.value});
  }
});
function handleSizeChange(limit:number){
  currentPage.value=1;emit("pagination",{page:currentPage.value,limit});
}
function handleCurrentChange(page:number){
  emit("pagination",{page,limit:pageSize.value});
}
</script>
<template>
  <ElScrollbar>
    <div :class="{'is-hidden':hidden}" class="pagination-container">
      <ElPagination v-model:current-page="currentPage" v-model:page-size="pageSize"
        :disabled="disabled" :background="background" :layout="layout"
        :page-sizes="pageSizes" :total="total"
        @size-change="handleSizeChange" @current-change="handleCurrentChange" />
    </div>
  </ElScrollbar>
</template>
<style scoped>
.pagination-container{display:flex;justify-content:flex-end;padding-top:14px;overflow:visible}
.pagination-container.is-hidden{display:none}
</style>

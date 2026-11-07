<script setup lang="ts">
import {computed} from 'vue';
import {ElTag} from 'element-plus';
const props=defineProps<{status:string,label?:string,version?:number}>();
const names:Record<string,string>={
 reserve:'储备编制',stocked:'已入库',approved:'已立项',closed:'已结项',
 planned:'计划中',running:'实施中',finished:'已结束',cancelled:'已取消',
 active:'有效',inactive:'停用',pending:'待核实',returned:'已退回',
 draft:'草稿',submitted:'已提交',rejected:'已驳回',
 unimplemented_unsettled:'未实施未结算',unimplemented_settled:'未实施已结算',
 implemented_unsettled:'已实施未结算',implemented_settled:'已实施已结算'
};
const title=computed(()=>props.label||names[props.status]||props.status);
const kind=computed<'success'|'warning'|'danger'|'info'>(()=>{
 if(['approved','closed','finished','active','implemented_settled'].includes(props.status))return 'success';
 if(['cancelled','rejected','returned'].includes(props.status))return 'danger';
 if(['draft','running','stocked','pending','submitted','implemented_unsettled','unimplemented_settled'].includes(props.status))return 'warning';
 return 'info';
});
</script>
<template>
 <ElTag class="status-tag" :type="kind" effect="light" round>
  {{title}}<template v-if="version!==undefined"> · v{{version}}</template>
 </ElTag>
</template>
<style scoped>
.status-tag{white-space:nowrap;font-weight:500}
</style>

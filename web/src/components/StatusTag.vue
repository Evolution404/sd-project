<script setup lang="ts">
import { computed } from 'vue';

const props=defineProps<{
  status: string;
  label?: string;
  version?: number;
}>();

const names: Record<string,string>={
  reserve:'储备编制',stocked:'已入库',approved:'已立项',closed:'已结项',
  planned:'计划中',running:'实施中',finished:'已结束',cancelled:'已取消',
  active:'有效',inactive:'停用',pending:'待核实',returned:'已退回',
  draft:'草稿',submitted:'已提交',rejected:'已驳回',
  unimplemented_unsettled:'未实施未结算',
  unimplemented_settled:'未实施已结算',
  implemented_unsettled:'已实施未结算',
  implemented_settled:'已实施已结算'
};
const title=computed(()=>props.label||names[props.status]||props.status);
const tone=computed(()=>{
  if(['approved','closed','finished','active','implemented_settled'].includes(props.status))return 'positive';
  if(['cancelled','rejected','returned'].includes(props.status))return 'negative';
  if(['planned','running','stocked','pending','submitted','implemented_unsettled','unimplemented_settled'].includes(props.status))return 'attention';
  return 'neutral';
});
</script>
<template>
  <span class="tag status-tag" :class="'status-tag--'+tone">{{title}}<template v-if="version!==undefined"> · v{{version}}</template></span>
</template>
<style scoped>
.status-tag{white-space:nowrap;font-weight:500}
.status-tag--positive{color:#246a45;background:#edf7f0;border-color:#d2e8d8}
.status-tag--attention{color:#95611e;background:#fff7e9;border-color:#f3dfb8}
.status-tag--negative{color:#a33b3b;background:#fff0f0;border-color:#f1cece}
.status-tag--neutral{color:#586475;background:#f2f4f6;border-color:#dce1e5}
</style>

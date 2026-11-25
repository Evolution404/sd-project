<template>
  <el-dialog :model-value="true" :title="title" append-to-body align-center width="min(94vw,780px)"
    :close-on-click-modal="false" :close-on-press-escape="!saving" :show-close="!saving" @close="emit('close')">
    <el-alert v-if="error" :title="error" type="error" :closable="false" class="mb-3"/>
    <el-alert :title="'已勾选 '+targets.length+' 条，可办理 '+ready.length+' 条，不能办理 '+(rows.length-ready.length)+' 条'"
      :type="rows.length===ready.length?'info':'warning'" :closable="false" class="mb-3"/>
    <el-table v-loading="checking" :data="rows" border max-height="360" row-key="id">
      <el-table-column prop="label" label="办理记录" min-width="200"/>
      <el-table-column prop="expected_version" label="正式版本" width="100"/>
      <el-table-column label="预检结果" min-width="230">
        <template #default="{row}"><el-tag :type="row.reason?'warning':'success'" effect="plain">{{row.reason||"可办理"}}</el-tag></template>
      </el-table-column>
    </el-table>
    <p class="mt-3 text-[var(--el-text-color-secondary)]">仅提交预检通过的记录；服务端在同一事务内重新校验权限、状态和版本。任何已提交记录冲突时整批回滚。</p>
    <template #footer>
      <el-button :disabled="saving" @click="emit('close')">取消</el-button>
      <el-button :loading="checking" :disabled="saving||attempted" @click="check">重新检查</el-button>
      <el-button type="primary" :loading="saving" :disabled="checking||!ready.length" @click="commit">
        {{attempted?"重试原批次":"确认办理 "+ready.length+" 条"}}
      </el-button>
    </template>
  </el-dialog>
</template>
<script setup lang="ts">
import {computed,onMounted,ref,shallowRef} from "vue";
import {ElMessage} from "element-plus";
import {handleBatch,newHandlingKey,type HandlingKind,type HandlingReviewRow,type HandlingTarget} from "@/api/business/handling-batch";
const props=defineProps<{kind:HandlingKind;targets:readonly HandlingTarget[]}>();
const emit=defineEmits<{close:[];changed:[]}>();
const title=computed(()=>props.kind==="demands"?"批量确认需求":"批量项目入库");
const rows=shallowRef<HandlingReviewRow[]>([]);
const checking=ref(false),saving=ref(false),error=ref(""),attempted=ref(false);
const ready=computed(()=>rows.value.filter(row=>!row.reason));
let commitKey="";
async function check(){
  if(saving.value||attempted.value)return;
  checking.value=true;error.value="";rows.value=[];
  try{
    if(!props.targets.length||props.targets.length>100)throw Error("请选择1至100条记录");
    const result=await handleBatch(props.kind,props.targets,true,newHandlingKey());
    if(!Array.isArray(result))throw Error("预检返回格式错误");
    rows.value=result;commitKey=newHandlingKey();
  }catch(e){error.value=(e as Error).message}
  finally{checking.value=false}
}
async function commit(){
  if(saving.value||checking.value||!ready.value.length)return;
  attempted.value=true;saving.value=true;error.value="";
  try{
    const result=await handleBatch(props.kind,ready.value.map(({id,expected_version,expected_event_seq})=>({id,expected_version,expected_event_seq})),false,commitKey);
    if(Array.isArray(result)||result.count!==ready.value.length)throw Error("提交结果不明确，请核对并重试原批次");
    ElMessage.success("已办理 "+result.count+" 条");emit("changed");emit("close");
  }catch(e){error.value=(e as Error).message+"。可使用同一批次重试；若版本冲突，请关闭后重新选择最新记录。"}
  finally{saving.value=false}
}
onMounted(check);
</script>

<template>
  <el-card shadow="never">
    <div class="flex flex-wrap items-center justify-between gap-4 mb-4">
      <div>
        <h3 class="text-lg font-semibold">物资批量编辑</h3>
        <el-text type="info">本次编辑 {{ records.length }} 条物资（查询合计 {{ total }} 条）；编号、单位、状态及版本只读。</el-text>
      </div>
      <el-space wrap>
        <el-button data-guide-action="materials.finish-edit" :disabled="saving" @click="cancel">返回查看态</el-button>
        <el-button data-guide-action="materials.batch-save" type="primary" :loading="saving" :disabled="!ready || saving" @click="save">
          保存 {{ changes.length }} 条修改
        </el-button>
      </el-space>
    </div>
    <BusinessWorksheet ref="sheet" name="物资资料" session-key="materials-bulk"
      :rows="rows" :columns="columns" :validate="validate" :disabled="saving"
      undo-guide="materials.undo" redo-guide="materials.redo"
      @change="values => draft = values" @readiness-change="value => ready = value" />
    <el-alert class="mt-4" type="info" :closable="false"
      title="未保存内容仅存于本次编辑会话；任一记录版本冲突时服务端整批回滚。" />
  </el-card>
</template>
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate } from "vue-router";
import { listRouteIdentity } from "@/components/Crud/utils/list-state";
import { ElMessage, ElMessageBox } from "element-plus";
import BusinessWorksheet from "@/components/BusinessWorksheet/BusinessWorksheet.vue";
import type { WorksheetColumn, WorksheetRow, WorksheetValues, WorksheetIssue } from "@/components/BusinessWorksheet/univer-engine";
import { bulkUpdateMaterial, type Material } from "@/api/business/materials";
defineOptions({ name:"MaterialBulkEditor" });
const props = defineProps<{ records: Material[]; page: number; total: number }>();
const emit = defineEmits<{cancel:[],saved:[]}>();
const sheet = ref<InstanceType<typeof BusinessWorksheet>>();
const ready = ref(false), saving = ref(false);
const modifiedFields = ["name","model","specification","note"] as const;
const columns: WorksheetColumn[] = [
  { key:"code",title:"物资编码",width:155 },
  { key:"name",title:"物资名称",width:200,editable:true },
  { key:"model",title:"型号",width:175,editable:true },
  { key:"specification",title:"规格",width:175,editable:true },
  { key:"note",title:"备注",width:200,editable:true },
  { key:"unit",title:"计量单位",width:125 },
  { key:"status",title:"状态",width:100 },
  { key:"version",title:"正式版本",width:120 },
];
const original = props.records.map(record => ({...record}));
const rows: WorksheetRow[] = original.map(record => ({
  id:record.id,label:record.code,
  values:{code:record.code,name:record.name,model:record.model??"",specification:record.specification??"",
    note:record.note??"",unit:record.unit_id_label,status:record.status==="active"?"启用":"停用",version:String(record.version_no)},
}));
const draft = shallowRef<WorksheetValues>(Object.fromEntries(rows.map(row=>[row.id,row.values])));
function validate(values: WorksheetValues): WorksheetIssue[] {
  return rows.flatMap((row,index) => (values[row.id]?.name??"").trim() ? [] : [{
    row:index+1,column:1,cell:"B"+(index+2),rowId:row.id,field:"name",location:row.label,message:"物资名称不能为空",
  }]);
}
function collect(values: WorksheetValues) {
  return original.flatMap(record => {
    const changes = Object.fromEntries(modifiedFields
      .filter(key=>String(values[record.id]?.[key]??"")!==String(record[key]??""))
      .map(key=>[key,String(values[record.id]?.[key]??"")]));
    return Object.keys(changes).length ? [{id:record.id,expected_version:record.version_no,changes}] : [];
  });
}
const changes = computed(()=>collect(draft.value));
async function mayLeave(){
  if(saving.value)return false;
  await sheet.value?.finishEditing();
  if(!changes.value.length)return true;
  try {await ElMessageBox.confirm("还有未保存修改，确定退出批量编辑吗？","放弃修改",
    {type:"warning",confirmButtonText:"退出",cancelButtonText:"继续编辑"});return true}
  catch{return false}
}
async function cancel(){if(await mayLeave())emit("cancel")}
function beforeUnload(event:BeforeUnloadEvent){
  if(changes.value.length||sheet.value?.changed()){event.preventDefault();event.returnValue=""}
}
async function leaveRoute(){if(!await mayLeave())return false;emit("cancel");return true}
onBeforeRouteLeave(leaveRoute);
onBeforeRouteUpdate((to,from)=>listRouteIdentity(to.fullPath)===listRouteIdentity(from.fullPath)?true:leaveRoute());
onMounted(()=>window.addEventListener("beforeunload",beforeUnload));
onUnmounted(()=>window.removeEventListener("beforeunload",beforeUnload));
async function save(){
  if(!ready.value||saving.value)return;
  saving.value=true;
  try{
    const values=await sheet.value?.prepareSave();
    if(!values)return;
    const pending=collect(values);
    if(!pending.length){ElMessage.info("没有需要保存的修改");return}
    await ElMessageBox.confirm("将为 "+pending.length+" 条物资生成新正式版本，任一验证失败整批回滚。确认保存？",
      "提交批量修改",{type:"warning",confirmButtonText:"确认保存",cancelButtonText:"继续编辑"});
    const result=await bulkUpdateMaterial(pending);
    ElMessage.success("已更新 "+result.count+" 条物资的正式版本");
    emit("saved");
  }catch(e){if(e!=="cancel"&&e!=="close")ElMessage.error((e as Error).message)}
  finally{saving.value=false}
}
</script>

<template>
  <section data-guide-workspace class="page-container settlement-compose-page" :aria-label="editorTitle">
    <el-card class="page-content settlement-compose" shadow="never">
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 class="text-lg font-semibold">{{ editorTitle }}</h2>
          <div class="page-heading-actions flex flex-wrap gap-2">
            <el-button :disabled="saving || switching" @click="returnToFinance">返回结算列表</el-button>
            <el-button data-guide-action="finance.draft-save" :loading="saving && !submitting"
              :disabled="saving || !editorProject?.approval || switching || (editorForm.changeType !== 'void' && !worksheetReady)"
              @click="saveDraft(false)">保存草稿</el-button>
            <el-button data-guide-action="finance.direct-submit" type="primary" :loading="saving && submitting"
              :disabled="saving || !editorProject?.approval || switching || (editorForm.changeType !== 'void' && !worksheetReady)"
              @click="saveDraft(true)">提交审核</el-button>
          </div>
        </div>
      </template>
      <el-skeleton v-if="editorLoading" animated :rows="8" />
      <el-alert v-else-if="loadError" type="error" :title="loadError" :closable="false">
        <el-button link type="primary" data-guide-action="finance.reload-approvals" @click="load">重新读取</el-button>
      </el-alert>
      <template v-else-if="editorProject?.approval">

      <el-alert :closable="false" type="info" class="settlement-context"
        :title="`子项目：${editorProject.name}。当前正式批准版本：V${editorProject.approval.version_no}。保存草稿可继续编辑；提交审核后锁定，审核通过方可生效。`"/>
      <el-form :model="editorForm" label-width="145px" novalidate :disabled="saving || switching">
        <el-row :gutter="14">
          <el-col :span="12">
            <el-form-item label="结算方式">
              <el-select v-model="editorForm.mode" :disabled="editorForm.changeType === 'void'">
                <el-option label="按项目总额" value="project_total" />
                <el-option label="按子费用" value="itemized" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="采用批准版本">
              <el-select :model-value="editorForm.approvalId" :disabled="editorForm.changeType === 'void'"
                @update:model-value="changeApproval">
                <el-option v-for="approval in approvalVersions" :key="approval.id" :value="approval.id"
                  :label="'第 ' + approval.version_no + ' 版' + (approval.id === editorProject.approval.id ? '（当前）' : '')" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col v-if="editorForm.mode === 'project_total' && editorForm.changeType !== 'void'" :span="12">
            <el-form-item label="本次金额（元）" required>
              <el-input v-model="editorForm.amountYuan" placeholder="如 1200.00"/>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="结算日期">
              <el-date-picker v-model="editorForm.settlementOn" type="date"
                value-format="YYYY-MM-DD" placeholder="可选"/>
            </el-form-item>
          </el-col>
          <el-col v-if="editorForm.changeType !== 'void'" :span="24">
            <el-form-item label="结算依据" required>
              <el-input v-model="editorForm.basis" type="textarea" :rows="2"
                placeholder="请填写本次结算依据"/>
            </el-form-item>
          </el-col>
          <el-col v-if="editing?.version" :span="24">
            <el-form-item :label="editorForm.changeType === 'void' ? '作废原因' : '修订说明'">
              <el-input v-model="editorForm.reason" type="textarea" :rows="2" />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <template v-if="editorForm.mode === 'itemized' && editorForm.changeType !== 'void'">
        <div class="my-3 flex flex-wrap items-center justify-between">
          <h3 class="font-semibold">本次结算子费用</h3>
          <el-button :disabled="saving || switching" data-guide-action="finance.cost-item-add" @click="addItem">新增子费用</el-button>
        </div>
        <el-table :data="editorItems" row-key="key" border empty-text="请选择末级费用科目并录入金额">
          <el-table-column label="费用科目" min-width="190">
            <template #default="{ row }">
              <CostCategoryField v-model="row.cost_node_id" :nodes="costNodes"
                :frozen-name="costNames.get(row.cost_node_id) ? undefined : row.costNodeName"
                :disabled="saving || switching" />
            </template>
          </el-table-column>
          <el-table-column label="关联批准需求" min-width="185">
            <template #default="{ row }">
              <el-select v-model="row.project_scope_id" clearable filterable :disabled="saving || switching" placeholder="共同费用可留空">
                <el-option v-for="scope in adoptedApproval?.scopes" :key="scope.project_scope_id"
                  :value="scope.project_scope_id" :label="scope.demand_no" />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="82">
            <template #default="{ row }">
              <el-button link type="danger" :disabled="saving || switching"
                data-guide-action="finance.cost-item-remove" @click="editorItems = editorItems.filter(item => item.key !== row.key)">移除</el-button>
            </template>
          </el-table-column>
        </el-table>
        <BusinessWorksheet v-if="editorItems.length" ref="itemSheet" class="mt-3"
          name="子费用金额及依据" :session-key="itemSession" :rows="itemRows" :columns="itemColumns"
          :validate="validateItems" :disabled="saving||switching" @change="updateItems" />
      </template>
      <SettlementWorkSheet v-if="editorForm.changeType !== 'void'"
        ref="worksheet"
        :inert="saving || switching"
        :project-id="editorProject.id"
        :approval-id="editorForm.approvalId"
        :settlement-id="editing?.id"
        :resolutions="resolutions"
        @readiness-change="worksheetReady=$event"
      />

      </template>
    </el-card>
  </section>
</template>

<script setup lang="ts">
import BusinessWorksheet from "@/components/BusinessWorksheet/BusinessWorksheet.vue";
import type {WorksheetColumn,WorksheetValues,WorksheetIssue} from "@/components/BusinessWorksheet/univer-engine";
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import SettlementWorkSheet from "@/components/business/SettlementWorkSheet.vue";
import CostCategoryField from "@/components/business/CostCategoryField.vue";
import { fenToYuan, yuanToFen } from "@/api/business/funding";
import { projectApprovalHistory, projectDetail, type ProjectApproval, type ProjectDetail } from "@/api/business/projects";
import { listCostNodes, saveSettlementDraft, settlementDetail, type CostNode, type SettlementDetails, type SettlementItemInput,
  type SettlementMode, type SettlementResolutionInput } from "@/api/business/finance";
import { useUserStore } from "@/stores/user";

interface EditorItem extends Omit<SettlementItemInput, "amount_fen"> {
  key: number;
  amountYuan: string;
  costNodeName?: string;
}

const route = useRoute();
const router = useRouter();
const user = useUserStore();
const loadError = ref("");
const editorLoading=ref(true);
const editorProject=ref<ProjectDetail|null>(null);
const approvalVersions=ref<ProjectApproval[]>([]);
const editing=ref<SettlementDetails|null>(null);
const editorForm=reactive({
  amountYuan:"",basis:"",settlementOn:"",reason:"",approvalId:"",
  mode:"project_total" as SettlementMode,changeType:"initial" as "initial"|"revision"|"void",
});
const editorItems=ref<EditorItem[]>([]);
let itemKey=0;
let editorSequence=0;
let originalEditor="";
const resolutions=ref<SettlementResolutionInput[]>([]);
const worksheetReady=ref(false),saving=ref(false);
const switching=ref(false),submitting=ref(false);
const worksheet=ref<InstanceType<typeof SettlementWorkSheet>>();
const adoptedApproval=computed(()=>approvalVersions.value.find(row=>row.id===editorForm.approvalId));
const editorTitle=computed(()=>editorForm.changeType==="void"?"编制作废草稿":editing.value?.version?"编制结算修订":"编制结算草稿");
const costNodes = ref<CostNode[]>([]);
const costNames = computed(() => new Map(costNodes.value.map(node => [node.id, node.name])));
const eligibleCostNodes = computed(() => new Set(costNodes.value.filter(node => node.selectable).map(node => node.id)));
const itemSheet=ref<InstanceType<typeof BusinessWorksheet>>();
const itemColumns:WorksheetColumn[]=[
  {key:"label",title:"费用科目",width:240},{key:"scope",title:"关联需求",width:170},
  {key:"amount",title:"金额（元）",width:125,editable:true,numeric:true},{key:"evidence",title:"结算依据",width:260,editable:true},
];
const itemSession=computed(()=>JSON.stringify(editorItems.value.map(row=>[row.key,row.cost_node_id,row.project_scope_id])));
const itemRows=computed(()=>editorItems.value.map(row=>({
  id:String(row.key),label:costNames.value.get(row.cost_node_id) || row.costNodeName || "未选费用科目",
  values:{label:costNames.value.get(row.cost_node_id) || row.costNodeName || "未选费用科目",
    scope:adoptedApproval.value?.scopes.find(scope=>scope.project_scope_id===row.project_scope_id)?.demand_no||"共同费用",
    amount:row.amountYuan,evidence:row.evidence??""},
})));
function validateItems(values:WorksheetValues):WorksheetIssue[]{
  const issues:WorksheetIssue[]=[];
  itemRows.value.forEach((row,i)=>{
    try{yuanToFen(values[row.id]?.amount??"");}
    catch(cause){const message=cause instanceof Error?cause.message:String(cause);issues.push({row:i+1,column:2,cell:"C"+(i+2),rowId:row.id,field:"amount",location:row.label,message});}
  });
  return issues;
}
function updateItems(values:WorksheetValues){
  for(const row of editorItems.value){const item=values[String(row.key)];if(item){row.amountYuan=item.amount??"";row.evidence=item.evidence??"";}}
}
function addItem(){
  editorItems.value.push({key:++itemKey,cost_node_id:"",amountYuan:"",evidence:""});
}
function editorState(){
  return JSON.stringify([editorForm, editorItems.value]);
}
function editorDirty(){
  return Boolean(originalEditor) && (editorState() !== originalEditor || worksheet.value?.changed());
}
async function allowExit(){
  if(saving.value||switching.value)return false;
  if (originalEditor) { await worksheet.value?.finishEditing(); await itemSheet.value?.finishEditing(); }
  if(!editorDirty())return true;
  try{
    await ElMessageBox.confirm("当前结算有未保存的修改，确定放弃？","离开结算编制",{
      type:"warning",confirmButtonText:"放弃修改",cancelButtonText:"继续编制",
    });
    return true;
  }catch{return false;}
}
function beforeUnload(event:BeforeUnloadEvent){
  if(!editorDirty()&&!saving.value&&!switching.value)return;
  event.preventDefault();
  event.returnValue=true;
}

async function load() {
  const sequence = ++editorSequence;
  const entry = route.name;
  const settlementId = route.params.settlementId;
  const projectId = route.params.projectId;
  editorLoading.value = true;
  editorProject.value = null;
  editing.value = null;
  originalEditor = "";
  loadError.value = "";
  try {
    if (!user.userInfo.perms.includes("write")) throw Error("当前账号无结算编制权限");
    const record = typeof settlementId === "string" ? await settlementDetail(settlementId) : null;
    const id = record?.project_id ?? projectId;
    if (typeof id !== "string") throw Error("缺少结算所属项目");
    const voiding = entry === "SettlementVoid";
    if (record?.deleted || (record?.review?.action === "submit" && !record.draft))
      throw Error("结算单已删除或正在审核，请从结算列表查看");
    if (voiding && (record?.status !== "approve" || record.draft))
      throw Error("仅可对已审核且无待处理草稿的结算单编制作废");
    if (!voiding) {
      // Fetch the editor bundle while the authorized compose route reads project facts.
      // The worksheet owns the visible load-error state and retries.
      void import("@/components/business/settlement-worksheet").catch(() => {});
    }
    const [row, versions, categories] = await Promise.all([
      projectDetail(id), projectApprovalHistory(id), voiding ? [] : listCostNodes(id),
    ]);
    if (sequence !== editorSequence) return;
    if (!row.approval || row.status !== "approved" || row.deleted)
      throw Error("本项目当前不可编制结算");
    costNodes.value = categories;
    approvalVersions.value = versions.filter(version => version.status === "approved");
    editing.value = record;
    const original=record?.draft?.document??record?.version;
    Object.assign(editorForm,{
      amountYuan:original?fenToYuan(original.amount_fen):"",
      basis:original?.basis??"",
      settlementOn:original?.settlement_on??"",
      reason:record?.draft?.document.reason??"",
      approvalId:original?.approval_version_id??row.approval.id,
      mode:original?.mode??"project_total",
      changeType:voiding?"void":record?.draft?.document.change_type??(record?.version?"revision":"initial"),
    });
    const items=record?.draft?.document.items??record?.items??[];
    editorItems.value=items.map(({amount_fen,...item},index)=>({
      ...item,key:++itemKey,amountYuan:fenToYuan(amount_fen),
      costNodeName:record?.document_details?.items[index]?.cost_node_name,
    }));
    const adoptedResolutions=record?.draft?.document.resolutions??record?.resolutions??[];
    resolutions.value=adoptedResolutions.map(row=>({
      project_scope_id:row.project_scope_id,location_item_no:row.location_item_no,
      resolved_quantity_scaled:row.resolved_quantity_scaled,evidence:row.evidence??"",
    }));
    worksheetReady.value=false;
    originalEditor=editorState();
    editorProject.value=row;
  } catch (cause) {
    if (sequence === editorSequence) loadError.value = (cause as Error).message;
  } finally {
    if (sequence === editorSequence) editorLoading.value = false;
  }
}

async function returnToFinance() {
  await router.push({ name: "Finance", query: route.query });
}

async function changeApproval(id:string){
  if(!id||id===editorForm.approvalId||switching.value||!worksheet.value)return;
  switching.value=true;
  try{
    await itemSheet.value?.finishEditing();
    const issues=await worksheet.value.previewSwitch(id);
    const allowed=new Set(approvalVersions.value.find(row=>row.id===id)?.scopes.map(row=>row.project_scope_id));
    const excluded=editorItems.value.filter(row=>row.project_scope_id&&!allowed.has(row.project_scope_id));
    const affected = [...issues, ...excluded.map(row => costNames.value.get(row.cost_node_id) || row.costNodeName || "所填子费用采用的需求不在目标版本")];
    if (affected.length || editing.value) {
      const message = affected.length ? "切换将移除以下受影响的输入：" + affected.join("；")
        : "确认采用所选批准版本？请核对该版本的作业位置和批准数量。";
      await ElMessageBox.confirm(message, "核对批准版本差异", {
        type: "warning", confirmButtonText: "确认切换", cancelButtonText: "保持当前版本",
      });
    }
    editorItems.value=editorItems.value.filter(row=>!excluded.includes(row));
    worksheetReady.value=false;
    editorForm.approvalId=id;
  }catch(e){if(e!=="cancel"&&e!=="close")ElMessage.error((e as Error).message)}
  finally{switching.value=false}
}
async function saveDraft(submitNow = false){
  if(!editorProject.value?.approval||saving.value||switching.value||
    (editorForm.changeType!=="void"&&!worksheetReady.value))return;
  saving.value=true;
  submitting.value=submitNow;
  let saved=false;
  try{
    const positions = editorForm.changeType === "void" ? { resolutions: [] }
      : await worksheet.value?.prepareSave();
    const itemValues=editorForm.mode==="itemized"&&editorForm.changeType!=="void"&&editorItems.value.length ? await itemSheet.value?.prepareSave() : {};
    if (!positions || !itemValues) return;
    const items=editorForm.mode==="itemized"&&editorForm.changeType!=="void"
      ?editorItems.value.map(({key:_key,amountYuan,costNodeName:_name,...item})=>({
        ...item,amount_fen:yuanToFen(amountYuan),
      })):[];
    if(items.some(item=>!eligibleCostNodes.value.has(item.cost_node_id)))
      throw Error("请选择本项目有效的末级费用科目");
    if (submitNow) await ElMessageBox.confirm("提交后结算进入待审核状态，审核完成前不可编辑。确定提交？","提交结算审核",{
      type:"warning",confirmButtonText:"确认提交",cancelButtonText:"继续编辑",
    });
    await saveSettlementDraft({
      projectId:editorProject.value.id,approvalId:editorForm.approvalId,
      amountYuan:editorForm.amountYuan,basis:editorForm.basis,
      settlementOn:editorForm.settlementOn,resolutions:positions.resolutions,
      items,mode:editorForm.mode,reason:editorForm.reason,changeType:editorForm.changeType,existing:editing.value,submitNow,
    });
    originalEditor="";
    saved=true;
    ElMessage.success(submitNow ? "已提交结算审核" : "草稿已保存，可继续编辑");
  }catch(e){if(e!=="cancel"&&e!=="close")ElMessage.error((e as Error).message)}
  finally{saving.value=false;submitting.value=false}
  if(saved)await returnToFinance();
}

watch(() => route.fullPath, () => {
  if (["SettlementCreate", "SettlementEdit", "SettlementVoid"].some(name => route.name === name))
    void load();
}, { immediate: true });
onBeforeRouteLeave(allowExit);
onBeforeRouteUpdate(allowExit);
window.addEventListener("beforeunload", beforeUnload);
onBeforeUnmount(() => {
  editorSequence++;
  window.removeEventListener("beforeunload", beforeUnload);
});
</script>

<style scoped>
.settlement-context { margin-bottom: 20px; }
.settlement-compose-page {
  height: auto;
  min-height: 100%;
}
.settlement-compose :deep(.el-card__body) {
  display: block;
  overflow: visible;
}
.settlement-compose :deep(.el-card__header) {
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--el-bg-color);
}
.settlement-compose {
  overflow: visible;
}
</style>

<template>
  <div data-guide-workspace class="page-container" v-loading="loading">
    <el-card class="page-content approval-document" shadow="never">
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 class="text-lg font-semibold">{{ title }}</h2>
            <div v-if="project"><div>项目编号：{{ project.code }}</div><div>项目名称：{{ project.name }}</div></div>
          </div>
          <div class="page-heading-actions flex flex-wrap gap-2">
            <el-button @click="returnToProject">返回子项目</el-button>
            <el-button v-if="!project && !loading" @click="load">重试</el-button>
            <el-button data-guide-action="projects.approval-draft" v-if="canCompile && !error" type="primary" :loading="submitting"
              :disabled="!selectedRows.length || Boolean(invalidScope)" @click="prepareSave">
              {{ baseline ? "核对变更差异" : "保存立项草稿" }}
            </el-button>
            <el-button data-guide-action="projects.approval-discard" v-if="reviewing && draft && canWrite" :disabled="submitting"
              @click="discard">撤回草稿</el-button>
            <el-button data-guide-action="projects.approve" v-if="reviewing && draft && approveAction" type="primary" :loading="submitting"
              :disabled="!approveAction.enabled" @click="approve">确认正式批准</el-button>
          </div>
        </div>
      </template>

      <el-alert v-if="error" class="mb-3" type="error" :title="error" :closable="false" show-icon />
      <template v-if="canCompile && !error">
        <el-form label-position="top" novalidate :disabled="submitting">
          <div class="flex flex-wrap gap-x-6">
            <el-form-item label="拟批准预算（元）" required>
              <el-input v-model="budget" inputmode="decimal" placeholder="0.00" />
            </el-form-item>
            <el-form-item v-if="baseline" label="当前正式批准预算">
              <span>{{ projectMoney(baseline.approved_budget_fen) }}</span>
            </el-form-item>
          </div>
          <el-form-item label="编制依据">
            <el-input v-model="basis" type="textarea" :rows="2" />
          </el-form-item>
          <el-form-item v-if="baseline" label="变更原因">
            <el-input v-model="reason" type="textarea" :rows="2" />
          </el-form-item>
          <el-form-item v-if="baseline" label="新增候选需求">
            <el-button data-guide-action="projects.add-candidate" type="primary" @click="candidatePickerOpen=true">选择候选需求</el-button>
            <NativeRecordPicker v-if="candidatePickerOpen" title="选择候选需求" placeholder="按需求编号或问题描述搜索"
              confirm-label="纳入变更草稿" :columns="candidateColumns" :loader="loadCandidates"
              :selectable="canSelectCandidate" :saving="adding" @close="candidatePickerOpen=false" @confirm="addCandidate"/>
          </el-form-item>
        </el-form>
        <el-alert v-if="invalidScope" class="mb-3" type="warning" :title="invalidScope" :closable="false" />
        <el-table :data="scopeRows" row-key="id" border empty-text="当前没有可编制批准范围的已确认需求">
          <el-table-column label="纳入范围" width="102">
            <template #default="{ row }">
              <el-checkbox v-model="row.selected" :aria-label="'纳入 ' + row.demandNo"
                :disabled="row.required || submitting" />
            </template>
          </el-table-column>
          <el-table-column prop="demandNo" label="需求编号" min-width="135" />
          <el-table-column prop="problem" label="问题描述" min-width="200" />
          <el-table-column prop="operation" label="操作类型" min-width="150" />
          <el-table-column prop="expectedOn" label="预计解决时间" min-width="120" />
          <el-table-column prop="change" label="范围变化" min-width="150" />
          <el-table-column label="批准物资" width="150" fixed="right">
            <template #default="{row}">
              <el-button data-guide-action="projects.material-add" link type="primary" :disabled="!row.selected||submitting" @click="openMaterials(row as ScopeRow)">
                添加批准物资（{{row.materialDrafts.length}}）
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </template>

      <template v-if="reviewing && draft">
        <el-alert v-if="approveAction?.reason" class="mb-3" type="warning"
          :title="approveAction.reason" :closable="false" />
        <el-descriptions :column="2" border class="mb-4">
          <el-descriptions-item label="待审核版本">第 {{ draft.version_no }} 版</el-descriptions-item>
          <el-descriptions-item label="拟批准预算">{{ projectMoney(draft.approved_budget_fen) }}</el-descriptions-item>
          <el-descriptions-item v-if="baseline" label="原正式批准预算">
            {{ projectMoney(baseline.approved_budget_fen) }}
          </el-descriptions-item>
          <el-descriptions-item v-if="baseline" label="预算差额">
            {{ projectMoney(draft.approved_budget_fen - baseline.approved_budget_fen) }}
          </el-descriptions-item>
          <el-descriptions-item label="参考计价">
            {{ draft.reference.complete ? projectMoney(draft.reference.total_fen) : "未完整计价" }}
          </el-descriptions-item>
          <el-descriptions-item label="编制依据">{{ draftBasis || "—" }}</el-descriptions-item>
          <el-descriptions-item v-if="baseline" label="变更原因">{{ draft.change_reason || "—" }}</el-descriptions-item>
        </el-descriptions>
        <div v-if="canWrite && draft.scopes.length" class="mb-3 flex flex-wrap gap-2">
          <el-button v-for="scope in draft.scopes" :key="scope.id" data-guide-action="projects.quote" @click="quoteScope = scope">
            对需求 {{ scope.demand_no }} 按承接范围核价
          </el-button>
        </div>
        <el-form v-if="approveAction?.enabled" label-position="top" novalidate :disabled="submitting">
          <el-form-item label="审核意见">
            <el-input v-model="reviewReason" type="textarea" :rows="2" />
          </el-form-item>
        </el-form>
      </template>
      <el-empty v-if="reviewing && project && !draft" description="当前没有待审核草稿" />

      <template v-if="selectedRows.length && (canCompile || draft)">
        <h3 class="my-3 font-semibold">本次纳入的作业位置</h3>
        <el-table :data="positionRows" row-key="id" border max-height="460">
          <el-table-column prop="demandNo" label="需求编号" min-width="130" />
          <el-table-column prop="revision" label="需求版本" width="100" />
          <el-table-column prop="line" label="线路" min-width="135" />
          <el-table-column prop="position" label="作业位置" min-width="150" />
          <el-table-column v-if="positionRows.some(row=>row.startTower||row.endTower)" prop="startTower" label="起点杆塔号" width="120" />
          <el-table-column v-if="positionRows.some(row=>row.startTower||row.endTower)" prop="endTower" label="终点杆塔号" width="120" />
          <el-table-column prop="quantity" label="批准数量" width="105" />
          <el-table-column prop="unit" label="计量单位" width="105" />
        </el-table>
      </template>
      <template v-if="selectedRows.length && (canCompile || draft)">
        <h3 class="my-3 font-semibold">本次批准物资</h3>
        <el-alert class="mb-3" type="info" :closable="false" title="批准物资独立于需求预计物资，不自动按工作量换算；历史版本不被覆盖；如物资定义已变化，请移除旧项后重新选择并核对差异。"/>
        <BusinessWorksheet v-if="canCompile && materialRows.length" ref="materialSheet"
          name="批准物资数量" :session-key="materialSession" :rows="materialSheetRows" :columns="materialColumns"
          :validate="validateMaterialSheet" :disabled="submitting" @change="updateMaterialSheet" />
        <div v-if="canCompile" class="flex flex-wrap gap-2 mt-2">
          <el-button v-for="row in materialRows" :key="row.id" link type="danger" data-guide-action="projects.material-remove"
            :disabled="submitting" @click="removeMaterial(row.scope,row.material.id)">移除 {{row.material.name}}（{{row.demandNo}}）</el-button>
        </div>
        <el-table v-else :data="materialRows" row-key="id" border max-height="380" empty-text="本次未批准物资">
          <el-table-column prop="demandNo" label="需求编号" min-width="140"/>
          <el-table-column prop="material.name" label="物资名称" min-width="180"/>
          <el-table-column prop="material.unit" label="计量单位" width="110"/>
          <el-table-column label="批准数量" width="145">
            <template #default="{row}">
              <span>{{row.material.quantity}}</span>
            </template>
          </el-table-column>
          <el-table-column label="采用版本" min-width="125">
            <template #default="{row}">{{row.material.versionLabel||"草稿指定版本"}}</template>
          </el-table-column>
        </el-table>
        <p v-if="materialError" class="mt-2 text-[var(--el-color-danger)]">{{materialError}}</p>
      </template>
    </el-card>
    <el-dialog v-model="materialPickerOpen" title="选择批准物资" append-to-body align-center width="min(95vw,900px)" destroy-on-close>
      <el-space wrap class="mb-3">
        <el-input v-model="materialKeyword" clearable placeholder="物资名称 / 规格 / 型号" @keyup.enter="loadMaterials(true)"/>
        <el-button :loading="materialLoading" @click="loadMaterials(true)">查询</el-button>
      </el-space>
      <el-table ref="materialPicker" :data="materialOptions" v-loading="materialLoading" row-key="id" border max-height="360"
        @selection-change="(rows:Material[])=>materialSelected=rows">
        <el-table-column type="selection" width="48" reserve-selection :selectable="(row:Material)=>!materialScope?.materialDrafts.some(item=>item.id===row.id)"/>
        <el-table-column prop="code" label="编号" min-width="125"/>
        <el-table-column prop="name" label="名称" min-width="150"/>
        <el-table-column prop="model" label="型号" min-width="120"/>
        <el-table-column prop="specification" label="规格" min-width="120"/>
        <el-table-column prop="unit_id_label" label="计量单位" width="100"/>
        <el-table-column prop="version_no" label="版本" width="80"/>
      </el-table>
      <el-pagination class="mt-3" v-model:current-page="materialPage" :page-size="20" :total="materialTotal"
        layout="total, prev, pager, next" @current-change="loadMaterials(false)"/>
      <template #footer>
        <el-button @click="materialPickerOpen=false">取消</el-button>
        <el-button type="primary" :disabled="!materialSelected.length||materialLoading" @click="addMaterials">添加所选物资（{{materialSelected.length}}）</el-button>
      </template>
    </el-dialog>
    <el-dialog v-model="confirmOpen" title="核对正式变更差异" width="min(90vw, 620px)"
      :close-on-click-modal="false" append-to-body>
      <p>批准预算 {{ projectMoney(baseline?.approved_budget_fen) }} → {{ projectMoney(prepared?.approved_budget_fen) }}</p>
      <ul class="my-3 list-disc pl-5">
        <li v-for="row in selectedRows" :key="row.id">需求 {{ row.demandNo }}：{{ row.change }}</li>
      </ul>
      <el-table v-if="materialDiffs.length" :data="materialDiffs" border max-height="280" class="mb-3">
        <el-table-column prop="demandNo" label="需求" min-width="110"/>
        <el-table-column prop="name" label="物资" min-width="125"/>
        <el-table-column prop="before" label="原批准" min-width="100"/>
        <el-table-column prop="after" label="本次批准" min-width="100"/>
        <el-table-column prop="versionChange" label="定义版本" min-width="100"/>
      </el-table>
      <p>草稿保存后须经正式审核，新增候选需求在审核通过时建立关联。</p>
      <template #footer>
        <el-button :disabled="submitting" @click="confirmOpen = false">返回核对</el-button>
        <el-button type="primary" :loading="submitting" @click="persist">确认并保存变更草稿</el-button>
      </template>
    </el-dialog>
    <ProjectQuoteDialog v-if="quoteScope" :scope="quoteScope" @close="quoteScope = undefined"
      @confirmed="refreshQuote" />
  </div>
</template>

<script setup lang="ts">
import { locationDisplayFields } from "../../../../server/shared/location-display";

import NativeRecordPicker from "@/components/business/NativeRecordPicker.vue";
import BusinessWorksheet from "@/components/BusinessWorksheet/BusinessWorksheet.vue";
import type {WorksheetColumn,WorksheetValues,WorksheetIssue} from "@/components/BusinessWorksheet/univer-engine";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ElMessage, ElMessageBox, type TableInstance } from "element-plus";
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from "vue-router";
import { useUserStore } from "@/stores/user";
import ProjectQuoteDialog from "@/components/business/ProjectQuoteDialog.vue";
import { readDemand, queryDemands, type DemandLocation, type DemandRow } from "@/api/business/demands";
import { fenToYuan, yuanToFen } from "@/api/business/funding";
import {
  approvalCandidates, approveProject, projectActions, projectDetail, projectMoney, saveApproval,
  withdrawApproval, type ApprovedProjectScope, type ApprovalScopeInput, type ProjectAction,
  type ProjectApprovalCandidate, type ProjectApprovalInput, type ProjectDetail,
} from "@/api/business/projects";
import { formatScaledDecimal, exactScaledDecimalText, quantityFitsUnitPrecision } from "@/utils/business/fixed-scale";
import { queryMaterials, readMaterial, type Material } from "@/api/business/materials";
import { readDictionary } from "@/api/business/dictionaries";

interface Position {
  location_item_no: number;
  approved_quantity_scaled: number;
  position: string;
  line: string;
  startTower:string;
  endTower:string;
}
interface MaterialDraft { id:string;name:string;unit:string;quantity:string;versionId:string;versionLabel:string; precision?:number }
interface ScopeRow {
  id: string;
  demandNo: string;
  problem: string;
  operation: string;
  expectedOn: string;
  unit: string;
  required: boolean;
  selected: boolean;
  incomplete: boolean;
  change: string;
  input: ApprovalScopeInput;
  positions: Position[];
  materialDrafts: MaterialDraft[];
}
type ScopeDemand = Pick<ProjectApprovalCandidate, "work_locations" | "operation_snapshot" |
  "unit_snapshot" | "expected_on" | "current_version" | "demand_no" | "problem_description">;

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const submitting = ref(false);
const error = ref("");
const project = ref<ProjectDetail>();
const actions = ref<ProjectAction[]>([]);
const scopeRows = ref<ScopeRow[]>([]);
const budget = ref("");
const basis = ref("");
const reason = ref("");
const reviewReason = ref("");
const confirmOpen = ref(false);
const prepared = ref<ProjectApprovalInput>();
const quoteScope = ref<ApprovedProjectScope>();
const candidatePickerOpen=ref(false);
const adding = ref(false);
const materialPickerOpen=ref(false),materialLoading=ref(false);
const materialScope=ref<ScopeRow>(),materialPicker=ref<TableInstance>();
const materialKeyword=ref(""),materialPage=ref(1),materialTotal=ref(0);
const materialOptions=ref<Material[]>([]),materialSelected=ref<Material[]>([]);
let materialSearchSequence=0,appliedMaterialKeyword="";
let loadSequence = 0;
let initial = "";

const canWrite = computed(() => useUserStore().userInfo.perms.includes("write"));
const reviewing = computed(() => route.params.task === "review");
const baseline = computed(() => project.value?.approvals.find(row => row.id === project.value?.approval?.id));
const draft = computed(() => project.value?.approvals.find(row => row.status === "draft"));
const approveAction = computed(() => actions.value.find(action => action.key === "approve" && action.approval_id === draft.value?.id));
const canCompile = computed(() => Boolean(project.value && !reviewing.value && !draft.value &&
  canWrite.value && ["stocked", "approved"].includes(project.value.status)));
const title = computed(() => reviewing.value
  ? baseline.value ? "审核正式变更" : "审核首次立项"
  : baseline.value ? "编制正式变更" : "编制首次立项");
const draftBasis = computed(() => draft.value && (JSON.parse(draft.value.snapshot_json) as { basis?: string }).basis);
const selectedRows = computed(() => scopeRows.value.filter(row => row.selected));
const materialRows=computed(()=>selectedRows.value.flatMap(scope=>scope.materialDrafts.map(material=>({
  id:scope.id+":"+material.id,scope,material,demandNo:scope.demandNo
}))));
const materialSheet=ref<InstanceType<typeof BusinessWorksheet>>();
const materialColumns:WorksheetColumn[]=[
  {key:"demand",title:"需求编号",width:140},{key:"name",title:"物资名称",width:180},
  {key:"unit",title:"计量单位",width:110},{key:"quantity",title:"批准数量",width:145,editable:true,numeric:true},
  {key:"version",title:"采用版本",width:125},
];
const materialSession=computed(()=>JSON.stringify(materialRows.value.map(row=>[row.id,row.material.versionId])));
const materialSheetRows=computed(()=>materialRows.value.map(row=>({id:row.id,label:row.material.name,
  values:{demand:row.demandNo,name:row.material.name,unit:row.material.unit,quantity:row.material.quantity,version:row.material.versionLabel||"草稿指定版本"}})));
function approvedMaterialError(material:MaterialDraft,raw:string) {
  const n=exactScaledDecimalText(raw,4);
  if(!material.versionId||material.precision===undefined)return "物资版本或当前计量单位精度未核实";
  if(n===null||n<=0)return "请输入大于零且最多四位小数的数量";
  if(!quantityFitsUnitPrecision(n,material.precision))return material.precision===0?"该计量单位仅允许整数":"该计量单位最多允许 "+material.precision+" 位小数";
  return "";
}
function validateMaterialSheet(values:WorksheetValues):WorksheetIssue[]{
  return materialRows.value.flatMap((row,i)=>{
    const message=approvedMaterialError(row.material,values[row.id]?.quantity??"");
    return message ? [{row:i+1,column:3,cell:"D"+(i+2),rowId:row.id,field:"quantity",
      location:row.material.name,message}] : [];
  });
}
function updateMaterialSheet(values:WorksheetValues){
  for(const row of materialRows.value)if(values[row.id])row.material.quantity=values[row.id].quantity??"";
}
const materialError=computed(()=>{
  if(!canCompile.value)return "";
  for(const {material,demandNo} of materialRows.value){
    const message=approvedMaterialError(material,material.quantity);
    if(message)return "需求 "+demandNo+" 的物资 "+material.name+"："+message;
  }
  return "";
});
const materialDiffs=computed(()=>{
  const prior=new Map(baseline.value?.scopes.map(scope=>[scope.project_scope_id,scope.materials]));
  return selectedRows.value.flatMap(scope=>{
    const old=new Map((prior.get(scope.id)||[]).map(row=>[row.material_id,row]));
    const next=new Map(scope.materialDrafts.map(row=>[row.id,row]));
    return [...new Set([...old.keys(),...next.keys()])].flatMap(id=>{
      const a=old.get(id),b=next.get(id);
      const before=a?formatScaledDecimal(a.approved_quantity_scaled,4)+" "+a.unit_snapshot:"无";
      const after=b?b.quantity+" "+b.unit:"移除";
      return before!==after||a?.material_version_id!==b?.versionId
        ?[{demandNo:scope.demandNo,name:b?.name||a?.material_name||"历史物资",before,after,versionChange:a&&b&&a.material_version_id!==b.versionId?"已变化":"—"}]:[];
    });
  });
});
const invalidScope = computed(()=>( selectedRows.value.find(row => row.incomplete)?.demandNo
  ? `${selectedRows.value.find(row => row.incomplete)?.demandNo} 的当前需求版本无法完整保留原批准位置，请先核对正式需求。`
  : ""));
const positionRows = computed(() => selectedRows.value.flatMap(row => row.positions.map(position => ({
  ...position,
  id: `${row.id}:${position.location_item_no}`,
  demandNo: row.demandNo,
  revision: row.input.demand_version,
  quantity: formatScaledDecimal(position.approved_quantity_scaled, 4),
  unit: row.unit,
}))));

function positionIdentity(location: DemandLocation): string {
  return `${location.location_kind}:${location.logical_tower_id || location.physical_tower_id || location.span_id}`;
}

function positionDetails(location: DemandLocation, quantity: number): Position {
  const snapshot = location.location_snapshot_json;
  return {
    location_item_no: location.item_no,
    approved_quantity_scaled: quantity,
    position: locationDisplayFields(location.location_kind,snapshot).location_label,
    line: snapshot.line_name || "—",
    startTower:locationDisplayFields(location.location_kind,snapshot).start_tower_no,
    endTower:locationDisplayFields(location.location_kind,snapshot).end_tower_no,
  };
}

function buildRow(demand: ScopeDemand, identity: { project_scope_id: string } | { demand_id: string },
  prior?: ApprovedProjectScope, submitted?: ApprovalScopeInput, snapshots?:ApprovedProjectScope["materials"]): ScopeRow {
  const amounts = new Map(prior?.locations.map(row =>
    [`${row.location_kind}:${row.location_object}`, row.approved_quantity_scaled]));
  const submittedAmounts = new Map(submitted?.locations.map(row => [row.location_item_no, row.approved_quantity_scaled]));
  const positions = demand.work_locations.flatMap(location => {
    const amount = submitted ? submittedAmounts.get(location.item_no) : prior
      ? amounts.get(positionIdentity(location)) : location.remaining_quantity_scaled ?? location.quantity_scaled;
    return amount && amount > 0 ? [positionDetails(location, amount)] : [];
  });
  const materials = submitted?.materials ?? prior?.materials.map(row => ({
    material_id: row.material_id, quantity_scaled: row.approved_quantity_scaled,
  })) ?? [];
  const metadata=new Map((snapshots??prior?.materials??[]).map(row=>[row.material_id,row]));
  const materialDrafts=materials.map(row=>{
    const m=metadata.get(row.material_id);
    return {id:row.material_id,name:m?.material_name||"物资待读取",unit:m?.unit_snapshot||"—",
      quantity:formatScaledDecimal(row.quantity_scaled,4),versionId:submitted?.expected_material_versions?.[row.material_id]??m?.material_version_id??"",
      versionLabel:m?"正式采用版本":"草稿指定版本"};
  });
  return {
    id: "demand_id" in identity ? identity.demand_id : identity.project_scope_id,
    demandNo: demand.demand_no,
    problem: demand.problem_description,
    operation: demand.operation_snapshot,
    expectedOn: demand.expected_on || "待补填",
    unit: demand.unit_snapshot,
    required: Boolean(prior),
    selected: Boolean(submitted || prior || !baseline.value),
    incomplete: !positions.length || Boolean(prior && positions.length !== amounts.size),
    change: prior ? prior.demand_version === demand.current_version ? "沿用原批准范围" : "采用新版需求"
      : baseline.value ? "新增完整承接范围" : "首次立项范围",
    input: {
      ...identity,
      demand_version: demand.current_version,
      approved_amount_fen: submitted?.approved_amount_fen ?? prior?.approved_amount_fen ?? null,
      locations: positions.map(({ location_item_no, approved_quantity_scaled }) => ({
        location_item_no, approved_quantity_scaled,
      })),
      materials,
    },
    positions,materialDrafts,
  };
}

function draftState() {
  return JSON.stringify([budget.value, basis.value, reason.value, reviewReason.value,
    scopeRows.value.map(row => [row.id,row.selected,row.materialDrafts.map(({id,quantity,versionId})=>[id,quantity,versionId])])]);
}

function isDirty() {
  return Boolean(initial && draftState() !== initial);
}

function beforeUnload(event: BeforeUnloadEvent) {
  if (!isDirty() && !submitting.value) return;
  event.preventDefault();
  event.returnValue = true;
}

async function guardExit() {
  if (submitting.value) return false;
  await materialSheet.value?.finishEditing();
  if (!isDirty()) return true;
  try {
    await ElMessageBox.confirm("当前页面有未保存的修改，确定离开？", "离开办理页", {
      type: "warning", confirmButtonText: "放弃修改", cancelButtonText: "继续办理",
    });
    return true;
  } catch {
    return false;
  }
}

async function load() {
  const sequence = ++loadSequence;
  const id = String(route.params.projectId || "");
  const task = route.params.task;
  loading.value = true;
  error.value = "";
  project.value = undefined;
  scopeRows.value = [];
  reviewReason.value = "";
  initial = "";
  try {
    if (task !== "compile" && task !== "review") throw Error("未知的项目办理入口");
    const current = await projectDetail(id);
    const next = task === "review" ? await projectActions(id) : [];
    const candidates = task === "compile" ? await approvalCandidates(id) : [];
    if (sequence !== loadSequence) return;
    project.value = current;
    actions.value = next;
    budget.value = fenToYuan(current.approval?.approved_budget_fen ?? 0);
    basis.value = "";
    reason.value = "";
    const previous = new Map(baseline.value?.scopes.map(row => [row.project_scope_id, row]));
    if (task === "compile") {
      if (!canCompile.value) throw Error("项目当前状态或账号权限不允许编制草稿");
      scopeRows.value = candidates.filter(row => row.status === "active").map(demand =>
        buildRow(demand, { project_scope_id: demand.project_scope_id }, previous.get(demand.project_scope_id)));
      if (baseline.value?.scopes.some(scope => !scopeRows.value.some(row => row.id === scope.project_scope_id)))
        throw Error("原批准需求已发生变化，请先核对正式需求和承接范围");
    } else if (draft.value) {
      scopeRows.value = [
        ...draft.value.scopes.map(scope => {
          const demand = JSON.parse(scope.snapshot_json) as ScopeDemand;
          return buildRow({ ...demand, current_version: scope.demand_version, demand_no: scope.demand_no },
            { project_scope_id: scope.project_scope_id }, previous.get(scope.project_scope_id), {
              demand_version: scope.demand_version, locations: scope.locations, materials: scope.materials.map(item=>({material_id:item.material_id,quantity_scaled:item.approved_quantity_scaled})),
            },scope.materials);
        }),
        ...draft.value.pending_scopes.map(scope => buildRow(
          { ...scope.snapshot, current_version: scope.demand_version }, { demand_id: scope.demand_id }, undefined, scope)),
      ];
    }
    if(task==="review"){
      // Pending candidate material labels may not have an approval item until formal adoption.
      const missing=scopeRows.value.flatMap(row=>row.materialDrafts.filter(material=>material.name==="物资待读取"));
      const labels=await Promise.all([...new Set(missing.map(row=>row.id))].map(async id=>[id,await readMaterial(id,true)] as const));
      if(sequence!==loadSequence)return;
      const byId=new Map(labels);
      for(const item of missing){
        const current=byId.get(item.id);
        if(current){
          item.name=current.name;item.unit=current.unit_id_label;
          item.versionLabel=current.material_version_id===item.versionId?"草稿指定版本":"定义已变化，请退回重新编制";
        }
      }
    }
    if(task==="compile"){
      const items=scopeRows.value.flatMap(row=>row.materialDrafts);
      const materials=new Map(await Promise.all([...new Set(items.map(item=>item.id))].map(async id=>[id,await readMaterial(id,true)] as const)));
      const units=new Map(await Promise.all([...new Set([...materials.values()].map(item=>item.unit_id))].map(async id=>[id,await readDictionary("units",id)] as const)));
      if(sequence!==loadSequence)return;
      for(const item of items){
        const current=materials.get(item.id);
        if(!current||current.deleted)continue;
        // New approval facts adopt the current unit, as the server's materialUnits does.
        // Preserve the existing expected material-version conflict semantics.
        item.precision=units.get(current.unit_id)?.quantity_precision;
      }
    }
    initial = draftState();
  } catch (cause) {
    if (sequence === loadSequence) error.value = (cause as Error).message;
  } finally {
    if (sequence === loadSequence) loading.value = false;
  }
}

const candidateColumns:{key:keyof DemandRow;label:string;width?:number}[]=[
  {key:"demand_no",label:"需求编号",width:160},{key:"problem_description",label:"问题描述",width:250},
  {key:"operation_snapshot",label:"操作类型"},{key:"line_count",label:"涉及线路数"},
  {key:"display_status",label:"状态"},
];
function loadCandidates(keyword:string,page:number){return queryDemands({keyword,page,pageSize:20,status:"待承接"});}
function canSelectCandidate(row:DemandRow){return !row.deleted&&!row.binding&&row.status==="active"&&!scopeRows.value.some(item=>item.demandNo===row.demand_no);}
async function addCandidate(selected:DemandRow[]){
  if(adding.value||!selected.length)return;
  adding.value=true;
  const sequence=loadSequence;
  try{
    const demands=await Promise.all(selected.map(item=>readDemand(item.id)));
    if(sequence!==loadSequence)return;
    const additions=demands.map(demand=>{
      if(demand.binding||demand.status!=="active")throw Error("需求承接资格已变化，请重新查询");
      if(scopeRows.value.some(row=>row.demandNo===demand.demand_no))throw Error("已纳入该需求");
      const row=buildRow(demand,{demand_id:demand.id});
      if(!row.positions.length)throw Error("需求已无未完成位置");
      return {...row,selected:true};
    });
    scopeRows.value.push(...additions);
    candidatePickerOpen.value=false;
  }catch(cause){if(sequence===loadSequence)ElMessage.error((cause as Error).message);}
  finally{if(sequence===loadSequence)adding.value=false;}
}

function openMaterials(row:ScopeRow){
  if(!canCompile.value||!row.selected)return;
  materialScope.value=row;materialKeyword.value="";materialSelected.value=[];materialPickerOpen.value=true;
  void loadMaterials(true);
}
async function loadMaterials(reset=false){
  if(reset){materialPage.value=1;appliedMaterialKeyword=materialKeyword.value;materialPicker.value?.clearSelection();materialSelected.value=[]}
  const seq=++materialSearchSequence;materialLoading.value=true;
  try{
    const result=await queryMaterials({page:materialPage.value,pageSize:20,keyword:appliedMaterialKeyword,status:"active"});
    if(seq!==materialSearchSequence)return;
    materialOptions.value=result.items;materialTotal.value=result.total;
  }catch(cause){if(seq===materialSearchSequence)ElMessage.error((cause as Error).message)}
  finally{if(seq===materialSearchSequence)materialLoading.value=false}
}
async function addMaterials(){
  const row=materialScope.value;if(!row||!canCompile.value||materialLoading.value)return;
  await materialSheet.value?.finishEditing();
  materialLoading.value=true;
  try{
    const ids=new Set(row.materialDrafts.map(item=>item.id));
    const selected=materialSelected.value.filter(material=>!ids.has(material.id)&&!material.deleted&&material.status==="active");
    const units=new Map(await Promise.all([...new Set(selected.map(item=>item.unit_id))].map(async id=>[id,await readDictionary("units",id)] as const)));
    const additions=selected.map(material=>{
      const precision=units.get(material.unit_id)?.quantity_precision;
      if(precision===undefined||!quantityFitsUnitPrecision(0,precision))throw Error("物资计量单位缺少有效数量精度");
      return {id:material.id,name:material.name,unit:material.unit_id_label,precision,
        quantity:"1",versionId:material.material_version_id,versionLabel:"V"+material.version_no};
    });
    row.materialDrafts.push(...additions);materialPickerOpen.value=false;
  }catch(cause){ElMessage.error(cause instanceof Error?cause.message:String(cause))}
  finally{materialLoading.value=false}
}
async function removeMaterial(row:ScopeRow,id:string){
  await materialSheet.value?.finishEditing();
  if(canCompile.value&&!submitting.value)row.materialDrafts=row.materialDrafts.filter(item=>item.id!==id);
}
async function prepareSave() {
  if (!project.value || submitting.value || !selectedRows.value.length || invalidScope.value) return;
  try {
    if(materialRows.value.length && !await materialSheet.value?.prepareSave())return;
    prepared.value = {
      expected_version: project.value.version,
      expected_approval_version_id: baseline.value?.id ?? null,
      approved_budget_fen: yuanToFen(budget.value),
      scopes: selectedRows.value.map(row=>({
        ...row.input,
        materials:row.materialDrafts.map(material=>{
          const quantity=exactScaledDecimalText(material.quantity,4);
          if(quantity===null||approvedMaterialError(material,material.quantity))throw Error("批准物资数量或版本无效");
          return {material_id:material.id,quantity_scaled:quantity};
        }),
        expected_material_versions:Object.fromEntries(row.materialDrafts.map(material=>[material.id,material.versionId])),
      })),
      basis: basis.value.trim(), reason: reason.value.trim(),
      confirm_changes: Boolean(baseline.value),
    };
    if (baseline.value) confirmOpen.value = true;
    else void persist();
  } catch (cause) {
    ElMessage.error((cause as Error).message);
  }
}

async function persist() {
  if (!project.value || !prepared.value || submitting.value) return;
  submitting.value = true;
  const id = project.value.id;
  try {
    await saveApproval(id, prepared.value);
    initial = draftState();
    confirmOpen.value = false;
    ElMessage.success(baseline.value ? "变更草稿已保存" : "立项草稿已保存");
  } catch (cause) {
    ElMessage.error((cause as Error).message);
    return;
  } finally {
    submitting.value = false;
  }
  await router.replace({ name: "ProjectApproval", params: { projectId: id, task: "review" }, query: route.query });
}

async function refreshQuote() {
  const current = project.value;
  if (!current) return;
  try {
    const updated = await projectDetail(current.id);
    if (project.value?.id === current.id) project.value = updated;
  } catch (cause) {
    ElMessage.error((cause as Error).message);
  }
}

function returnToProject() {
  return router.push({ name: "Projects", query: { ...route.query, project: route.params.projectId } });
}

async function approve() {
  const current = project.value;
  const approval = draft.value;
  if (!current || !approval || submitting.value || !approveAction.value?.enabled) return;
  if (!await confirmAction("确认正式批准本次版本及其冻结范围？", "正式批准")) return;
  submitting.value = true;
  try {
    await approveProject(current, approval.id, reviewReason.value.trim());
    initial = draftState();
    ElMessage.success("已正式批准");
  } catch (cause) {
    ElMessage.error((cause as Error).message);
    return;
  } finally {
    submitting.value = false;
  }
  await returnToProject();
}

async function discard() {
  const current = project.value;
  const approval = draft.value;
  if (!current || !approval || submitting.value) return;
  if (!await confirmAction("撤回后需重新编制草稿，正式批准历史继续保留。", "撤回草稿")) return;
  submitting.value = true;
  try {
    await withdrawApproval(current.id, approval.id);
    initial = draftState();
    ElMessage.success("草稿已撤回");
  } catch (cause) {
    ElMessage.error((cause as Error).message);
    return;
  } finally {
    submitting.value = false;
  }
  await returnToProject();
}

async function confirmAction(message: string, title: string) {
  try {
    await ElMessageBox.confirm(message, title, { type: "warning" });
    return true;
  } catch {
    return false;
  }
}

onBeforeRouteLeave(guardExit);
onBeforeRouteUpdate(guardExit);
watch(() => [route.params.projectId, route.params.task], ([id, task]) => {
  if (id && task) void load();
}, { immediate: true });
window.addEventListener("beforeunload", beforeUnload);
onBeforeUnmount(() => {
  ++loadSequence;
  window.removeEventListener("beforeunload", beforeUnload);
});
</script>

<style scoped>
/* A multi-section document must not use the list page's fixed three-row grid. */
.approval-document > :deep(.el-card__body) { display: block; overflow: auto; }
</style>

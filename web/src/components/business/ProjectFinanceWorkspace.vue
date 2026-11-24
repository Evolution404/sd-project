<template>
  <div class="page-main">
  <el-tabs v-model="tab" class="shrink-0">
    <el-tab-pane name="nodes"><template #label><span data-guide-action="finance.categories">费用科目</span></template></el-tab-pane>
    <el-tab-pane label="实际费用" name="costs" />
    <el-tab-pane name="reconciliations"><template #label><span data-guide-action="finance.reconciliation-section">费用核对</span></template></el-tab-pane>
  </el-tabs>

  <el-card v-if="tab === 'nodes'" class="page-content" shadow="never">
    <div class="page-heading-actions mb-3 flex flex-wrap gap-2">
      <el-button data-guide-action="finance.category-root" v-if="canWrite && !closed" type="primary" @click="openNode()">新增一级科目</el-button>
      <el-checkbox data-guide-action="finance.category-show-deleted" v-model="includeDeletedNodes" label="包含已删除" />
      <el-button :loading="loadingNodes" @click="loadNodes">刷新</el-button>
    </div>
    <el-table :data="nodeTree" row-key="id" border default-expand-all v-loading="loadingNodes">
      <el-table-column prop="name" label="费用科目" min-width="195" />
      <el-table-column label="状态" width="95">
        <template #default="{ row }">{{ row.deleted ? "已删除" : row.status === "active" ? "启用" : "停用" }}</template>
      </el-table-column>
      <el-table-column prop="reference_count" label="历史引用" width="96" />
      <el-table-column label="操作" min-width="230">
        <template #default="{ row }">
          <el-button data-guide-action="finance.category-history" link type="primary" @click="viewNodeHistory(row.id)">查看历史</el-button>
          <template v-if="canWrite && !closed && !row.deleted">
            <el-button data-guide-action="finance.category-child" v-if="row.can_add_child" link type="primary" @click="openNode(undefined, row.id)">新增下级</el-button>
            <el-button data-guide-action="finance.category-edit" link type="primary" @click="editNode(row.id)">修订</el-button>
          </template>
          <el-button data-guide-action="finance.category-delete" v-if="canAdmin && !closed && !row.deleted" link type="danger" @click="removeNode(row.id)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-card>

  <template v-if="tab === 'costs'">
    <el-checkbox data-guide-action="finance.cost-show-deleted" v-model="includeDeletedCosts" class="shrink-0" label="包含已删除费用" @change="costCrud?.search()" />
    <CrudPage embedded ref="costCrud" :search-config="costSearch" :table-config="costTable">
      <template #table-cell-amount_fen="{ row }">{{ projectMoney(row.amount_fen) }}</template>
      <template #table-cell-status="{ row }">{{ row.deleted ? "已删除" : row.status === "voided" ? "已作废" : "有效" }}</template>
    </CrudPage>
  </template>

  <CrudPage embedded v-if="tab === 'reconciliations'" ref="reconciliationCrud"
    :search-config="reconciliationSearch" :table-config="reconciliationTable">
    <template #table-cell-reconciled_cost_fen="{ row }">{{ projectMoney(row.reconciled_cost_fen) }}</template>
    <template #table-cell-reconciled_settlement_fen="{ row }">{{ projectMoney(row.reconciled_settlement_fen) }}</template>
    <template #table-cell-status="{ row }">
      {{ row.status === "voided" ? "已作废" : !row.effective ? "所用版本已变更" : row.is_final ? "已最终核对" : "有效" }}
    </template>
  </CrudPage>

  </div>

  <el-dialog v-model="nodeOpen" :title="nodeTarget ? '修订费用科目' : '新增费用科目'"
    width="min(90vw, 560px)" append-to-body :close-on-click-modal="false">
    <el-form label-position="top" novalidate :disabled="busy">
      <el-form-item v-if="nodeForm.parent_id" label="上级科目">{{ nodes.find(node => node.id === nodeForm.parent_id)?.name }}</el-form-item>
      <el-form-item label="科目名称" required><el-input v-model="nodeForm.name" /></el-form-item>
      <el-form-item label="科目状态">
        <el-radio-group v-model="nodeForm.status">
          <el-radio value="active">启用</el-radio>
          <el-radio value="inactive">停用</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="修订说明"><el-input v-model="nodeForm.reason" type="textarea" /></el-form-item>
    </el-form>
    <template #footer>
      <el-button :disabled="busy" @click="nodeOpen = false">取消</el-button>
      <el-button data-guide-action="finance.category-save" type="primary" :disabled="!nodeForm.name.trim()" :loading="busy" @click="persistNode">保存科目</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="costOpen" :title="costTarget ? '修订实际费用' : '登记实际费用'"
    width="min(90vw, 620px)" append-to-body :close-on-click-modal="false">
    <el-form label-position="top" novalidate :disabled="busy">
      <el-form-item label="费用事项" required><el-input v-model="costForm.title" /></el-form-item>
      <el-form-item label="费用科目" required>
        <CostCategoryField v-model="costForm.cost_node_id" :nodes="nodes"
          :frozen-name="costTarget?.cost_node_name" :readonly="Boolean(costTarget)" :disabled="busy" />
      </el-form-item>
      <el-form-item label="实际金额（元）" required><el-input v-model="costForm.amount" inputmode="decimal" /></el-form-item>
      <el-form-item label="发生日期" required>
        <el-date-picker v-model="costForm.occurred_on" type="date" value-format="YYYY-MM-DD" />
      </el-form-item>
      <el-form-item label="发票号"><el-input v-model="costForm.invoice_number" /></el-form-item>
      <el-form-item label="费用凭据" required><el-input v-model="costForm.evidence" type="textarea" /></el-form-item>
      <el-form-item v-if="costTarget" label="修订说明"><el-input v-model="costForm.reason" type="textarea" /></el-form-item>
    </el-form>
    <template #footer>
      <el-button :disabled="busy" @click="costOpen = false">取消</el-button>
      <el-button data-guide-action="finance.cost" type="primary" :loading="busy" @click="persistCost">核定费用</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="reconciliationOpen" :title="reconciliationTarget ? '修订费用核对' : '核对实际费用与结算明细'" width="min(90vw, 680px)"
    append-to-body :close-on-click-modal="false">
    <el-form label-position="top" novalidate :disabled="busy">
      <el-descriptions title="采用实际费用" border :column="2" class="mb-3">
        <el-descriptions-item label="费用事项">{{ reconciliationTarget?.cost_title ?? costTarget?.title }}</el-descriptions-item>
        <el-descriptions-item label="版本">{{ reconciliationTarget?.cost_version ?? costTarget?.version_no }}</el-descriptions-item>
        <el-descriptions-item label="金额">{{ projectMoney(reconciliationTarget?.cost_amount_fen ?? costTarget?.amount_fen) }}</el-descriptions-item>
      </el-descriptions>
      <el-form-item label="生效结算明细" required>
        <div class="w-full">
          <el-descriptions v-if="selectedReconciliationItem" border :column="2" class="mb-2">
            <el-descriptions-item label="结算编号">{{selectedReconciliationItem.number}}</el-descriptions-item>
            <el-descriptions-item label="费用科目">{{selectedReconciliationItem.cost_node_name}}</el-descriptions-item>
            <el-descriptions-item label="结算金额">{{projectMoney(selectedReconciliationItem.amount_fen)}}</el-descriptions-item>
          </el-descriptions>
          <el-button @click="reconciliationPickerOpen=true">选择生效结算明细</el-button>
        </div>
      </el-form-item>
      <el-form-item label="核对实际费用（元）" required><el-input v-model="reconciliationForm.cost" inputmode="decimal" /></el-form-item>
      <el-form-item label="核对结算金额（元）" required><el-input v-model="reconciliationForm.settlement" inputmode="decimal" /></el-form-item>
      <el-form-item label="核对依据"><el-input v-model="reconciliationForm.evidence" type="textarea" /></el-form-item>
      <el-checkbox v-model="reconciliationForm.final" label="标记最终核对" />
    </el-form>
    <template #footer>
      <el-button :disabled="busy" @click="reconciliationOpen = false">取消</el-button>
      <el-button data-guide-action="finance.reconcile" type="primary" :loading="busy" @click="persistReconciliation">保存核对</el-button>
    </template>
  </el-dialog>

  <NativeRecordPicker v-if="reconciliationOpen && reconciliationPickerOpen" single title="选择生效结算明细" placeholder="搜索结算单编号或费用科目" confirm-label="确认选择"
    :columns="reconciliationPickerColumns" :loader="loadReconciliationPage" @close="reconciliationPickerOpen=false" @confirm="selectReconciliationItem"/>
  <el-drawer v-model="historyOpen" :title="historyTitle" size="min(90vw, 670px)" append-to-body>
    <el-table :data="historyRows" row-key="id" border v-loading="historyLoading">
      <el-table-column prop="version" label="版本" width="85" />
      <el-table-column prop="content" label="版本记录" min-width="165" />
      <el-table-column v-if="historyRows.some(row=>row.amount!==undefined)" prop="amount" label="金额" min-width="105" />
      <el-table-column prop="time" label="记录时间" min-width="175" />
      <el-table-column v-if="historyRows.some(row=>row.attachmentOwner)" label="附件" width="95">
        <template #default="{ row }">
          <el-button v-if="row.attachmentOwner" link type="primary" @click="openEvidence(row.attachmentOwner, true)">附件</el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-drawer>
  <el-drawer v-model="evidenceOpen" title="实际费用版本附件" size="min(95vw, 730px)" append-to-body destroy-on-close>
    <BusinessEvidence v-if="evidenceTarget" :key="evidenceTarget.owner" kind="cost_version_id" :owner="evidenceTarget.owner" :readonly="evidenceTarget.readonly" />
  </el-drawer>
</template>

<script setup lang="ts">
import { historyScopeField, nativeListQuery, nativeColumnFilter } from "@/utils/business/native-list-query";
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { usePageOverlays } from "@/composables/usePageOverlays";
import CrudPage from "@/components/Crud/CrudPage.vue";
import CostCategoryField from "./CostCategoryField.vue";
import BusinessEvidence from "./BusinessEvidence.vue";
import NativeRecordPicker from "@/components/business/NativeRecordPicker.vue";
import type { CrudRecord, CrudSearchConfig, CrudTableConfig } from "@/components/Crud/types";
import { useUserStore } from "@/stores/user";
import { fenToYuan, yuanToFen } from "@/api/business/funding";
import { projectMoney } from "@/api/business/projects";
import { formatBeijingDateTime } from "@/utils/business/datetime";
import {
  costDeletionPreview, costHistory, costNodeHistory, deleteActualCost, deleteCostNode, listActualCosts,
  listCostNodes, listCostReconciliations, listReconciliationItems, reconciliationHistory,
  saveActualCost, saveCostNode, saveCostReconciliation,
  removeCostReconciliation, voidCostReconciliation,
  type ActualCost, type CostNode, type CostReconciliation, type ReconciliationItem,
} from "@/api/business/finance";

const props = defineProps<{ projectId: string; closed: boolean; initialTab?: "costs" | "reconciliations" }>();
const user = useUserStore();
const canWrite = computed(() => user.userInfo.perms.includes("write"));
const canAdmin = computed(() => user.userInfo.perms.includes("admin"));
const tab = ref<"nodes" | "costs" | "reconciliations">(props.initialTab || "costs");
const nodes = ref<CostNode[]>([]);
const loadingNodes = ref(false);
const includeDeletedNodes = ref(false);
const includeDeletedCosts = ref(false);
const nodeOpen = ref(false);
const costOpen = ref(false);
const reconciliationOpen = ref(false);
const nodeTarget = ref<CostNode>();
const costTarget = ref<ActualCost>();
const reconciliationTarget = ref<CostReconciliation>();
const nodeForm = reactive({ name: "", parent_id: null as string | null, status: "active" as CostNode["status"], reason: "" });
const costForm = reactive({ title: "", cost_node_id: "", amount: "", occurred_on: "", invoice_number: "", evidence: "", reason: "" });
const reconciliationForm = reactive({ item: "", cost: "", settlement: "", evidence: "", final: false });
const reconciliationPickerOpen=ref(false);
const selectedReconciliationItem=ref<ReconciliationItem>();
type ReconciliationChoice=ReconciliationItem & {amount:string};
const reconciliationPickerColumns:{key:keyof ReconciliationChoice;label:string;width?:number}[]=[
  {key:"number",label:"结算编号"},{key:"cost_node_name",label:"费用科目"},{key:"demand_no",label:"需求编号"},{key:"amount",label:"金额"}];
async function loadReconciliationPage(keyword:string,page:number){
  const result=await listReconciliationItems(props.projectId,keyword,page);
  return {...result,items:result.items.map(row=>({...row,amount:projectMoney(row.amount_fen)}))};
}
function selectReconciliationItem(rows:ReconciliationChoice[]){
  if(!rows[0])return;
  selectedReconciliationItem.value=rows[0];reconciliationForm.item=rows[0].id;reconciliationPickerOpen.value=false;
}
const busy = ref(false);
const historyOpen = ref(false);
const historyLoading = ref(false);
const historyTitle = ref("");
const historyRows = ref<{ id: string; version: number; content: string; time: string; amount?: string; attachmentOwner?: string }[]>([]);
const evidenceOpen = ref(false);
const evidenceTarget = ref<{ owner: string; readonly: boolean }>();
function openEvidence(owner: string, readonly: boolean) {
  evidenceTarget.value = { owner, readonly };
  evidenceOpen.value = true;
}
let historyRequest = 0;
usePageOverlays([nodeOpen,costOpen,reconciliationOpen,reconciliationPickerOpen,historyOpen,evidenceOpen],{
  async mayLeave(){
    if(busy.value)return false;
    if(!nodeOpen.value&&!costOpen.value&&!reconciliationOpen.value)return true;
    try{
      await ElMessageBox.confirm("当前财务表单尚未提交，确定离开并放弃？","放弃表单修改",{
        type:"warning",confirmButtonText:"放弃修改",cancelButtonText:"继续填写",
      });
      return true;
    }catch{return false}
  },
  invalidate(){
    historyRequest++;
    reconciliationPickerOpen.value=false;historyLoading.value=false;
    selectedReconciliationItem.value=undefined;historyRows.value=[];
  }
});
const costCrud = ref<InstanceType<typeof CrudPage>>();
const reconciliationCrud = ref<InstanceType<typeof CrudPage>>();

interface CostTreeRow extends CostNode { children: CostTreeRow[] }
const nodeTree = computed(() => {
  const rows = new Map(nodes.value.filter(node => includeDeletedNodes.value || !node.deleted)
    .map(node => [node.id, { ...node, children: [] } as CostTreeRow]));
  const roots: CostTreeRow[] = [];
  for (const row of rows.values()) {
    const parent = row.parent_id && rows.get(row.parent_id);
    if (parent) parent.children.push(row);
    else roots.push(row);
  }
  return roots;
});

async function loadNodes() {
  loadingNodes.value = true;
  try {
    nodes.value = await listCostNodes(props.projectId);
  } catch (cause) {
    ElMessage.error((cause as Error).message);
  } finally {
    loadingNodes.value = false;
  }
}

function openNode(node?: CostNode, parentId?: string) {
  nodeTarget.value = node;
  Object.assign(nodeForm, { name: node?.name ?? "", parent_id: node?.parent_id ?? parentId ?? null,
    status: node?.status ?? "active", reason: "" });
  nodeOpen.value = true;
}
function editNode(id: string) {
  const node = nodes.value.find(row => row.id === id);
  if (node) openNode(node);
}

function openCost(cost?: ActualCost) {
  costTarget.value = cost;
  Object.assign(costForm, {
    title: cost?.title ?? "", cost_node_id: cost?.cost_node_id ?? "", amount: cost ? fenToYuan(cost.amount_fen) : "",
    occurred_on: cost?.occurred_on ?? "", invoice_number: cost?.invoice_number ?? "", evidence: cost?.evidence ?? "", reason: "",
  });
  costOpen.value = true;
}

function run(operation: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  void operation().catch(cause => {
    if (cause !== "cancel" && cause !== "close") ElMessage.error((cause as Error).message);
  }).finally(() => { busy.value = false; });
}

function persistNode() {
  run(async () => {
    await saveCostNode(props.projectId, { ...nodeForm, name: nodeForm.name.trim(), expected_version: nodeTarget.value?.version_no }, nodeTarget.value?.id);
    nodeOpen.value = false;
    ElMessage.success("费用科目已保存");
    await loadNodes();
  });
}

function removeNode(id: string) {
  run(async () => {
    const current = (await listCostNodes(props.projectId)).find(row => row.id === id);
    if (!current || current.deleted) throw Error("费用科目已变化，请刷新");
    await ElMessageBox.confirm(`删除「${current.name}」将从正常列表隐藏。直属下级 ${current.child_count} 项，历史引用 ${current.reference_count} 项仍可追溯。`,
      "删除费用科目", { type: "warning" });
    await deleteCostNode(props.projectId, current);
    ElMessage.success("费用科目已删除");
    await loadNodes();
  });
}

function persistCost() {
  run(async () => {
    const target = costTarget.value;
    await saveActualCost(props.projectId, {
      title: costForm.title.trim(), cost_node_id: costForm.cost_node_id, amount_fen: yuanToFen(costForm.amount),
      occurred_on: costForm.occurred_on, invoice_number: costForm.invoice_number || null,
      evidence: costForm.evidence.trim(), reason: costForm.reason.trim(), status: "active", expected_version: target?.version_no,
    }, target?.entry_id);
    costOpen.value = false;
    ElMessage.success("实际费用已核定");
    await costCrud.value?.refresh();
  });
}

function voidCost(row: ActualCost) {
  run(async () => {
    const { value } = await ElMessageBox.prompt("作废将保留费用历史并停止累计。填写作废原因。", "作废实际费用", {
      type: "warning", inputValidator: value => Boolean(value.trim()) || "请填写作废原因",
    });
    await saveActualCost(props.projectId, {
      title: row.title, cost_node_id: row.cost_node_id, amount_fen: row.amount_fen, occurred_on: row.occurred_on,
      invoice_number: row.invoice_number, evidence: row.evidence, status: "voided", reason: value.trim(),
      expected_version: row.version_no,
    }, row.entry_id);
    ElMessage.success("实际费用已作废");
    await costCrud.value?.refresh();
  });
}

function removeCost(row: ActualCost) {
  run(async () => {
    const preview = await costDeletionPreview(props.projectId, row.entry_id);
    if (preview.blocked) throw Error(preview.blocked);
    await ElMessageBox.confirm(
      `删除「${preview.title}」将从正常列表隐藏。涉及 ${preview.reconciliation_count} 条有效核对，金额 ${projectMoney(preview.reconciled_cost_fen)}。`,
      "删除实际费用", { type: "warning" },
    );
    await deleteActualCost(props.projectId, row.entry_id, preview.expected_version, preview.reconciliation_count);
    ElMessage.success("实际费用已删除");
    await costCrud.value?.refresh();
  });
}

function openReconciliation(row: ActualCost) {
  costTarget.value = row;
  reconciliationTarget.value = undefined;
  Object.assign(reconciliationForm, { item: "", cost: "", settlement: "", evidence: "", final: false });
  selectedReconciliationItem.value=undefined;reconciliationPickerOpen.value=false;
  reconciliationOpen.value = true;
}
function editReconciliation(row: CostReconciliation) {
  reconciliationTarget.value = row;
  Object.assign(reconciliationForm, {
    item: row.settlement_item_version_id, cost: fenToYuan(row.reconciled_cost_fen),
    settlement: fenToYuan(row.reconciled_settlement_fen), evidence: row.evidence, final: Boolean(row.is_final),
  });
  selectedReconciliationItem.value={id:row.settlement_item_version_id,number:row.settlement_number,cost_node_name:row.item_cost_node_name,amount_fen:row.item_amount_fen,demand_no:null};
  reconciliationPickerOpen.value=false;reconciliationOpen.value = true;
}

function persistReconciliation() {
  run(async () => {
    const current = reconciliationTarget.value;
    const costVersionId = current?.cost_version_id ?? costTarget.value?.id;
    if (!costVersionId || !reconciliationForm.item) throw Error("请选择生效结算明细");
    await saveCostReconciliation({
      cost_version_id: costVersionId, settlement_item_version_id: reconciliationForm.item,
      reconciled_cost_fen: yuanToFen(reconciliationForm.cost), reconciled_settlement_fen: yuanToFen(reconciliationForm.settlement),
      is_final: reconciliationForm.final, evidence: reconciliationForm.evidence.trim(),
      expected_version: current?.version_no ?? 0, record_id: current?.record_id,
    });
    reconciliationOpen.value = false;
    tab.value = "reconciliations";
    ElMessage.success("费用核对已保存");
    if (current) await reconciliationCrud.value?.refresh();
  });
}
function voidReconciliation(row: CostReconciliation) {
  run(async () => {
    const { value } = await ElMessageBox.prompt("填写本次作废依据", "作废费用核对", {
      type: "warning", inputValidator: value => Boolean(value?.trim()) || "请填写作废依据",
    });
    await voidCostReconciliation(row, value.trim());
    ElMessage.success("费用核对已作废");
    await reconciliationCrud.value?.refresh();
  });
}
function deleteReconciliation(row: CostReconciliation) {
  run(async () => {
    await ElMessageBox.confirm(`当前为第 ${row.version_no} 版，将从常规列表隐藏并保留正式历史。确认删除？`,
      "核对费用记录删除影响", { type: "warning", confirmButtonText: "确认删除" });
    await removeCostReconciliation(row);
    ElMessage.success("费用核对已删除");
    await reconciliationCrud.value?.refresh();
  });
}

async function loadHistory(title: string, request: () => Promise<typeof historyRows.value>) {
  const sequence = ++historyRequest;
  historyTitle.value = title; historyRows.value = []; historyLoading.value = true; historyOpen.value = true;
  try {
    const rows = await request();
    if (sequence === historyRequest) historyRows.value = rows;
  } catch (cause) {
    if (sequence === historyRequest) ElMessage.error((cause as Error).message);
  } finally {
    if (sequence === historyRequest) historyLoading.value = false;
  }
}

function viewCostHistory(entryId: string) {
  return loadHistory("实际费用历史", async () => (await costHistory(props.projectId, entryId)).map(version => ({
    id: version.id, version: version.version_no, content: version.title, amount: projectMoney(version.amount_fen),
    time: formatBeijingDateTime(version.confirmed_at), attachmentOwner: version.id,
  })));
}

function viewNodeHistory(id: string) {
  return loadHistory("费用科目历史", async () => (await costNodeHistory(props.projectId, id)).versions.map(row => ({
    id: row.id, version: row.version_no, content: row.name, time: formatBeijingDateTime(row.recorded_at),
  })));
}

const costSearch: CrudSearchConfig = { fields: [{ type: "input", prop: "keywords", label: "费用事项", attrs: {
  clearable: true, placeholder: "费用事项、发票号或费用科目",
} }] };
const costTable: CrudTableConfig<CrudRecord, ActualCost> = {
  stateKey:"finance:costs:"+props.projectId,
  rowKey: "entry_id", table: { border: true }, tableTools: ["refresh", "columns", "search"],
  toolbarActions: [{ key: "register", label: "登记实际费用", permission: "cost.confirm",
    visible: () => !props.closed, onClick: () => openCost() }],
  async fetchData(query) {
    const result = await listActualCosts(props.projectId, Number(query.pageNum) || 1, Number(query.pageSize) || 20,
      String(query.keywords ?? ""), includeDeletedCosts.value, nativeListQuery(query, ["status"]));
    return { list: result.items, total: result.total };
  },
  columns: [
    { prop: "title", sortable: "custom", label: "费用事项", minWidth: 180 },
    { prop: "cost_node_name", sortable: "custom", label: "费用科目", minWidth: 150 },
    { prop: "amount_fen", sortable: "custom", label: "实际金额", minWidth: 100, cellType: "custom" },
    { prop: "occurred_on", sortable: "custom", label: "发生日期", minWidth: 112 },
    { prop: "status", sortable: "custom", ...nativeColumnFilter("status",[{text:"有效",value:"active"},{text:"已作废",value:"voided"}]), label: "费用状态", minWidth: 100, cellType: "custom" },
    { prop: "actions", label: "操作", width: 200, fixed: "right", cellType: "actions", actions: [
      { key: "history", label: "查看历史", permission: "read", onClick: ({ row }) => row && viewCostHistory(row.entry_id) },
      { key: "reconcile", label: "费用核对", permission: "cost.confirm", visible: ({ row }) => !props.closed && row?.status === "active" && !row.deleted,
        onClick: ({ row }) => row && openReconciliation(row as ActualCost) },
      { key: "revise", label: "修订", permission: "cost.confirm", visible: ({ row }) => !props.closed && row?.status === "active" && !row.deleted,
        onClick: ({ row }) => row && openCost(row as ActualCost) },
      { key: "void", label: "作废", permission: "cost.confirm", visible: ({ row }) => !props.closed && row?.status === "active" && !row.deleted,
        onClick: ({ row }) => row && voidCost(row as ActualCost) },
      { key: "remove", label: "删除", permission: "admin", visible: ({ row }) => !props.closed && Boolean(row && !row.deleted),
        onClick: ({ row }) => row && removeCost(row as ActualCost) },
      { key: "attachments", label: "附件", permission: "read", onClick: ({ row }) => {
        if (!row) return;
        if (row.deleted || row.status !== "active") return viewCostHistory(row.entry_id);
        openEvidence(row.id, props.closed);
      } },
    ] },
  ],
};
const reconciliationSearch: CrudSearchConfig = { fields: [{ type: "input", prop: "keywords", label: "费用核对", attrs: {
  clearable: true, placeholder: "搜索核对依据",
} },historyScopeField("finance.reconcile-show-deleted")] };
const reconciliationTable: CrudTableConfig<CrudRecord, CostReconciliation> = {
  stateKey:"finance:reconciliations:"+props.projectId,
  rowKey: "record_id", table: { border: true }, tableTools: ["refresh", "columns", "search"],
  async fetchData(query) {
    const result = await listCostReconciliations(props.projectId, Number(query.pageNum) || 1, Number(query.pageSize) || 20,
      String(query.keywords ?? ""), nativeListQuery(query));
    return { list: result.items, total: result.total };
  },
  columns: [
    { prop: "evidence", sortable: "custom", label: "核对依据", minWidth: 205 },
    { prop: "status", sortable: "custom", label: "核对状态", minWidth: 140, cellType: "custom" },
    { prop: "reconciled_cost_fen", sortable: "custom", label: "核对实际费用", minWidth: 145, cellType: "custom" },
    { prop: "reconciled_settlement_fen", sortable: "custom", label: "核对结算金额", minWidth: 145, cellType: "custom" },
    { prop: "actions", label: "操作", width: 175, cellType: "actions", actions: [
      { key: "history", label: "查看历史", permission: "read", onClick: ({ row }) => row && loadHistory("费用核对历史",
        async () => (await reconciliationHistory(props.projectId, String(row.record_id))).map(version => ({
          id: version.id, version: version.version_no, content: version.evidence || "—", time: formatBeijingDateTime(version.created_at),
        }))) },
      { key: "edit", label: "修订核对", permission: "cost.confirm",
        visible: ({ row }) => !props.closed && Boolean(row?.effective && row.status === "active"),
        onClick: ({ row }) => row && editReconciliation(row as CostReconciliation) },
      { key: "void", label: "作废核对", permission: "cost.confirm",
        visible: ({ row }) => !props.closed && row?.status === "active",
        onClick: ({ row }) => row && voidReconciliation(row as CostReconciliation) },
      { key: "remove", label: "删除核对", permission: "cost.confirm",
        visible: () => !props.closed,
        onClick: ({ row }) => row && deleteReconciliation(row as CostReconciliation) },
    ] },
  ],
};

onMounted(loadNodes);
</script>

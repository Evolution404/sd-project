<script setup lang="ts">
import CostCategoryWorkspace from "./components/CostCategoryWorkspace.vue";
import CostCategorySelect from "./components/CostCategorySelect.vue";
import type { CostCategoryNode } from "../../../../server/shared/types/trees";
const categoryNodes = ref<CostCategoryNode[]>([]);
import { useListRoute } from "../../shared/composables/use-list-route";import { useDialogDraftGuard } from "../../shared/forms/use-dialog-draft";
import RowActions from "../../shared/ui/RowActions.vue";
import BusinessHistory from "../../shared/ui/BusinessHistory.vue";
import { useAccess } from "../../shared/composables/use-access";
const can = useAccess();
import { ref, watch, computed } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import FieldControl from "../../shared/ui/FieldControl.vue";
import { formatVisibleDateTime } from "../../shared/utils/datetime";
import { readAdoptedQuantityPrecision } from "../../shared/api/quantity-precision";
import BusinessTable, { type TableColumn } from "../../shared/ui/BusinessTable.vue";
import ExchangePanel from "../exchange/ExchangePanel.vue";
import EvidencePanel from "../files/EvidencePanel.vue";
const evidence = ref<Row | null>(null);
import {
  api,
  today,
  type Row,
  money,
  quantity,
  statusText,
} from "../../shared/api/client";
type FocusKind = "cost" | "settlement" | "reconciliation";
type FocusedRecord = { kind: FocusKind; id: string };
const props = defineProps<{ project: Row; focus?: FocusedRecord | null }>();
const formRef = ref();
const scopePrecision = ref<Record<string, number>>({});
const scopePrecisionError = ref("");
const invalidQuantity = ref<Record<string, boolean>>({});
function markQuantityInvalid(path: string, invalid: boolean) {
  invalidQuantity.value = { ...invalidQuantity.value, [path]: invalid };
}
let scopePrecisionRequest = 0;
watch(() => [
  props.project.id,
  (props.project.scopes || []).map((scope: Row) => scope.id + ':' + (scope.demand_version || '')).join('|'),
  props.project.approval?.id || '',
] as const, async ([projectId]) => {
  const sequence = ++scopePrecisionRequest;
  scopePrecision.value = {};
  scopePrecisionError.value = "";
  try {
    const candidates = await api<Array<{
      project_scope_id: string;
      unit_id: string;
      unit_version: number;
    }>>("/projects/" + projectId + "/approval-candidates");
    const units = new Map<string, Promise<number>>();
    await Promise.all(candidates.map(async item => {
      const key = item.unit_id + "@" + item.unit_version;
      if (!units.has(key)) units.set(key,
        readAdoptedQuantityPrecision(item.unit_id, item.unit_version));
      const precision = await units.get(key)!;
      if (sequence === scopePrecisionRequest) {
        scopePrecision.value = {
          ...scopePrecision.value, [item.project_scope_id]: precision,
        };
      }
    }));
  } catch (failure) {
    if (sequence === scopePrecisionRequest)
      scopePrecisionError.value = "正式单位精度读取失败：" + (failure as Error).message;
  }
}, { immediate: true });


const focusedFact = ref<Row | Row[] | null>(null);
const focusedLoading = ref(false);
const focusedError = ref("");
const focusedHistoryOpen = ref(false);
let focusSequence = 0;
const focusedCurrent = computed<Row | null>(() => Array.isArray(focusedFact.value)
  ? [...focusedFact.value].sort((a, b) => (b.version_no || 0) - (a.version_no || 0))[0] || null
  : focusedFact.value);
const focusedTitle = computed(() => {
  const f = props.focus;
  if (!f) return "业务记录";
  return f.kind === "cost" ? "定位真实费用" : f.kind === "settlement" ? "定位独立结算单" : "定位正式费用核对";
});
async function loadFocusedRecord() {
  const sequence = ++focusSequence, focus = props.focus;
  focusedHistoryOpen.value = false;
  focusedFact.value = null;
  focusedError.value = "";
  if (!focus || !focus.id) return;
  focusedLoading.value = true;
  try {
    const uri = focus.kind === "cost"
      ? `/projects/${props.project.id}/costs/${focus.id}`
      : focus.kind === "settlement" ? "/projects/" + props.project.id + "/settlements/" + focus.id
      : "/projects/" + props.project.id + "/reconciliations/" + focus.id;
    const result = await api<Row | Row[]>(uri);
    if (sequence === focusSequence) {
      // Nested endpoints enforce ownership before returning any history.
      // The request sequence additionally protects against stale UI results.
      focusedFact.value = result;
    }
  } catch (error) {
    if (sequence === focusSequence) focusedError.value = (error as Error).message;
  } finally {
    if (sequence === focusSequence) focusedLoading.value = false;
  }
}
watch(() => [props.project.id, props.focus?.kind, props.focus?.id], () => {
  void loadFocusedRecord();
}, { immediate: true });
const showDeletedCosts = ref(false), showDeletedReconciliations = ref(false);
const emit = defineEmits(["changed"]);
const costs = ref<Row[]>([]),
  listLoading = ref(false),
  listError = ref(""),
  bills = ref<Row[]>([]),
  summary = ref<Row>({}),
  dialog = ref(""),
  form = ref<Row>({}),
  editing = ref<Row | null>(null),
  busy = ref(false),
  selected = ref<Row[]>([]),
  history = ref<Row | null>(null),
  reconciliations = ref<Row[]>([]);
const financeColumns: Record<string, TableColumn[]> = {
  costs: [
    // Keep operational state and amount visible beside the fixed action
    // column even in a 760px project-detail dialog.
    { key: "title", label: "事项", minWidth: 165 },
    { key: "status", label: "状态", minWidth: 105 },
    { key: "amount_fen", label: "实际金额", minWidth: 125 },
    { key: "occurred_on", label: "发生日期", minWidth: 115 },
  ],
  bills: [
    { key: "number", label: "结算编号", minWidth: 175 },
    { key: "review", label: "正式版本与状态", minWidth: 180, sortable: false, filterable: false },
    { key: "amount", label: "本次金额", minWidth: 145, sortable: false, filterable: false },
  ],
  reconciliations: [
    { key: "reconciled_cost_fen", label: "实际费用份额", minWidth: 165 },
    { key: "reconciled_settlement_fen", label: "结算核定额", minWidth: 165 },
    { key: "evidence", label: "核对依据", minWidth: 180 },
    { key: "status", label: "状态" },
  ],
  demands: [
    { key: "demand_no", label: "需求编号", minWidth: 190 },
    { key: "approved_quantity_scaled", label: "批准数量" },
    { key: "resolved_quantity_scaled", label: "已解决" },
    { key: "remaining_quantity_scaled", label: "未解决数量" },
    { key: "excess_quantity_scaled", label: "超量数量" },
  ],
};
const financeSort = ref({ costs: "", bills: "", reconciliations: "" });
const financeDirection = ref({ costs: "desc", bills: "desc", reconciliations: "desc" });
const financeFilters = ref<Record<string, Record<string, string>>>({ costs: {}, bills: {}, reconciliations: {} });
function financeTableSort(table: "costs" | "bills" | "reconciliations", value: { key: string; order: string }) {
  financeSort.value[table] = value.key;
  financeDirection.value[table] = value.order === "ascending" ? "asc" : "desc";
  if (table === "costs") costPage.value = 1;
  else if (table === "bills") billPage.value = 1;
  else reconPage.value = 1;
  load();
}
function financeTableFilter(table: "costs" | "bills" | "reconciliations", value: Record<string, string>) {
  financeFilters.value[table] = value;
  if (table === "costs") costPage.value = 1;
  else if (table === "bills") billPage.value = 1;
  else reconPage.value = 1;
  load();
}
// Reconciliation choices must not inherit the unrelated 30-row list pages.
// Search the project's full eligible records on demand; current selected
// immutable IDs remain available when the search keyword changes.
const reconcileCostChoices = ref<Row[]>([]);
const reconcileBillChoices = ref<Row[]>([]);
const reconcileCostsLoading = ref(false);
const reconcileBillsLoading = ref(false);
let reconcileCostSequence = 0;
let reconcileBillSequence = 0;
async function loadReconciliationChoices(kind: "costs" | "bills", term = "") {
  const sequence = kind === "costs" ? ++reconcileCostSequence : ++reconcileBillSequence;
  if (kind === "costs") reconcileCostsLoading.value = true;
  else reconcileBillsLoading.value = true;
  const projectId = props.project.id;
  const resource = kind === "costs" ? "costs" : "settlements";
  try {
    const page = await api<{items: Row[]}>(`/projects/${projectId}/${resource}?page=1&page_size=200&q=${encodeURIComponent(term.trim())}`);
    if (projectId !== props.project.id || sequence !== (kind === "costs" ? reconcileCostSequence : reconcileBillSequence)) return;
    if (kind === "costs") {
      const currentId = form.value.cost_version_id;
      const selected = reconcileCostChoices.value.find(row => row.id === currentId);
      const candidates = page.items.filter(row => row.status === "active" && !row.deleted);
      reconcileCostChoices.value = selected && !candidates.some(row => row.id === currentId)
        ? [selected, ...candidates] : candidates;
    } else {
      const currentId = form.value.settlement_item_version_id;
      const selected = reconcileBillChoices.value.find(row =>
        (row.items || []).some((item: Row) => item.id === currentId));
      const candidates = page.items.filter(row => row.review?.action === "approve" && !row.deleted);
      reconcileBillChoices.value = selected && !candidates.some(row => row.id === selected.id)
        ? [selected, ...candidates] : candidates;
    }
  } catch (failure) {
    if (projectId === props.project.id && sequence === (kind === "costs" ? reconcileCostSequence : reconcileBillSequence))
      ElMessage.error("费用核对候选记录读取失败：" + (failure as Error).message);
  } finally {
    if (kind === "costs" && sequence === reconcileCostSequence) reconcileCostsLoading.value = false;
    if (kind === "bills" && sequence === reconcileBillSequence) reconcileBillsLoading.value = false;
  }
}
const costPage = ref(1),
  billPage = ref(1),
  reconPage = ref(1),
  costTotal = ref(0),
  billTotal = ref(0),
  reconTotal = ref(0);
let loadSequence = 0;
async function load() {
  const sequence = ++loadSequence;
  listLoading.value = true;
  listError.value = "";
  try {
    const [costResult, billResult, summaryResult, reconResult, treeResult] = await Promise.all([
      api<{ items: Row[]; total: number }>(`/projects/${props.project.id}/costs?page=${costPage.value}&page_size=30&deleted=${showDeletedCosts.value}&sort=${encodeURIComponent(financeSort.value.costs || "created_at")}&direction=${financeDirection.value.costs}&filters=${encodeURIComponent(JSON.stringify(financeFilters.value.costs))}`),
      api<{ items: Row[]; total: number }>(`/projects/${props.project.id}/settlements?page=${billPage.value}&page_size=30&sort=${encodeURIComponent(financeSort.value.bills || "created_at")}&direction=${financeDirection.value.bills}&filters=${encodeURIComponent(JSON.stringify(financeFilters.value.bills))}`),
      api<Row>(`/projects/${props.project.id}/summary`),
      api<{ items: Row[]; total: number }>(`/reconciliations?page=${reconPage.value}&page_size=30&project_id=${props.project.id}&deleted=${showDeletedReconciliations.value}&sort=${encodeURIComponent(financeSort.value.reconciliations || "created_at")}&direction=${financeDirection.value.reconciliations}&filters=${encodeURIComponent(JSON.stringify(financeFilters.value.reconciliations))}`),
      api<CostCategoryNode[]>(`/projects/${props.project.id}/cost-tree`),
    ]);
    if (sequence !== loadSequence) return;
    categoryNodes.value = treeResult;
    costs.value = costResult.items;
    costTotal.value = costResult.total;
    bills.value = billResult.items;
    billTotal.value = billResult.total;
    summary.value = summaryResult;
    reconciliations.value = reconResult.items;
    reconTotal.value = reconResult.total;
  } catch (error) {
    if (sequence === loadSequence) {
      listError.value = "费用数据读取失败：" + (error as Error).message;
      categoryNodes.value = [];
      costs.value = []; bills.value = []; reconciliations.value = [];
      costTotal.value = 0; billTotal.value = 0; reconTotal.value = 0;
      summary.value = {};
    }
  } finally {
    if (sequence === loadSequence) listLoading.value = false;
  }
}
const draftGuard = useDialogDraftGuard(() => form.value);
function closeEditor() { void draftGuard.confirmClose(() => { dialog.value = ""; }); }
function beforeEditorClose(done: () => void) { void draftGuard.confirmClose(done); }
function edit(type: string, row?: Row) {
  if (type === "settlement" && row?.review?.action === "submit") {
    ElMessage.warning("该结算正在审核，审核结束前不能修改；如需调整，请先由审核人员退回");
    return;
  }
  invalidQuantity.value = {};
  editing.value = row || null;
  dialog.value = type;
  if (type === "cost")
    form.value = row
      ? {
          ...row,
          request_key: undefined,
          cost_node_id: row.cost_node_id || props.project.cost_nodes.find(
            (n: Row) => n.current_version_id === row.cost_node_version_id,
          )?.id,
          expected_version: row.version_no,
        }
      : {
          title: "",
          occurred_on: today(),
          amount_fen: 0,
          evidence: "",
          status: "active",
        };
  if (type === "settlement")
    form.value = row
      ? {
          ...(row.draft?.document || row.version || {}),
          number: row.number,
          expected_version: row.version?.version_no || 0,
          expected_edit_version: row.draft?.edit_version || 0,
          items: structuredClone(row.draft?.document.items || row.items),
          resolutions: structuredClone(
            row.draft?.document.resolutions || row.resolutions,
          ),
        }
      : {
          number: "",
          approval_version_id: props.project.approval?.id,
          funding_version_id: props.project.funding?.id || null,
          settlement_on: today(),
          basis: "",
          items: [{ quantity_scaled: 0, amount_fen: 0, evidence: "" }],
          resolutions: [],
        };
  if (type === "reconcile")
    form.value = row
      ? {
          ...row,
          request_key: undefined,
          expected_version: row.version_no,
          is_final: !!row.is_final,
        }
      : {
          expected_version: 0,
          reconciled_cost_fen: 0,
          reconciled_settlement_fen: 0,
          evidence: "",
          is_final: true,
        };
  draftGuard.capture();
  if (type === "reconcile") {
    reconcileCostChoices.value = [];
    reconcileBillChoices.value = [];
    void loadReconciliationChoices("costs", String(row?.cost_version_id || ""));
    void loadReconciliationChoices("bills", String(row?.settlement_item_version_id || ""));
  }
}
async function save() {
  if (busy.value) return;
  if (dialog.value === "settlement") {
    const documents = (form.value.items || []) as Row[];
    const resolutions = (form.value.resolutions || []) as Row[];
    if (documents.some(item => item.project_scope_id &&
        scopePrecision.value[item.project_scope_id] === undefined) ||
        resolutions.some(item => !item.project_scope_id ||
          scopePrecision.value[item.project_scope_id] === undefined) ||
        documents.some((_, i) => invalidQuantity.value["items." + i]) ||
        resolutions.some((_, i) => invalidQuantity.value["resolutions." + i])) {
      ElMessage.error(scopePrecisionError.value ||
        "本次结算数量缺少有效冻结单位精度或仍有输入错误，请核对后重试");
      return;
    }
  }
  busy.value = true;
  try {
    if (!(await formRef.value?.validate().catch(() => false))) return;
    if (dialog.value === "cost")
      await api(
        `/projects/${props.project.id}/costs${editing.value ? "/" + editing.value.entry_id : ""}`,
        "POST",
        form.value,
      );
    if (dialog.value === "settlement")
      await api(
        `/projects/${props.project.id}/settlements${editing.value ? "/" + editing.value.id : ""}`,
        "POST",
        form.value,
      );
    if (dialog.value === "reconcile")
      await api("/reconciliations", "POST", form.value);
    ElMessage.success("费用或结算数据已保存，正在刷新列表");
    await load();
    emit("changed");
    dialog.value = "";
  } catch (e) {
    ElMessage.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function action(row: Row, name: string) {
  try {
    let reason: string | undefined;
    if (name === "return") {
      const result = await ElMessageBox.prompt(
        "请填写具体退回原因，编制人员将据此修改或按原版本重新提交。",
        "退回结算",
        {
          inputType: "textarea",
          inputPlaceholder: "填写需要补正的内容或退回依据",
          inputValidator: (value: string) => !!value.trim() || "退回原因不能为空",
          confirmButtonText: "确认退回",
          cancelButtonText: "取消",
        },
      );
      reason = result.value.trim();
    } else {
      await ElMessageBox.confirm(
        name === "submit"
          ? "确认将完整结算草稿正式提交审核？正式提交后，审核结束前不可再修订。"
          : "确认批准当前正式结算版本？批准后任何内容变化均需生成新版本重新审核。",
        "结算确认",
      );
    }
    await api(
      `/settlements/${row.id}/${name === "submit" ? "submit" : "review"}`,
      "POST",
      {
        expected_version: row.version?.version_no || 0,
        expected_edit_version: row.draft?.edit_version || 0,
        expected_event_seq: row.review?.event_seq || 0,
        action: name,
        reason,
      },
    );
    await load();
    emit("changed");
  } catch (e) {
    if (e instanceof Error) ElMessage.error(e.message);
  }
}
async function resubmitBill(row: Row) {
  try {
    await ElMessageBox.confirm(
      "原结算版本与金额、明细、解决量均不变，仅重新提交审核。若需要修改内容，请改用“修订结算”编制新版本。",
      "原版重新提交",
    );
    await api(`/settlements/${row.id}/resubmit`, "POST", {
      expected_version: row.version?.version_no || 0,
      expected_event_seq: row.review?.event_seq || 0,
    });
    await load();
    emit("changed");
    ElMessage.success("原结算版本已重新提交审核");
  } catch (e) {
    if (e instanceof Error) ElMessage.error(e.message);
  }
}
async function voidCost(row: Row) {
  try {
    await ElMessageBox.confirm("作废后该费用不再计入有效费用，但继续显示在正常列表中；原始版本及历史核对永久保留。", "作废费用", { type: "warning" });
    await api(`/projects/${props.project.id}/costs/${row.entry_id}`, "POST", {
      ...row,
      request_key: undefined,
      expected_version: row.version_no,
      status: "voided",
    });
    await load();
    emit("changed");
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message);
  }
}
async function removeBill(row: Row) {
  try {
    await ElMessageBox.confirm(
      "删除将正式注销当前有效结算，取消其当前结算金额及解决量，原始版本继续保留。",
      "删除结算单",
      { type: "warning" },
    );
    await api("/settlements/" + row.id, "DELETE", {
      expected_version: row.version?.version_no || 0,
      expected_edit_version: row.draft?.edit_version || 0,
    });
    await load();
    emit("changed");
  } catch (e) {
    if (e instanceof Error) ElMessage.error(e.message);
  }
}
async function removeCost(row: Row) {
  try {
    await ElMessageBox.confirm(
      "此操作仅限管理员：费用将先作废，再从正常列表隐藏；原始版本和历史核对保留，可通过“包含已删除费用”查看。",
      "管理员删除费用",
    );
    await api(
      `/projects/${props.project.id}/costs/${row.entry_id}`,
      "DELETE",
      { expected_version: row.version_no },
    );
    await load();
    emit("changed");
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message);
  }
}
async function removeReconciliation(row: Row) {
  try {
    await ElMessageBox.confirm(
      "撤销当前核对份额并从正常列表删除，原始核对及双金额历史保留。",
      "删除费用核对",
    );
    await api("/reconciliations/" + row.record_id, "DELETE", {
      expected_version: row.version_no,
    });
    await load();
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message);
  }
}
async function reconciliationHistory(row: Row) {
  history.value = await api("/reconciliations/" + row.record_id);
}
async function showHistory(row: Row) {
  history.value = await api("/settlements/" + row.id + "/history");
}
useListRoute({
  costPage, billPage, reconPage,
  deletedCosts: showDeletedCosts, deletedReconciliations: showDeletedReconciliations,
  costsSort: computed({ get: () => financeSort.value.costs, set: value => { financeSort.value.costs = value; } }),
  costsDirection: computed({ get: () => financeDirection.value.costs, set: value => { financeDirection.value.costs = value; } }),
  costsFilters: computed({ get: () => financeFilters.value.costs, set: value => { financeFilters.value.costs = value; } }),
  billsSort: computed({ get: () => financeSort.value.bills, set: value => { financeSort.value.bills = value; } }),
  billsDirection: computed({ get: () => financeDirection.value.bills, set: value => { financeDirection.value.bills = value; } }),
  billsFilters: computed({ get: () => financeFilters.value.bills, set: value => { financeFilters.value.bills = value; } }),
  reconciliationsSort: computed({ get: () => financeSort.value.reconciliations, set: value => { financeSort.value.reconciliations = value; } }),
  reconciliationsDirection: computed({ get: () => financeDirection.value.reconciliations, set: value => { financeDirection.value.reconciliations = value; } }),
  reconciliationsFilters: computed({ get: () => financeFilters.value.reconciliations, set: value => { financeFilters.value.reconciliations = value; } }),
}, load);
watch(() => props.project.id, () => {
  ++reconcileCostSequence;
  ++reconcileBillSequence;
  reconcileCostChoices.value = [];
  reconcileBillChoices.value = [];
  categoryNodes.value = [];
  costs.value = []; bills.value = []; reconciliations.value = [];
  summary.value = {};
  costTotal.value = 0; billTotal.value = 0; reconTotal.value = 0;
  void load();
}, { immediate: true });
</script>
<template>
  <template v-if="evidence"
    ><ElButton @click="evidence = null">关闭附件区</ElButton
    ><EvidencePanel
      :key="evidence.ownerId"
      :owner-kind="evidence.ownerKind"
      :owner-id="evidence.ownerId"
  /></template>
  <div v-if="focus" class="panel" v-loading="focusedLoading">
    <div class="toolbar">
      <h2>{{ focusedTitle }}</h2>
      <ElButton size="small" @click="loadFocusedRecord">重新读取</ElButton>
    </div>
    <ElAlert v-if="focusedError" :title="focusedError" :closable="false" type="error" />
    <template v-if="focusedCurrent">
      <ElDescriptions :column="2" border>
        <ElDescriptionsItem label="记录名称">
          {{ focusedCurrent.title || focusedCurrent.number || focusedCurrent.evidence || '正式业务记录' }}
        </ElDescriptionsItem>
        <ElDescriptionsItem label="正式版本">
          {{ focusedCurrent.version?.version_no || focusedCurrent.version_no || '查看完整历史' }}
        </ElDescriptionsItem>
        <ElDescriptionsItem v-if="focus.kind === 'cost'" label="实际金额">
          {{ focusedCurrent.amount_fen == null ? '未核定' : '¥' + money(focusedCurrent.amount_fen) }}
        </ElDescriptionsItem>
        <ElDescriptionsItem v-if="focus.kind === 'settlement'" label="结算业务">
          {{ focusedCurrent.number }}
        </ElDescriptionsItem>
        <ElDescriptionsItem v-if="focus.kind === 'reconciliation'" label="核对金额">
          {{ focusedCurrent.reconciled_settlement_fen == null ? '—' : '¥' + money(focusedCurrent.reconciled_settlement_fen) }}
        </ElDescriptionsItem>
      </ElDescriptions>
      <div class="toolbar" style="margin-top:12px">
        <ElButton link type="primary" @click="focusedHistoryOpen = !focusedHistoryOpen">
          {{ focusedHistoryOpen ? '收起正式历史' : '查看正式历史' }}
        </ElButton>
      </div>
      <BusinessHistory v-if="focusedHistoryOpen" :value="focusedFact" />
    </template>
  </div>
  <ElAlert v-if="listError" class="panel" type="error" :closable="false"
    :title="listError" show-icon>
    <ElButton @click="load">重新读取费用数据</ElButton>
  </ElAlert>
  <div v-if="!listError" class="metric-grid">
    <div class="metric">
      <span>正式参考价格</span>
      <strong>{{ summary.reference_total_fen == null ? '未完整计价' : '¥' + money(summary.reference_total_fen) }}</strong>
    </div>
    <div class="metric">
      <span>批准预算</span>
      <strong>{{ summary.approved_budget_fen == null ? '尚未批准' : '¥' + money(summary.approved_budget_fen) }}</strong>
    </div>
    <div class="metric">
      <span>真实费用</span><strong>¥{{ money(summary.actual_cost_fen) }}</strong>
    </div>
    <div class="metric">
      <span>已批准结算</span><strong>¥{{ money(summary.settlement_fen) }}</strong>
    </div>
  </div>
  <div class="panel">
    <div class="toolbar" style="flex-wrap:wrap">
      <span>参考价与批准预算差额：<strong>{{ summary.reference_budget_difference_fen == null ? '未具备比较条件' : '¥' + money(summary.reference_budget_difference_fen) }}</strong></span>
      <span>实际费用与参考价差额：<strong>{{ summary.actual_reference_difference_fen == null ? '未具备比较条件' : '¥' + money(summary.actual_reference_difference_fen) }}</strong></span>
      <span>待核对费用：<strong>¥{{ money(summary.unreconciled_cost_fen) }}</strong></span>
    </div>
    <p class="muted">参考价格、批准预算、真实费用和分期结算是不同业务事实，不要求相等。缺少任何需求报价时不显示完整参考总价。</p>
  </div>
  <CostCategoryWorkspace :project-id="project.id" :snapshot="categoryNodes" @changed="load(); emit('changed')" />
  <ElAlert v-if="scopePrecisionError" type="error" :closable="false"
    :title="scopePrecisionError" class="panel" />
  <div class="panel">
    <div class="toolbar">
      <h2>实际费用</h2>
      <ElCheckbox data-guide-action="finance.cost-show-deleted" v-model="showDeletedCosts" @change="costPage = 1; load()"
        >包含已删除费用</ElCheckbox
      >
      <ElButton data-guide-action="finance.cost"
        :disabled="!can('cost.confirm')"
        type="primary"
        @click="edit('cost')"
        >核定费用</ElButton
      >
      <span v-if="!can('cost.confirm')" class="muted" role="note">
        费用核定须由具备审核权限的人员办理
      </span>
    </div>
    <BusinessTable table-key="finance:costs" :loading="listLoading" :filter-state="financeFilters.costs"
      :sort-state="{ prop: financeSort.costs, order: financeSort.costs ? (financeDirection.costs === 'asc' ? 'ascending' : 'descending') : null }" :rows="costs" :columns="financeColumns.costs" :actions-width="145"
      @sort-change="financeTableSort('costs', $event)" @filter-change="financeTableFilter('costs', $event)">
      <template #cell="{ row, column }">
        <span v-if="column.key === 'amount_fen'">¥{{ money(row.amount_fen) }}</span>
        <ElTag v-else-if="column.key === 'status'" :type="row.deleted ? 'danger' : 'info'" effect="plain">{{ row.deleted ? '已删除' : row.status === 'voided' ? '已作废' : statusText[row.status] || row.status }}</ElTag>
        <span v-else>{{ formatVisibleDateTime(row[column.key], column.key) ?? '—' }}</span>
      </template>
      <template #actions="{ row }">
        <RowActions :actions="[
          { label: '附件', run: () => evidence = { ownerKind: 'cost_version_id', ownerId: row.id } },
          { label: '更正', disabled: !can('cost.confirm') || row.deleted, run: () => edit('cost', row) },
          { label: '作废费用', guideActionId: 'finance.void', danger: true, disabled: !can('cost.confirm') || row.deleted || row.status === 'voided', run: () => voidCost(row) },
          { label: '管理员删除', danger: true, disabled: !can('admin') || row.deleted, run: () => removeCost(row) },
        ]" />
      </template>
    </BusinessTable>
    <ElPagination v-model:current-page="costPage" :total="costTotal" :page-size="30"
      layout="prev,pager,next,total" @current-change="load" />
  </div>
  <div class="panel">
    <div class="toolbar">
      <h2>独立结算单</h2>
      <ElButton data-guide-action="finance.settlement-draft"
        type="primary"
        :disabled="!can('write') || project.status !== 'approved'"
        @click="edit('settlement')"
        >新增结算草稿</ElButton
      ><span v-if="project.status !== 'approved'" class="muted" role="note">
        子项目正式批准后才可编制结算
      </span>
      <span v-else-if="!can('write')" class="muted" role="note">
        结算草稿须由具备编辑权限的人员编制
      </span>
      <ExchangePanel
        kind="settlements"
        :project-id="project.id"
        :selected-ids="selected.map((x) => x.id)"
        @changed="load"
      />
    </div>
    <BusinessTable table-key="finance:bills" :loading="listLoading" :filter-state="financeFilters.bills"
      :sort-state="{ prop: financeSort.bills, order: financeSort.bills ? (financeDirection.bills === 'asc' ? 'ascending' : 'descending') : null }" :rows="bills" :columns="financeColumns.bills" selectable :actions-width="190"
      @selection-change="selected = $event" @sort-change="financeTableSort('bills', $event)"
      @filter-change="financeTableFilter('bills', $event)">
      <template #cell="{ row, column }">
        <span v-if="column.key === 'review'">
          第 {{ row.version?.version_no || 0 }} 版 · {{ row.review?.action === 'submit' ? '待审核' : row.review?.action === 'return' ? '已退回' : row.draft ? '有草稿' : statusText[row.review?.action] || '待编制' }}
          <span v-if="row.review?.action === 'return'" class="muted" :title="row.review.reason || '未记录原因'"> · 退回原因：{{ row.review.reason || '未记录' }}</span>
        </span>
        <span v-else-if="column.key === 'amount'">¥{{ money((row.draft?.document.items || row.items || []).reduce((sum: number, item: Row) => sum + item.amount_fen, 0)) }}</span>
        <span v-else>{{ formatVisibleDateTime(row[column.key], column.key) ?? '—' }}</span>
      </template>
      <template #actions="{ row }">
        <RowActions :actions="[
          ...(row.review?.action === 'submit' ? [
            { label: '批准', guideActionId: 'finance.approve', primary: true, disabled: !can('settlement.approve'), run: () => action(row, 'approve') },
            { label: '退回', disabled: !can('settlement.approve'), run: () => action(row, 'return') },
          ] : []),
          ...(row.draft ? [{ label: '正式提交', guideActionId: 'finance.submit', primary: true, disabled: !can('write') || row.review?.action === 'submit', run: () => action(row, 'submit') }] : []),
          ...(row.review?.action === 'return' && !row.draft ? [{ label: '原版重新提交', primary: true, disabled: !can('write'), run: () => resubmitBill(row) }] : []),
          { label: row.draft ? '继续编辑草稿' : row.review?.action === 'return' ? '修订结算' : row.review?.action === 'submit' ? '审核中（禁止修订）' : row.version ? '发起新修订' : '编制结算', disabled: !can('write') || row.review?.action === 'submit', run: () => edit('settlement', row) },
          ...(row.version ? [{ label: '附件', run: () => evidence = { ownerKind: 'settlement_version_id', ownerId: row.version.id } }] : []),
          { label: '历史', guideActionId: 'finance.history', run: () => showHistory(row) },
          { label: '删除', danger: true, disabled: !can('admin'), run: () => removeBill(row) },
        ]" />
      </template>
    </BusinessTable>
    <ElPagination v-model:current-page="billPage" :total="billTotal" :page-size="30"
      layout="prev,pager,next,total" @current-change="load" />
  </div>
  <div class="panel">
    <div class="toolbar">
      <h2>费用与结算核对</h2>
      <ElCheckbox data-guide-action="finance.reconcile-show-deleted" v-model="showDeletedReconciliations" @change="reconPage = 1; load()"
        >包含已删除核对</ElCheckbox
      ><ElButton data-guide-action="finance.reconcile" :disabled="!can('cost.confirm')" @click="edit('reconcile')"
        >新增正式核对</ElButton
      >
      <span v-if="!can('cost.confirm')" class="muted" role="note">
        正式费用核对须由具备审核权限的人员办理
      </span>
    </div>
    <BusinessTable table-key="finance:reconciliations" :loading="listLoading" :filter-state="financeFilters.reconciliations"
      :sort-state="{ prop: financeSort.reconciliations, order: financeSort.reconciliations ? (financeDirection.reconciliations === 'asc' ? 'ascending' : 'descending') : null }" :rows="reconciliations"
      :columns="financeColumns.reconciliations" :actions-width="190"
      @sort-change="financeTableSort('reconciliations', $event)"
      @filter-change="financeTableFilter('reconciliations', $event)">
      <template #cell="{ row, column }">
        <span v-if="column.key === 'reconciled_cost_fen' || column.key === 'reconciled_settlement_fen'">¥{{ money(row[column.key]) }}</span>
        <ElTag v-else-if="column.key === 'status'" effect="plain">{{ row.deleted ? '已删除' : row.status === 'voided' ? '已撤销' : '有效' }}</ElTag>
        <span v-else>{{ formatVisibleDateTime(row[column.key], column.key) ?? '—' }}</span>
      </template>
      <template #actions="{ row }">
        <RowActions :actions="[
          { label: '更正', disabled: !can('cost.confirm') || row.deleted, run: () => edit('reconcile', row) },
          { label: '历史', guideActionId: 'finance.history', run: () => reconciliationHistory(row) },
          { label: '删除', danger: true, disabled: !can('cost.confirm') || row.deleted, run: () => removeReconciliation(row) },
        ]" />
      </template>
    </BusinessTable>
    <ElPagination v-model:current-page="reconPage" :total="reconTotal" :page-size="30"
      layout="prev,pager,next,total" @current-change="load" />
  </div>
  <div class="panel">
    <h2>实际解决需求</h2>
    <BusinessTable client-side table-key="finance:demands" :rows="summary.demands || []"
      :columns="financeColumns.demands">
      <template #cell="{ row, column }">
        <span v-if="column.key.endsWith('_quantity_scaled')">{{ quantity(row[column.key]) }}</span>
        <span v-else>{{ formatVisibleDateTime(row[column.key], column.key) ?? '—' }}</span>
      </template>
    </BusinessTable>
  </div>
  <ElDialog append-to-body
    :model-value="!!dialog"
    :title="
      {
        node: '费用科目版本',
        cost: '核定真实费用',
        settlement: '结算草稿',
        reconcile: '正式费用核对',
      }[dialog]
    "
    width="1000px"
    :close-on-click-modal="false"
    :before-close="beforeEditorClose"
    @close="dialog = ''"
    ><ElForm ref="formRef" label-position="top" novalidate :model="form"
      ><div class="form-grid">
        <template v-if="dialog === 'cost'"
          ><ElFormItem
            label="费用事项"
            prop="title"
            :rules="[{ required: true, message: '请填写费用事项' }]"
            required
            ><ElInput v-model="form.title" /></ElFormItem
          ><ElFormItem
            label="末级费用科目"
            prop="cost_node_id"
            :rules="[{ required: true, message: '请填写末级费用科目' }]"
            required
            > <CostCategorySelect v-model="form.cost_node_id" :project-id="project.id" :nodes="categoryNodes" :disabled="!!editing" :historical-label="editing?.cost_node_name" :historical-version-id="editing?.cost_node_version_id" /></ElFormItem
          ><ElFormItem
            label="实际金额（元）"
            prop="amount_fen"
            :rules="[{ required: true, message: '请填写实际金额（元）' }]"
            required
            ><FieldControl
              v-model="form.amount_fen"
              :field="{ type: 'money' }" /></ElFormItem
          ><ElFormItem
            label="发生日期"
            prop="occurred_on"
            :rules="[{ required: true, message: '请填写发生日期' }]"
            required
            ><ElDatePicker
              v-model="form.occurred_on"
              value-format="YYYY-MM-DD" /></ElFormItem
          ><ElFormItem
            label="费用凭据"
            prop="evidence"
            :rules="[{ required: true, message: '请填写费用凭据' }]"
            required
            class="full-width"
            ><ElInput v-model="form.evidence" type="textarea" /></ElFormItem
        ></template>
        <template v-if="dialog === 'settlement'"
          ><ElFormItem label="结算日期"
            ><ElDatePicker
              v-model="form.settlement_on"
              value-format="YYYY-MM-DD" /></ElFormItem
          ><ElFormItem
            label="采用批准版本"
            prop="approval_version_id"
            :rules="[{ required: true, message: '请填写采用批准版本' }]"
            required
            ><ElSelect v-model="form.approval_version_id"
              ><ElOption
                v-for="ap in project.approvals.filter(
                  (x: Row) => x.status === 'approved',
                )"
                :key="ap.id"
                :value="ap.id"
                :label="'批准第' + ap.version_no" /></ElSelect></ElFormItem
          ><ElFormItem label="结算依据"
            ><ElInput v-model="form.basis" /></ElFormItem
          ><ElFormItem v-if="editing?.version" label="修订动作"
            ><ElSelect v-model="form.change_type"
              ><ElOption label="完整修订" value="revision" /><ElOption
                label="正式注销"
                value="void" /></ElSelect></ElFormItem
        ></template>
        <template v-if="dialog === 'reconcile'"
          ><div class="full-width muted" role="note" style="margin-bottom:12px">从整个子项目检索费用和已批准结算明细，不受主列表分页限制；未显示的历史记录可输入事项或编号搜索。</div>
          <ElFormItem
            label="实际费用"
            prop="cost_version_id"
            :rules="[{ required: true, message: '请填写实际费用' }]"
            required
            ><ElSelect v-model="form.cost_version_id" filterable remote
              :remote-method="term => loadReconciliationChoices('costs', term)"
              :loading="reconcileCostsLoading" placeholder="搜索费用事项后选择"
              no-match-text="未找到匹配费用，请更换关键词"
              ><ElOption
                v-for="cost in reconcileCostChoices"
                :key="cost.id"
                :value="cost.id"
                :label="
                  cost.title + ' ¥' + money(cost.amount_fen)
                " /></ElSelect></ElFormItem
          ><ElFormItem
            label="已批准结算明细"
            prop="settlement_item_version_id"
            :rules="[{ required: true, message: '请填写已批准结算明细' }]"
            required
            ><ElSelect v-model="form.settlement_item_version_id" filterable remote
              :remote-method="term => loadReconciliationChoices('bills', term)"
              :loading="reconcileBillsLoading" placeholder="搜索已批准结算编号后选择"
              no-match-text="未找到已批准结算，请更换编号"
              ><template
                v-for="bill in reconcileBillChoices"
                :key="bill.id"
                ><ElOption
                  v-for="item in bill.items"
                  :key="item.id"
                  :value="item.id"
                  :label="
                    bill.number + ' ¥' + money(item.amount_fen)
                  " /></template></ElSelect></ElFormItem
          ><ElFormItem
            label="费用份额（元）"
            prop="reconciled_cost_fen"
            :rules="[{ required: true, message: '请填写费用份额（元）' }]"
            required
            ><FieldControl
              v-model="form.reconciled_cost_fen"
              :field="{ type: 'money' }" /></ElFormItem
          ><ElFormItem
            label="核定结算额（元）"
            prop="reconciled_settlement_fen"
            :rules="[{ required: true, message: '请填写核定结算额（元）' }]"
            required
            ><FieldControl
              v-model="form.reconciled_settlement_fen"
              :field="{ type: 'money' }" /></ElFormItem
          ><ElFormItem label="核对依据"
            ><ElInput v-model="form.evidence" /></ElFormItem
          ><ElFormItem label="最终核对"
            ><ElSwitch v-model="form.is_final" /></ElFormItem
        ></template>
      </div>
      <template v-if="dialog === 'settlement' && form.change_type !== 'void'"
        ><h3>本次费用明细</h3>
        <div v-for="(item, index) in form.items" :key="index" class="panel finance-editor-line">
          <div class="toolbar finance-editor-line-heading">
            <strong>费用明细 {{ Number(index) + 1 }}</strong>
            <ElButton data-guide-action="finance.cost-item-remove" type="danger" plain size="small" @click="form.items.splice(index, 1)">移除此项</ElButton>
          </div>
          <div class="form-grid">
            <ElFormItem label="费用科目" required
              > <CostCategorySelect v-model="item.cost_node_id" :project-id="project.id" :nodes="categoryNodes" :historical-label="item.cost_node_name" :historical-version-id="item.cost_node_version_id" /></ElFormItem
            ><ElFormItem label="关联需求（共同费用可不选）"
              ><ElSelect v-model="item.project_scope_id" clearable
                ><ElOption
                  v-for="scope in project.scopes"
                  :key="scope.id"
                  :value="scope.id"
                  :label="
                    scope.demand_no || scope.demand_id
                  " /></ElSelect></ElFormItem
            ><ElFormItem label="费用计价数量"
              ><FieldControl
                v-model="item.quantity_scaled"
                :field="{ type: 'quantity', quantityPrecision: item.project_scope_id
                  ? scopePrecision[item.project_scope_id] : 4 }"
                @validity-change="markQuantityInvalid('items.' + index, $event)" /></ElFormItem
            ><ElFormItem label="本次金额（元）" required
              ><FieldControl
                v-model="item.amount_fen"
                :field="{ type: 'money' }" /></ElFormItem
            ><ElFormItem label="依据" required
              ><ElInput v-model="item.evidence"
            /></ElFormItem>
          </div>
        </div>
        <ElButton class="finance-editor-add" data-guide-action="finance.cost-item-add"
          @click="
            form.items.push({ quantity_scaled: 0, amount_fen: 0, evidence: '' })
          "
          >添加费用明细</ElButton
        >
        <h3>本次新增解决需求</h3>
        <ElAlert
          title="实际解决数量独立于费用计价数量。只补结费用时填写0。"
          type="info"
          :closable="false"
        />
        <div v-for="(r, index) in form.resolutions" :key="index" class="panel finance-editor-line">
          <div class="toolbar finance-editor-line-heading">
            <strong>解决需求 {{ Number(index) + 1 }}</strong>
            <ElButton data-guide-action="finance.resolution-remove" type="danger" plain size="small" @click="form.resolutions.splice(index, 1)">移除此项</ElButton>
          </div>
          <div class="form-grid">
            <ElFormItem label="项目需求" required
              ><ElSelect v-model="r.project_scope_id"
                ><ElOption
                  v-for="scope in project.scopes"
                  :key="scope.id"
                  :value="scope.id"
                  :label="
                    scope.demand_no || scope.demand_id
                  " /></ElSelect></ElFormItem
            ><ElFormItem label="本次新增解决量" required
              ><FieldControl
                v-model="r.resolved_quantity_scaled"
                :field="{ type: 'quantity', quantityPrecision: scopePrecision[r.project_scope_id] }"
                @validity-change="markQuantityInvalid('resolutions.' + index, $event)" /></ElFormItem
            ><ElFormItem label="完成依据"
              ><ElInput v-model="r.evidence"
            /></ElFormItem>
          </div>
        </div>
        <ElButton class="finance-editor-add" data-guide-action="finance.resolution-add"
          @click="
            form.resolutions.push({ resolved_quantity_scaled: 0, evidence: '' })
          "
          >添加解决需求</ElButton
        ></template
      ></ElForm
    ><template #footer
      ><ElButton @click="closeEditor">取消</ElButton
      ><ElButton
        :disabled="
          !can(
            dialog === 'cost' || dialog === 'reconcile'
              ? 'cost.confirm'
              : 'write',
          )
        "
        type="primary"
        :loading="busy"
        @click="save"
        >{{ dialog === "settlement" ? "保存草稿" : "保存" }}</ElButton
      ></template
    ></ElDialog
  >
  <ElDialog append-to-body
    :model-value="!!history"
    title="正式版本历史"
    width="950px"
    @close="history = null"
  >
    <BusinessHistory :value="history" />
  </ElDialog>
</template>
<style scoped>
.finance-editor-line-heading {
  justify-content: space-between;
  min-height: 28px;
  margin-bottom: 16px;
  padding-bottom: 11px;
  border-bottom: 1px solid var(--edge);
}
.finance-editor-line-heading strong {font-size:13px;font-weight:650;color:var(--ink)}
.finance-editor-line-heading .el-button {margin-left:auto}
.finance-editor-line > .form-grid :deep(.el-form-item:last-child) {margin-bottom:4px}
.finance-editor-add {margin:8px 0 5px}
</style>

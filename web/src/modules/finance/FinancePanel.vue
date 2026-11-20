<script setup lang="ts">
import VersionConflictNotice from "../../shared/ui/VersionConflictNotice.vue";
import { settlementProgressText } from "../../shared/utils/settlement-progress";
import { closedWriteReason } from "../../../../server/shared/project-lifecycle";
import CostCategoryWorkspace from "./components/CostCategoryWorkspace.vue";
import ActualCostFields from "./components/ActualCostFields.vue";
import SettlementEntryFields from "./components/SettlementEntryFields.vue";
import ReconciliationFields from "./components/ReconciliationFields.vue";
import CostCategorySelect from "./components/CostCategorySelect.vue";
import type { CostCategoryNode } from "../../../../server/shared/types/trees";
const categoryNodes = ref<CostCategoryNode[]>([]);
import { usePageSelection } from "../../shared/composables/use-page-selection";
import { useListRoute } from "../../shared/composables/use-list-route";import { useDialogDraftGuard } from "../../shared/forms/use-dialog-draft";
import RowActions from "../../shared/ui/RowActions.vue";
import BusinessNumber from "../../shared/ui/BusinessNumber.vue";
import BusinessHistory from "../../shared/ui/BusinessHistory.vue";
import BusinessEditorSurface from "../../shared/ui/BusinessEditorSurface.vue";
import BusinessWorkSurface from "../../shared/ui/BusinessWorkSurface.vue";
import { useAccess } from "../../shared/composables/use-access";
const can = useAccess();
const writeBlock = computed(() => closedWriteReason(props.project));
import { ref, watch, computed, toRaw, nextTick } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import FieldControl from "../../shared/ui/FieldControl.vue";
import { formatVisibleDateTime } from "../../shared/utils/datetime";
import { readAdoptedQuantityPrecision } from "../../shared/api/quantity-precision";
import BusinessTable, { type TableColumn } from "../../shared/ui/BusinessTable.vue";
import ExchangePanel from "../exchange/ExchangePanel.vue";
import EvidencePanel from "../files/EvidencePanel.vue";
import type { ProjectDetail } from "../../../../server/shared/types/project-api";
import type { ActualCostVersion, SettlementWorkflow, ReconciliationVersion, SettlementItemInput,
  SettlementResolutionInput, ReconciliationSettlementChoice, ActualCostInput, SettlementDraftInput, ReconciliationInput } from "../../../../server/shared/types/finance-workflows";
import type { CategoryCost } from "../../../../server/shared/types/trees";
import type { FinanceSummary } from "../../../../server/shared/types/finance-api";
import { choiceLabels } from "../../shared/utils/choice-labels";
import type { HistoryTarget } from "../../../../server/shared/types/history";
type CostFact = ActualCostVersion & CategoryCost;
type BillFact = SettlementWorkflow & {deleted?: boolean};
type ReconciliationFact = ReconciliationVersion & {deleted?:boolean; effective?:boolean};
type EditingFact = Partial<Omit<CostFact & Omit<BillFact, "status"> & ReconciliationFact, "status">> & {
  status?: CostFact["status"] | BillFact["status"];
};
interface FinanceForm extends Partial<ActualCostInput>, Omit<SettlementDraftInput, "items" | "resolutions">, ReconciliationInput {
  items: Array<Partial<SettlementItemInput> & {cost_node_name?:string; cost_node_version_id?:string}>;
  resolutions: Array<Partial<SettlementResolutionInput>>;
}
const emptyForm = (): FinanceForm => ({items:[], resolutions:[]});
const evidence = ref<{ownerKind:"cost_version_id" | "settlement_version_id"; ownerId:string} | null>(null);
import {
  api, ApiError,
  today,
  money,
  quantity,
  statusText,
} from "../../shared/api/client";
type FocusKind = "cost" | "settlement" | "reconciliation";
type FocusedRecord = { kind: FocusKind; id: string };
const actualSection = ref<HTMLElement>();
const settlementSection = ref<HTMLElement>();
const reconciliationSection = ref<HTMLElement>();
function jumpToSection(section?: HTMLElement) {
  section?.scrollIntoView({ block: "start" });
}
const props = defineProps<{
  project: ProjectDetail;
  focus?: FocusedRecord | null;
  settlementWork?: { id: string; action: string };
  refreshKey?: number;
}>();
const settlementReview = ref<BillFact | null>(null);
const billQuery = ref("");
const itemized = computed(() => form.value.mode === "itemized");
const categoryLoading = ref(false), categoryError = ref("");
let categoryRequest = 0;
async function loadSettlementCategories() {
  const request = ++categoryRequest;
  const project = props.project.id;
  categoryLoading.value = true;
  categoryError.value = "";
  categoryNodes.value = [];
  try {
    const nodes = await api<CostCategoryNode[]>(`/projects/${project}/cost-tree`);
    if (request === categoryRequest) categoryNodes.value = nodes;
  } catch (error) {
    if (request === categoryRequest) categoryError.value = (error as Error).message;
  } finally {
    if (request === categoryRequest) categoryLoading.value = false;
  }
}
const itemizedTotal = computed(() => form.value.items.reduce((total, row) => total + (row.amount_fen || 0), 0));
const settlementWorkLoading = ref(false), settlementWorkError = ref(""), reviewReason = ref("");
const settlementTitle = computed(() => props.settlementWork?.action === "review" ? "审核结算" :
  props.settlementWork?.action === "submit" ? "复核并提交结算" :
  props.settlementWork?.id === "new" ? "编制结算草稿" : "修订结算草稿");
const reviewDocument = computed(() => props.settlementWork?.action === "submit"
  ? settlementReview.value?.draft?.document : settlementReview.value?.version);
const reviewItems = computed(() => props.settlementWork?.action === "submit"
  ? settlementReview.value?.draft?.document.items || [] : settlementReview.value?.items || []);
const reviewResolutions = computed(() => props.settlementWork?.action === "submit"
  ? settlementReview.value?.draft?.document.resolutions || [] : settlementReview.value?.resolutions || []);
const reviewBlock = computed(() => {
  const row = settlementReview.value;
  if (!row) return "";
  if (writeBlock.value || row.deleted) return writeBlock.value || "结算单已删除";
  if (props.settlementWork?.action === "submit")
    return can("write") && row.draft && row.review?.action !== "submit" ? "" : "当前账号或结算状态无法提交";
  return can("settlement.approve") && row.review?.action === "submit" ? "" : "当前账号或结算状态无法审核";
});
const reviewApproval = computed(() => approvalChoices.value.find(row => row.id === reviewDocument.value?.approval_version_id));
const reviewScope = (scopeId?: string | null) => reviewApproval.value?.scopes.find(row => row.project_scope_id === scopeId);
const reviewLineColumns: TableColumn[] = [
  { key: "project_scope_id", label: "关联需求", minWidth: 180 },
  { key: "quantity_scaled", label: "工作量" },
  { key: "amount_fen", label: "结算金额" },
  { key: "evidence", label: "依据", minWidth: 180 },
];
const reviewResolutionColumns: TableColumn[] = [
  { key: "project_scope_id", label: "需求", minWidth: 180 },
  { key: "resolved_quantity_scaled", label: "本次解决量" },
  { key: "evidence", label: "依据", minWidth: 180 },
];
const formRef = ref();
const scopePrecision = ref<Record<string, number>>({});
const scopePrecisionError = ref("");
const invalidQuantity = ref<Record<string, boolean>>({});
function markQuantityInvalid(path: string, invalid: boolean) {
  invalidQuantity.value = { ...invalidQuantity.value, [path]: invalid };
}
const focusedSection = ref<HTMLElement>();
const focusedFact = ref<EditingFact | EditingFact[] | null>(null);
const focusedLoading = ref(false);
const focusedError = ref("");
const focusedHistoryOpen = ref(false);
let focusSequence = 0;
const focusedCurrent = computed<EditingFact | null>(() => Array.isArray(focusedFact.value)
  ? [...focusedFact.value].sort((a, b) => (b.version_no || 0) - (a.version_no || 0))[0] || null
  : focusedFact.value);
const focusedTitle = computed(() => {
  const f = props.focus;
  if (!f) return "结算单详情";
  return f.kind === "cost" ? "定位真实费用" : f.kind === "settlement" ? "定位独立结算单" : "定位正式费用核对";
});
async function inspectSettlement(row: BillFact) {
  focusedFact.value = row;
  focusedHistoryOpen.value = false;
  await nextTick();
  jumpToSection(focusedSection.value);
}
async function inspectImportedSettlement(id: string) {
  const row = await api<BillFact>(`/projects/${props.project.id}/settlements/${id}`);
  await inspectSettlement(row);
}
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
    const result = await api<EditingFact | EditingFact[]>(uri);
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
const emit = defineEmits<{
  changed: [];
  openSettlement: [id: string, action?: string];
  closeSettlement: [];
}>();
const costs = ref<CostFact[]>([]),
  listLoading = ref(false),
  listError = ref(""),
  bills = ref<BillFact[]>([]),
  summary = ref<Partial<FinanceSummary>>({}),
  dialog = ref(""),
  form = ref<FinanceForm>(emptyForm()),
  editing = ref<EditingFact | null>(null),
  busy = ref(false),
  history = ref<HistoryTarget | null>(null),
  reconciliations = ref<ReconciliationFact[]>([]);
const approvalChoices = ref<ProjectDetail["approvals"]>([]);
const approvalsLoading = ref(false);
const approvalsError = ref("");
const settlementScopes = computed(() => approvalChoices.value
  .find(ap => ap.id === form.value.approval_version_id)?.scopes || []);
const demandScopeLabels = computed(() => choiceLabels(settlementScopes.value.map(scope => ({
  ...scope, id: scope.project_scope_id,
})), scope => scope.problem_description || "历史需求", scope => [scope.demand_no]));

let approvalSequence = 0;
async function loadApprovalChoices() {
  const projectId = props.project.id;
  const sequence = ++approvalSequence;
  approvalsLoading.value = true;
  approvalsError.value = "";
  approvalChoices.value = [];
  try {
    const approvals = await api<ProjectDetail["approvals"]>(`/projects/${projectId}/approval-history`);
    if (sequence === approvalSequence)
      approvalChoices.value = approvals.filter(ap => ap.status === "approved");
  } catch (failure) {
    if (sequence === approvalSequence) approvalsError.value = (failure as Error).message;
  } finally {
    if (sequence === approvalSequence) approvalsLoading.value = false;
  }
}
watch(() => [props.project.id, props.project.approval?.id], () => {
  void loadApprovalChoices();
}, { immediate: true });
let scopePrecisionRequest = 0;
watch(settlementScopes, async scopes => {
  const sequence = ++scopePrecisionRequest;
  scopePrecision.value = {};
  scopePrecisionError.value = "";
  try {
    const units = new Map<string, Promise<number>>();
    const entries = await Promise.all(scopes.map(async scope => {
      const key = scope.unit_id + "@" + scope.unit_version;
      if (!units.has(key)) units.set(key,
        readAdoptedQuantityPrecision(scope.unit_id, scope.unit_version));
      return [scope.project_scope_id, await units.get(key)!] as const;
    }));
    if (sequence === scopePrecisionRequest) scopePrecision.value = Object.fromEntries(entries);
  } catch (failure) {
    if (sequence === scopePrecisionRequest)
      scopePrecisionError.value = "正式单位精度读取失败：" + (failure as Error).message;
  }
}, { immediate: true });

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
    { key: "amount_fen", label: "本次金额", minWidth: 135 },
    { key: "effective_amount_fen", label: "当前生效", minWidth: 135, sortable: false, filterable: false },
    { key: "number", label: "结算编号", minWidth: 175 },
    { key: "status", label: "正式版本与状态", minWidth: 180, sortable: false },
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
const reconcileCostChoices = ref<CostFact[]>([]);
const reconcileBillChoices = ref<ReconciliationSettlementChoice[]>([]);
const reconcileCostsLoading = ref(false);
const reconcileBillsLoading = ref(false);
let reconcileCostSequence = 0;
let reconcileBillSequence = 0;
async function loadReconciliationChoices(kind: "costs" | "bills", term = "") {
  const sequence = kind === "costs" ? ++reconcileCostSequence : ++reconcileBillSequence;
  if (kind === "costs") reconcileCostsLoading.value = true;
  else reconcileBillsLoading.value = true;
  const projectId = props.project.id;
  const resource = kind === "costs" ? "costs" : "reconciliation-items";
  try {
    const page = await api<{items: Array<CostFact | ReconciliationSettlementChoice>}>(`/projects/${projectId}/${resource}?page=1&page_size=200&q=${encodeURIComponent(term.trim())}`);
    if (projectId !== props.project.id || sequence !== (kind === "costs" ? reconcileCostSequence : reconcileBillSequence)) return;
    if (kind === "costs") {
      const currentId = form.value.cost_version_id;
      const selected = reconcileCostChoices.value.find(row => row.id === currentId);
      const candidates = (page.items as CostFact[]).filter(row => row.status === "active" && !row.deleted);
      reconcileCostChoices.value = selected && !candidates.some(row => row.id === currentId)
        ? [selected, ...candidates] : candidates;
    } else {
      const currentId = form.value.settlement_item_version_id;
      const selected = reconcileBillChoices.value.find(row => row.id === currentId);
      const candidates = page.items as ReconciliationSettlementChoice[];
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
const billSelection = usePageSelection(bills, () => JSON.stringify([props.project.id, financeFilters.value.bills]));
const { selected, selectedIds } = billSelection;
let loadSequence = 0;
async function load() {
  const sequence = ++loadSequence;
  listLoading.value = true;
  listError.value = "";
  try {
    const billParameters = new URLSearchParams({
      page: String(billPage.value), page_size: "30", sort: financeSort.value.bills || "created_at",
      direction: financeDirection.value.bills, filters: JSON.stringify(financeFilters.value.bills),
    });
    const [costResult, billResult, summaryResult, reconResult, treeResult] = await Promise.all([
      api<{ items: CostFact[]; total: number }>(`/projects/${props.project.id}/costs?page=${costPage.value}&page_size=30&deleted=${showDeletedCosts.value}&sort=${encodeURIComponent(financeSort.value.costs || "created_at")}&direction=${financeDirection.value.costs}&filters=${encodeURIComponent(JSON.stringify(financeFilters.value.costs))}`),
      api<{ items: BillFact[]; total: number }>(`/projects/${props.project.id}/settlements?${billParameters}`),
      api<FinanceSummary>(`/projects/${props.project.id}/summary`),
      api<{ items: ReconciliationFact[]; total: number }>(`/reconciliations?page=${reconPage.value}&page_size=30&project_id=${props.project.id}&deleted=${showDeletedReconciliations.value}&sort=${encodeURIComponent(financeSort.value.reconciliations || "created_at")}&direction=${financeDirection.value.reconciliations}&filters=${encodeURIComponent(JSON.stringify(financeFilters.value.reconciliations))}`),
      api<CostCategoryNode[]>(`/projects/${props.project.id}/cost-tree`),
    ]);
    if (sequence !== loadSequence) return;
    categoryNodes.value = treeResult;
    costs.value = costResult.items;
    costTotal.value = costResult.total;
    billQuery.value = billParameters.toString();
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
function confirmSettlementExit() { return !props.settlementWork || dialog.value !== "settlement" || draftGuard.canClose(); }
onBeforeRouteLeave(confirmSettlementExit);
onBeforeRouteUpdate((to, from) => to.path === from.path || confirmSettlementExit());
function closeEditor() {
  void draftGuard.confirmClose(() => {
    if (props.settlementWork) {
      draftGuard.capture();
      emit("closeSettlement");
    } else dialog.value = "";
  });
}
function beforeEditorClose(done: () => void) { void draftGuard.confirmClose(done); }
function edit(type: string, row?: EditingFact) {
  if (type === "settlement" && !props.settlementWork) {
    emit("openSettlement", row?.id || "new");
    return;
  }
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
          ...emptyForm(),
          ...row,
          status: row.status === "voided" ? "voided" : "active",
          is_final: undefined,
          request_key: undefined,
          cost_node_id: row.cost_node_id || props.project.cost_nodes.find(
            (n) => n.current_version_id === row.cost_node_version_id,
          )?.id,
          expected_version: row.version_no,
        }
      : {
          ...emptyForm(),
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
          change_type: row.draft?.document.change_type === "void"
            ? "void"
            : row.version ? "revision" : "initial",
          number: row.number,
          expected_version: row.version?.version_no || 0,
          expected_edit_version: row.draft?.edit_version || 0,
          items: structuredClone(toRaw(row.draft?.document.items || row.items || [])),
          resolutions: structuredClone(
            toRaw(row.draft?.document.resolutions || row.resolutions || []),
          ),
        }
      : {
          number: "",
          approval_version_id: props.project.approval?.id,
          funding_version_id: props.project.funding?.id || null,
          settlement_on: today(),
          basis: "",
          mode: "project_total",
          items: [],
          resolutions: [],
        };
  if (type === "reconcile")
    form.value = row
      ? {
          ...emptyForm(),
          ...row,
          status: "active",
          request_key: undefined,
          expected_version: row.version_no,
          is_final: !!row.is_final,
        }
      : {
          ...emptyForm(),
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
watch([itemized, () => props.project.id, dialog], ([active, , current]) => {
  if (active && current === "settlement") {
    if (form.value.change_type !== "void" && !form.value.items.length)
      form.value.items.push({ quantity_scaled: 0, evidence: "" });
    if (props.settlementWork) void loadSettlementCategories();
  } else {
    categoryRequest++;
    categoryLoading.value = false;
    categoryError.value = "";
  }
});
const settlementConflict = ref("");
let comparedSettlement: BillFact | null = null;
function continueSettlementEdit() {
  const latest = comparedSettlement;
  if (!latest || latest.id !== editing.value?.id) return;
  if (latest.review?.action === "submit") {
    ElMessage.warning("当前版本正在审核，退回后可继续编辑");
    return;
  }
  form.value.expected_version = latest.version?.version_no ?? 0;
  form.value.expected_edit_version = latest.draft?.edit_version ?? 0;
  if (latest.version && form.value.change_type === "initial") form.value.change_type = "revision";
  settlementConflict.value = "";
  comparedSettlement = null;
}
watch(() => props.settlementWork?.id, () => { settlementConflict.value = ""; });
async function compareSettlement() {
  const id = editing.value?.id;
  if (!id) return [];
  const row = await api<BillFact>(`/projects/${props.project.id}/settlements/${id}`);
  comparedSettlement = row;
  const document = row.draft?.document || row.version;
  const amount = itemized.value ? itemizedTotal.value : form.value.amount_fen;
  const shownAmount = (value: number | undefined) => value === undefined ? "未填写" : "¥" + money(value);
  return [
    { label: "正式版本", draft: String(form.value.expected_version ?? 0), current: String(row.version?.version_no ?? 0) },
    { label: "草稿版本", draft: String(form.value.expected_edit_version ?? 0), current: String(row.draft?.edit_version ?? 0) },
    { label: "本次金额", draft: shownAmount(amount), current: shownAmount(document?.amount_fen) },
    { label: "结算依据", draft: form.value.basis || "—", current: document?.basis || "—" },
  ];
}
async function save() {
  if (busy.value || writeBlock.value) return;
  if (dialog.value === "settlement") {
    if (itemized.value && form.value.change_type !== "void" && (categoryLoading.value || categoryError.value)) {
      ElMessage.error(categoryError.value || "正在读取末级费用科目");
      return;
    }
    if (approvalsLoading.value || approvalsError.value) {
      ElMessage.error(approvalsError.value || "正式批准历史正在读取，请稍后保存");
      return;
    }
    const documents = itemized.value && form.value.change_type !== "void" ? form.value.items : [];
    const resolutions = form.value.change_type === "void" ? [] : form.value.resolutions;
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
        { ...form.value, amount_fen: itemized.value ? undefined : form.value.amount_fen,
          items: itemized.value && form.value.change_type !== "void" ? form.value.items : [],
          resolutions: form.value.change_type === "void" ? [] : form.value.resolutions },
      );
    if (dialog.value === "reconcile")
      await api("/reconciliations", "POST", form.value);
    ElMessage.success("费用或结算数据已保存，正在刷新列表");
    if (!props.settlementWork) await load();
    emit("changed");
    dialog.value = "";
    if (props.settlementWork) emit("closeSettlement");
  } catch (e) {
    if (dialog.value === "settlement" && editing.value?.id && e instanceof ApiError && e.status === 409)
      settlementConflict.value = e.message;
    else ElMessage.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function action(row: BillFact, name: "submit" | "approve" | "return") {
  if (busy.value || reviewBlock.value) return;
  const reason = reviewReason.value.trim();
  if (name === "return" && !reason) {
    ElMessage.warning("请填写退回原因");
    return;
  }
  busy.value = true;
  try {
    await api(
      `/settlements/${row.id}/${name === "submit" ? "submit" : "review"}`,
      "POST",
      {
        expected_version: row.version?.version_no || 0,
        expected_edit_version: row.draft?.edit_version || 0,
        expected_event_seq: row.review?.event_seq || 0,
        action: name,
        reason: name === "return" ? reason : undefined,
      },
    );
    ElMessage.success(name === "submit" ? "已提交结算审核" : name === "return" ? "结算已退回" : "结算已批准");
    emit("changed");
    emit("closeSettlement");
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    busy.value = false;
  }
}
let settlementWorkRequest = 0;
async function loadSettlementWork() {
  const work = props.settlementWork;
  if (!work) return;
  const request = ++settlementWorkRequest;
  settlementWorkLoading.value = true;
  settlementWorkError.value = "";
  reviewReason.value = "";
  settlementReview.value = null;
  try {
    const row = work.id === "new" ? undefined
      : await api<BillFact>(`/projects/${props.project.id}/settlements/${work.id}`);
    if (request !== settlementWorkRequest) return;
    if (work.action && !row) throw new Error("请选择要办理的结算单");
    if (work.action && row) {
      settlementReview.value = row;
      return;
    }
    if (!can("write") || writeBlock.value || props.project.status !== "approved" ||
        row?.review?.action === "submit" || row?.deleted)
      throw new Error(writeBlock.value || "当前账号、项目或结算状态无法编制草稿");
    edit("settlement", row);
  } catch (error) {
    if (request === settlementWorkRequest) settlementWorkError.value = (error as Error).message;
  } finally {
    if (request === settlementWorkRequest) settlementWorkLoading.value = false;
  }
}
watch([() => props.project.id, () => props.settlementWork?.id, () => props.settlementWork?.action],
  loadSettlementWork, { immediate: true });
async function resubmitBill(row: BillFact) {
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
async function voidCost(row: CostFact) {
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
async function removeBill(row: BillFact) {
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
async function withdrawBillDraft(row: BillFact) {
  try {
    await ElMessageBox.confirm(
      row.version ? "撤回当前未提交草稿，保留原正式结算版本及审核历史。"
        : "撤回首次结算草稿并从正常列表移除，撤回内容保留审计。",
      "撤回结算草稿", { type: "warning" },
    );
    await api(`/settlements/${row.id}/draft`, "DELETE", {
      expected_version: row.version?.version_no || 0,
      expected_edit_version: row.draft?.edit_version || 0,
    });
    await load();
    emit("changed");
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message);
  }
}
async function removeCost(row: CostFact) {
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
async function removeReconciliation(row: ReconciliationFact) {
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
function reconciliationHistory(row: ReconciliationFact) {
  history.value = { kind: "reconciliations", id: row.record_id, project: props.project.id };
}
function showHistory(row: BillFact) {
  history.value = { kind: "settlements", id: row.id, project: props.project.id };
}
const focusedHistoryTarget = computed<HistoryTarget | null>(() => {
  const focus = props.focus;
  if (focus) return { kind: focus.kind === "cost" ? "costs" : focus.kind === "reconciliation" ? "reconciliations" : "settlements",
    id: focus.id, project: props.project.id };
  return focusedCurrent.value?.id ? { kind: "settlements", id: focusedCurrent.value.id, project: props.project.id } : null;
});
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
}, load, () => !props.settlementWork);
watch(() => props.refreshKey, () => { if (!props.settlementWork) void load(); });
watch(() => props.project.id, () => {
  if (props.settlementWork) return;
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
  <template v-if="!settlementWork">
  <ElAlert v-if="writeBlock" :title="writeBlock" type="info" :closable="false" />
  <template v-if="evidence"
    ><ElButton @click="evidence = null">关闭附件区</ElButton
    ><EvidencePanel
      :key="evidence.ownerId"
      :owner-kind="evidence.ownerKind"
      :owner-id="evidence.ownerId"
  /></template>
  <div v-if="focus || focusedFact" ref="focusedSection" class="panel" v-loading="focusedLoading">
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
        <ElDescriptionsItem v-if="focus?.kind === 'cost'" label="实际金额">
          {{ focusedCurrent.amount_fen == null ? '未核定' : '¥' + money(focusedCurrent.amount_fen) }}
        </ElDescriptionsItem>
        <ElDescriptionsItem v-if="focus?.kind === 'settlement' || (!focus && focusedFact)" label="结算业务">
          {{ focusedCurrent.number }}
        </ElDescriptionsItem>
        <ElDescriptionsItem v-if="focus?.kind === 'reconciliation'" label="核对金额">
          {{ focusedCurrent.reconciled_settlement_fen == null ? '—' : '¥' + money(focusedCurrent.reconciled_settlement_fen) }}
        </ElDescriptionsItem>
      </ElDescriptions>
      <div class="toolbar" style="margin-top:12px">
        <ElButton link type="primary" @click="focusedHistoryOpen = !focusedHistoryOpen">
          {{ focusedHistoryOpen ? '收起正式历史' : '查看正式历史' }}
        </ElButton>
      </div>
      <BusinessHistory reveal v-if="focusedHistoryOpen && focusedHistoryTarget" :record-kind="focusedHistoryTarget.kind"
        :record-id="focusedHistoryTarget.id" :project-id="focusedHistoryTarget.project" />
    </template>
  </div>
  <ElAlert v-if="listError" class="panel" type="error" :closable="false"
    :title="listError" show-icon>
    <ElButton @click="load">重新读取费用数据</ElButton>
  </ElAlert>
  <nav class="toolbar" aria-label="定位财务分区">
    <ElButton size="small" @click="jumpToSection(actualSection)">实际费用</ElButton>
    <ElButton size="small" @click="jumpToSection(settlementSection)">结算单</ElButton>
    <ElButton size="small" @click="jumpToSection(reconciliationSection)">费用核对</ElButton>
  </nav>
  <section v-if="!listError" class="panel finance-summary" v-loading="listLoading" aria-label="项目结算总览">
    <div class="finance-summary-main">
      <div class="settlement-progress">
        <h2>结算进度</h2>
        <strong :class="{ 'without-basis': summary.settlement_progress_percent == null }">
          {{ settlementProgressText(summary.settlement_progress_percent) }}
        </strong>
        <ElProgress v-if="summary.settlement_progress_percent != null" :percentage="Math.min(100, summary.settlement_progress_percent)"
          :show-text="false" :status="summary.excess_settlement_fen ? 'warning' : undefined" :stroke-width="6"
          :aria-label="'结算进度 ' + settlementProgressText(summary.settlement_progress_percent)" />
      </div>
      <dl class="finance-totals">
        <div><dt>核定实际费用</dt><dd>¥{{ money(summary.actual_cost_fen) }}</dd></div>
        <div><dt>已批准结算</dt><dd>¥{{ money(summary.settlement_fen) }}</dd></div>
        <div><dt>其中按项目总额</dt><dd>¥{{ money(summary.project_total_settlement_fen) }}</dd></div>
        <div v-if="summary.excess_settlement_fen" class="settlement-excess">
          <dt>超结算</dt><dd>¥{{ money(summary.excess_settlement_fen) }}</dd>
        </div>
        <div v-else-if="summary.settlement_progress_percent != null">
          <dt>待结算</dt><dd>¥{{ money(summary.unsettled_cost_fen) }}</dd>
        </div>
      </dl>
    </div>
    <dl class="finance-summary-context">
      <div><dt>批准预算</dt><dd>{{ summary.approved_budget_fen == null ? '尚未批准' : '¥' + money(summary.approved_budget_fen) }}</dd></div>
      <div><dt>正式参考价格</dt><dd>{{ summary.reference_total_fen == null ? '未完整计价' : '¥' + money(summary.reference_total_fen) }}</dd></div>
      <div><dt>参考价与批准预算差额</dt><dd>{{ summary.reference_budget_difference_fen == null ? '未具备比较条件' : '¥' + money(summary.reference_budget_difference_fen) }}</dd></div>
      <div><dt>实际费用与参考价差额</dt><dd>{{ summary.actual_reference_difference_fen == null ? '未具备比较条件' : '¥' + money(summary.actual_reference_difference_fen) }}</dd></div>
      <div><dt>待核对费用</dt><dd>¥{{ money(summary.unreconciled_cost_fen) }}</dd></div>
    </dl>
  </section>
  <CostCategoryWorkspace :readonly="!!writeBlock" :project-id="project.id" :snapshot="categoryNodes" @changed="load(); emit('changed')" />
  <ElAlert v-if="scopePrecisionError" type="error" :closable="false"
    :title="scopePrecisionError" class="panel" />
  <div ref="actualSection" class="panel">
    <div class="toolbar">
      <h2>实际费用</h2>
      <ElCheckbox data-guide-action="finance.cost-show-deleted" v-model="showDeletedCosts" @change="costPage = 1; load()"
        >包含已删除费用</ElCheckbox
      >
      <ElButton data-guide-action="finance.cost"
        :disabled="!!writeBlock || !can('cost.confirm')"
        type="primary"
        @click="edit('cost')"
        >核定费用</ElButton
      >
      <span v-if="!!writeBlock || !can('cost.confirm')" class="muted" role="note">
        费用核定须由具备审核权限的人员办理
      </span>
    </div>
    <BusinessTable table-key="finance:costs" :loading="listLoading" :filter-state="financeFilters.costs"
      :sort-state="{ prop: financeSort.costs, order: financeSort.costs ? (financeDirection.costs === 'asc' ? 'ascending' : 'descending') : null }" :rows="costs" :columns="financeColumns.costs" :actions-width="145"
      @sort-change="financeTableSort('costs', $event)" @filter-change="financeTableFilter('costs', $event)">
      <template #cell="{ row, column }">
        <ElButton v-if="column.key === 'title'" link type="primary" class="cell-link"
          @click="history = { kind: 'costs', id: row.entry_id, project: project.id }">{{ row.title }}</ElButton>
        <span v-else-if="column.key === 'amount_fen'">¥{{ money(row.amount_fen) }}</span>
        <ElTag v-else-if="column.key === 'status'" :type="row.deleted ? 'danger' : 'info'" effect="plain">{{ row.deleted ? '已删除' : row.status === 'voided' ? '已作废' : statusText[row.status] || row.status }}</ElTag>
        <span v-else>{{ formatVisibleDateTime(row[column.key as keyof typeof row], column.key) ?? '—' }}</span>
      </template>
      <template #actions="{ row }">
        <RowActions :actions="[
          { label: '附件', run: () => evidence = { ownerKind: 'cost_version_id', ownerId: row.id } },
          { label: '更正', disabled: !!writeBlock || !can('cost.confirm') || row.deleted, run: () => edit('cost', row) },
          { label: '作废费用', guideActionId: 'finance.void', danger: true, disabled: !!writeBlock || !can('cost.confirm') || row.deleted || row.status === 'voided', run: () => voidCost(row) },
          { label: '管理员删除', danger: true, disabled: !!writeBlock || !can('admin') || row.deleted, run: () => removeCost(row) },
        ]" />
      </template>
    </BusinessTable>
    <ElPagination v-model:current-page="costPage" :total="costTotal" :page-size="30"
      layout="prev,pager,next,total" @current-change="load" />
  </div>
  <div ref="settlementSection" class="panel">
    <BusinessTable table-key="finance:bills" :loading="listLoading" :filter-state="financeFilters.bills"
      :sort-state="{ prop: financeSort.bills, order: financeSort.bills ? (financeDirection.bills === 'asc' ? 'ascending' : 'descending') : null }" :rows="bills" :columns="financeColumns.bills" selectable :actions-width="190"
       :selected-ids="selectedIds" @selection-change="billSelection.updatePage" @sort-change="financeTableSort('bills', $event)"
      @filter-change="financeTableFilter('bills', $event)">
      <template #toolbar="{ openSettings, clearFilters, hasActiveFilters }">
        <div v-if="selected.length" class="toolbar selection-toolbar" aria-label="结算批量操作">
          <span role="status">已选 {{ selected.length }} 条</span>
          <ExchangePanel :readonly="!!writeBlock" kind="settlements" :project-id="project.id"
            :applied-query="billQuery" :selected-ids="selectedIds" @changed="load" @inspect="inspectImportedSettlement" />
          <ElButton link @click="billSelection.clear">清空选择</ElButton>
          <ElButton class="business-column-setting-trigger" @click="openSettings">列设置</ElButton>
        </div>
        <div v-else class="unified-list-tools">
          <div class="toolbar"><h2>独立结算单</h2>
          <span v-if="!can('write') || project.status !== 'approved'" class="muted">{{ writeBlock || (project.status !== 'approved' ? '待项目正式批准后编制结算' : '当前账号可查看结算') }}</span></div>
          <div class="toolbar page-heading-actions">
            <ElButton v-if="hasActiveFilters" link type="primary" @click="clearFilters">清除列筛选</ElButton>
            <ElButton :loading="listLoading" @click="load">刷新</ElButton>
            <ElButton class="business-column-setting-trigger" @click="openSettings">列设置</ElButton>
            <ExchangePanel :readonly="!!writeBlock" kind="settlements" :project-id="project.id"
              :applied-query="billQuery" @changed="load" @inspect="inspectImportedSettlement" />
            <ElButton v-if="can('write') && project.status === 'approved' && !writeBlock" data-guide-action="finance.settlement-draft"
              type="primary" @click="edit('settlement')">新增结算草稿</ElButton>
          </div>
        </div>
      </template>
      <template #cell="{ row, column }">
        <span v-if="column.key === 'amount_fen'">¥{{ money(row.draft?.document.amount_fen ?? row.version?.amount_fen) }}</span>
        <span v-else-if="column.key === 'effective_amount_fen'">{{ row.effective_amount_fen == null ? '—' : '¥' + money(row.effective_amount_fen) }}</span>
        <span v-else-if="column.key === 'status'">
          第 {{ row.version?.version_no || 0 }} 版 · {{ row.status === 'voided' ? '已注销' : row.status === 'submit' ? '待审核' : row.status === 'return' ? '已退回' : row.draft ? '有草稿' : statusText[row.status] || '待编制' }}
          <span v-if="row.review?.action === 'return'" class="muted" :title="row.review.reason || '未记录原因'"> · 退回原因：{{ row.review.reason || '未记录' }}</span>
        </span>
        <ElButton v-else-if="column.key === 'number'" link type="primary" class="cell-link"
          @click="inspectSettlement(row)">{{ row.number }}</ElButton>
        <span v-else>{{ formatVisibleDateTime(row[column.key as keyof typeof row], column.key) ?? '—' }}</span>
      </template>
      <template #actions="{ row }">
        <RowActions :actions="[
          ...(row.review?.action === 'submit' && can('settlement.approve') ? [
            { label: '审核结算', guideActionId: 'finance.approve', primary: true, disabled: !!writeBlock, run: () => emit('openSettlement', row.id, 'review') },
          ] : []),
          ...(row.draft && can('write') ? [{ label: '复核并提交', guideActionId: 'finance.submit', primary: true, disabled: !!writeBlock || row.review?.action === 'submit', run: () => emit('openSettlement', row.id, 'submit') }] : []),
          ...(row.review?.action === 'return' && !row.draft ? [{ label: '原版重新提交', primary: true, disabled: !!writeBlock || !can('write'), run: () => resubmitBill(row) }] : []),
          { label: row.draft ? '继续编辑草稿' : row.review?.action === 'return' ? '修订结算' : row.review?.action === 'submit' ? '审核中（禁止修订）' : row.version ? '发起新修订' : '编制结算', disabled: !!writeBlock || !can('write') || row.review?.action === 'submit', run: () => edit('settlement', row) },
          ...(row.draft ? [{ label: '撤回草稿', disabled: !!writeBlock || !can('write'), run: () => withdrawBillDraft(row) }] : []),
          ...(row.version ? [{ label: '附件', run: () => evidence = { ownerKind: 'settlement_version_id', ownerId: row.version!.id } }] : []),
          { label: '历史', guideActionId: 'finance.history', run: () => showHistory(row) },
          { label: '删除', danger: true, disabled: !!writeBlock || !can('admin'), run: () => removeBill(row) },
        ]" />
      </template>
    </BusinessTable>
    <ElPagination v-model:current-page="billPage" :total="billTotal" :page-size="30"
      layout="prev,pager,next,total" @current-change="load" />
  </div>
  <div ref="reconciliationSection" class="panel">
    <div class="toolbar">
      <h2>费用与结算核对</h2>
      <ElCheckbox data-guide-action="finance.reconcile-show-deleted" v-model="showDeletedReconciliations" @change="reconPage = 1; load()"
        >包含已删除核对</ElCheckbox
      ><ElButton data-guide-action="finance.reconcile" :disabled="!!writeBlock || !can('cost.confirm')" @click="edit('reconcile')"
        >新增正式核对</ElButton
      >
      <span v-if="!!writeBlock || !can('cost.confirm')" class="muted" role="note">
        正式费用核对须由具备审核权限的人员办理
      </span>
    </div>
    <BusinessTable table-key="finance:reconciliations" :loading="listLoading" :filter-state="financeFilters.reconciliations"
      :sort-state="{ prop: financeSort.reconciliations, order: financeSort.reconciliations ? (financeDirection.reconciliations === 'asc' ? 'ascending' : 'descending') : null }" :rows="reconciliations"
      :columns="financeColumns.reconciliations" :actions-width="190"
      @sort-change="financeTableSort('reconciliations', $event)"
      @filter-change="financeTableFilter('reconciliations', $event)">
      <template #cell="{ row, column }">
        <span v-if="column.key === 'reconciled_cost_fen' || column.key === 'reconciled_settlement_fen'">¥{{ money(Number(row[column.key as keyof typeof row])) }}</span>
        <ElTag v-else-if="column.key === 'status'" effect="plain">{{ row.deleted ? '已删除' : row.status === 'voided' ? '已撤销' : row.effective === false ? '待重新核对' : '有效' }}</ElTag>
        <span v-else>{{ formatVisibleDateTime(row[column.key as keyof typeof row], column.key) ?? '—' }}</span>
      </template>
      <template #actions="{ row }">
        <RowActions :actions="[
          { label: '更正', disabled: !!writeBlock || !can('cost.confirm') || row.deleted, run: () => edit('reconcile', row) },
          { label: '历史', guideActionId: 'finance.history', run: () => reconciliationHistory(row) },
          { label: '删除', danger: true, disabled: !!writeBlock || !can('cost.confirm') || row.deleted, run: () => removeReconciliation(row) },
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
        <span v-if="column.key.endsWith('_quantity_scaled')">{{ quantity(Number(row[column.key as keyof typeof row])) }}</span>
        <span v-else>{{ formatVisibleDateTime(row[column.key as keyof typeof row], column.key) ?? '—' }}</span>
      </template>
    </BusinessTable>
  </div>
  </template>
  <BusinessWorkSurface v-if="settlementWork && dialog !== 'settlement'" :title="settlementTitle" :subtitle="project.name" :busy="busy"
    @back="emit('closeSettlement')">
    <ElSkeleton v-if="settlementWorkLoading" :rows="5" animated />
    <ElAlert v-else-if="settlementWorkError" :title="settlementWorkError" type="error" :closable="false">
      <ElButton text @click="loadSettlementWork">重新读取</ElButton>
    </ElAlert>
    <template v-else-if="settlementReview">
      <ElAlert v-if="reviewBlock" :title="reviewBlock" type="info" :closable="false" />
      <ElAlert v-if="settlementReview.reconciliation_impact?.count" type="warning" :closable="false"
        title="批准新版会影响原有核对记录"
        :description="`涉及 ${settlementReview.reconciliation_impact.count} 条有效核对，已核对费用 ¥${money(settlementReview.reconciliation_impact.cost_fen)}。批准后请按生效明细重新核对，原记录保留历史。`" />
      <ElDescriptions :column="2" border>
        <ElDescriptionsItem label="结算编号"><BusinessNumber :value="settlementReview.number" label="结算编号" /></ElDescriptionsItem>
        <ElDescriptionsItem label="业务日期">{{ reviewDocument?.settlement_on || '—' }}</ElDescriptionsItem>
        <ElDescriptionsItem label="结算方式">{{ reviewDocument?.mode === 'project_total' ? '按项目总额' : '按子费用' }}</ElDescriptionsItem>
        <ElDescriptionsItem label="本次申请">¥{{ money(reviewDocument?.amount_fen) }}</ElDescriptionsItem>
        <ElDescriptionsItem label="当前生效">{{ settlementReview.effective_amount_fen == null ? '尚无批准' : '¥' + money(settlementReview.effective_amount_fen) }}</ElDescriptionsItem>
        <ElDescriptionsItem label="批准后净变化">¥{{ money((reviewDocument?.amount_fen ?? 0) - (settlementReview.effective_amount_fen ?? 0)) }}</ElDescriptionsItem>
        <ElDescriptionsItem label="采用批准范围">{{ reviewApproval ? '第 ' + reviewApproval.version_no + ' 版' : '—' }}</ElDescriptionsItem>
        <ElDescriptionsItem label="结算依据">{{ reviewDocument?.basis || '—' }}</ElDescriptionsItem>
        <ElDescriptionsItem v-if="reviewDocument?.reason" label="修订依据">{{ reviewDocument.reason }}</ElDescriptionsItem>
      </ElDescriptions>
      <h2 v-if="reviewItems.length">结算明细</h2>
      <BusinessTable v-if="reviewItems.length" table-key="finance:review-items" :rows="reviewItems" :columns="reviewLineColumns" sort-mode="off" filter-mode="off">
        <template #cell="{ row, column, value }">
          <template v-if="column.key === 'project_scope_id'">{{ reviewScope(row.project_scope_id)?.demand_no || '独立费用' }}</template>
          <template v-else-if="column.key === 'amount_fen'">¥{{ money(row.amount_fen) }}</template>
          <template v-else-if="column.key === 'quantity_scaled'">{{ quantity(row.quantity_scaled) }}</template>
          <template v-else>{{ value || '—' }}</template>
        </template>
      </BusinessTable>
      <template v-if="reviewResolutions.length">
        <h2>需求解决量</h2>
        <BusinessTable table-key="finance:review-resolutions" :rows="reviewResolutions" :columns="reviewResolutionColumns" sort-mode="off" filter-mode="off">
          <template #cell="{ row, column, value }">
            <template v-if="column.key === 'project_scope_id'">{{ reviewScope(row.project_scope_id)?.demand_no || '—' }}</template>
            <template v-else-if="column.key === 'resolved_quantity_scaled'">{{ quantity(row.resolved_quantity_scaled) }}</template>
            <template v-else>{{ value || '—' }}</template>
          </template>
        </BusinessTable>
      </template>
      <ElForm v-if="settlementWork.action === 'review' && !reviewBlock" label-position="top" novalidate class="review-reason">
        <ElFormItem label="退回原因（选择退回时必填）">
          <ElInput v-model="reviewReason" type="textarea" :rows="3" />
        </ElFormItem>
      </ElForm>
    </template>
    <template v-if="settlementReview && !reviewBlock" #footer>
      <ElButton :disabled="busy" @click="emit('closeSettlement')">取消</ElButton>
      <template v-if="settlementWork.action === 'review'">
        <ElButton :disabled="busy || !reviewReason.trim()" type="danger" plain @click="action(settlementReview, 'return')">确认退回</ElButton>
        <ElButton data-guide-action="finance.approve" :loading="busy" type="primary" @click="action(settlementReview, 'approve')">确认批准结算</ElButton>
      </template>
      <ElButton v-else data-guide-action="finance.submit" :loading="busy" type="primary" @click="action(settlementReview, 'submit')">确认提交审核</ElButton>
    </template>
  </BusinessWorkSurface>
  <BusinessEditorSurface :page="!!settlementWork" :open="!!dialog" :subtitle="project.name" :busy="busy"
    :title="
      {
        node: '费用科目版本',
        cost: '核定真实费用',
        settlement: settlementTitle,
        reconcile: '正式费用核对',
      }[dialog] || ''
    "
    width="min(1000px, 94vw)"
    :before-close="beforeEditorClose"
    @close="settlementWork ? closeEditor() : dialog = '' "
    >
    <VersionConflictNotice v-if="dialog === 'settlement'" :message="settlementConflict" :read-current="compareSettlement" :apply-current="continueSettlementEdit" />
    <ElForm ref="formRef" label-position="top" novalidate :model="form"
      ><div class="form-grid">
        <ActualCostFields v-if="dialog === 'cost'" :model-value="form" :project-id="project.id"
          :nodes="categoryNodes" :editing="!!editing" :historical-label="editing?.cost_node_name"
          :historical-version-id="editing?.cost_node_version_id" />
        <SettlementEntryFields v-if="dialog === 'settlement'" :model-value="form"
          :approval-choices="approvalChoices" :approvals-loading="approvalsLoading"
          :approvals-error="approvalsError" :itemized="itemized" :editing-version="!!editing?.version"
          @retry="loadApprovalChoices" />
        <ReconciliationFields v-if="dialog === 'reconcile'" :model-value="form"
          :cost-choices="reconcileCostChoices" :bill-choices="reconcileBillChoices"
          :costs-loading="reconcileCostsLoading" :bills-loading="reconcileBillsLoading"
          @search-costs="term => loadReconciliationChoices('costs', term)"
          @search-bills="term => loadReconciliationChoices('bills', term)" />
      </div>
      <template v-if="dialog === 'settlement' && form.change_type !== 'void'"
        ><template v-if="itemized">
        <ElAlert v-if="categoryError" type="error" :closable="false" :title="categoryError">
          <ElButton @click="loadSettlementCategories">重新读取费用科目</ElButton>
        </ElAlert>
        <div class="toolbar"><h3>本次费用明细</h3><strong>合计 ¥{{ money(itemizedTotal) }}</strong></div>
        <div v-for="(item, index) in form.items" :key="index" class="panel finance-editor-line">
          <div class="toolbar finance-editor-line-heading">
            <strong>费用明细 {{ Number(index) + 1 }}</strong>
            <ElButton data-guide-action="finance.cost-item-remove" type="danger" plain size="small" @click="form.items.splice(index, 1)">移除此项</ElButton>
          </div>
          <div class="form-grid">
            <ElFormItem label="费用科目" required
              > <CostCategorySelect v-model="item.cost_node_id" :project-id="project.id" :nodes="categoryNodes" :disabled="categoryLoading || !!categoryError" :historical-label="item.cost_node_name" :historical-version-id="item.cost_node_version_id" /></ElFormItem
            ><ElFormItem label="关联需求（共同费用可不选）"
              ><ElSelect v-model="item.project_scope_id" clearable filterable
                ><template #label>{{ demandScopeLabels.get(item.project_scope_id || '') || "正在读取需求名称" }}</template>
                <ElOption
                  v-for="scope in settlementScopes"
                  :key="scope.project_scope_id"
                  :value="scope.project_scope_id"
                  :label="demandScopeLabels.get(scope.project_scope_id) || '历史需求'" /></ElSelect></ElFormItem
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
        </template>
        <h3>本次新增解决量（选填）</h3>
        <div v-for="(r, index) in form.resolutions" :key="index" class="panel finance-editor-line">
          <div class="toolbar finance-editor-line-heading">
            <strong>解决需求 {{ Number(index) + 1 }}</strong>
            <ElButton data-guide-action="finance.resolution-remove" type="danger" plain size="small" @click="form.resolutions.splice(index, 1)">移除此项</ElButton>
          </div>
          <div class="form-grid">
            <ElFormItem label="项目需求" required
              ><ElSelect v-model="r.project_scope_id" filterable
                ><template #label>{{ demandScopeLabels.get(r.project_scope_id || '') || "正在读取需求名称" }}</template>
                <ElOption
                  v-for="scope in settlementScopes"
                  :key="scope.project_scope_id"
                  :value="scope.project_scope_id"
                  :label="demandScopeLabels.get(scope.project_scope_id) || '历史需求'" /></ElSelect></ElFormItem
            ><ElFormItem label="本次新增解决量" required
              ><FieldControl
                v-model="r.resolved_quantity_scaled"
                :field="{ type: 'quantity', quantityPrecision: scopePrecision[r.project_scope_id || ''] }"
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
    ></BusinessEditorSurface>
  <ElDialog append-to-body
    :model-value="!!history"
    title="财务历史记录"
    width="min(1160px, 94vw)"
    destroy-on-close
    @close="history = null"
  >
    <BusinessHistory v-if="history" :record-kind="history.kind" :record-id="history.id" :project-id="history.project" />
  </ElDialog>
</template>
<style scoped>
.finance-summary { padding: 0; overflow: hidden }
.finance-summary-main {
  display: grid;
  grid-template-columns: minmax(170px, 1fr) minmax(0, 4fr);
  align-items: center;
  padding: 16px;
  gap: 18px;
}
.settlement-progress {
  align-self: stretch;
  background: var(--brand-soft);
  border-radius: 8px;
  padding: 12px;
}
.settlement-progress h2 { margin: 0; color: var(--muted); font-size: 13px }
.settlement-progress strong {
  display: block;
  margin: 3px 0 9px;
  color: var(--brand-primary);
  font-size: 26px;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}
.settlement-progress strong.without-basis { margin-bottom: 0; font-size: 16px }
.settlement-progress :deep(.el-progress-bar__outer) { background: var(--surface) }
.finance-totals, .finance-summary-context {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 12px 20px;
  margin: 0;
}
.finance-totals > div { flex: 1 1 104px }
.finance-summary dt { font-size: 12px; color: var(--muted) }
.finance-summary dd { margin: 5px 0 0; font-weight: 620; font-variant-numeric: tabular-nums }
.finance-totals dd { font-size: clamp(16px, 1.55vw, 22px); overflow-wrap: anywhere }
.settlement-excess dd { color: var(--el-color-warning) }
.finance-summary-context {
  padding: 12px 16px;
  border-top: 1px solid var(--edge);
  background: var(--surface-subtle);
}
.finance-summary-context > div { flex: 1 1 132px }
.finance-summary-context dd { font-size: 13px }
@media (max-width: 760px) {
  .finance-summary-main { grid-template-columns: minmax(0, 1fr) }
  .finance-totals > div { min-width: 0 }
}
.review-reason { margin-top:20px }
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

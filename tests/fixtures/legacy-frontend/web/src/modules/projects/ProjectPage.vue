<script setup lang="ts">
import ExcelExportButton from "../exchange/ExcelExportButton.vue";
import { projectStatusTag } from "../../shared/utils/project-status";
import VersionConflictNotice from "../../shared/ui/VersionConflictNotice.vue";
import SettlementProgressSummary from "../finance/components/SettlementProgressSummary.vue";
import HandlingReviewDialog from "../../shared/ui/HandlingReviewDialog.vue";
import { useHandlingReview } from "../../shared/composables/use-handling-review";
import { usePageSelection } from "../../shared/composables/use-page-selection";
import type { HandlingTarget } from "../../../../server/shared/types/handling-batch";
import { ordinaryLinkReason, approvalDraftReason, projectDeleteReason } from "../../../../server/shared/project-lifecycle";
import type { DemandRecord } from "../../../../server/shared/types/demands";
import BusinessDetailDialog from "../../shared/ui/BusinessDetailDialog.vue";
import BusinessEditorSurface from "../../shared/ui/BusinessEditorSurface.vue";
import BusinessWorkSurface from "../../shared/ui/BusinessWorkSurface.vue";
import { useWorkRoute } from "../../shared/navigation/use-work-route";
import { useEntityDialog } from "../../shared/composables/use-entity-dialog";
import { useDescriptionColumns } from "../../shared/composables/use-description-columns";import { useDialogDraftGuard } from "../../shared/forms/use-dialog-draft";
const descriptionColumns = useDescriptionColumns();
import { useListRoute } from "../../shared/composables/use-list-route";
import RowActions from "../../shared/ui/RowActions.vue";
import BusinessNumber from "../../shared/ui/BusinessNumber.vue";
import BusinessHistory from "../../shared/ui/BusinessHistory.vue";
import { useAccess } from "../../shared/composables/use-access";
const can = useAccess();
import { ref, onMounted, computed, watch, nextTick } from "vue";
import { useRoute, useRouter, onBeforeRouteLeave, onBeforeRouteUpdate } from "vue-router";
import { contextOrigin, demandContext, fundContext, projectContext } from "../../shared/navigation/business-context";
import { projectDisplayStatuses } from "../../../../server/shared/project-display-status";
import { ElMessage, ElMessageBox } from "element-plus";
import FieldControl from "../../shared/ui/FieldControl.vue";
import { readAdoptedQuantityPrecision, readCurrentMaterialPrecision }
  from "../../shared/api/quantity-precision";
import type { PriceRuleRecord } from "../../../../server/shared/types/price-rules";
import BusinessTable, { type TableColumn } from "../../shared/ui/BusinessTable.vue";
import PricingQuoteDialog from "../pricing/PricingQuoteDialog.vue";
import FinancePanel from "../finance/FinancePanel.vue";
import { approvalDifferences } from "./components/approval-differences";
import ProjectWorkflowHeader from "./components/ProjectWorkflowHeader.vue";
import ProjectOverview from "./components/ProjectOverview.vue";
import ProjectCloseReviewDialog from "./components/ProjectCloseReviewDialog.vue";
import ProjectArchiveFields from "./components/ProjectArchiveFields.vue";
import ProjectApprovalFields from "./components/ProjectApprovalFields.vue";
import ProjectDemandPicker from "./components/ProjectDemandPicker.vue";
import type { ProjectOverviewFacts, ProjectFinanceSnapshot, ProjectReference } from "./components/types";
import { ApiError, api, money, quantity, statusText } from "../../shared/api/client";
import { formatVisibleDateTime } from "../../shared/utils/datetime";
import type { ApprovedScope, ProjectScopeProjection, ApprovalCandidate, ProjectAction, ProjectDetail,
  ProjectListItem, ProjectDeletionImpact } from "../../../../server/shared/types/project-api";
import type { ProjectManagementInput, ProjectAgreementOption } from "../../../../server/shared/types/projects";

type ApprovalDetail = ProjectDetail["approvals"][number];
type ReferenceCharge = ApprovalDetail["reference"]["charges"][number];
interface ApprovalEditorRow {
  project_scope_id: string;
  demand_id?: string;
  demand_version: number;
  demand_no: string;
  demand_status: string;
  problem_description: string;
  expected_on: string | null;
  previous_demand_version?: number;
  unit_id: string;
  unit_version: number;
  quantity_precision?: number;
  precision_error?: string;
  selected: boolean;
  locations: ReturnType<typeof approvalEditorLocations>;
  materials: Array<{material_id: string; quantity_scaled: number}>;
}
interface ProjectForm extends ProjectManagementInput {
  managing_unit_name?: string | null;
  managing_unit_version_id?: string | null;
  code?: string;
  approved_budget_fen?: number;
  expected_approval_version_id?: string | null;
  basis?: string;
  reference_price_catalog_id?: string;
  quantity_scaled?: number;
  charge_scope_key?: string;
  work_mode?: string;
}
const formRef = ref(),
  actors = ref<Array<{id:string; username:string}>>([]);

const route = useRoute(), router = useRouter();
const workRoute = useWorkRoute();
const projectWork = computed(() => route.name === "projects" ? String(route.params.work || "") : "");
const workProjectId = computed(() => typeof route.params.projectId === "string" ? route.params.projectId : "");
const approvalEditorPage = computed(() => projectWork.value === "compile");
const approvalReviewPage = computed(() => projectWork.value === "review");
const projectFinancePage = computed(() => projectWork.value === "finance" || projectWork.value === "settlements");
const approvalEditorTitle = computed(() => detail.value?.approval ? "编制项目变更" : "编制项目立项");
const approvalReviewTitle = computed(() => detail.value?.approval ? "审核项目变更" : "审核项目立项");
function goToProjectWork(work: string, recordId = "", recordAction = "", focus = "") {
  const project = detail.value;
  if (!project) return;
  return workRoute.enter({
    name: "projects", params: { projectId: project.id, work, recordId, recordAction },
    query: { ...route.query, ...(focus ? { focus, record: recordId } : {}) },
  });
}
let returningToProjectDetail = false;
async function returnFromProjectWork() {
  if (typeof route.query.returnTo === "string") {
    const origin = router.resolve(route.query.returnTo);
    if (origin.name === "dashboard" && ["compile", "review", "finance"].includes(projectWork.value))
      return workRoute.exit(origin.fullPath);
    if (projectWork.value === "finance" && ["finance", "frameworks", "agreements"].includes(String(origin.name)))
      return workRoute.exit(origin.fullPath);
    if (projectWork.value === "settlements" && origin.name === "dashboard" && route.query.source === "task")
      return workRoute.exit(origin.fullPath);
  }
  if (projectWork.value === "settlements") return workRoute.exit({ name: "projects",
    params: { projectId: workProjectId.value, work: "finance", recordId: "", recordAction: "" }, query: route.query,
  });
  returningToProjectDetail = true;
  try {
    await workRoute.exit({ name: "projects",
      params: { projectId: "", work: "", recordId: "", recordAction: "" },
      query: { ...route.query, project: workProjectId.value, tab: projectFinancePage.value ? "finance" : "approval" },
    });
    await nextTick();
  } finally { returningToProjectDetail = false; }
}
function closeProjectDetails() {
  if (typeof route.query.returnTo === "string") {
    const from = router.resolve(route.query.returnTo);
    if (from.name === "dashboard" || (route.query.focus === "funding" && ["frameworks", "agreements"].includes(String(from.name))) ||
        (route.query.focus === "demand" && from.name === "demands")) {
      void workRoute.exit(from.fullPath);
      return;
    }
  }
  detailDialog.close();
  if (typeof route.query.project === "string") {
    const query = { ...route.query };
    for (const key of ["project", "tab", "focus", "record", "returnTo"]) delete query[key];
    void router.replace({ query });
  }
}
function projectDetailsPath() {
  return router.resolve({ path: route.path, query: { ...route.query, project: detail.value?.id, tab: tab.value } }).fullPath;
}
function openRelatedDemand(id: string) {
  const origin = contextOrigin(router, route.query.returnTo, "demands");
  if (origin?.query.demand === id) void workRoute.exit(origin.fullPath);
  else {
    const source = projectDetailsPath();
    void workRoute.enter(demandContext(id, source), source);
  }
}
function openRelatedFunding(kind: "frameworks" | "agreements", id: string) {
  const origin = contextOrigin(router, route.query.returnTo, kind);
  if (origin?.query.record === id) void workRoute.exit(origin.fullPath);
  else {
    const source = projectDetailsPath();
    void workRoute.enter(fundContext(kind, id, source), source);
  }
}
const projectActions = ref<ProjectAction[]>([]);
const overviewSummary = ref<ProjectFinanceSnapshot | null>(null);
const overviewError = ref("");
const overviewFramework = ref<ProjectReference | null>(null);
const overviewAgreement = ref<ProjectReference | null>(null);
const overviewLoading = ref(false);
const closeReviewOpen = ref(false);
interface ClosePreview {
  expected_version: number;
  approval_version: number;
  summary: ProjectFinanceSnapshot;
  reason: string;
  preview_hash: string;
}
const closePreview = ref<ClosePreview | null>(null);
const closePreviewError = ref("");
const closePreviewLoading = ref(false);
let closePreviewSequence = 0;
async function loadClosePreview() {
  const id = detail.value?.id;
  if (!id) return;
  const sequence = ++closePreviewSequence;
  closePreview.value = null;
  closePreviewError.value = "";
  closePreviewLoading.value = true;
  try {
    const result = await api<ClosePreview>(`/projects/${id}/close-preview`);
    if (sequence === closePreviewSequence && detail.value?.id === id) closePreview.value = result;
  } catch (error) {
    if (sequence === closePreviewSequence) closePreviewError.value = (error as Error).message;
  } finally {
    if (sequence === closePreviewSequence) closePreviewLoading.value = false;
  }
}
function openCloseReview() {
  closeReviewOpen.value = true;
  void loadClosePreview();
}
const financeRevision = ref(0);
const handoffDemand = ref<DemandRecord | null>(null);
const focusedDemandId = computed(() => route.query.focus === "demand" && typeof route.query.record === "string"
  ? route.query.record : null);
async function loadHandoffDemand() {
  const demandId = route.query.demand;
  if (typeof demandId !== "string" || !demandId) {
    handoffDemand.value = null;
    return;
  }
  try {
    handoffDemand.value = await api("/demands/" + demandId);
  } catch (error) {
    ElMessage.error("无法读取待承接需求：" + (error as Error).message);
  }
}
const overviewProject = computed<ProjectOverviewFacts | null>(() => {
  const row = detail.value;
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    deleted: Boolean(row.deleted),
    framework_id: row.framework_id,
    agreement_id: row.funding?.agreement_id ?? null,
    scopes: (row.scopes || []).map((scope) => ({ binding: scope.binding })),
    approval: row.approval
      ? { version_no: row.approval.version_no, approved_budget_fen: row.approval.approved_budget_fen }
      : null,
    planned_end_on: row.planned_end_on || null,
    planned_start_on: row.planned_start_on || null,
    category_name: row.category_name || null,
    managing_unit_name: row.managing_unit_name || null,
    owner_username: row.owner_username || null,
    manager_username: row.manager_username || null,
    preliminary_estimate_fen: row.preliminary_estimate_fen ?? null,
  };
});
const rows = ref<ProjectListItem[]>([]),
  listLoading = ref(false),
  listReadError = ref(""),
  showDeleted = ref(false),
  total = ref(0),
  page = ref(1),
  query = ref(""),
  sortKey = ref(""),
  sortDirection = ref("desc"),
  columnFilters = ref<Record<string, string>>({}),
  detail = ref<ProjectDetail | null>(null),
  dialog = ref(""),
  form = ref<ProjectForm>({}),
  editing = ref<ProjectDetail | null>(null),
  busy = ref(false),
  linkPickerOpen = ref(false),
  agreementChoices = ref<ProjectAgreementOption[]>([]),
  agreementLoading = ref(false),
  agreementError = ref(""),
  historyRevision = ref(0),
  tab = ref("overview"),
  approvalRows = ref<ApprovalEditorRow[]>([]),
  priceScopeContext = ref<ApprovedScope | null>(null),
  quoteOpen = ref(false);

const selection = usePageSelection(rows, () => JSON.stringify([query.value, showDeleted.value, columnFilters.value]), "projects");
const { selected, selectedIds, eligibleIds } = selection;
const handling = useHandlingReview();


function stockSelectedProjects() {
  const targets: HandlingTarget[] = selected.value.map(row => ({ id: row.id, expected_version: row.version }));
  void handling.review({
    title: "核对批量入库", description: "入库后年度框架锁定。只有下方标为可办理的储备项目会提交。",
    targets, previewPath: "/projects/stock-batch/preview", commitPath: "/projects/stock-batch",
    complete: async ids => { selection.remove(ids); await load(); },
  });
}
const approvalLoading = ref(false), approvalLoadError = ref("");
let approvalRequest = 0;
const approvalQuantityError = ref<Record<string, boolean>>({});
function approvalQuantityInvalid(path: string, invalid: boolean) {
  approvalQuantityError.value = { ...approvalQuantityError.value, [path]: invalid };
}
const materialQuantityPrecision = ref<Record<string, number>>({});
const materialQuantityErrors = ref<Record<string, string>>({});
let materialPrecisionRequest = 0;
watch(() => approvalRows.value.flatMap((scope) =>
  (scope.materials || []).map((item) => String(item.material_id || "")))
  .filter(Boolean).sort().join("|"), async () => {
  const sequence = ++materialPrecisionRequest;
  const ids = [...new Set<string>(approvalRows.value.flatMap((scope) =>
    (scope.materials || []).map((item): string => String(item.material_id || ""))).filter(Boolean))];
  materialQuantityPrecision.value = {};
  materialQuantityErrors.value = {};
  await Promise.all(ids.map(async id => {
    try {
      const precision = await readCurrentMaterialPrecision(id);
      if (sequence === materialPrecisionRequest)
        materialQuantityPrecision.value = { ...materialQuantityPrecision.value, [id]: precision };
    } catch (failure) {
      if (sequence === materialPrecisionRequest)
        materialQuantityErrors.value = { ...materialQuantityErrors.value,
          [id]: (failure as Error).message };
    }
  }));
});
const editingCharge = ref<ReferenceCharge | null>(null);
const chargeQuantityPrecision = ref<number | undefined>();
const chargePrecisionError = ref("");
const chargeQuantityInvalid = ref(false);
let chargePrecisionRequest = 0;
watch(
  () => dialog.value === "charge" ? String(form.value.reference_price_catalog_id || "") : "",
  async ruleId => {
    const seq = ++chargePrecisionRequest;
    chargeQuantityPrecision.value = undefined;
    chargePrecisionError.value = "";
    chargeQuantityInvalid.value = false;
    if (!ruleId) return;
    try {
      const price = await api<PriceRuleRecord>(
        "/catalog/prices/" + encodeURIComponent(ruleId));
      const precision = await readAdoptedQuantityPrecision(price.unit_id, price.unit_version);
      if (seq === chargePrecisionRequest) chargeQuantityPrecision.value = precision;
    } catch (failure) {
      if (seq === chargePrecisionRequest)
        chargePrecisionError.value = (failure as Error).message;
    }
  },
);

function approvalEditorLocations(
  demand: Pick<ApprovalCandidate, "work_locations" | "operation_snapshot" | "unit_snapshot">,
  prior?: ApprovedScope["locations"],
) {
  const allocated = prior ? new Map(prior.map(location =>
    [location.location_kind + ":" + location.location_object,
      location.approved_quantity_scaled])) : null;
  return demand.work_locations.filter(location => {
    const key = location.location_kind + ":" +
      (location.logical_tower_id || location.physical_tower_id || location.span_id);
    return allocated ? allocated.has(key)
      : (location.remaining_quantity_scaled ?? location.quantity_scaled) > 0;
  }).map(location => {
    const key = location.location_kind + ":" +
      (location.logical_tower_id || location.physical_tower_id || location.span_id);
    const snapshot = location.location_snapshot_json;
    return {
      location_item_no: location.item_no,
      approved_quantity_scaled: allocated
        ? allocated.get(key)! : (location.remaining_quantity_scaled ?? location.quantity_scaled),
      line_name: snapshot.line_name,
      label: location.location_kind === "span" ? snapshot.location_label : snapshot.tower_no || snapshot.asset_no || snapshot.location_label,
      operation_snapshot: demand.operation_snapshot,
      unit_snapshot: demand.unit_snapshot,
      work_mode: statusText[location.work_mode],
      location_type: location.location_kind === "span" ? "档距" : "杆塔",
      specification: snapshot.specification,
    };
  });
}
const approvalEditorColumns: TableColumn[] = [
  { key: "line_name", label: "线路", minWidth: 150 },
  { key: "operation_snapshot", label: "操作类型", minWidth: 150 },
  { key: "label", label: "作业位置", minWidth: 160, hideable: false },
  { key: "approved_quantity_scaled", label: "需求数量", minWidth: 100, hideable: false },
  { key: "unit_snapshot", label: "计量单位", minWidth: 100 },
  { key: "work_mode", label: "作业方式", minWidth: 105 },
  { key: "location_type", label: "位置类型", minWidth: 105 },
  { key: "specification", label: "设备规格", minWidth: 135 },
];
const demandContentColumns: TableColumn[] = [
  { key: "operation_snapshot", label: "操作类型", minWidth: 170 },
  { key: "line_summary", label: "涉及线路", minWidth: 170 },
  { key: "quantity_scaled", label: "需求数量", minWidth: 110 },
  { key: "unit_snapshot", label: "计量单位", minWidth: 105 },
  { key: "location_count", label: "位置数", minWidth: 90 },
  { key: "expected_on", label: "预计解决时间", minWidth: 150 },
];
const projectScopeColumns: TableColumn[] = [
  { key: "demand_no", label: "需求编号", minWidth: 140, hideable: false },
  { key: "problem_description", label: "问题描述", minWidth: 215 },
  ...demandContentColumns,
  { key: "binding", label: "承接关系", minWidth: 110, sortable: false, filterable: false },
  { key: "created_at", label: "关联登记时间", minWidth: 175 },
];
const projectApprovalColumns: TableColumn[] = [
  { key: "demand_no", label: "需求编号", minWidth: 140 },
  { key: "problem_description", label: "问题描述", minWidth: 215 },
  ...demandContentColumns,
  { key: "locations_display", label: "作业位置", minWidth: 160 },
  { key: "demand_version", label: "采用需求版本", minWidth: 140 },
  { key: "material_count", label: "批准物资项数", minWidth: 145 },
];
function approvalDemandSummary(demand: Pick<DemandRecord,
  "problem_description" | "work_locations" | "operation_snapshot" | "unit_snapshot" | "expected_on">) {
  const locations = approvalEditorLocations(demand);
  return {
    problem_description: demand.problem_description,
    operation_snapshot: demand.operation_snapshot,
    unit_snapshot: demand.unit_snapshot,
    expected_on: demand.expected_on,
    line_summary: [...new Set(locations.map(row => row.line_name).filter(Boolean))].join("、"),
    locations_display: locations.map(row => row.label).filter(Boolean).join("、"),
    location_count: locations.length,
  };
}
function approvedScopeRow(scope: ApprovedScope) {
  return { ...scope, ...approvalDemandSummary(JSON.parse(scope.snapshot_json) as DemandRecord),
    material_count: scope.materials.length };
}
function candidateScopeRow(candidate: ApprovalDetail["pending_scopes"][number]) {
  return { ...approvalDemandSummary(candidate.snapshot), demand_no: candidate.snapshot.demand_no,
    quantity_scaled: candidate.snapshot.quantity_scaled, demand_version: candidate.snapshot.current_version,
    material_count: candidate.materials?.length ?? 0 };
}
const completionColumns: TableColumn[] = [
  { key: "demand_no", label: "需求编号", minWidth: 140 },
  { key: "problem_description", label: "问题描述", minWidth: 215 },
  { key: "operation_snapshot", label: "操作类型", minWidth: 165 },
  { key: "unit_snapshot", label: "计量单位", minWidth: 105 },
  { key: "approved_quantity_scaled", label: "批准工作量" },
  { key: "resolved_quantity_scaled", label: "已完成" },
  { key: "remaining_quantity_scaled", label: "未完成" },
  { key: "excess_quantity_scaled", label: "超出批准工作量", minWidth: 150 },
];
const completionRows = computed(() => {
  const scopeDetails = new Map(currentApproval.value?.scopes.map(scope => [scope.project_scope_id, approvedScopeRow(scope)]));
  return overviewSummary.value?.demands.map(row => ({ ...scopeDetails.get(row.project_scope_id), ...row })) || [];
});
const projectChargeColumns: TableColumn[] = [
  { key: "rule_title", label: "批次或项目参考费用", minWidth: 210 },
  { key: "amount_fen", label: "金额", minWidth: 140 },
];
function resetListPage() {
  page.value = 1;
  void load();
}
const projectStatuses = projectDisplayStatuses;
// One visible status and one authoritative derived filter source.
// The formal four-stage lifecycle remains unchanged for business rules.
const listStatus = computed({
  get: () => projectStatuses.find(value => value === columnFilters.value.display_status) || "",
  set: value => {
    const next = { ...columnFilters.value };
    if (value) next.display_status = value;
    else delete next.display_status;
    delete next.status;
    columnFilters.value = next;
    page.value = 1;
    void load();
  },
});
const projectColumns: TableColumn[] = [
  { key: "name", label: "项目名称", minWidth: 220, hideable: false },
  { key: "display_status", filterable: false, label: "项目状态", minWidth: 155, hideable: false },
  { key: "approval", filterable: false, label: "批准预算", sortable: false },
  { key: "scopes", filterable: false, label: "关联需求数", sortable: false },
  { key: "code", label: "项目编号", minWidth: 150 },
  { key: "framework_name", label: "年度框架", minWidth: 165 },
  { key: "agreement_name", label: "执行协议", minWidth: 165, filterable: false },
  { key: "category_name", label: "项目类别", minWidth: 135 },
  { key: "managing_unit_name", label: "归口单位", minWidth: 145 },
  { key: "owner_username", label: "项目负责人", minWidth: 145 },
  { key: "manager_username", label: "项目经办人", minWidth: 145 },
  { key: "planned_start_on", label: "计划开始时间", minWidth: 150 },
  { key: "planned_end_on", label: "计划结束时间", minWidth: 150 },
  { key: "preliminary_estimate_fen", label: "初步估算", minWidth: 145 },
  { key: "created_at", label: "创建时间", minWidth: 175 },
];
function sortTable(value: { key: string; order: string }) {
  sortKey.value = value.key;
  sortDirection.value = value.order === "ascending" ? "asc" : "desc";
  page.value = 1;
  load();
}
const pendingSearch = ref(query.value);
watch(query, (value) => { pendingSearch.value = value; }, { immediate: true });
function applySearch() {
  query.value = pendingSearch.value.trim();
  resetListPage();
}
function clearSearchAndColumns() {
  query.value = "";
  columnFilters.value = listStatus.value ? { display_status: listStatus.value } : {};
  page.value = 1;
  void load();
}
function filterTable(value: Record<string, string>) {
  columnFilters.value = value;
  page.value = 1;
  load();
}
const appliedQuery = ref("");
const exportQuery = computed(() => listLoading.value || listReadError.value ? "" : appliedQuery.value);
let loadSequence = 0;
async function load() {
  const sequence = ++loadSequence;
  listLoading.value = true;
  listReadError.value = "";
  try {
    const parameters = new URLSearchParams({
      page: String(page.value), q: query.value, deleted: String(showDeleted.value),
      sort: sortKey.value || "created_at", direction: sortDirection.value,
      filters: JSON.stringify(columnFilters.value),
    });
    const value = await api<{ items: ProjectListItem[]; total: number }>(`/projects?${parameters}`);
    if (sequence !== loadSequence) return;
    appliedQuery.value = parameters.toString();
    rows.value = value.items;
    total.value = value.total;
    void workRoute.restoreScroll();
    const id = detail.value?.id;
    if (id) {
      const updated = await api<ProjectDetail>("/projects/" + id + "?deleted=true");
      if (sequence === loadSequence && detail.value?.id === id) detail.value = updated;
    }
  } catch (error) {
    if (sequence === loadSequence) listReadError.value = (error as Error).message;
  } finally {
    if (sequence === loadSequence) listLoading.value = false;
  }
}
async function open(row: {id:string}) {
  tab.value = "overview";
  await detailDialog.open(row.id);
}
const draftGuard = useDialogDraftGuard(() => ({
  form: form.value,
  // Approved locations are edited in their own table, not in the header form.
  approvalRows: dialog.value === "approval" ? approvalRows.value : [],
}));
function confirmApprovalExit() {
  return !approvalEditorPage.value || dialog.value !== "approval" || approvalLoading.value || draftGuard.canClose();
}
onBeforeRouteLeave(confirmApprovalExit);
onBeforeRouteUpdate((to, from) => to.path === from.path || confirmApprovalExit());
function closeEditor() {
  if (dialog.value === "approval" && approvalLoading.value) {
    void returnFromProjectWork();
    return;
  }
  void draftGuard.confirmClose(() => {
    if (approvalEditorPage.value) {
      draftGuard.capture();
      void returnFromProjectWork();
    } else dialog.value = "";
  });
}
function beforeEditorClose(done: () => void) {
  if (dialog.value === "approval" && approvalLoading.value) { done(); return; }
  void draftGuard.confirmClose(done);
}
function editProject(row?: ProjectDetail) {
  editing.value = row || null;
  form.value = row
    ? { ...row, expected_version: row.profile_version,
        agreement_id: row.funding?.agreement_id || null,
        expected_funding_version: row.funding?.version_no || 0 }
    : { code: "", name: "", framework_id: "", agreement_id: null,
        expected_funding_version: 0 };
  dialog.value = "project";
  void loadProjectAgreements(String(form.value.framework_id || ""),
    String(form.value.agreement_id || "") || null);
  draftGuard.capture();
}
const currentApprovedScopes = computed<ApprovedScope[]>(() =>
  detail.value?.approvals?.find((ap) => ap.id === detail.value?.approval?.id)?.scopes || []);
function pendingApprovalChanges() {
  if (!detail.value?.approval) return [];
  const reasons: string[] = [];
  if (form.value.approved_budget_fen !== detail.value.approval.approved_budget_fen)
    reasons.push("批准预算已调整");
  for (const previous of currentApprovedScopes.value) {
    const selected = approvalRows.value.find((row) =>
      row.project_scope_id === previous.project_scope_id && row.selected);
    if (!selected) {
      reasons.push(previous.demand_no + " 已从批准范围移除");
      continue;
    }
    if (previous.demand_version !== selected.demand_version)
      reasons.push(previous.demand_no + " 的需求版本已变化，请核对作业设备和数量");
    const oldLocations = previous.locations.length
      ? previous.locations.map((loc) => [loc.location_item_no, loc.approved_quantity_scaled])
      : [[1, previous.quantity_scaled]];
    const nextLocations = selected.locations
      .map((loc) => [loc.location_item_no, loc.approved_quantity_scaled]);
    if (JSON.stringify(oldLocations.sort((a,b)=>a[0]-b[0])) !==
      JSON.stringify(nextLocations.sort((a,b)=>a[0]-b[0])))
      reasons.push(previous.demand_no + " 的作业位置或数量已调整");
    const oldMaterials = previous.materials.map((item) =>
      [item.material_id, item.approved_quantity_scaled]).sort();
    const newMaterials = selected.materials.map((item) =>
      [item.material_id, item.quantity_scaled]).sort();
    if (JSON.stringify(oldMaterials) !== JSON.stringify(newMaterials))
      reasons.push(previous.demand_no + " 的批准物资已调整");
  }
  const priorIds = new Set(currentApprovedScopes.value.map((x) => x.project_scope_id));
  if (approvalRows.value.some((x) => x.selected && !priorIds.has(x.project_scope_id)))
    reasons.push("新增承接需求范围");
  return reasons;
}
const selectedFundingAgreement = computed<ProjectAgreementOption | null>(() =>
  agreementChoices.value.find(item => item.id === form.value.agreement_id) || null);
let agreementRequestSeq = 0;
async function loadProjectAgreements(frameworkId: string, selectedId: string | null = null) {
  const sequence = ++agreementRequestSeq;
  agreementChoices.value = [];
  agreementError.value = "";
  agreementLoading.value = Boolean(frameworkId);
  if (!frameworkId) return;
  try {
    const params = new URLSearchParams({ framework_id: frameworkId });
    if (selectedId) params.set("selected_id", selectedId);
    const response = await api<{ options: ProjectAgreementOption[] }>("/projects/eligible-agreements?" + params);
    if (sequence === agreementRequestSeq && dialog.value === "project" &&
        form.value.framework_id === frameworkId)
      agreementChoices.value = response.options;
  } catch (error) {
    if (sequence === agreementRequestSeq) {
      agreementError.value = (error as Error).message;
      ElMessage.error("读取所选框架执行协议失败：" + agreementError.value);
    }
  } finally {
    if (sequence === agreementRequestSeq) agreementLoading.value = false;
  }
}
function changeProjectFramework(frameworkId: string | null) {
  form.value.framework_id = frameworkId || "";
  form.value.agreement_id = null;
  void loadProjectAgreements(form.value.framework_id);
}
const projectAgreementInvalid = computed(() =>
  Boolean(form.value.agreement_id && !selectedFundingAgreement.value?.eligible &&
    (form.value.agreement_id !== (editing.value?.funding?.agreement_id || null) ||
      form.value.framework_id !== editing.value?.framework_id)));
async function addApprovalCandidates(records: DemandRecord[]) {
  for (const demand of records) {
    const precision = await readAdoptedQuantityPrecision(demand.unit_id, demand.unit_version);
    approvalRows.value.push({
      project_scope_id: "candidate:" + demand.id, demand_id: demand.id,
      demand_version: demand.current_version, demand_no: demand.demand_no,
      demand_status: demand.status, unit_id: demand.unit_id, unit_version: demand.unit_version,
      problem_description: demand.problem_description, expected_on: demand.expected_on,
      quantity_precision: precision, selected: true, materials: [],
      locations: approvalEditorLocations(demand),
    });
  }
}
async function openDialog(type: string) {
  if (type === "approval" && !approvalEditorPage.value) {
    await goToProjectWork("compile");
    return;
  }
  if (type === "approval" && !detail.value?.scopes.some((scope) =>
      scope.binding && scope.demand_status === "active")) {
    ElMessage.warning("当前没有已确认有效的专业需求。请先在专业需求中确认，再编制立项范围。");
    return;
  }
  if (type === "link") {
    const reason = ordinaryLinkReason(detail.value!);
    if (reason) { ElMessage.warning(reason); return; }
    linkPickerOpen.value = true; return;
  }
  if (type === "approval") {
    const reason = approvalDraftReason(detail.value!);
    if (reason) { ElMessage.warning(reason); return; }
  }
  const project = detail.value;
  if (!project) return;
  const request = ++approvalRequest;
  editingCharge.value = null;
  form.value = type === "approval" ? {
    approved_budget_fen: project.approval?.approved_budget_fen || 0,
    basis: "", expected_version: project.version,
    expected_approval_version_id: project.approval?.id || null,
  } : {};
  dialog.value = type;
  if (type === "approval") {
    approvalLoading.value = true;
    approvalLoadError.value = "";
    try {
      approvalRows.value = [];
      approvalQuantityError.value = {};
      const candidates = await api<ApprovalCandidate[]>(`/projects/${project.id}/approval-candidates`);
      if (request !== approvalRequest || dialog.value !== "approval" || detail.value?.id !== project.id) return;
      for (const demand of candidates) {
        const scope = detail.value!.scopes.find((item) => item.id === demand.project_scope_id);
        if (!scope) continue;
        const baseline = currentApprovedScopes.value.find((item) =>
          item.project_scope_id === scope.id);
        approvalRows.value.push({
          project_scope_id: scope.id,
          demand_version: demand.current_version,
          demand_no: demand.demand_no, demand_status: demand.status,
          problem_description: demand.problem_description, expected_on: demand.expected_on,
          unit_id: demand.unit_id,
          unit_version: demand.unit_version,
          quantity_precision: undefined,
          selected: demand.status === "active" && (!detail.value?.approval || !!baseline),
          previous_demand_version: baseline?.demand_version,
          locations: approvalEditorLocations(demand, baseline?.locations),
          materials: baseline?.materials?.map((item) => ({
            material_id: item.material_id,
            quantity_scaled: item.approved_quantity_scaled,
          })) || [],
        });
      }
      const currentApproval = approvalRows.value;
      const unitRequests = new Map<string, Promise<number>>();
      await Promise.all(currentApproval.map(async (scope) => {
        const key = String(scope.unit_id || "") + "@" + String(scope.unit_version || "");
        if (!unitRequests.has(key))
          unitRequests.set(key, readAdoptedQuantityPrecision(
            String(scope.unit_id || ""), Number(scope.unit_version)));
        try {
          const precision = await unitRequests.get(key)!;
          if (approvalRows.value === currentApproval) scope.quantity_precision = precision;
        } catch (failure) {
          if (approvalRows.value === currentApproval)
            scope.precision_error = (failure as Error).message;
        }
      }));
    } catch (error) {
      if (request === approvalRequest) approvalLoadError.value = (error as Error).message;
    } finally {
      if (request === approvalRequest) approvalLoading.value = false;
    }
  }
  if (request === approvalRequest && dialog.value === type && detail.value?.id === project.id) draftGuard.capture();
}
const projectConflict = ref("");
let comparedProject: ProjectDetail | null = null;
function continueProjectEdit() {
  const latest = comparedProject;
  if (!latest || latest.id !== (editing.value || detail.value)?.id) return;
  if (dialog.value === "approval") {
    form.value.expected_version = latest.version;
    form.value.expected_approval_version_id = latest.approval?.id ?? null;
    detail.value = latest;
  } else {
    form.value.expected_version = latest.profile_version;
    form.value.expected_funding_version = latest.funding?.version_no ?? 0;
  }
  projectConflict.value = "";
  comparedProject = null;
}
watch([dialog, () => detail.value?.id], () => { projectConflict.value = ""; });
async function compareProject() {
  const project = editing.value || detail.value;
  if (!project) return [];
  const latest = await api<ProjectDetail>(`/projects/${project.id}`);
  comparedProject = latest;
  if (dialog.value === "approval") {
    return [
      { label: "项目办理版本", draft: String(form.value.expected_version || project.version), current: String(latest.version) },
      { label: "批准预算", draft: "¥" + money(form.value.approved_budget_fen),
        current: latest.approval ? "¥" + money(latest.approval.approved_budget_fen) : "尚未批准" },
      { label: "需求数", draft: String(approvalRows.value.filter(row => row.selected).length),
        current: String(latest.scopes.filter(row => row.binding).length) },
    ];
  }
  return [
    { label: "档案版本", draft: String(form.value.expected_version || project.profile_version), current: String(latest.profile_version) },
    { label: "项目名称", draft: form.value.name || "—", current: latest.name },
    { label: "计划结束", draft: form.value.planned_end_on || "未填写", current: latest.planned_end_on || "未填写" },
  ];
}
async function save() {
  if (busy.value || dialog.value === "approval" && (approvalLoading.value || approvalLoadError.value)) return;
  if (dialog.value === "charge" &&
      (chargeQuantityPrecision.value === undefined || chargeQuantityInvalid.value)) {
    ElMessage.error(chargePrecisionError.value ||
      "计价规则采用的正式计量单位精度尚未确认，不能提交数量");
    return;
  }
  if (dialog.value === "approval") {
    const selectedScopes = approvalRows.value.filter((scope) => scope.selected);
    const invalid = selectedScopes.some((scope) =>
      typeof scope.quantity_precision !== "number" ||
      scope.materials.some((item) =>
        materialQuantityPrecision.value[item.material_id] === undefined) ||
      scope.locations.some((loc) => approvalQuantityError.value[
        "location." + scope.project_scope_id + "." + loc.location_item_no]) ||
      scope.materials.some((item) => approvalQuantityError.value[
        "material." + scope.project_scope_id + "." + item.material_id]));
    if (invalid) {
      ElMessage.error("批准范围存在无效数量或未读取的冻结单位精度，请核对每项并重新提交");
      return;
    }
  }
  busy.value = true;
  try {
    if (!formRef.value || !(await formRef.value.validate().catch(() => false))) return;
    // Direct framework ownership is a complete business route. Loading the
    // optional agreement catalog must never block saving a direct project.
    if (dialog.value === "project" && form.value.agreement_id &&
        (agreementLoading.value || !!agreementError.value || projectAgreementInvalid.value)) {
      ElMessage.warning(agreementError.value ||
        "请等待执行协议加载完成，或选择当前年度框架内有效的执行协议");
      return;
    }
    let newlyCreatedProject: ProjectDetail | null = null;
    if (dialog.value === "project") {
      if (!editing.value && handoffDemand.value && route.query.action === "create") {
        newlyCreatedProject = await api("/projects/from-demand", "POST", {
          ...form.value,
          demand_id: handoffDemand.value.id,
          expected_demand_version: handoffDemand.value.current_version,
        });
      } else {
        newlyCreatedProject = await api(
          "/projects" + (editing.value ? "/" + editing.value.id : ""),
          "POST", form.value,
        );
      }
    }
    if (dialog.value === "approval") {
      const differences = pendingApprovalChanges();
      await api(`/projects/${detail.value!.id}/approvals`, "POST", {
        ...form.value,
        confirm_changes: differences.length > 0,
        scopes: approvalRows.value
          .filter((x) => x.selected)
          .map((x) => ({
            demand_id: x.demand_id,
            project_scope_id: x.demand_id ? undefined : x.project_scope_id,
            demand_version: x.demand_version,
            materials: x.materials,
            locations: x.locations.map(({ location_item_no, approved_quantity_scaled }) => ({
              location_item_no, approved_quantity_scaled,
            })),
          })),
      });
    }
    if (dialog.value === "charge")
      await api(
        "/charges" + (editingCharge.value ? "/" + editingCharge.value.id : ""),
        "POST",
        {
          ...form.value,
          approval_version_id: detail.value!.approvals.find(
            (x) => x.status === "draft",
          )?.id,
        },
      );
    ElMessage.success("业务数据已保存，正在同步列表");
    const finishedApproval = dialog.value === "approval";
    dialog.value = "";
    draftGuard.capture();
    await load();
    if (finishedApproval) await returnFromProjectWork();
    if (newlyCreatedProject?.id && !editing.value) {
      const demandId = handoffDemand.value?.id;
      handoffDemand.value = null;
      await router.replace(projectContext(newlyCreatedProject.id, "overview",
        demandId ? { focus: "demand", record: demandId } : undefined));
      await detailDialog.open(newlyCreatedProject.id);
    }
  } catch (e) {
    if ((dialog.value === "approval" || (dialog.value === "project" && editing.value)) && e instanceof ApiError && e.status === 409)
      projectConflict.value = e.message;
    else ElMessage.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function action(name: string, approval?: ApprovalDetail, reviewed = false) {
  if (busy.value) return;
  busy.value = true;
  try {
    const project = detail.value;
    if (!project) return;
    const projectName = project.name;
    const description: Record<string, string> = {
      stock: "将子项目正式入库，之后才可编制立项批准范围。",
      close: "正式审核结项；请确认未实施工作、未核对费用和未结算费用已处理或明确接受差异。结项后不再新增需求或调整批准范围。",
      approve: "批准后形成不可变的正式范围与预算历史。需求与位置数：" +
        ((approval?.scopes?.length || 0) + (approval?.pending_scopes.length || 0)) +
        "，批准预算：¥" + money(approval?.approved_budget_fen),
      discard: "撤回本次未批准草稿，不修改上一版正式批准的范围、物资与费用历史。",
    };
    const titles: Record<string, string> = {
      stock: "确认项目入库", close: "确认审核结项",
      approve: "确认正式批准", discard: "撤回批准草稿",
    };
    if (!reviewed) await ElMessageBox.confirm(
      "项目：" + projectName + "。 " + (description[name] || "确认执行本次操作？"),
      titles[name] || "正式确认",
      { type: name === "close" || name === "discard" ? "warning" : "info",
        confirmButtonText: titles[name] || "确认" },
    );
    if (name === "stock")
      await api(`/projects/${project.id}/stock`, "POST", { expected_version: project.version });
    if (name === "close") {
      const preview = closePreview.value;
      if (!preview) return;
      await api(`/projects/${project.id}/close`, "POST", {
        expected_version: preview.expected_version,
        preview_hash: preview.preview_hash,
      });
    }
    if (name === "approve")
      await api(
        `/projects/${project.id}/approvals/${approval!.id}/approve`,
        "POST",
        { expected_version: project.version },
      );
    if (name === "discard")
      await api(
        `/projects/${project.id}/approvals/${approval!.id}`,
        "DELETE",
        {},
      );
    ElMessage.success((titles[name] || "正式操作") + "成功，正在刷新业务状态");
    closeReviewOpen.value = false;
    await load();
    if (name === "approve" && approvalReviewPage.value) await returnFromProjectWork();
  } catch (e) {
    if (name === "close" && e instanceof ApiError && e.status === 409) {
      closePreview.value = null;
      closePreviewError.value = e.message;
    } else if (e instanceof Error) ElMessage.error(e.message);
  } finally {
    busy.value = false;
  }
}
function releaseBlockReason(scope: ProjectScopeProjection): string {
  const project = detail.value;
  if (!project || project.deleted) return "项目已删除，不能操作";
  if (!scope.binding) return "需求当前没有承接关系";
  if (!can("write")) return "当前账号没有变更关联权限";
  const approvals = (project.approvals || []) as ApprovalDetail[];
  if (approvals.some(approval =>
    approval.status === "draft" && (approval.scopes || []).some(
      (item) => item.project_scope_id === scope.id))) {
    return "有立项或变更草稿包含该需求；须先在草稿中移出并保存";
  }
  const latestApproved = approvals.filter(a => a.status === "approved")
    .sort((a, b) => Number(b.version_no) - Number(a.version_no))[0];
  if (latestApproved?.scopes?.some((item) => item.project_scope_id === scope.id)) {
    return project.status === "closed"
      ? "项目已结项，最新版正式批准范围仍包含该需求，不能解绑"
      : "最新版正式批准范围仍包含该需求；须先在「批准与变更」中完成正式范围变更移出";
  }
  return "";
}
async function release(scope: ProjectScopeProjection) {
  const blocked = releaseBlockReason(scope);
  if (blocked) { ElMessage.warning(blocked); return; }
  try {
    await ElMessageBox.confirm(
      "明确解绑后，该需求可由其他项目承接。当前批准范围仍含此需求时，先正式变更移出。",
      "显式解绑",
    );
    const history = await api<{ bindings: Array<{ id: string; events: Array<{ event_seq: number }> }> }>("/demands/" + scope.demand_id + "/history"),
      binding = history.bindings.find(x => x.id === scope.id);
    const latestEvent = binding?.events.at(-1);
    if (!latestEvent) throw Error("缺少有效的承接事件历史，不能解绑");
    await api(`/projects/${detail.value!.id}/release/${scope.id}`, "POST", {
      expected_event_seq: latestEvent.event_seq,
    });
    await load();
  } catch (e) {
    if (e instanceof Error) ElMessage.error(e.message);
  }
}
function priceScope(scope: ApprovedScope) {
  priceScopeContext.value = scope;
  quoteOpen.value = true;
}
function editCharge(charge: ReferenceCharge) {
  editingCharge.value = charge;
  form.value = {
    ...JSON.parse(charge.pricing_inputs_json),
    reference_price_catalog_id: charge.reference_price_catalog_id,
  };
  dialog.value = "charge";
  draftGuard.capture();
}
async function removeCharge(charge: ReferenceCharge) {
  try {
    await ElMessageBox.confirm(
      "删除本草稿参考费用，原计算依据保存在审计中。",
      "删除参考费用",
    );
    await api("/charges/" + charge.id, "DELETE", {});
    await load();
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message);
  }
}
async function removeProject() {
  const project = detail.value;
  if (!project || project.deleted || !can("admin") || deleteReason.value) return;
  try {
    const impact = await api<ProjectDeletionImpact>(`/projects/${project.id}/deletion-preview`);
    if (impact.reason) { ElMessage.warning(impact.reason); return; }
    if (detail.value?.id !== project.id) return;
    const linked = impact.linked_demands.length;
    const approval = impact.approved_version ? "。最近一次正式批准为第 " + impact.approved_version + " 版" : "";
    await ElMessageBox.confirm(
      impact.name + "当前有 " + linked + " 条承接需求" + approval +
        "。删除后项目从正常列表移除，承接关系、历次批准、费用、结算和附件历史继续保留。",
      "删除子项目",
      { type: "warning", confirmButtonText: "确认删除" },
    );
    await api(`/projects/${project.id}`, "DELETE", { expected_version: impact.version });
    await detailDialog.close();
    await load();
    ElMessage.success("项目已删除，可在包含已删除中查询");
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message);
  }
}
let overviewSequence = 0;
async function loadOverview() {
  const id = detail.value?.id;
  if (!id) return;
  const sequence = ++overviewSequence;
  overviewLoading.value = true;
  overviewError.value = "";
  try {
    const [summary, actions, framework, agreement] = await Promise.all([
      api<ProjectFinanceSnapshot>("/projects/" + id + "/summary"),
      api<ProjectAction[]>(`/projects/${id}/actions`),
      detail.value?.framework_id ? api<ProjectReference>("/funding/frameworks/" + detail.value.framework_id + "?deleted=true") : null,
      detail.value?.funding?.agreement_id
        ? api<ProjectReference>("/funding/agreements/" + detail.value.funding.agreement_id + "?deleted=true") : null,
    ]);
    if (sequence !== overviewSequence || detail.value?.id !== id) return;
    overviewSummary.value = summary;
    projectActions.value = actions;
    overviewFramework.value = framework;
    overviewAgreement.value = agreement;
  } catch (error) {
    if (sequence === overviewSequence) overviewError.value = (error as Error).message;
  } finally {
    if (sequence === overviewSequence) overviewLoading.value = false;
  }
}
const currentApproval = computed(() => detail.value?.approvals.find(row => row.id === detail.value?.approval?.id));
const approvalDraft = computed(() => detail.value?.approvals.find(row => row.status === "draft"));
const editorDifferences = computed(() => approvalEditorPage.value && !approvalLoading.value ? pendingApprovalChanges() : []);
const approvalComparison = computed(() => approvalDraft.value ? approvalDifferences(currentApproval.value, approvalDraft.value) : []);
const missingExpected = computed(() => [...new Map([
  ...(detail.value?.scopes || []).filter(scope => scope.binding && !scope.expected_on)
    .map(row => [row.demand_id, { id: row.demand_id, number: row.demand_no }] as const),
  ...(approvalDraft.value?.pending_scopes || []).filter(row => !row.snapshot.expected_on)
    .map(row => [row.demand_id, { id: row.demand_id, number: row.snapshot.demand_no }] as const),
]).values()]);
const hasActiveScope = computed(() => !!detail.value?.scopes.some(row => row.binding && row.demand_status === "active"));
const approvalAction = computed(() => projectActions.value.find(row => row.key === "approve"));
const closeAction = computed(() => !overviewLoading.value && projectActions.value.find(row => row.key === "close") || undefined);
const deleteReason = computed(() => detail.value ? projectDeleteReason(detail.value) : "");
const overviewStep = computed(() => {
  const project = detail.value;
  if (!project) return { message: "" };
  if (project.deleted) return { message: "此项目已删除，可查阅保留的业务记录。", label: "查看历史", action: "history" };
  if (project.display_status === "已结项") return { message: "结项结果及差异已保存。", label: "查看结项结果", action: "history" };
  if (approvalDraft.value) {
    const change = !!currentApproval.value;
    const canReview = can(change ? "change.approve" : "project.approve");
    return {
      message: approvalAction.value?.reason || (change ? "当前批准继续生效，变更等待审核。" : "立项草稿等待审核。"),
      label: canReview && !approvalAction.value?.reason ? (change ? "审核变更" : "审核立项") : "查看申请",
      action: canReview && !approvalAction.value?.reason ? "draft" : "inspectApproval",
    };
  }
  if (currentApproval.value) return {
    message: "第 " + currentApproval.value.version_no + " 版批准范围和预算已生效。",
    label: "办理费用与结算", action: "finance",
  };
  const count = project.scopes.filter(row => row.binding).length;
  const action = project.status === "reserve" && count && can("project.stock") ? "stock"
    : project.status === "stocked" && hasActiveScope.value && can("write") ? "approval"
    : !ordinaryLinkReason(project) && can("write") ? "link"
    : project.status === "reserve" && can("project.stock") ? "stock" : "";
  const labels: Record<string, string> = { stock: "确认入库", approval: "编制立项", link: "关联需求" };
  const message = action === "link" && count
    ? "已有 " + count + " 条关联需求。立项前请确认需求有效。"
    : count ? "已关联 " + count + " 条需求。" : "尚未关联专业需求。";
  return { message, label: labels[action], action };
});
function runOverviewStep() {
  const next = overviewStep.value.action;
  if (next === "stock") void action("stock");
  if (next === "link") { tab.value = "scope"; void openDialog("link"); }
  if (next === "approval") { tab.value = "approval"; void openDialog("approval"); }
  if (next === "draft") { tab.value = "approval"; void goToProjectWork("review"); }
  if (next === "history") tab.value = "history";
  if (next === "inspectApproval") tab.value = "approval";
  if (next === "finance") void goToProjectWork("finance");
}
watch(() => detail.value, () => {
  if (detail.value?.id) {
    void loadOverview();
  }
});
useListRoute({ q: query, page, deleted: showDeleted, sort: sortKey, direction: sortDirection, filters: columnFilters }, load, () => route.name === "projects" && !projectWork.value);
const detailDialog = useEntityDialog(detail, id => api<ProjectDetail>('/projects/' + id + '?deleted=true'), () => {
  dialog.value = ''; historyRevision.value = 0; quoteOpen.value = false; closeReviewOpen.value = false;
  projectActions.value = []; overviewSummary.value = null; overviewError.value = ""; overviewFramework.value = null; overviewAgreement.value = null;
});
const { isOpen: detailOpen, loading: detailLoading, error: detailError } = detailDialog;
watch(() => [route.query.action, route.query.demand], async () => {
  if (route.query.action !== "create" || typeof route.query.demand !== "string") return;
  await loadHandoffDemand();
  if (handoffDemand.value?.status !== "active" || handoffDemand.value.binding) {
    ElMessage.warning("该需求尚未确认有效或已被承接，无法创建新项目并承接");
    return;
  }
  if (!dialog.value) editProject();
}, { immediate: true });
watch([() => route.query.project, () => route.query.tab], ([projectId, section]) => {
  if (projectWork.value || typeof projectId !== "string" || !projectId) return;
  tab.value = typeof section === "string" && ["overview", "scope", "approval", "finance", "history"].includes(section)
    ? section : "overview";
  if (projectId !== detail.value?.id) void detailDialog.open(projectId);
}, { immediate: true });
let workReadSequence = 0;
async function openWorkRoute() {
  const sequence = ++workReadSequence;
  const work = projectWork.value;
  if (!work) {
    ++approvalRequest;
    if (dialog.value === "approval") dialog.value = "";
    const project = route.query.project;
    if (typeof project === "string" && project) {
      if (project !== detail.value?.id || !detailOpen.value) await detailDialog.open(project);
    } else if (detailOpen.value && !returningToProjectDetail) detailDialog.close();
    return;
  }
  if (!workProjectId.value) {
    await router.replace({ name: "projects", params: { projectId: "", work: "", recordId: "", recordAction: "" }, query: route.query });
    return;
  }
  tab.value = projectFinancePage.value ? "finance" : "approval";
  if (detail.value?.id !== workProjectId.value) await detailDialog.open(workProjectId.value);
  if (sequence !== workReadSequence || !detail.value) return;
  if (work === "compile" && can("write") && !approvalDraft.value) await openDialog("approval");
}
watch([projectWork, workProjectId], openWorkRoute, { immediate: true });
onMounted(async () => {
  actors.value = await api("/actors");
  await load();
});
</script>
<template>
  <div v-show="!projectWork">
  <div class="page-heading">
      <div>
        <h1>子项目管理</h1>
      </div>

    </div>
    <ElTabs v-model="listStatus" aria-label="按项目状态筛选">
      <ElTabPane name="" label="全部项目" />
      <ElTabPane v-for="state in projectStatuses" :key="state"
        :name="state" :label="state" />
    </ElTabs>
    <div class="panel">
      <ElAlert v-if="listReadError" :title="listReadError" type="error" :closable="false">
        <p v-if="rows.length">当前显示上次成功读取的结果。</p>
        <ElButton link type="primary" @click="load">重试</ElButton>
      </ElAlert>
      <BusinessTable :search-active="!!query" @clear-search="clearSearchAndColumns" :fixed-filter-keys="['display_status']" :loading="listLoading" :rows="rows" :columns="projectColumns" table-key="project:list" selectable :selected-ids="selectedIds" @selection-change="selection.updatePage" :filter-state="columnFilters"
        :sort-state="{ prop: sortKey, order: sortKey ? (sortDirection === 'asc' ? 'ascending' : 'descending') : null }"
        @sort-change="sortTable" @filter-change="filterTable">
        <template #toolbar="{ openSettings, hasActiveFilters, appliedFilters }">
      <div v-if="selected.length" class="toolbar selection-toolbar" aria-label="子项目批量操作">
        <span role="status">已选 {{ selected.length }} 条</span>
        <span class="muted">共 {{ total }} 条</span>
        <ExcelExportButton kind="projects" guide-action="projects.export-selection" :selected-ids="eligibleIds"
          :disabled="!exportQuery || eligibleIds.length !== selected.length" />
        <ElButton data-guide-action="projects.batch-stock" v-if="selected.some(row => row.display_status === '储备' && !row.deleted) && can('project.stock')" type="primary" :disabled="selected.length > 100" @click="stockSelectedProjects">批量入库</ElButton>
        <ElButton link @click="selection.clear">清空选择</ElButton>
        <ElButton class="business-column-setting-trigger" @click="openSettings">列设置</ElButton>
        <span v-if="selected.length > 100" class="muted">每次批量办理最多 100 条</span>
        <span v-else-if="eligibleIds.length !== selected.length" class="muted">导出前请取消勾选已删除记录</span>
      </div>
          <div v-else class="unified-list-tools">
            <div class="toolbar">
        <ElInput
          v-model="pendingSearch"
          clearable
          placeholder="搜索项目编号或名称"
          @change="applySearch" @keyup.enter="applySearch"
        />
            <ElCheckbox data-guide-action="projects.show-deleted" v-model="showDeleted" @change="resetListPage"
          >包含已删除</ElCheckbox
        >
              <span role="status" class="muted">共 {{ total }} 条</span>
              <ElTag v-if="columnFilters.status === 'approved'" effect="plain">在办项目 · 已批准及变更中</ElTag>
              <ElTag v-for="condition in appliedFilters" :key="condition.label" effect="plain">{{ condition.label }} · {{ condition.value }}</ElTag>
              <ElButton v-if="hasActiveFilters || columnFilters.status === 'approved'" link type="primary"
                @click="clearSearchAndColumns">清除检索与列筛选</ElButton>
            </div>
            <div class="toolbar page-heading-actions">
              <ElButton :loading="listLoading" @click="load">刷新</ElButton>
              <ElButton class="business-column-setting-trigger" @click="openSettings">列设置</ElButton>
              <ExcelExportButton kind="projects" :applied-query="exportQuery" :total="total" />

        <ElButton
          v-if="can('write')"
          type="primary"
          data-guide-action="projects.create" @click="editProject()"
          >新增子项目</ElButton
        >

            </div>
          </div>
        </template>
        <template #cell="{ row, column }">
          <ElButton v-if="column.key === 'name'" link type="primary" class="cell-link" @click="open(row)">{{ row.name }}</ElButton>
          <ElTag v-else-if="column.key === 'display_status'" effect="plain"
            :type="projectStatusTag(row.display_status)">{{ row.display_status }}</ElTag>
          <span v-else-if="column.key === 'approval'">{{ row.approval ? '¥' + money(row.approval.approved_budget_fen) : '尚未批准' }}</span>
          <span v-else-if="column.key === 'scopes'">{{ row.scopes?.filter((x) => x.binding).length || 0 }}</span>
          <span v-else-if="column.key === 'preliminary_estimate_fen'">{{ row.preliminary_estimate_fen == null ? '—' : '¥' + money(row.preliminary_estimate_fen) }}</span>
          <span v-else-if="column.key === 'agreement_name'">{{ row.agreement_name || '直接归属年度框架' }}</span>
          <span v-else>{{ formatVisibleDateTime(row[column.key as keyof typeof row], column.key) ?? '—' }}</span>
        </template>
      </BusinessTable>
      <ElPagination
        v-model:current-page="page"
        :total="total"
        :page-size="30"
        layout="prev,pager,next,total"
        @current-change="load"
      /></div
  >
  </div>
  <HandlingReviewDialog :workflow="handling" />
  <div v-show="projectWork !== 'settlements'">
  <BusinessDetailDialog :class="{ 'project-detail-drawer': !projectWork }" :open="detailOpen && !approvalEditorPage" :page="approvalReviewPage || projectFinancePage"
    :title="approvalReviewPage ? approvalReviewTitle : projectFinancePage ? '费用与结算' : '子项目详情'"
    :subtitle="projectWork ? detail?.name : undefined" bare :loading="detailLoading" :error="detailError"
    @close="projectWork ? returnFromProjectWork() : closeProjectDetails()" @retry="detailDialog.reload">
    <template v-if="detail"><div v-if="!projectWork" class="detail-header project-drawer-heading" :data-guide-record="'project/' + detail.id">
      <h1>{{ detail.name }}</h1>
      <ElTag :type="projectStatusTag(detail.display_status)">{{ detail.display_status }}</ElTag
      ><ElTooltip :content="detail.code" placement="top">
         <span class="muted project-code"><BusinessNumber :value="detail.code" label="项目编号" /></span>
       </ElTooltip>
    </div>
    <ElTabs v-if="!projectWork" v-model="tab" class="project-workflow-tabs">
      <ElTabPane name="overview" label="概览" />
      <ElTabPane name="scope" label="承接需求" />
      <ElTabPane name="approval" label="立项与变更" />
      <ElTabPane name="finance" label="费用与结算" />
      <ElTabPane name="history" label="历史记录" />
    </ElTabs>
    <ElAlert v-if="overviewError && !projectFinancePage && tab !== 'finance'" :title="overviewError" type="error" :closable="false">
      <ElButton text @click="loadOverview">重新读取项目数据</ElButton>
    </ElAlert>
    <template v-if="tab === 'overview' && overviewProject">
      <ProjectWorkflowHeader :message="overviewStep.message" :label="overviewStep.label" @proceed="runOverviewStep"
        :action-id="overviewStep.action === 'stock' ? 'projects.stock' : overviewStep.action === 'approval' ? 'projects.approval-draft'
          : overviewStep.action === 'link' ? 'projects.link' : overviewStep.action === 'history' ? 'projects.history' : overviewStep.action === 'finance' ? undefined : 'projects.approval-navigation'" />
      <ProjectOverview :project="overviewProject" :summary="overviewSummary" :framework="overviewFramework"
        :agreement="overviewAgreement" :loading="overviewLoading" :can-write="can('write')" :can-admin="can('admin')"
        :delete-reason="deleteReason" :close-reason="closeAction?.reason ?? (closeAction ? '' : undefined)"
        :description-columns="descriptionColumns" :settlement-blockers="closeAction?.settlement_blockers"
        @settlement="(id) => goToProjectWork('finance', id, '', 'settlement')"
        @fund="openRelatedFunding"
        @edit="editProject(detail || undefined)" @remove="removeProject" @close="openCloseReview" />
    </template>
    <template v-if="tab === 'scope'"
      ><section class="panel" aria-label="当前关联需求">
        <div class="toolbar">
          <h2>当前关联需求</h2>
          <ElButton data-guide-action="projects.link"
            :disabled="!can('write') || !!ordinaryLinkReason(detail)" :title="ordinaryLinkReason(detail)"
            @click="openDialog('link')"
            >关联需求</ElButton
          >
        </div>
        <ElAlert v-if="detail.status === 'closed' && (detail.scopes || []).length"
          type="info" :closable="false" show-icon
          title="项目正式结项，原需求关联及批准历史保留"
          description="未完成需求的独占承接资格已经释放，后续项目可以接续全部剩余位置和数量；本项目不可再解除历史关联。" />
        <ElAlert v-else-if="(detail.scopes || []).some((scope) =>
            scope.binding && releaseBlockReason(scope).includes('正式批准范围'))"
          type="info" :closable="false" show-icon
          title="当前正式批准范围内的需求不可直接解绑"
          description="在办项目禁止通过正式范围变更提前释放需求；只有正式结项且存在未解决量时才允许新项目接续。" />
        <BusinessTable client-side table-key="project:scopes" :rows="detail.scopes || []"
          :columns="projectScopeColumns" :actions-width="135">
          <template #cell="{ row, column }">
            <ElTag v-if="column.key === 'binding'" :type="row.binding ? 'success' : 'info'" effect="plain">
              {{ row.binding ? '当前关联' : detail.status === 'closed' ? '结项释放（历史保留）' : '已解除' }}
            </ElTag>
            <template v-else-if="column.key === 'expected_on'">
              <ElTag :type="row.expected_on ? 'success' : 'warning'" effect="plain">
                {{ row.expected_on || "未填写" }}
              </ElTag>
            </template>
            <template v-else-if="column.key === 'demand_no'">
              <ElButton link type="primary" @click="openRelatedDemand(row.demand_id)">{{ row.demand_no }}</ElButton>
              <ElTag v-if="row.demand_id === focusedDemandId" size="small" type="info">当前定位</ElTag>
            </template>
            <span v-else-if="column.key === 'quantity_scaled'">{{ quantity(row.quantity_scaled) }}</span>
            <span v-else>{{ formatVisibleDateTime(row[column.key as keyof typeof row], column.key) ?? '—' }}</span>
          </template>
          <template #actions="{ row }">
            <ElButton v-if="row.binding && can('write')" data-guide-action="projects.release" size="small"
              plain type="danger" :disabled="!!releaseBlockReason(row)" :title="releaseBlockReason(row)"
              @click="release(row)">解除承接</ElButton>
          </template>
        </BusinessTable>
      </section>
      <section v-if="detail.approval" class="panel" aria-label="工作完成情况">
        <h2>工作完成情况</h2>
        <BusinessTable client-side table-key="project:completed-work" :rows="completionRows" :columns="completionColumns">
          <template #cell="{ row, column, value }">
            {{ column.key.endsWith('_quantity_scaled') && typeof value === 'number'
              ? quantity(value) : formatVisibleDateTime(row[column.key as keyof typeof row], column.key) ?? '—' }}
          </template>
        </BusinessTable>
      </section>
    </template>
    <template v-if="tab === 'approval'">
      <ElAlert v-if="approvalReviewPage && !approvalDraft" type="info" :closable="false" title="当前没有待审核的立项或变更草稿" />
      <ElAlert v-if="missingExpected.length && detail.status !== 'closed'"
        type="warning" :closable="false" show-icon
        title="正式批准前，请填写全部关联需求和本次候选需求的预计解决时间">
        <div class="toolbar">
          <ElButton v-for="demand in missingExpected" :key="demand.id" link type="primary"
            @click="openRelatedDemand(demand.id)">{{ demand.number }}</ElButton>
        </div>
        <p v-if="approvalDraft">若补填的是草稿采纳的需求，请撤回草稿后按最新需求版本重新编制。</p>
      </ElAlert>
      <div v-if="!approvalReviewPage && !approvalDraft && !detail.deleted && ['stocked', 'approved'].includes(detail.status)" class="toolbar">
        <ElButton v-if="can('write')" :data-guide-action="detail.approval ? 'projects.change' : 'projects.approval-draft'"
          type="primary" :disabled="!detail.approval && !hasActiveScope"
          @click="openDialog('approval')">{{ detail.approval ? "编制变更" : "编制立项" }}</ElButton>
        <span v-if="!detail.approval && !hasActiveScope" class="muted">请先关联至少一条已确认的专业需求。</span>
      </div>
      <div v-if="approvalDraft" class="panel approval-comparison">
        <h2>{{ currentApproval ? "本次变更差异" : "本次立项申请" }}</h2>
        <ElDescriptions :column="2" border>
          <ElDescriptionsItem label="当前生效">
            {{ currentApproval ? "第 " + currentApproval.version_no + " 版 · ¥" + money(currentApproval.approved_budget_fen) : "尚未批准" }}
          </ElDescriptionsItem>
          <ElDescriptionsItem label="本次申请">第 {{ approvalDraft.version_no }} 版 · ¥{{ money(approvalDraft.approved_budget_fen) }}</ElDescriptionsItem>
          <ElDescriptionsItem v-if="currentApproval" label="预算差额">
            ¥{{ money(approvalDraft.approved_budget_fen - currentApproval.approved_budget_fen) }}
          </ElDescriptionsItem>
        </ElDescriptions>
        <BusinessTable v-if="approvalComparison.length" :rows="approvalComparison" table-key="project:approval-difference" sort-mode="off" filter-mode="off"
          :columns="[{key:'name',label:'需求编号',minWidth:180},{key:'changes',label:'本次调整',minWidth:150},
            {key:'before',label:'当前批准',minWidth:140},{key:'after',label:'本次申请',minWidth:140}]">
          <template #cell="{row,column}">
            <span v-if="column.key === 'name'">{{ row.name }}</span>
            <span v-else-if="column.key === 'changes'">{{ row.changes }}</span>
            <template v-else>
              <span v-if="row[column.key === 'before' ? 'before' : 'after']">
                {{ quantity(row[column.key === 'before' ? 'before' : 'after']!.quantity) }} {{ row[column.key === 'before' ? 'before' : 'after']!.unit }} ·
                {{ row[column.key === 'before' ? 'before' : 'after']!.locations.length || 1 }} 处 ·
                {{ row[column.key === 'before' ? 'before' : 'after']!.materialSummary || (row[column.key === 'before' ? 'before' : 'after']!.materials.length + ' 项物资') }}
              </span>
              <span v-else>—</span>
            </template>
          </template>
        </BusinessTable>
        <p v-else>需求、工作量和批准物资沿用当前批准。</p>
      </div>
      <p v-else-if="!currentApproval" class="muted">{{ detail.status === 'reserve' ? '确认入库后可编制立项。' : '尚无生效的批准范围。' }}</p>
      <div
        v-for="approval in [...detail.approvals].sort((a,b) => Number(b.status === 'draft') - Number(a.status === 'draft'))"
        :key="approval.id"
        class="panel"
      >
        <div class="toolbar">
          <h2>{{ approval.status === "draft" ? "待审核草稿" : "当前正式批准" }} · 第 {{ approval.version_no }} 版</h2>
          <ElButton data-guide-action="projects.approve"
            :disabled="
              detail.deleted || missingExpected.length > 0 || approvalAction?.enabled === false || !can(
                approval.version_no === 1
                  ? 'project.approve'
                  : 'change.approve',
              )
            "
            v-if="approval.status === 'draft' && !approvalReviewPage"
            type="primary"
            @click="goToProjectWork('review')"
            >{{ approval.version_no === 1 ? "审核立项" : "审核变更" }}</ElButton
          ><ElButton data-guide-action="projects.approval-discard"
            :disabled="!can('write') || detail.deleted"
            v-if="approval.status === 'draft'"
            plain type="danger"
            @click="action('discard', approval)"
            >撤回草稿</ElButton
          >
          <span v-if="approval.status === 'draft' && approvalAction?.reason" class="muted">{{ approvalAction.reason }}</span>
          <span v-if="approval.status === 'draft' && !approvalAction?.reason && !can(approval.version_no === 1 ? 'project.approve' : 'change.approve')" class="muted">由具备审核权限的人员办理</span>
          <ElButton v-if="approval.status === 'draft' && !detail.deleted && can('write')" @click="openDialog('charge')">增加批次 / 项目参考费用</ElButton>
        </div>
        <ElDescriptions :column="descriptionColumns" border
          ><ElDescriptionsItem :label="approval.status === 'draft' ? '申请预算' : '批准预算'"
            >¥{{ money(approval.approved_budget_fen) }}</ElDescriptionsItem
          ><ElDescriptionsItem label="参考价格">{{
            approval.reference.complete
              ? "完整参考价 ¥" + money(approval.reference.total_fen)
              : "未完整计价，已计价小计 ¥" +
                money(approval.reference.subtotal_fen)
          }}</ElDescriptionsItem></ElDescriptions
        ><BusinessTable client-side table-key="project:approval-scopes" :rows="approval.scopes.map(approvedScopeRow)"
          :columns="projectApprovalColumns" :actions-width="170">
          <template #cell="{ row, column }">
            <span v-if="column.key === 'quantity_scaled'">{{ quantity(row.quantity_scaled) }}</span>
            <span v-else>{{ formatVisibleDateTime(row[column.key as keyof typeof row], column.key) ?? '—' }}</span>
          </template>
          <template v-if="approval.status === 'draft'" #actions="{ row }">
            <ElButton data-guide-action="projects.quote" :disabled="!can('write')" size="small" @click="priceScope(row)">按承接范围核价</ElButton>
          </template>
        </BusinessTable>
        <template v-if="approval.pending_scopes.length">
          <h3>新增候选需求</h3>
          <ElAlert title="正式变更批准时建立承接关系，提交前仍须核对需求版本和当前归属" type="info" :closable="false" />
          <BusinessTable client-side table-key="project:approval-candidates"
            :rows="approval.pending_scopes.map(candidateScopeRow)" :columns="projectApprovalColumns">
            <template #cell="{ row, column, value }">
              {{ column.key === 'quantity_scaled' ? quantity(row.quantity_scaled)
                : formatVisibleDateTime(value, column.key) ?? '—' }}
            </template>
          </BusinessTable>
        </template>
        <BusinessTable v-if="approval.reference.charges.length" client-side
          table-key="project:approval-charges" :rows="approval.reference.charges"
          :columns="projectChargeColumns" :actions-width="190">
          <template #cell="{ row, column }">
            <span v-if="column.key === 'amount_fen'">¥{{ money(row.amount_fen) }}</span>
            <span v-else>{{ formatVisibleDateTime(row[column.key as keyof typeof row], column.key) ?? '—' }}</span>
          </template>
          <template v-if="approval.status === 'draft'" #actions="{ row }">
            <RowActions :actions="[
              { label: '更正', disabled: !can('write'), run: () => editCharge(row) },
              { label: '删除', danger: true, disabled: !can('write'), run: () => removeCharge(row) },
            ]" />
          </template>
        </BusinessTable>
      </div></template
    >
    <template v-if="tab === 'finance' && !projectFinancePage">
      <SettlementProgressSummary :summary="overviewSummary" :loading="overviewLoading" :error="overviewError"
        @retry="loadOverview">
        <template #actions v-if="!detail.deleted">
          <ElButton type="primary" @click="goToProjectWork('finance')">打开项目财务工作区</ElButton>
        </template>
      </SettlementProgressSummary>
    </template>
    <ElAlert
      v-if="detail.deleted && tab === 'finance'"
      title="项目已归档删除，费用与结算记录可在档案历史中查询。"
      type="info"
      :closable="false"
    /><FinancePanel
      v-if="tab === 'finance' && projectFinancePage && !detail.deleted"
      :project="detail" :refresh-key="financeRevision"
      :focus="route.query.focus === 'cost' || route.query.focus === 'settlement' || route.query.focus === 'reconciliation'
        ? { kind: route.query.focus, id: String(route.query.record || '') } : null"
      @changed="load" @open-settlement="(id, action) => goToProjectWork('settlements', id, action)"
    />
    <div v-if="tab === 'history'" class="panel">
      <div class="toolbar">
        <h2>{{ detail.display_status === '已结项' ? '结项结果' : '项目历史记录' }}</h2>
        <ElButton data-guide-action="projects.history" @click="historyRevision++">刷新历史</ElButton>
      </div>
      <BusinessHistory :key="historyRevision" record-kind="projects" :record-id="detail.id"
        :initial-entry="detail.display_status === '已结项' ? '结项结果' : undefined" />
    </div>
  </template>
    <template v-if="approvalReviewPage && approvalDraft && detail && !detail.deleted && can(approvalDraft.version_no === 1 ? 'project.approve' : 'change.approve')" #footer>
      <ElButton @click="returnFromProjectWork">取消</ElButton>
      <ElButton type="primary" data-guide-action="projects.approve" :loading="busy" :disabled="missingExpected.length > 0 || approvalAction?.enabled === false || overviewLoading"
        @click="action('approve', approvalDraft, true)">确认正式批准</ElButton>
    </template>
  </BusinessDetailDialog>
  </div>
  <template v-if="projectWork === 'settlements'">
    <FinancePanel v-if="detail && !detailLoading" :key="String(route.params.recordId) + '/' + String(route.params.recordAction)"
      :project="detail" :settlement-work="{ id: String(route.params.recordId || ''), action: String(route.params.recordAction || '') }"
      @changed="financeRevision++; load()" @close-settlement="returnFromProjectWork" />
    <BusinessWorkSurface v-else title="项目结算" @back="returnFromProjectWork">
      <ElAlert v-if="detailError" :title="detailError" type="error" :closable="false"><ElButton text @click="detailDialog.reload">重新读取</ElButton></ElAlert>
      <ElSkeleton v-else :rows="5" animated />
    </BusinessWorkSurface>
  </template>
  <ProjectCloseReviewDialog v-model:open="closeReviewOpen"
    :approved-version="closePreview?.approval_version" :summary="closePreview?.summary ?? null"
    :can-close="!!closePreview && !closePreview.reason && !busy"
    :error="closePreviewError" :reason="closePreview?.reason"
    :loading="closePreviewLoading" @retry="loadClosePreview"
    @confirm="action('close', undefined, true)" />
  <BusinessWorkSurface v-if="approvalEditorPage && dialog !== 'approval'" :title="approvalEditorTitle" :subtitle="detail?.name" @back="returnFromProjectWork">
    <ElSkeleton v-if="detailLoading" :rows="5" animated />
    <ElAlert v-else :title="detailError || '当前项目状态或账号权限无法编制批准范围'" type="info" :closable="false" />
  </BusinessWorkSurface>
  <BusinessEditorSurface :page="approvalEditorPage" :open="!!dialog" :busy="busy" :subtitle="detail?.name"
    :title="
      {
        project: editing ? '修订项目档案' : '新增子项目',
        approval: approvalEditorTitle,
        charge: '批次 / 项目独立参考费用',
      }[dialog] || ''
    "
    width="min(950px, 94vw)"
    :before-close="beforeEditorClose"
    @close="approvalEditorPage ? closeEditor() : dialog = ''"
    ><ElAlert v-if="dialog === 'approval' && approvalLoadError" type="error" :closable="false" :title="'批准范围读取失败：' + approvalLoadError">
      <ElButton @click="openDialog('approval')">重新读取</ElButton>
      </ElAlert>
      <VersionConflictNotice :message="projectConflict" :read-current="compareProject" :apply-current="continueProjectEdit" />
    <ElForm ref="formRef" :model="form" label-position="top" novalidate
        v-loading="dialog === 'approval' && approvalLoading"
        :disabled="dialog === 'approval' && (approvalLoading || !!approvalLoadError)">
      <ElAlert v-if="dialog === 'project' && handoffDemand" type="info" :closable="false"
        :title="'本次创建成功后将同时承接需求 ' + handoffDemand.demand_no + ' · ' + handoffDemand.problem_description" />
      <div class="form-grid">
        <ProjectArchiveFields v-if="dialog === 'project'" :model-value="form" :editing-status="editing?.status"
          :actors="actors" :agreement-choices="agreementChoices" :agreement-loading="agreementLoading"
          :agreement-error="agreementError" :project-agreement-invalid="projectAgreementInvalid"
          @framework="changeProjectFramework"
          @retry="loadProjectAgreements(String(form.framework_id || ''), String(form.agreement_id || '') || null)" />
        <ProjectApprovalFields v-if="dialog === 'approval'" :model-value="form" />
        <template v-if="dialog === 'charge'"
          ><ElFormItem
            label="正式价格规则"
            prop="reference_price_catalog_id"
            :rules="[{ required: true, message: '请填写正式价格规则' }]"
            required
            ><FieldControl
              v-model="form.reference_price_catalog_id"
              :field="{ type: 'ref', reference: 'prices' }" /></ElFormItem
          ><ElFormItem
            label="唯一批次 / 项目费用键"
            prop="charge_scope_key"
            :rules="[
              { required: true, message: '请填写唯一批次 / 项目费用键' },
            ]"
            required
            ><ElInput v-model="form.charge_scope_key" /></ElFormItem
          ><ElFormItem
            label="计价数量"
            prop="quantity_scaled"
            :rules="[{ required: true, message: '请填写计价数量' }]"
            required
            ><FieldControl
              v-model="form.quantity_scaled"
              :field="{ type: 'quantity', quantityPrecision: chargeQuantityPrecision }"
              @validity-change="chargeQuantityInvalid = $event" /></ElFormItem
          ><ElAlert v-if="chargePrecisionError" type="error"
            :title="chargePrecisionError" :closable="false" />
        ></template>
      </div>
      <ElAlert v-if="dialog === 'approval' && detail?.approval"
        type="info" :closable="false"
        title="已继承上一版正式批准的物资、位置、数量和预算；新增需求默认不纳入，需要明确选择。" />
      <template v-if="dialog === 'approval'">
        <ElButton v-if="detail?.status === 'approved'" @click="linkPickerOpen = true" data-guide-action="projects.add-candidate">新增候选需求</ElButton>
        <p v-if="detail?.status === 'approved'" class="muted">新增候选仅在正式批准时建立归属；已承接需求不得在项目结项前提前释放。</p>
        <h2 class="subheading">纳入批准的需求</h2>
        <p class="muted">首次承接自动采用全部剩余工作量；在办项目保留原批准范围，不允许并行或手动分割承接。</p>
        <div
          v-for="scope in approvalRows"
          :key="scope.project_scope_id"
          class="panel approval-scope-card"
        >
          <div class="approval-scope-heading">
            <ElCheckbox v-model="scope.selected" :disabled="scope.demand_status !== 'active'">
              {{ scope.demand_no }}
              {{ scope.demand_status !== 'active' ? ' · 需求待确认，暂不可纳入批准' : '' }}
            </ElCheckbox>
            <span class="approval-scope-description">{{ scope.problem_description }}</span>
            <span class="muted">预计解决时间 {{ scope.expected_on || '未填写' }}</span>
          </div>
          <BusinessTable table-key="project:approval-editor"
            :rows="scope.locations" :columns="approvalEditorColumns"
            sort-mode="off" filter-mode="off" compact>
            <template #cell="{ row, column }">
              <span v-if="column.key === 'approved_quantity_scaled'">{{ quantity(row.approved_quantity_scaled) }}</span>
              <span v-else>{{ formatVisibleDateTime(row[column.key as keyof typeof row], column.key) ?? '—' }}</span>
            </template>
          </BusinessTable>
          <ElAlert v-if="scope.precision_error" type="error" :closable="false"
            :title="'需求正式单位版本无效：' + scope.precision_error" />
          <h3 class="subheading">批准物资（按承接范围明确数量）</h3>
          <div
            v-for="(item, index) in scope.materials"
            :key="index"
            class="approval-material-row"
            role="group" :aria-label="'批准物资第' + (Number(index) + 1) + '项'"
          >
            <div class="approval-material-field">
              <span class="approval-material-label">物资名称</span>
              <FieldControl
                v-model="item.material_id"
                :field="{ type: 'ref', reference: 'materials' }"
              />
            </div>
            <div class="approval-material-field">
              <span class="approval-material-label">批准数量</span>
              <FieldControl
                v-model="item.quantity_scaled"
                :field="{ type: 'quantity', quantityPrecision: materialQuantityPrecision[item.material_id] }"
                @validity-change="approvalQuantityInvalid('material.' + scope.project_scope_id + '.' + item.material_id, $event)"
              />
            </div>
            <ElButton data-guide-action="projects.material-remove" type="danger" plain size="small"
              @click="scope.materials.splice(index, 1)">移除</ElButton>
          </div>
          <ElButton data-guide-action="projects.material-add" @click="scope.materials.push({ material_id: '', quantity_scaled: 10000 })"
            >添加批准物资</ElButton
          >
        </div></template
      ></ElForm>
    <ElAlert v-if="editorDifferences.length" title="保存草稿前请核对本次调整" type="warning" :closable="false">
      <ul><li v-for="difference in editorDifferences" :key="difference">{{ difference }}</li></ul>
    </ElAlert>
    <template #footer
      ><ElButton @click="closeEditor">取消</ElButton
      ><ElButton data-guide-action="projects.save"
        :disabled="!can('write') || (dialog === 'approval' && (approvalLoading || !!approvalLoadError)) || (dialog === 'project' &&
          !!form.agreement_id && (agreementLoading || !!agreementError || projectAgreementInvalid))"
        type="primary"
        :loading="busy"
        @click="save"
        >{{ approvalEditorPage ? (editorDifferences.length ? '核对并保存变更草稿' : '保存批准草稿') : '保存' }}</ElButton
      ></template>
  </BusinessEditorSurface>
  <ProjectDemandPicker v-model:open="linkPickerOpen"
    :project-id="detail?.id || ''"
    :proposal="dialog === 'approval'"
    :existing-ids="[...(detail?.scopes || []).filter((scope) => scope.binding).map((scope) => scope.demand_id), ...approvalRows.flatMap((scope) => scope.demand_id ? [scope.demand_id] : [])]"
    @selected="addApprovalCandidates" @linked="load" />
  <PricingQuoteDialog
    v-if="priceScopeContext"
    v-model="quoteOpen"
    :demand-id="priceScopeContext.demand_id"
    :expected-version="priceScopeContext.demand_version"
    :scope-id="priceScopeContext.id"
    @confirmed="load"
  />
</template>
<style scoped>
.approval-comparison {display:grid;gap:12px}
.approval-comparison h2 {margin:0}
.closed-project-summary {margin-bottom:12px}
:global(.project-detail-drawer .el-drawer__body) {background:var(--page-background)}
.project-drawer-heading {padding:12px 0 8px;min-height:44px;gap:10px 14px}
.project-workflow-tabs :deep(.el-tabs__header) {margin-bottom:16px}
.approval-scope-card {background:var(--surface);margin-bottom:16px}
.approval-scope-heading {display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 14px;margin-bottom:10px}
.approval-scope-description {font-weight:600;overflow-wrap:anywhere}
.project-code {
  display: inline-block;
  max-width: min(260px, 37vw);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: middle;
}
.funding-option {
  display: flex;
  flex-direction: column;
  gap: 2px;
  line-height: 1.3;
  padding-block: 4px;
}
.funding-option-title { font-weight: 600; }
.funding-option small {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.approval-material-row {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(140px, .6fr) auto;
  align-items: end;
  gap: 12px;
  background: var(--surface-subtle);
  border: 1px solid var(--edge);
  border-radius: 11px;
  padding: 12px;
  margin-bottom: 12px;
}
.approval-material-field {min-width:0}
.approval-material-label {
  display: block;
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
}
.approval-material-field :deep(.el-select),
.approval-material-field :deep(.el-input) {width:100%}
.approval-material-row > .el-button {margin-bottom:2px}
@media(max-width:760px){
  .approval-material-row {grid-template-columns:1fr}
  .approval-material-row > .el-button {justify-self:end}
}
</style>

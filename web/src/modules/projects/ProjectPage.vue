<script setup lang="ts">
import BusinessDetailDialog from "../../shared/ui/BusinessDetailDialog.vue";
import { useEntityDialog } from "../../shared/composables/use-entity-dialog";
import { useDescriptionColumns } from "../../shared/composables/use-description-columns";import { useDialogDraftGuard } from "../../shared/forms/use-dialog-draft";
const descriptionColumns = useDescriptionColumns();
import { useListRoute } from "../../shared/composables/use-list-route";
import RowActions from "../../shared/ui/RowActions.vue";
import BusinessHistory from "../../shared/ui/BusinessHistory.vue";
import { useAccess } from "../../shared/composables/use-access";
const can = useAccess();
import { ref, onMounted, computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { demandContext, fundContext, projectContext } from "../../shared/navigation/business-context";
import type { ProjectAction } from "../../../../server/modules/projects/actions";
import { ElMessage, ElMessageBox } from "element-plus";
import FieldControl from "../../shared/ui/FieldControl.vue";
import { readAdoptedQuantityPrecision, readCurrentMaterialPrecision }
  from "../../shared/api/quantity-precision";
import type { PriceRuleRecord } from "../../../../server/shared/types/price-rules";
import BusinessTable, { type TableColumn } from "../../shared/ui/BusinessTable.vue";
import PricingQuoteDialog from "../pricing/PricingQuoteDialog.vue";
import FinancePanel from "../finance/FinancePanel.vue";
import ProjectWorkflowHeader from "./components/ProjectWorkflowHeader.vue";
import ProjectOverview from "./components/ProjectOverview.vue";
import ProjectCloseReviewDialog from "./components/ProjectCloseReviewDialog.vue";
import type { ProjectOverviewFacts, ProjectFinanceSnapshot, ProjectReference } from "./components/types";
import { api, type Row, money, quantity, statusText } from "../../shared/api/client";
import { formatVisibleDateTime } from "../../shared/utils/datetime";
import type { DemandListItem } from "../../../../server/shared/types/demands";
import type { Page } from "../../../../server/shared/types/contracts";
const formRef = ref(),
  actors = ref<Row[]>([]);

const route = useRoute(), router = useRouter();
const projectActions = ref<ProjectAction[]>([]);
const overviewSummary = ref<ProjectFinanceSnapshot | null>(null);
const overviewFramework = ref<ProjectReference | null>(null);
const overviewAgreement = ref<ProjectReference | null>(null);
const overviewLoading = ref(false);
const closeReviewOpen = ref(false);
const handoffDemand = ref<Row | null>(null);
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
    scopes: (row.scopes || []).map((scope: Row) => ({ binding: scope.binding })),
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
const rows = ref<Row[]>([]),
  listLoading = ref(false),
  total = ref(0),
  page = ref(1),
  query = ref(""),
  sortKey = ref(""),
  sortDirection = ref("desc"),
  columnFilters = ref<Record<string, string>>({}),
  detail = ref<Row | null>(null),
  dialog = ref(""),
  form = ref<Row>({}),
  editing = ref<Row | null>(null),
  busy = ref(false),
  demands = ref<DemandListItem[]>([]),
  showPendingDemands = ref(false),
  demandQuery = ref(""),
  demandPage = ref(1),
  demandTotal = ref(0),
  demandLoading = ref(false),
  agreementChoices = ref<Row[]>([]),
  agreementLoading = ref(false),
  agreementError = ref(""),
  history = ref<Row | null>(null),
  tab = ref("overview"),
  approvalRows = ref<Row[]>([]),
  priceScopeContext = ref<Row | null>(null),
  quoteOpen = ref(false);
const approvalQuantityError = ref<Record<string, boolean>>({});
function approvalQuantityInvalid(path: string, invalid: boolean) {
  approvalQuantityError.value = { ...approvalQuantityError.value, [path]: invalid };
}
const materialQuantityPrecision = ref<Record<string, number>>({});
const materialQuantityErrors = ref<Record<string, string>>({});
let materialPrecisionRequest = 0;
watch(() => approvalRows.value.flatMap((scope: Row) =>
  (scope.materials || []).map((item: Row) => String(item.material_id || "")))
  .filter(Boolean).sort().join("|"), async () => {
  const sequence = ++materialPrecisionRequest;
  const ids = [...new Set<string>(approvalRows.value.flatMap((scope: Row) =>
    (scope.materials || []).map((item: Row): string => String(item.material_id || ""))).filter(Boolean))];
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
const editingCharge = ref<Row | null>(null);
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
const showDeleted = ref(false);
// Approval decision fields must remain visible: column customization cannot
// hide a selected scope or its approved quantity during a formal submission.
const approvalEditorColumns: TableColumn[] = [
  { key: "selected", label: "纳入批准", minWidth: 125, sortable: false, filterable: false, hideable: false },
  { key: "label", label: "作业位置", minWidth: 190, sortable: false, filterable: false, hideable: false },
  { key: "approved_quantity_scaled", label: "批准数量", minWidth: 180, sortable: false, filterable: false, hideable: false },
];
const projectScopeColumns: TableColumn[] = [
  { key: "demand_no", label: "需求编号", minWidth: 215 },
  { key: "binding", label: "状态", sortable: false, filterable: false },
];
const projectApprovalColumns: TableColumn[] = [
  { key: "demand_no", label: "需求", minWidth: 185 },
  { key: "quantity_scaled", label: "承接数量" },
  { key: "locations", label: "位置数", sortable: false, filterable: false },
];
const projectChargeColumns: TableColumn[] = [
  { key: "rule_title", label: "批次或项目参考费用", minWidth: 210 },
  { key: "amount_fen", label: "金额", minWidth: 140 },
];
function resetListPage() {
  page.value = 1;
  void load();
}
const projectStatuses = ["储备", "已入库", "立项中", "已批准", "变更中", "已结项"] as const;
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
  { key: "code", label: "项目编号", minWidth: 150 },
  { key: "name", label: "项目名称", minWidth: 220 },
  { key: "display_status", label: "项目状态", minWidth: 155, hideable: false },
  { key: "approval", filterable: false, label: "批准预算", sortable: false },
  { key: "scopes", filterable: false, label: "关联需求数", sortable: false },
];
function sortTable(value: { key: string; order: string }) {
  sortKey.value = value.key;
  sortDirection.value = value.order === "ascending" ? "asc" : "desc";
  page.value = 1;
  load();
}
function filterTable(value: Record<string, string>) {
  columnFilters.value = value;
  page.value = 1;
  load();
}
let loadSequence = 0;
async function load() {
  const sequence = ++loadSequence;
  listLoading.value = true;
  try {
    const value = await api<{ items: Row[]; total: number }>(
      `/projects?page=${page.value}&q=${encodeURIComponent(query.value)}&deleted=${showDeleted.value}&sort=${encodeURIComponent(sortKey.value || "created_at")}&direction=${sortDirection.value}&filters=${encodeURIComponent(JSON.stringify(columnFilters.value))}`,
    );
    if (sequence !== loadSequence) return;
    rows.value = value.items;
    total.value = value.total;
    const id = detail.value?.id;
    if (id) {
      const updated = await api<Row>("/projects/" + id + "?deleted=true");
      if (sequence === loadSequence && detail.value?.id === id) detail.value = updated;
    }
  } catch (error) {
    if (sequence === loadSequence) ElMessage.error((error as Error).message);
  } finally {
    if (sequence === loadSequence) listLoading.value = false;
  }
}
async function open(row: Row) {
  await detailDialog.open(row.id);
}
const draftGuard = useDialogDraftGuard(() => ({
  form: form.value,
  // Approved locations are edited in their own table, not in the header form.
  approvalRows: dialog.value === "approval" ? approvalRows.value : [],
}));
function closeEditor() { void draftGuard.confirmClose(() => { dialog.value = ""; }); }
function beforeEditorClose(done: () => void) { void draftGuard.confirmClose(done); }
function editProject(row?: Row) {
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
let demandSearchSequence = 0;
async function searchDemands(q = "", append = false) {
  if (!append) {
    demandQuery.value = q;
    demandPage.value = 1;
  }
  const sequence = ++demandSearchSequence;
  const targetPage = append ? demandPage.value + 1 : 1;
  demandLoading.value = true;
  try {
    const params = new URLSearchParams({
      page: String(targetPage),
      page_size: "50",
      q: demandQuery.value,
      include_pending: String(showPendingDemands.value),
    });
    const pageResult = await api<Page<DemandListItem>>("/demands/candidates?" + params);
    if (sequence !== demandSearchSequence) return;
    // Keep the selected business description visible after refining search.
    const selected = demands.value.find(item => item.id === form.value.demand_id);
    const entries = append ? [...demands.value, ...pageResult.items] : pageResult.items;
    const deduped = new Map(entries.map(item => [item.id, item]));
    if (selected && !deduped.has(selected.id)) deduped.set(selected.id, selected);
    demands.value = [...deduped.values()];
    demandTotal.value = pageResult.total;
    demandPage.value = targetPage;
  } catch (error) {
    if (sequence === demandSearchSequence)
      ElMessage.error((error as Error).message);
  } finally {
    if (sequence === demandSearchSequence) demandLoading.value = false;
  }
}
function moreDemandCandidates() {
  if (!demandLoading.value && demandPage.value * 50 < demandTotal.value)
    void searchDemands(demandQuery.value, true);
}
function changePendingDemandFilter() {
  if (!showPendingDemands.value &&
      demands.value.find(item => item.id === form.value.demand_id)?.status === "pending")
    form.value.demand_id = null;
  void searchDemands(demandQuery.value);
}
const currentApprovedScopes = computed<Row[]>(() =>
  detail.value?.approvals?.find((ap: Row) => ap.id === detail.value?.approval?.id)?.scopes || []);
function pendingApprovalChanges() {
  if (!detail.value?.approval) return [];
  const reasons: string[] = [];
  if (form.value.approved_budget_fen !== detail.value.approval.approved_budget_fen)
    reasons.push("批准预算已调整");
  for (const previous of currentApprovedScopes.value) {
    const selected = approvalRows.value.find((row: Row) =>
      row.project_scope_id === previous.project_scope_id && row.selected);
    if (!selected) {
      reasons.push(previous.demand_no + " 已从批准范围移除");
      continue;
    }
    if (previous.demand_version !== selected.demand_version)
      reasons.push(previous.demand_no + " 的需求版本已变化，请核对作业设备和数量");
    const oldLocations = previous.locations.length
      ? previous.locations.map((loc: Row) => [loc.location_item_no, loc.approved_quantity_scaled])
      : [[1, previous.quantity_scaled]];
    const nextLocations = selected.locations.filter((loc: Row) => loc.selected)
      .map((loc: Row) => [loc.location_item_no, loc.approved_quantity_scaled]);
    if (JSON.stringify(oldLocations.sort((a: Row,b: Row)=>a[0]-b[0])) !==
      JSON.stringify(nextLocations.sort((a: Row,b: Row)=>a[0]-b[0])))
      reasons.push(previous.demand_no + " 的作业位置或数量已调整");
    const oldMaterials = previous.materials.map((item: Row) =>
      [item.material_id, item.approved_quantity_scaled]).sort();
    const newMaterials = selected.materials.map((item: Row) =>
      [item.material_id, item.quantity_scaled]).sort();
    if (JSON.stringify(oldMaterials) !== JSON.stringify(newMaterials))
      reasons.push(previous.demand_no + " 的批准物资已调整");
  }
  const priorIds = new Set(currentApprovedScopes.value.map((x: Row) => x.project_scope_id));
  if (approvalRows.value.some((x: Row) => x.selected && !priorIds.has(x.project_scope_id)))
    reasons.push("新增承接需求范围");
  return reasons;
}
const selectedFundingAgreement = computed<Row | null>(() =>
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
    const response = await api<{ options: Row[] }>("/projects/eligible-agreements?" + params);
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
async function openDialog(type: string) {  if (type === "approval" && !detail.value?.scopes.some((scope: Row) =>
      scope.binding && scope.demand_status === "active")) {
    ElMessage.warning("当前没有已确认有效的专业需求。请先在专业需求中确认，再编制立项范围。");
    return;
  }
  if (type === "link") showPendingDemands.value = false;
  editingCharge.value = null;
  dialog.value = type;
  form.value = {};
  if (type === "link") await searchDemands();
  if (type === "approval") {
    approvalRows.value = [];
    approvalQuantityError.value = {};
    const candidates = await api<Row[]>(`/projects/${detail.value!.id}/approval-candidates`);
    for (const demand of candidates) {
      const scope = detail.value!.scopes.find((item: Row) => item.id === demand.project_scope_id);
      if (!scope) continue;
      const baseline = currentApprovedScopes.value.find((item: Row) =>
        item.project_scope_id === scope.id);
      approvalRows.value.push({
        project_scope_id: scope.id,
        demand_version: demand.current_version,
        demand_no: demand.demand_no,        demand_status: demand.status,
        unit_id: demand.unit_id,
        unit_version: demand.unit_version,
        quantity_precision: undefined,
        selected: demand.status === "active" && (!detail.value?.approval || !!baseline),
        previous_demand_version: baseline?.demand_version,
        locations: demand.work_locations.map((loc: Row, index: number) => {
          const old = baseline?.locations?.find((item: Row) =>
            item.location_item_no === index + 1);
          return {
            location_item_no: index + 1,
            approved_quantity_scaled: old?.approved_quantity_scaled ??
              (baseline && demand.work_locations.length === 1
                ? baseline.quantity_scaled : loc.quantity_scaled),
            selected: !baseline || baseline.locations.length === 0 || !!old,
            label: loc.location_snapshot_json.location_label ||
              loc.location_snapshot_json.physical_code ||
              loc.location_snapshot_json.tower_no || loc.span_id,
          };
        }),
        materials: baseline?.materials?.map((item: Row) => ({
          material_id: item.material_id,
          quantity_scaled: item.approved_quantity_scaled,
        })) || [],
      });
    }
    const currentApproval = approvalRows.value;
    const unitRequests = new Map<string, Promise<number>>();
    await Promise.all(currentApproval.map(async (scope: Row) => {
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
    form.value = {
      approved_budget_fen: detail.value?.approval?.approved_budget_fen || 0,
      basis: "",
      expected_version: detail.value?.version,
      expected_approval_version_id: detail.value?.approval?.id || null,
    };
  }
  draftGuard.capture();
}
async function save() {
  if (busy.value) return;
  if (dialog.value === "charge" &&
      (chargeQuantityPrecision.value === undefined || chargeQuantityInvalid.value)) {
    ElMessage.error(chargePrecisionError.value ||
      "计价规则采用的正式计量单位精度尚未确认，不能提交数量");
    return;
  }
  if (dialog.value === "approval") {
    const selectedScopes = approvalRows.value.filter((scope: Row) => scope.selected);
    const invalid = selectedScopes.some((scope: Row) =>
      typeof scope.quantity_precision !== "number" ||
      scope.materials.some((item: Row) =>
        materialQuantityPrecision.value[item.material_id] === undefined) ||
      scope.locations.some((loc: Row) => approvalQuantityError.value[
        "location." + scope.project_scope_id + "." + loc.location_item_no]) ||
      scope.materials.some((item: Row) => approvalQuantityError.value[
        "material." + scope.project_scope_id + "." + item.material_id]));
    if (invalid) {
      ElMessage.error("批准范围存在无效数量或未读取的冻结单位精度，请核对每项并重新提交");
      return;
    }
  }
  busy.value = true;
  try {
    if (!(await formRef.value?.validate().catch(() => false))) return;
    // Direct framework ownership is a complete business route. Loading the
    // optional agreement catalog must never block saving a direct project.
    if (dialog.value === "project" && form.value.agreement_id &&
        (agreementLoading.value || !!agreementError.value || projectAgreementInvalid.value)) {
      ElMessage.warning(agreementError.value ||
        "请等待执行协议加载完成，或选择当前年度框架内有效的执行协议");
      return;
    }
    let newlyCreatedProject: Row | null = null;
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
    if (dialog.value === "link") {
      const demand = demands.value.find((x) => x.id === form.value.demand_id);
      await api(`/projects/${detail.value!.id}/link`, "POST", {
        ...form.value,
        expected_version: demand?.current_version,
      });
    }
    if (dialog.value === "approval") {
      const differences = pendingApprovalChanges();
      if (differences.length) {
        await ElMessageBox.confirm(
          "请核对本次正式变更：\n" + differences.map(
            (item, index) => (index + 1) + ". " + item).join("\n") +
            "\n确认后方可生成新版批准草稿，原批准历史不会被修改。",
          "复核正式变更差异",
          { type: "warning", confirmButtonText: "已核对，编制变更" },
        );
      }
      await api(`/projects/${detail.value!.id}/approvals`, "POST", {
        ...form.value,
        confirm_changes: differences.length > 0,
        scopes: approvalRows.value
          .filter((x) => x.selected)
          .map((x) => ({
            ...x,
            locations: x.locations.filter((loc: Row) => loc.selected),
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
            (x: Row) => x.status === "draft",
          )?.id,
        },
      );
    ElMessage.success("业务数据已保存，正在同步列表");
    dialog.value = "";
    await load();
    if (newlyCreatedProject?.id && !editing.value) {
      const demandId = handoffDemand.value?.id;
      handoffDemand.value = null;
      await router.replace(projectContext(newlyCreatedProject.id, "overview",
        demandId ? { focus: "demand", record: demandId } : undefined));
      await detailDialog.open(newlyCreatedProject.id);
    }
  } catch (e) {
    ElMessage.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function action(name: string, approval?: Row, reviewed = false) {
  try {
    const projectName = detail.value!.name;
    const description: Record<string, string> = {
      stock: "将子项目正式入库，之后才可编制立项批准范围。",
      close: "正式审核结项；请确认未实施工作、未核对费用和未结算费用已处理或明确接受差异。结项后不再新增需求或调整批准范围。",
      approve: "批准后形成不可变的正式范围与预算历史。需求与位置数：" +
        (approval?.scopes?.length || 0) +
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
    if (name === "stock" || name === "close")
      await api(`/projects/${detail.value!.id}/${name}`, "POST", {
        expected_version: detail.value!.version,
      });
    if (name === "approve")
      await api(
        `/projects/${detail.value!.id}/approvals/${approval!.id}/approve`,
        "POST",
        { expected_version: detail.value!.version },
      );
    if (name === "discard")
      await api(
        `/projects/${detail.value!.id}/approvals/${approval!.id}`,
        "DELETE",
        {},
      );
    ElMessage.success((titles[name] || "正式操作") + "成功，正在刷新业务状态");
    closeReviewOpen.value = false;
    await load();
  } catch (e) {
    if (e instanceof Error) ElMessage.error(e.message);
  }
}
function releaseBlockReason(scope: Row): string {
  const project = detail.value;
  if (!project || project.deleted) return "项目已删除，不能操作";
  if (!scope.binding) return "需求当前没有承接关系";
  if (!can("write")) return "当前账号没有变更关联权限";
  const approvals = (project.approvals || []) as Row[];
  if (approvals.some(approval =>
    approval.status === "draft" && (approval.scopes || []).some(
      (item: Row) => item.project_scope_id === scope.id))) {
    return "有立项或变更草稿包含该需求；须先在草稿中移出并保存";
  }
  const latestApproved = approvals.filter(a => a.status === "approved")
    .sort((a, b) => Number(b.version_no) - Number(a.version_no))[0];
  if (latestApproved?.scopes?.some((item: Row) => item.project_scope_id === scope.id)) {
    return project.status === "closed"
      ? "项目已结项，最新版正式批准范围仍包含该需求，不能解绑"
      : "最新版正式批准范围仍包含该需求；须先在「批准与变更」中完成正式范围变更移出";
  }
  return "";
}
async function release(scope: Row) {
  const blocked = releaseBlockReason(scope);
  if (blocked) { ElMessage.warning(blocked); return; }
  try {
    await ElMessageBox.confirm(
      "明确解绑后，该需求可由其他项目承接。当前批准范围仍含此需求时，先正式变更移出或结项。",
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
function priceScope(scope: Row) {
  priceScopeContext.value = scope;
  quoteOpen.value = true;
}
function editCharge(charge: Row) {
  editingCharge.value = charge;
  form.value = {
    ...JSON.parse(charge.pricing_inputs_json),
    reference_price_catalog_id: charge.reference_price_catalog_id,
  };
  dialog.value = "charge";
  draftGuard.capture();
}
async function removeCharge(charge: Row) {
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
  try {
    await ElMessageBox.confirm(
      "删除后从正常项目列表移除，正式范围、费用、结算和证据历史继续保留。",
      "删除子项目",
    );
    await api(`/projects/${detail.value!.id}`, "DELETE", {
      expected_version: detail.value!.version,
    });
    await detailDialog.close();
    await load();
    ElMessage.success("项目已删除，可在包含已删除中查询");
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message);
  }
}
async function showHistory() {
  const id = detail.value!.id;
  const [records, approvals] = await Promise.all([
    api<Row>(`/projects/${id}/history`),
    api<Row[]>(`/projects/${id}/approval-history`),
  ]);
  if (detail.value?.id !== id) return;
  history.value = { ...records, approval_details: approvals };
}
let overviewSequence = 0;
async function loadOverview() {
  const id = detail.value?.id;
  if (!id) return;
  const sequence = ++overviewSequence;
  overviewLoading.value = true;
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
    if (sequence === overviewSequence) ElMessage.error((error as Error).message);
  } finally {
    if (sequence === overviewSequence) overviewLoading.value = false;
  }
}
function runWorkflowAction(item: ProjectAction) {
  if (!item.enabled || !detail.value) return;
  if (item.key === "stock") void action("stock");
  else if (item.key === "link") {
    tab.value = "scope"; void openDialog("link");
  } else if (item.key === "approval") {
    tab.value = "approval";
    if (!detail.value.approvals.some((approval: Row) => approval.status === "draft"))
      void openDialog("approval");
  } else if (item.key === "approve") {
    tab.value = "approval";
    const draft = detail.value.approvals.find((approval: Row) => approval.id === item.approval_id);
    if (draft) void action("approve", draft);
  } else if (item.key === "finance") tab.value = "finance";
  else if (item.key === "close") closeReviewOpen.value = true;
  else if (item.key === "history") {
    tab.value = "history";
    void showHistory();
  }
}
watch(() => detail.value, () => {
  if (detail.value?.id) void loadOverview();
});
watch(tab, value => {
  if (value === "history" && detail.value?.id && !history.value) void showHistory();
});
useListRoute({ q: query, page, deleted: showDeleted, sort: sortKey, direction: sortDirection, filters: columnFilters, tab }, load);
const detailDialog = useEntityDialog(detail, id => api('/projects/' + id + '?deleted=true'), () => { dialog.value = ''; history.value = null; quoteOpen.value = false; });
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
watch(() => route.query.project, (projectId) => {
  if (typeof projectId === "string" && projectId &&
      projectId !== detail.value?.id)
    void detailDialog.open(projectId);
}, { immediate: true });
onMounted(async () => {
  actors.value = await api("/actors");
  await load();
});
</script>
<template>
  <div class="page-heading">
      <div>
        <div class="section-caption">
          项目管理
        </div>
        <h1>子项目管理</h1>
        <p>
          按年度框架储备项目，执行协议可选；保留正式批准与结算历史。
        </p>
      </div>
      <div class="page-heading-actions">
        <ElButton
          :disabled="!can('write')"
          type="primary"
          data-guide-action="projects.create" @click="editProject()"
          >新增子项目</ElButton
        >
      </div>
    </div>
    <ElTabs v-model="listStatus" aria-label="按项目状态筛选">
      <ElTabPane name="" label="全部项目" />
      <ElTabPane v-for="state in projectStatuses" :key="state"
        :name="state" :label="state" />
    </ElTabs>
    <div class="panel">
      <div class="toolbar">
        <ElInput
          v-model="query"
          clearable
          placeholder="搜索项目编号或名称"
          @change="resetListPage"
        /><ElCheckbox data-guide-action="projects.show-deleted" v-model="showDeleted" @change="resetListPage"
          >包含已删除</ElCheckbox
        ><ElButton @click="load">刷新</ElButton>
      </div>
      <BusinessTable :search-active="!!query" @clear-search="query = ''; columnFilters = {}; page = 1; load()" :loading="listLoading" :rows="rows" :columns="projectColumns" table-key="project:list" :filter-state="columnFilters"
        :sort-state="{ prop: sortKey, order: sortKey ? (sortDirection === 'asc' ? 'ascending' : 'descending') : null }"
        @sort-change="sortTable" @filter-change="filterTable">
        <template #cell="{ row, column }">
          <ElTag v-if="column.key === 'display_status'" effect="plain"
            :type="row.display_status === '已批准' ? 'success' : row.display_status === '已结项' ? 'info' : ['立项中','变更中'].includes(row.display_status) ? 'warning' : undefined">{{ row.display_status }}</ElTag>
          <span v-else-if="column.key === 'approval'">{{ row.approval ? '¥' + money(row.approval.approved_budget_fen) : '尚未批准' }}</span>
          <span v-else-if="column.key === 'scopes'">{{ row.scopes?.filter((x: Row) => x.binding).length || 0 }}</span>
          <span v-else>{{ formatVisibleDateTime(row[column.key], column.key) ?? '—' }}</span>
        </template>
        <template #actions="{ row }">
          <ElButton size="small" @click="open(row)">进入项目</ElButton>
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
  <BusinessDetailDialog :open="detailOpen" title="子项目详情" :loading="detailLoading" :error="detailError"
    @close="detailDialog.close" @retry="detailDialog.reload">
    <template v-if="detail"><div class="detail-header">
      <h1>{{ detail.name }}</h1>
      <ElTag :type="detail.display_status === '已批准' ? 'success' : ['变更中','立项中'].includes(detail.display_status) ? 'warning' : undefined">{{ detail.display_status }}</ElTag
      ><ElTooltip :content="detail.code" placement="top">
         <span class="muted project-code">{{ detail.code }}</span>
       </ElTooltip>
    </div>
    <ProjectWorkflowHeader :display-status="detail.display_status" :deleted="!!detail.deleted"
      :loading="overviewLoading" :actions="projectActions" :can-write="can('write')"
      :can-admin="can('admin')" :can-delete="detail.status === 'closed' || (['reserve', 'stocked'].includes(detail.status) && !(detail.scopes || []).some((scope: Row) => scope.binding))" @action="runWorkflowAction"
      @manage="command => {
        if (command === 'edit') editProject(detail || undefined);
        if (command === 'history') { tab = 'history'; showHistory(); }
        if (command === 'delete') removeProject();
      }" />
    <ElTabs v-model="tab" class="project-workflow-tabs">
      <ElTabPane name="overview" label="项目概览" />
      <ElTabPane name="scope" label="需求与范围" />
      <ElTabPane name="approval" label="批准与变更" />
      <ElTabPane name="finance" label="费用与结算" />
      <ElTabPane name="history" label="完整历史" />
    </ElTabs>
    <ProjectOverview v-if="tab === 'overview' && overviewProject" :project="overviewProject"
      :summary="overviewSummary" :framework="overviewFramework"
      :agreement="overviewAgreement" :loading="overviewLoading"
      :can-write="can('write')" :description-columns="descriptionColumns"
      @section="tab = $event" @fund="(kind, id) => router.push(fundContext(kind, id))"
      @edit="editProject(detail || undefined)" />
    <template v-if="tab === 'scope'"
      ><div class="panel">
        <div class="toolbar">
          <h2>当前关联需求</h2>
          <ElButton data-guide-action="projects.link"
            :disabled="!can('write') || detail.deleted || detail.status === 'closed'"
            @click="openDialog('link')"
            >关联需求</ElButton
          >
        </div>
        <ElAlert v-if="(detail.scopes || []).some((scope: Row) =>
            scope.binding && releaseBlockReason(scope).includes('正式批准范围'))"
          type="info" :closable="false" show-icon
          title="当前正式批准范围内的需求不可直接解绑"
          :description="detail.status === 'closed' ? '项目已结项，最新版正式批准范围内的需求保持原承接关系及历史。' : '请先进入「批准与变更」，完成正式范围变更并移出该需求，再返回这里解绑。'" />
        <BusinessTable client-side table-key="project:scopes" :rows="detail.scopes || []"
          :columns="projectScopeColumns" :actions-width="135">
          <template #cell="{ row, column }">
            <ElTag v-if="column.key === 'binding'" :type="row.binding ? 'success' : 'info'" effect="plain">
              {{ row.binding ? '当前关联' : '已解绑' }}
            </ElTag>
            <template v-else-if="column.key === 'demand_no'">
              <ElButton link type="primary" @click="router.push(demandContext(row.demand_id))">{{ row.demand_no }}</ElButton>
              <ElTag v-if="row.demand_id === focusedDemandId" size="small" type="info">当前定位</ElTag>
            </template>
            <span v-else>{{ formatVisibleDateTime(row[column.key], column.key) ?? '—' }}</span>
          </template>
          <template #actions="{ row }">
            <RowActions :actions="[
              { label: '查看需求', run: () => router.push(demandContext(row.demand_id)) },
              { label: '显式解绑', danger: true, disabled: !!releaseBlockReason(row), reason: releaseBlockReason(row), run: () => release(row) },
            ]" />
          </template>
        </BusinessTable>
      </div>
    </template>
    <template v-if="tab === 'approval'">
      <div class="toolbar">
        <ElButton :data-guide-action="detail.approval ? 'projects.change' : 'projects.approval-draft'"
          type="primary"
          :disabled="
            !can('write') || detail.deleted || !['stocked', 'approved'].includes(detail.status) ||
            detail.approvals.some((approval: Row) => approval.status === 'draft')
          "
          :title="detail.approvals.some((approval: Row) => approval.status === 'draft') ? '已有待批准草稿，请先批准或删除草稿' : undefined"
          @click="openDialog('approval')"
          >{{ detail.approval ? "编制正式变更" : "编制立项范围" }}</ElButton
        ><ElButton :disabled="!can('write') || detail.deleted" @click="openDialog('charge')"
          >增加批次 / 项目参考费用</ElButton
        >
      </div>
      <div
        v-for="approval in detail.approvals"
        :key="approval.id"
        class="panel"
      >
        <div class="toolbar">
          <h2>第 {{ approval.version_no }} 次批准</h2>
          <ElTag>{{ statusText[approval.status] }}</ElTag
          ><ElButton data-guide-action="projects.approve"
            :disabled="
              detail.deleted || !can(
                approval.version_no === 1
                  ? 'project.approve'
                  : 'change.approve',
              )
            "
            v-if="approval.status === 'draft'"
            type="primary"
            @click="action('approve', approval)"
            >正式批准</ElButton
          ><ElButton data-guide-action="projects.approval-discard"
            :disabled="!can('write') || detail.deleted"
            v-if="approval.status === 'draft'"
            type="danger"
            @click="action('discard', approval)"
            >删除草稿</ElButton
          >
        </div>
        <ElDescriptions :column="descriptionColumns" border
          ><ElDescriptionsItem label="批准预算"
            >¥{{ money(approval.approved_budget_fen) }}</ElDescriptionsItem
          ><ElDescriptionsItem label="参考价格">{{
            approval.reference.complete
              ? "完整参考价 ¥" + money(approval.reference.total_fen)
              : "未完整计价，已计价小计 ¥" +
                money(approval.reference.subtotal_fen)
          }}</ElDescriptionsItem></ElDescriptions
        ><BusinessTable client-side table-key="project:approval-scopes" :rows="approval.scopes || []"
          :columns="projectApprovalColumns" :actions-width="170">
          <template #cell="{ row, column }">
            <span v-if="column.key === 'quantity_scaled'">{{ quantity(row.quantity_scaled) }}</span>
            <span v-else-if="column.key === 'locations'">{{ row.locations?.length || 0 }}</span>
            <span v-else>{{ formatVisibleDateTime(row[column.key], column.key) ?? '—' }}</span>
          </template>
          <template v-if="approval.status === 'draft'" #actions="{ row }">
            <ElButton data-guide-action="projects.quote" :disabled="!can('write')" size="small" @click="priceScope(row)">按承接范围核价</ElButton>
          </template>
        </BusinessTable>
        <BusinessTable v-if="approval.reference.charges.length" client-side
          table-key="project:approval-charges" :rows="approval.reference.charges"
          :columns="projectChargeColumns" :actions-width="190">
          <template #cell="{ row, column }">
            <span v-if="column.key === 'amount_fen'">¥{{ money(row.amount_fen) }}</span>
            <span v-else>{{ formatVisibleDateTime(row[column.key], column.key) ?? '—' }}</span>
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
    <ElAlert
      v-if="detail.deleted && tab === 'finance'"
      title="项目已归档删除，费用与结算记录可在档案历史中查询。"
      type="info"
      :closable="false"
    /><FinancePanel
      v-if="tab === 'finance' && !detail.deleted"
      :project="detail"
      :focus="route.query.focus === 'cost' || route.query.focus === 'settlement' || route.query.focus === 'reconciliation'
        ? { kind: route.query.focus, id: String(route.query.record || '') } : null"
      @changed="load"
    />
    <div v-if="tab === 'history'" class="panel">
      <div class="toolbar">
        <h2>完整正式历史</h2>
        <ElButton :loading="busy" @click="showHistory">刷新历史</ElButton>
      </div>
      <BusinessHistory v-if="history" :value="history" />
      <ElSkeleton v-else :rows="5" animated />
    </div>
  </template>
  </BusinessDetailDialog>
  <ProjectCloseReviewDialog v-model:open="closeReviewOpen"
    :approved-version="detail?.approval?.version_no" :summary="overviewSummary"
    :can-close="can('project.close')"
    @confirm="action('close', undefined, true)" />
  <ElDialog append-to-body
    :model-value="!!dialog"
    :title="
      {
        project: editing ? '修订项目档案' : '新增子项目',
        link: '关联专业需求',
        approval: '编制完整批准范围',
        charge: '批次 / 项目独立参考费用',
      }[dialog]
    "
    width="950px"
    :close-on-click-modal="false"
    :before-close="beforeEditorClose"
    @close="dialog = ''"
    ><ElForm ref="formRef" :model="form" label-position="top" novalidate>
      <ElAlert v-if="dialog === 'project' && handoffDemand" type="info" :closable="false"
        :title="'本次创建成功后将同时承接需求 ' + handoffDemand.demand_no + ' · ' + handoffDemand.problem_description" />
      <div class="form-grid">
        <template v-if="dialog === 'project'"
          ><ElFormItem
            label="项目名称"
            prop="name"
            :rules="[{ required: true, message: '请填写项目名称' }]"
            required
            ><ElInput v-model="form.name" /></ElFormItem
          ><ElFormItem
            label="年度框架"
            prop="framework_id"
            :rules="[{ required: true, message: '请填写年度框架' }]"
            required
            ><FieldControl
              v-model="form.framework_id"
              :field="{ type: 'ref', reference: 'frameworks' }"
              :disabled="!!editing && editing.status !== 'reserve'"
              @update:model-value="changeProjectFramework" /></ElFormItem
          ><ElFormItem label="执行协议（选填）">
            <ElSelect v-model="form.agreement_id" clearable filterable
              placeholder="直接归属年度框架（无需执行协议）"
              :disabled="!form.framework_id || agreementLoading || editing?.status === 'closed'"
              :loading="agreementLoading">
              <ElOption v-for="item in agreementChoices" :key="item.id"
                :value="item.id" :label="item.name + ' · ' + item.code"
                :disabled="!item.eligible" />
            </ElSelect>
            <p class="muted" style="font-size:12px;margin:6px 0 0">
              不选择执行协议，即直接归属所选年度框架；这是完整的项目归属方式，无需以后补选。
            </p>
          </ElFormItem>
          <ElAlert v-if="agreementError" class="full-width" type="error" :closable="false"
            :title="'执行协议读取失败：' + agreementError">
            <ElButton size="small" @click="loadProjectAgreements(String(form.framework_id || ''), String(form.agreement_id || '') || null)">重试</ElButton>
          </ElAlert>
          <ElAlert v-else-if="form.framework_id && !agreementLoading && !agreementChoices.some((item: Row) => item.eligible)"
            class="full-width" type="info" :closable="false"
            title="该框架下没有有效执行协议。子项目可以直接归属年度框架，无需创建或补选协议。" />
          <ElAlert v-else-if="projectAgreementInvalid" class="full-width" type="warning" :closable="false"
            title="所选执行协议已失效，请选择有效协议或清空关联。" />
          <ElFormItem label="项目类别"
            ><FieldControl
              v-model="form.category_id"
              :field="{ type: 'ref', reference: 'categories' }" /></ElFormItem
          ><ElFormItem label="归口单位"
            ><FieldControl
              v-model="form.managing_unit_id"
              :field="{
                type: 'ref',
                reference: 'organizations', adoptedLabel: form.managing_unit_name, adoptedVersionId: form.managing_unit_version_id,
              }" /></ElFormItem
          ><ElFormItem label="初步估算（元）"
            ><FieldControl
              v-model="form.preliminary_estimate_fen"
              :field="{ type: 'money' }" /></ElFormItem
          ><ElFormItem label="计划开始"
            ><ElDatePicker
              v-model="form.planned_start_on"
              value-format="YYYY-MM-DD" /></ElFormItem
          ><ElFormItem label="计划结束"
            ><ElDatePicker
              v-model="form.planned_end_on"
              value-format="YYYY-MM-DD" /></ElFormItem
          ><ElFormItem label="责任人"
            ><ElSelect
              v-model="form.owner_id"
              clearable
              filterable
              @clear="form.owner_id = null"
              ><ElOption
                v-for="actor in actors"
                :key="actor.id"
                :value="actor.id"
                :label="actor.username" /></ElSelect></ElFormItem
          ><ElFormItem label="管理人员"
            ><ElSelect
              v-model="form.manager_id"
              clearable
              filterable
              @clear="form.manager_id = null"
              ><ElOption
                v-for="actor in actors"
                :key="actor.id"
                :value="actor.id"
                :label="actor.username" /></ElSelect></ElFormItem
        ></template>
        <template v-if="dialog === 'link'"
          ><ElFormItem
            label="专业需求"
            prop="demand_id"
            :rules="[{ required: true, message: '请填写专业需求' }]"
            required
            class="full-width"
            ><ElSelect
              v-model="form.demand_id"
              filterable
              remote
              :remote-method="searchDemands"
              :loading="demandLoading"
              ><ElOption
                v-for="d in demands"
                :key="d.id"
                :value="d.id"
                :label="
                  (d.status === 'active' ? '待承接 · ' : '待确认（仅储备） · ') +
                  d.demand_no + ' · ' + d.problem_description
                " /></ElSelect>
                <div class="toolbar">
                  <ElCheckbox data-guide-action="projects.include-pending" v-model="showPendingDemands" @change="changePendingDemandFilter">包含待确认需求（确认有效后才能立项）</ElCheckbox>
                  <span class="muted">符合条件 {{ demandTotal }} 条</span>
                  <ElButton v-if="demandPage * 50 < demandTotal" size="small"
                    :loading="demandLoading" @click="moreDemandCandidates">
                    继续加载
                  </ElButton>
                </div>
                <ElAlert v-if="form.demand_id && demands.find((d: Row) => d.id === form.demand_id)?.status !== 'active'"
                  :closable="false" type="warning"
                  title="当前需求尚未确认有效，可以先关联项目储备，但不能正式批准立项。" />
                </ElFormItem
        ></template>
        <template v-if="dialog === 'approval'"
          ><ElFormItem
            label="批准预算（元）"
            prop="approved_budget_fen"
            :rules="[{ required: true, message: '请填写批准预算（元）' }]"
            required
            ><FieldControl
              v-model="form.approved_budget_fen"
              :field="{ type: 'money' }" /></ElFormItem
          ><ElFormItem label="批准依据"
            ><ElInput v-model="form.basis" /></ElFormItem
        ></template>
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
      <template v-if="dialog === 'approval'"
        ><div
          v-for="scope in approvalRows"
          :key="scope.project_scope_id"
          class="panel"
        >
          <ElCheckbox v-model="scope.selected" :disabled="scope.demand_status !== 'active'">
            {{ scope.demand_no }}
            {{ scope.demand_status !== 'active' ? ' · 需求待确认，暂不可纳入批准' : '' }}
          </ElCheckbox
          ><BusinessTable :table-key="'project:approval-editor:' + scope.project_scope_id"
            :rows="scope.locations" :columns="approvalEditorColumns"
            sort-mode="off" filter-mode="off" compact>
            <template #cell="{ row, column }">
              <ElCheckbox v-if="column.key === 'selected'" v-model="row.selected" />
              <FieldControl v-else-if="column.key === 'approved_quantity_scaled'"
                v-model="row.approved_quantity_scaled"
                :field="{ type: 'quantity', quantityPrecision: scope.quantity_precision }"
                @validity-change="approvalQuantityInvalid('location.' + scope.project_scope_id + '.' + row.location_item_no, $event)" />
              <span v-else>{{ formatVisibleDateTime(row[column.key], column.key) ?? '—' }}</span>
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
          <ElButton data-guide-action="projects.material-add" @click="scope.materials.push({ quantity_scaled: 10000 })"
            >添加批准物资</ElButton
          >
        </div></template
      ></ElForm
    ><template #footer
      ><ElButton @click="closeEditor">取消</ElButton
      ><ElButton data-guide-action="projects.save"
        :disabled="!can('write') || (dialog === 'project' &&
          !!form.agreement_id && (agreementLoading || !!agreementError || projectAgreementInvalid))"
        type="primary"
        :loading="busy"
        @click="save"
        >保存</ElButton
      ></template
    ></ElDialog
  >
  <ElDialog append-to-body
    :model-value="!!history"
    title="项目正式历史"
    width="950px"
    @close="history = null"
  >
    <BusinessHistory :value="history" />
  </ElDialog>
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

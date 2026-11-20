<script setup lang="ts">
import { settlementProgressText } from "../../shared/utils/settlement-progress";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useRoute, useRouter } from "vue-router";
import { fundContext, projectContext, projectFinanceContext } from "../../shared/navigation/business-context";
import { api, money, statusText } from "../../shared/api/client";
import type { FundingKind, FundingRecord, FundingProject } from "../../../../server/shared/types/funding";
import { useListRoute } from "../../shared/composables/use-list-route";
import { useDialogDraftGuard } from "../../shared/forms/use-dialog-draft";
import { useAccess } from "../../shared/composables/use-access";
import BusinessTable, { type TableColumn } from "../../shared/ui/BusinessTable.vue";
import FieldControl from "../../shared/ui/FieldControl.vue";
import BusinessDetailDialog from "../../shared/ui/BusinessDetailDialog.vue";
import BusinessHistory from "../../shared/ui/BusinessHistory.vue";

const props = defineProps<{ kind: FundingKind }>();
const route = useRoute(), router = useRouter();
const can = useAccess();
const isAgreement = computed(() => props.kind === "agreements");
const title = computed(() => isAgreement.value ? "执行协议" : "年度框架");
const introduction = computed(() => isAgreement.value
  ? "管理执行协议额度、生效期间及关联子项目；预算占用差额仅供参考。"
  : "统筹年度框架下直接归属及经执行协议关联的子项目，统一核对预算和真实费用。");
type FundingDraft = {
  name: string; fiscal_year: number; framework_id: string | null;
  limit_fen: number; status: "active" | "inactive";
  contract_number: string; counterparty_name: string;
  signed_on: string | null; effective_from: string | null; effective_to: string | null;
  reason: string;
};
type FundingDetails = {
  item: FundingRecord;
  projects: (FundingProject & { settlement_progress_percent: number | null })[];
  agreements: FundingRecord[];
  summary: { project_count: number; approved_budget_fen: number;
    actual_cost_fen: number; settlement_fen: number; capacity_difference_fen: number;
    settlement_progress_percent: number | null; projects_without_cost_basis: number };
};
function emptyDraft(): FundingDraft {
  return {
    name: "", fiscal_year: new Date().getFullYear(), framework_id: null,
    limit_fen: 0, status: "active", contract_number: "", counterparty_name: "",
    signed_on: null, effective_from: null, effective_to: null, reason: "",
  };
}
const draft = ref<FundingDraft>(emptyDraft());
const amountYuan = computed({
  get: () => draft.value.limit_fen / 100,
  set: (value: number | undefined) => { draft.value.limit_fen = Math.round((value || 0) * 100); },
});
const rows = ref<FundingRecord[]>([]);
const total = ref(0), page = ref(1), query = ref(""), sort = ref(""), direction = ref("");
const filters = ref<Record<string, string>>({}), deleted = ref(false), loading = ref(false);
const saving = ref(false), editing = ref<FundingRecord | null>(null), editorOpen = ref(false);
const editorRef = ref(), errors = ref<Record<string, string>>({});
const selectedId = ref(""), details = ref<FundingDetails | null>(null);
const detailsOpen = ref(false), detailsLoading = ref(false), detailsError = ref("");
const history = ref<unknown>(null);

const linkedAgreementColumns: TableColumn[] = [
  { key: "name", label: "协议名称", minWidth: 175 },
  { key: "contract_number", label: "合同编号", minWidth: 155 },
  { key: "limit_fen", label: "协议额度", minWidth: 155 },
  { key: "status", label: "状态", minWidth: 110 },
];
const linkedProjectColumns = computed<TableColumn[]>(() => [
  { key: "name", label: "子项目名称", minWidth: 220 },
  ...(!isAgreement.value
    ? [{ key: "agreement_id", label: "归属方式", minWidth: 172, sortable: false, filterable: false }]
    : []),
  { key: "display_status", label: "项目状态", minWidth: 135 },
  { key: "approved_budget_fen", label: "批准预算", minWidth: 155 },
  { key: "actual_cost_fen", label: "真实费用", minWidth: 155 },
  { key: "settlement_fen", label: "已批准结算", minWidth: 155 },
  { key: "settlement_progress_percent", label: "结算进度", minWidth: 155 },
]);
const columns = computed<TableColumn[]>(() => isAgreement.value ? [
  { key: "name", label: "协议名称", minWidth: 190 },
  { key: "framework_id_label", label: "所属年度框架", minWidth: 200 },
  { key: "contract_number", label: "合同编号", minWidth: 170 },
  { key: "limit_fen", label: "协议额度", minWidth: 150 },
  { key: "effective_from", label: "生效日期", minWidth: 136 },
  { key: "effective_to", label: "截止日期", minWidth: 136 },
  { key: "status", label: "状态", minWidth: 96 },
] : [
  { key: "name", label: "框架名称", minWidth: 210 },
  { key: "fiscal_year", label: "年度", minWidth: 105 },
  { key: "limit_fen", label: "框架额度", minWidth: 160 },
  { key: "status", label: "状态", minWidth: 110 },
]);
function relatedAgreementCell(row: FundingRecord, column: TableColumn): string {
  if (column.key === "limit_fen") return amountText(row.limit_fen);
  if (column.key === "status") return row.deleted ? "已删除" : statusText[row.status] || row.status;
  return String(row[column.key as keyof FundingRecord] ?? "—");
}
function relatedProjectCell(row: FundingDetails["projects"][number], column: TableColumn): string {
  if (column.key === "settlement_progress_percent") return settlementProgressText(row.settlement_progress_percent);
  if (column.key === "approved_budget_fen" || column.key === "actual_cost_fen" || column.key === "settlement_fen")
    return amountText(row[column.key]);
  if (column.key === "display_status") return row.display_status;
  if (column.key === "agreement_id")
    return row.agreement_id ? "通过执行协议" : "直接归属年度框架";
  return String(row[column.key as keyof FundingProject] ?? "—");
}
const amountText = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : "¥" + money(value);
function cell(row: FundingRecord, column: TableColumn) {
  if (column.key === "limit_fen") return amountText(row.limit_fen);
  if (column.key === "status") return statusText[row.status] || row.status;
  const value = row[column.key as keyof FundingRecord];
  return value === null || value === undefined || value === "" ? "—" : String(value);
}
let loadSequence = 0;
async function load() {
  const sequence = ++loadSequence;
  loading.value = true;
  try {
    const params = new URLSearchParams({
      page: String(page.value), q: query.value, deleted: String(deleted.value),
      sort: sort.value || "created_at", direction: direction.value || "desc",
      filters: JSON.stringify(filters.value),
    });
    const result = await api<{ items: FundingRecord[]; total: number }>(
      `/funding/${props.kind}?${params}`);
    if (sequence !== loadSequence) return;
    rows.value = result.items; total.value = result.total;
  } catch (error) {
    if (sequence === loadSequence) ElMessage.error((error as Error).message);
  } finally {
    if (sequence === loadSequence) loading.value = false;
  }
}
useListRoute({ q: query, page, deleted, sort, direction, filters }, load);
function changeSort(value: { key: string; order: string }) {
  sort.value = value.key;
  direction.value = value.order === "ascending" ? "asc" : "desc";
  page.value = 1;
  void load();
}
function changeFilters(value: Record<string, string>) {
  filters.value = value; page.value = 1; void load();
}
const guard = useDialogDraftGuard(() => draft.value);
function startEdit(row?: FundingRecord) {
  editing.value = row || null;
  errors.value = {};
  draft.value = {
    ...emptyDraft(),
    ...(row && {
      name: row.name, fiscal_year: row.fiscal_year ?? new Date().getFullYear(),
      framework_id: row.framework_id ?? null, limit_fen: row.limit_fen,
      status: row.status, contract_number: row.contract_number ?? "",
      counterparty_name: row.counterparty_name ?? "",
      signed_on: row.signed_on ?? null, effective_from: row.effective_from ?? null,
      effective_to: row.effective_to ?? null,
    }),
  };
  editorOpen.value = true; guard.capture();
}
function closeEditor() { void guard.confirmClose(() => { editorOpen.value = false; }); }
function beforeEditorClose(done: () => void) { void guard.confirmClose(done); }
async function save() {
  if (saving.value) return;
  saving.value = true;
  try {
    const valid = await editorRef.value?.validate().catch(() => false);
    if (!valid) {
      await nextTick();
      (editorRef.value?.$el as HTMLElement | undefined)
        ?.querySelector<HTMLElement>(".el-form-item.is-error input")?.focus();
      return;
    }
    await api(`/funding/${props.kind}${editing.value ? "/" + editing.value.id : ""}`,
      "POST", { ...draft.value, expected_version: editing.value?.version_no });
    await load();
    if (detailsOpen.value && editing.value?.id === selectedId.value) await refreshDetails();
    editorOpen.value = false;
    ElMessage.success(title.value + "正式版本已保存");
  } catch (error) {
    const fields = (error as { fields?: Record<string, string | string[]> }).fields || {};
    errors.value = Object.fromEntries(Object.entries(fields).map(([key, value]) =>
      [key, Array.isArray(value) ? value.join("；") : value]));
    ElMessage.error((error as Error).message);
  } finally {
    saving.value = false;
  }
}
async function remove(row: FundingRecord) {
  try {
    const impact = await api<{ expected_version: number; projects: FundingProject[]; agreements: FundingRecord[]; reference_ids: string[] }>(
      `/funding/${props.kind}/${row.id}/deletion-impact`);
    const label = (items: { name: string }[]) => items.length
      ? ` ${items.length} 项（${items.slice(0, 5).map(item => item.name).join("、")}${items.length > 5 ? "等" : ""}）` : " 0 项";
    await ElMessageBox.confirm(
      "关联子项目" + label(impact.projects) + "，关联执行协议" + label(impact.agreements) +
        "。删除后停止新增关联，保留现有业务和历史。",
      "确认删除" + title.value, { type: "warning" },
    );
    await api(`/funding/${props.kind}/${row.id}`, "DELETE",
      { expected_version: impact.expected_version, expected_references: impact.reference_ids });
    await load();
    if (detailsOpen.value && selectedId.value === row.id) await refreshDetails();
    ElMessage.success("已保留历史并从可选业务移除");
  } catch (error) {
    if (error instanceof Error && error.name !== "Cancel") ElMessage.error(error.message);
  }
}
async function refreshDetails() {
  const id = selectedId.value;
  detailsLoading.value = true; detailsError.value = "";
  try {
    const result = await api<FundingDetails>(`/funding/${props.kind}/${id}?detail=true`);
    if (selectedId.value === id) details.value = result;
  } catch (error) {
    if (selectedId.value === id) detailsError.value = (error as Error).message;
  } finally {
    if (selectedId.value === id) detailsLoading.value = false;
  }
}
function openDetails(row: FundingRecord) {
  selectedId.value = row.id; details.value = null; history.value = null;
  detailsOpen.value = true; void refreshDetails();
}
async function showHistory(row: FundingRecord) {
  if (selectedId.value !== row.id || !detailsOpen.value) openDetails(row);
  try {
    history.value = await api(`/funding/${props.kind}/history/${row.id}`);
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
}
watch([() => props.kind, () => route.query.record], ([, record]) => {
  if (typeof record === "string" && record)
    openDetails({ id: record } as FundingRecord);
}, { immediate: true, flush: "post" });
watch(() => props.kind, () => {
  rows.value = []; detailsOpen.value = false;
  page.value = 1; query.value = ""; sort.value = ""; filters.value = {};
  void load();
});
onMounted(() => void load());
</script>

<template>
  <div class="page-heading">
    <div>
      <h1>{{ title }}</h1>
      <p>{{ introduction }}</p>
    </div>

  </div>
  <div class="panel">

    <BusinessTable detail-column="name" :detail-guide-action="isAgreement ? undefined : 'frameworks.detail'" @open-detail="openDetails" :rows="rows" :columns="columns" :table-key="'funding:' + kind"
      :loading="loading" :actions-width="170" :search-active="!!query"
      :filter-state="filters"
      :sort-state="{ prop: sort, order: sort ? (direction === 'asc' ? 'ascending' : 'descending') : null }"
      @sort-change="changeSort" @filter-change="changeFilters"
      @clear-search="query = ''; filters = {}; page = 1; load()">
      <template #toolbar="{ openSettings, clearFilters, hasActiveFilters }">
        <div class="unified-list-tools">
          <div class="toolbar">
            <ElInput v-model="query" clearable
        :placeholder="isAgreement ? '搜索协议名称、合同编号或合同对方' : '搜索框架名称或年度'"
        @change="page = 1; load()" @keyup.enter="page = 1; load()" />
            <ElPopover trigger="click" placement="bottom-start">
              <template #reference><ElButton>筛选</ElButton></template>
              <ElCheckbox :data-guide-action="isAgreement ? 'agreements.show-deleted' : 'frameworks.show-deleted'" v-model="deleted" @change="page = 1; load()">包含已删除</ElCheckbox>
            </ElPopover>
            <ElButton v-if="hasActiveFilters" link type="primary" @click="clearFilters">清除检索与列筛选</ElButton>
          </div>
          <div class="toolbar page-heading-actions">
      <ElButton :loading="loading" @click="load">刷新</ElButton>
      <ElButton class="business-column-setting-trigger" @click="openSettings">列设置</ElButton>
      <ElButton :data-guide-action="isAgreement ? 'agreements.create' : 'frameworks.create'" type="primary" v-if="can('write')" @click="startEdit()">新增{{ title }}</ElButton>
    </div>
        </div>
      </template>
      <template #cell="{ row, column }">
        <ElTag v-if="column.key === 'status'"
          :type="row.deleted ? 'danger' : row.status === 'active' ? 'success' : 'info'"
          effect="plain">{{ row.deleted ? "已删除" : cell(row, column) }}</ElTag>
        <span v-else>{{ cell(row, column) }}</span>
      </template>

    </BusinessTable>
    <ElPagination v-model:current-page="page" :page-size="30" :total="total"
      layout="prev, pager, next, total" @current-change="load" />
  </div>

  <BusinessDetailDialog :open="detailsOpen" :title="title + '详情'"
    :loading="detailsLoading" :error="detailsError"
    @close="detailsOpen = false" @retry="refreshDetails">
    <template v-if="details">
      <div class="detail-header">
        <h1>{{ details.item.name }}</h1>
        <ElTag :type="details.item.deleted ? 'danger' :
          details.item.status === 'active' ? 'success' : 'info'">
          {{ details.item.deleted ? "已删除" : statusText[details.item.status] || details.item.status }}
        </ElTag>
      </div>
      <div class="toolbar">
        <ElButton :data-guide-action="isAgreement ? 'agreements.edit' : 'frameworks.edit'" v-if="can('write') && !details.item.deleted" @click="startEdit(details.item)">编辑</ElButton>
        <ElButton :data-guide-action="isAgreement ? 'agreements.history' : 'frameworks.history'" @click="showHistory(details.item)">完整历史</ElButton>
        <ElButton v-if="can('admin') && !details.item.deleted" type="danger" plain @click="remove(details.item)">删除{{ title }}</ElButton>
      </div>
      <div class="panel">
        <h2>资金概览</h2>
        <div class="funding-summary">
          <div><span>正式额度</span><strong>{{ amountText(details.item.limit_fen) }}</strong></div>
          <div><span>关联子项目</span><strong>{{ details.summary.project_count }}</strong></div>
          <div><span>批准预算合计</span><strong>{{ amountText(details.summary.approved_budget_fen) }}</strong></div>
          <div><span>真实费用合计</span><strong>{{ amountText(details.summary.actual_cost_fen) }}</strong></div>
          <div><span>已批准结算合计</span><strong>{{ amountText(details.summary.settlement_fen) }}</strong></div>
          <div><span>有基数项目结算进度</span><strong>{{ settlementProgressText(details.summary.settlement_progress_percent) }}</strong></div>
          <div><span>待核定费用基数</span><strong>{{ details.summary.projects_without_cost_basis }} 个项目</strong></div>
        </div>
        <p class="funding-caption">额度减关联项目批准预算：
          <strong>{{ amountText(details.summary.capacity_difference_fen) }}</strong>。
          差额仅作资金参考，不是实际费用或结算上限。</p>
      </div>
      <div class="panel">
        <h2>{{ isAgreement ? '协议基本信息' : '框架基本信息' }}</h2>
        <ElDescriptions :column="2" border>
          <ElDescriptionsItem v-if="!isAgreement" label="年度">{{ details.item.fiscal_year }}</ElDescriptionsItem>
          <ElDescriptionsItem v-if="isAgreement" label="所属年度框架">{{ details.item.framework_id_label }}</ElDescriptionsItem>
          <ElDescriptionsItem v-if="isAgreement" label="合同编号">{{ details.item.contract_number || '—' }}</ElDescriptionsItem>
          <ElDescriptionsItem v-if="isAgreement" label="合同对方">{{ details.item.counterparty_name || '—' }}</ElDescriptionsItem>
          <ElDescriptionsItem v-if="isAgreement" label="签订日期">{{ details.item.signed_on || '—' }}</ElDescriptionsItem>
          <ElDescriptionsItem v-if="isAgreement" label="生效日期">{{ details.item.effective_from || '—' }}</ElDescriptionsItem>
          <ElDescriptionsItem v-if="isAgreement" label="截止日期">{{ details.item.effective_to || '—' }}</ElDescriptionsItem>
          <ElDescriptionsItem label="正式版本">第{{ details.item.version_no }}版</ElDescriptionsItem>
        </ElDescriptions>
      </div>
      <div v-if="!isAgreement" class="panel">
        <h2>关联执行协议（{{ details.agreements.length }}）</h2>
        <BusinessTable client-side detail-column="name" @open-detail="row => router.push(fundContext('agreements', row.id))" table-key="funding:linked-agreements" :rows="details.agreements"
          :columns="linkedAgreementColumns" :actions-width="110">
          <template #cell="{ row, column }">
            {{ relatedAgreementCell(row, column) }}
          </template>
        </BusinessTable>
      </div>
      <div class="panel">
        <h2>关联子项目（{{ details.projects.length }}）</h2>
        <BusinessTable client-side detail-column="name" detail-guide-action="agreements.projects"
          @open-detail="row => router.push(projectContext(row.id, 'overview', { focus: 'funding', record: details!.item.id }))"
          table-key="funding:linked-projects" :rows="details.projects"
          :columns="linkedProjectColumns" :actions-width="110">
          <template #cell="{ row, column }">
            {{ relatedProjectCell(row, column) }}
          </template>
          <template #actions="{ row }">
            <ElButton link type="primary" @click="router.push(projectFinanceContext(row.id, router.resolve(fundContext(props.kind, details!.item.id)).fullPath))">费用与结算</ElButton>
          </template>
        </BusinessTable>
        <ElEmpty v-if="!details.projects.length" description="暂无关联子项目" :image-size="56" />
      </div>
      <div v-if="history" class="panel">
        <h2>正式版本与审计历史</h2>
        <BusinessHistory :value="history" />
      </div>
    </template>
  </BusinessDetailDialog>

  <ElDialog v-model="editorOpen" append-to-body :title="(editing ? '编辑' : '新增') + title"
    width="min(760px, 94vw)" :before-close="beforeEditorClose" :close-on-click-modal="false">
    <ElForm ref="editorRef" :model="draft" label-position="top" novalidate @submit.prevent="save">
      <div class="form-grid">
        <ElFormItem :label="isAgreement ? '协议名称' : '框架名称'" prop="name"
          :error="errors.name" :rules="[{ required: true, message: '请填写名称', trigger: 'blur' }]">
          <ElInput v-model="draft.name" maxlength="120" show-word-limit />
        </ElFormItem>
        <ElFormItem v-if="!isAgreement" label="年度" prop="fiscal_year"
          :error="errors.fiscal_year" :rules="[{ required: true, message: '请选择年度' }]">
          <ElInputNumber v-model="draft.fiscal_year" :disabled="!!editing"
            :min="2000" :max="2100" controls-position="right" />
        </ElFormItem>
        <ElFormItem v-if="isAgreement" label="所属年度框架" prop="framework_id"
          :error="errors.framework_id" :rules="[{ required: true, message: '请选择所属年度框架' }]">
          <FieldControl v-model="draft.framework_id"
            :field="{ key: 'framework_id', label: '年度框架', type: 'ref', reference: 'frameworks' }"
            :disabled="!!editing" :selected-label="editing?.framework_id_label" />
        </ElFormItem>
        <ElFormItem :label="isAgreement ? '协议额度（元）' : '框架额度（元）'" prop="limit_fen"
          :error="errors.limit_fen" :rules="[{ required: true, message: '请填写额度' }]">
          <ElInputNumber v-model="amountYuan" :min="0" :precision="2"
            :step="1000" controls-position="right" />
        </ElFormItem>
        <ElFormItem label="状态" prop="status" :error="errors.status">
          <ElSelect v-model="draft.status">
            <ElOption label="启用" value="active" />
            <ElOption label="停用" value="inactive" />
          </ElSelect>
        </ElFormItem>
        <template v-if="isAgreement">
          <ElFormItem label="合同编号"><ElInput v-model="draft.contract_number" /></ElFormItem>
          <ElFormItem label="合同对方"><ElInput v-model="draft.counterparty_name" /></ElFormItem>
          <ElFormItem label="签订日期">
            <ElDatePicker v-model="draft.signed_on" type="date"
              value-format="YYYY-MM-DD" clearable />
          </ElFormItem>
          <ElFormItem label="生效日期">
            <ElDatePicker v-model="draft.effective_from" type="date"
              value-format="YYYY-MM-DD" clearable />
          </ElFormItem>
          <ElFormItem label="截止日期" :error="errors.effective_to">
            <ElDatePicker v-model="draft.effective_to" type="date"
              value-format="YYYY-MM-DD" clearable />
          </ElFormItem>
        </template>
        <ElFormItem label="变更说明" class="full-width">
          <ElInput v-model="draft.reason" type="textarea" :rows="2"
            placeholder="可记录正式额度、期限或状态变更的依据" />
        </ElFormItem>
      </div>
    </ElForm>
    <template #footer>
      <ElButton @click="closeEditor">取消</ElButton>
      <ElButton :data-guide-action="isAgreement ? 'agreements.save' : 'frameworks.save'" type="primary" :disabled="!can('write')"
        :loading="saving" @click="save">保存正式版本</ElButton>
    </template>
  </ElDialog>
</template>
<style scoped>
.funding-summary {display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:16px 0}
.funding-summary > div {border:1px solid var(--edge);border-radius:12px;padding:16px;min-width:0}
.funding-summary span {display:block;font-size:12px;color:var(--muted);margin-bottom:8px}
.funding-summary strong {font-size:19px;font-weight:650;overflow-wrap:anywhere;color:var(--ink)}
.funding-caption {font-size:13px;color:var(--muted);margin:4px 0 0}
@media (max-width:1000px) {.funding-summary {grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:520px) {.funding-summary {grid-template-columns:1fr}}
</style>

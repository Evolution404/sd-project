<script setup lang="ts">
import { computed, inject, onUnmounted, ref, shallowRef } from "vue";
import { ElMessage, ElMessageBox, type UploadFile } from "element-plus";
import type {
  AssetExchangeKind, WorkbookKind, ExchangePreviewDocument, ExchangeCommitResult, WorkbookIssue,
  ExchangeMode, ExchangePreview,
} from "../../../../server/shared/types/exchange";
import { issueDetails } from "../../../../server/shared/exchange-display";
import { api, download } from "../../shared/api/client";
import { useAccess } from "../../shared/composables/use-access";
import { guideCenterKey } from "../../guides/core/guide-center";
import { newClientId } from "../../shared/utils/id";
import { fieldName, factText, visibleFact } from "../../shared/utils/display";
import { formatBeijingDateTime } from "../../shared/utils/datetime";
import BusinessTable, { type TableColumn } from "../../shared/ui/BusinessTable.vue";
import { downloadExport } from "./download-export";

const props = defineProps<{
  kind: WorkbookKind;
  selectedIds?: readonly string[];
  appliedQuery?: string;
  total?: number;
  assetKind?: AssetExchangeKind;
  projectId?: string;
  blockedReason?: string;
}>();
const emit = defineEmits<{ changed: []; inspect: [id: string, kind?: AssetExchangeKind] }>();
const can = useAccess();
const openGuide = inject(guideCenterKey, null);
const canImport = computed(() => !props.blockedReason && can(props.kind === "assets" ? "admin" : "write"));
const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const selection = computed(() => props.selectedIds !== undefined);
const count = computed(() => selection.value ? props.selectedIds?.length ?? 0 : props.total);
const scope = computed(() => selection.value ? `已选 ${count.value} 条`
  : `当前筛选（全部页）共 ${count.value ?? 0} 条`);

type PreparedFile = {
  file: File; preview: ExchangePreview; requestKey: string; mode: ExchangeMode; atomic: boolean;
};
const open = ref(false);
const intent = ref<"import" | "edit">("import");
const file = shallowRef<File>();
const previousFile = shallowRef<PreparedFile>();
const preview = shallowRef<ExchangePreview>();
const result = shallowRef<ExchangeCommitResult>();
const reopened = ref(false);
const requestKey = ref("");
const advanced = ref(false);
const mode = ref<ExchangeMode>("mixed");
const atomic = ref(true);
const showChanges = ref(false);
const phase = ref<"" | "checking" | "saving">("");
const busy = computed(() => phase.value !== "");
const error = ref("");
let controller: AbortController | undefined;

const issuePage = ref(1);
const diffPage = ref(1);
const diffFilters = ref<Record<string, string>>({});
const diffSort = ref({ key: "", order: "" });
const issues = computed(() => result.value?.issues ?? preview.value?.issues ?? []);
const correctionAvailable = computed(() => !result.value?.results.some(row => !row.sheet || !row.row));
const issueRows = computed(() => issues.value.slice((issuePage.value - 1) * 30, issuePage.value * 30));
const issueColumns: TableColumn[] = [
  { key: "position", label: "位置", minWidth: 160 }, { key: "field", label: "字段", minWidth: 116 },
  { key: "reason", label: "问题", minWidth: 210 }, { key: "suggestion", label: "修改建议", minWidth: 210 },
  { key: "raw_value", label: "输入值", minWidth: 135 },
];
const documentColumns: TableColumn[] = [
  { key: "number", label: "业务记录", minWidth: 165 },
  { key: "action", label: "改动", minWidth: 95, filterable: false, sortable: false },
  { key: "changes", label: "内容", minWidth: 310, filterable: false, sortable: false },
];
function reference(row: ExchangePreviewDocument) {
  if (props.kind === "settlements" && row.action === "create")
    return `${row.sheet} · 第 ${row.row} 行`;
  return row.number;
}
const filteredChanges = computed(() => {
  const value = (diffFilters.value.number ?? "").trim().toLocaleLowerCase("zh-CN");
  const rows = (preview.value?.documents ?? []).filter(row => reference(row).toLocaleLowerCase("zh-CN").includes(value));
  if (diffSort.value.key === "number") rows.sort((left, right) =>
    reference(left).localeCompare(reference(right), "zh-CN", { numeric: true }) *
    (diffSort.value.order === "ascending" ? 1 : -1));
  return rows;
});
const changeRows = computed(() => filteredChanges.value.slice((diffPage.value - 1) * 30, diffPage.value * 30));
const settlementRepeatAllowed = computed(() => reopened.value && props.kind === "settlements" &&
  !!result.value?.results.length && !issues.value.length && result.value.results.every(row => row.action === "create"));
const saveLabel = computed(() => props.kind === "settlements" ? "保存结算草稿"
  : `保存 ${preview.value?.documents.length ?? 0} 条${props.kind === "demands" ? "需求" : "台账"}`);
const uploadLabel = computed(() => preview.value || error.value ? "重新上传" : "选择 Excel 文件");
const importHint = computed(() => props.kind === "settlements"
  ? "只填本次金额即可保存草稿。批准后计入项目已结金额。"
  : props.kind === "assets" ? "下载模板，填写本次需要录入的设备表，然后上传检查。"
    : "下载模板，填写需求和对应的作业位置，然后上传检查。");

function start(next: "import" | "edit") {
  if (!canImport.value) return;
  intent.value = next;
  file.value = undefined; preview.value = undefined; result.value = undefined;
  reopened.value = false; advanced.value = false; error.value = "";
  mode.value = next === "edit" ? "update" : "mixed";
  atomic.value = true;
  resetDetails();
  open.value = true;
}
function resetDetails() {
  showChanges.value = false;
  issuePage.value = 1; diffPage.value = 1; diffFilters.value = {};
  diffSort.value = { key: "", order: "" };
}
function remember() {
  if (file.value && preview.value && !result.value)
    previousFile.value = { file: file.value, preview: preview.value, requestKey: requestKey.value,
      mode: mode.value, atomic: atomic.value };
}
function resume() {
  const saved = previousFile.value;
  if (!saved) return;
  file.value = saved.file; preview.value = saved.preview; requestKey.value = saved.requestKey;
  mode.value = saved.mode; atomic.value = saved.atomic; error.value = "";
  previousFile.value = undefined;
}
function workbookContext(query = new URLSearchParams()) {
  if (props.projectId) query.set("project_id", props.projectId);
  if (props.assetKind) query.set("asset_kind", props.assetKind);
  return query;
}
async function getFile(path: string, filename?: string, options?: RequestInit) {
  try { await download(path, filename, options); }
  catch (failure) { ElMessage.error((failure as Error).message); }
}
async function downloadEdit() {
  const query = workbookContext(new URLSearchParams(selection.value ? "" : props.appliedQuery));
  query.delete("page");
  try { await downloadExport(`/exchange/${props.kind}/export?${query}`, props.selectedIds); }
  catch (failure) { ElMessage.error((failure as Error).message); }
}
async function check(raw: File, newSettlement = false) {
  if (!canImport.value || busy.value) return;
  previousFile.value = undefined;
  phase.value = "checking";
  file.value = raw;
  preview.value = undefined; result.value = undefined;
  reopened.value = false; error.value = "";
  resetDetails();
  controller = new AbortController();
  const query = workbookContext(new URLSearchParams({ mode: mode.value }));
  if (newSettlement) query.set("new_settlement", "true");
  try {
    const response = await fetch(`/api/exchange/${props.kind}/preview?${query}`, {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": mime },
      body: raw, signal: controller.signal,
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.message);
    const checked = value as ExchangePreview;
    preview.value = checked;
    result.value = checked.previous;
    reopened.value = !!checked.previous;
    requestKey.value = newClientId();
  } catch (failure) {
    error.value = (failure as Error).name === "AbortError" ? "已取消检查，可以重新选择文件。" : (failure as Error).message;
  } finally {
    controller = undefined; phase.value = "";
  }
}
function chooseFile(entry: UploadFile) {
  if (entry.raw) void check(entry.raw);
}
async function importNextSettlement() {
  if (!file.value || !settlementRepeatAllowed.value) return;
  try {
    await ElMessageBox.confirm("系统会新增一期结算草稿。请核对这笔金额属于另一期结算。",
      "作为新一期结算", { type: "warning", confirmButtonText: "检查新一期", cancelButtonText: "取消" });
  } catch { return; }
  await check(file.value, true);
}
async function commit() {
  const checked = preview.value;
  if (!checked?.documents.length || !canImport.value || busy.value || result.value ||
      (atomic.value && checked.issues.length)) return;
  phase.value = "saving"; error.value = "";
  try {
    result.value = await api<ExchangeCommitResult>(`/exchange/${checked.token}/commit`, "POST", {
      request_key: requestKey.value, atomic: atomic.value,
    });
    previousFile.value = undefined; issuePage.value = 1;
    emit("changed");
  } catch (failure) { error.value = (failure as Error).message; }
  finally { phase.value = ""; }
}
function correctedCopy() {
  if (!preview.value || !file.value) return;
  return getFile(`/exchange/${preview.value.token}/correction`, undefined, {
    method: "POST", headers: { "Content-Type": mime }, body: file.value,
  });
}
onUnmounted(() => controller?.abort());
function position(issue: WorkbookIssue) {
  return issue.sheet + (issue.row ? ` · 第 ${issue.row} 行` : "");
}
</script>

<template>
  <template v-if="canImport">
    <ElButton v-if="!selection" data-guide-action="excel.import" @click="start('import')">导入 Excel</ElButton>
    <ElButton v-if="count && count <= 5000 && appliedQuery !== ''" @click="start('edit')">用 Excel 批量修改</ElButton>
  </template>
  <ElDialog append-to-body v-model="open" :title="intent === 'edit' ? '用 Excel 批量修改' : '导入 Excel'"
    width="min(960px, 94vw)" :close-on-click-modal="false" :close-on-press-escape="!busy"
    :show-close="!busy" @close="remember">
    <template #header>
      <div class="exchange-heading">
        <strong>{{ intent === "edit" ? "用 Excel 批量修改" : "导入 Excel" }}</strong>
        <ElButton v-if="openGuide" data-guide-modal-help size="small" text @click="openGuide">使用指引</ElButton>
      </div>
    </template>

    <ElAlert v-if="phase === 'checking'" title="正在检查文件" type="info" :closable="false" show-icon />
    <ElAlert v-if="phase === 'saving'" title="正在保存，请稍候" type="info" :closable="false" show-icon />
    <ElAlert v-if="error" :title="error" type="error" :closable="false" show-icon />

    <template v-if="!file">
      <p>{{ intent === "edit" ? scope + "。下载后修改需要更新的内容，再上传检查。" : importHint }}</p>
      <div class="toolbar">
        <ElButton v-if="intent === 'import'" data-guide-action="excel.template"
          @click="getFile('/exchange/' + kind + '/template?' + workbookContext())">下载模板</ElButton>
        <ElButton v-else :data-guide-action="selection ? 'excel.export-selected' : 'excel.export-filtered'"
          @click="downloadEdit">下载要修改的记录</ElButton>
        <ElButton v-if="previousFile" link type="primary" @click="resume">继续检查 {{ previousFile.file.name }}</ElButton>
      </div>
    </template>
    <p v-else class="current-file">文件 <strong>{{ file.name }}</strong></p>

    <template v-if="preview && !result">
      <ElAlert type="info" :closable="false"
        :title="`新增 ${preview.summary.created} 条，修改 ${preview.summary.updated} 条，${preview.summary.invalid_documents || issues.length} 条需处理`" />
      <p v-if="preview.summary.unchanged" class="muted">{{ preview.summary.unchanged }} 条无需修改。</p>
      <ElButton v-if="preview.documents.length" link type="primary" :aria-expanded="showChanges"
        @click="showChanges = !showChanges">{{ showChanges ? "收起改动" : "查看改动" }}</ElButton>
      <BusinessTable v-if="showChanges" :key="requestKey" :rows="changeRows" :columns="documentColumns"
        :table-key="'exchange:' + kind + ':changes'" filter-mode="remote" sort-mode="remote" :max-height="320" compact
        @filter-change="diffFilters = $event; diffPage = 1" @sort-change="diffSort = $event; diffPage = 1">
        <template #cell="{ row, column }">
          <span v-if="column.key === 'number'">{{ reference(row) }}</span>
          <span v-else-if="column.key === 'action'">{{ row.action === "create" ? "新增" : row.action === "update" ? "修改" : "保持原值" }}</span>
          <div v-else>
            <p v-for="change in row.changes.filter(item => visibleFact(item.field))" :key="change.field" class="change">
              <strong>{{ fieldName(change.field) }}</strong> {{ factText(change.before, change.field) }} → {{ factText(change.after, change.field) }}
            </p>
          </div>
        </template>
      </BusinessTable>
      <ElPagination v-if="showChanges && filteredChanges.length > 30" v-model:current-page="diffPage"
        :total="filteredChanges.length" :page-size="30" layout="prev,pager,next,total" />
    </template>

    <template v-if="result">
      <ElAlert :type="issues.length ? 'warning' : 'success'" :closable="false" show-icon
        :title="reopened ? '此文件已经导入，以下为上次结果' : `已处理 ${result.results.length} 条`"
        :description="reopened ? formatBeijingDateTime(result.submitted_at) : issues.length ? '还有记录需要处理，下载待处理记录后继续。' : undefined"
        />
      <BusinessTable v-if="result.results.length" :rows="result.results"
        :columns="[{key:'number',label:'业务记录'}, {key:'action',label:'处理结果'}]"
        :table-key="'exchange:results:' + kind" hide-toolbar sort-mode="off" filter-mode="off" :max-height="260">
        <template #cell="{row,column}">
          <ElButton v-if="column.key === 'number'" link type="primary" class="cell-link"
            @click="open = false; emit('inspect', row.id, row.entity_kind)">{{ row.number }}</ElButton>
          <span v-else>{{ row.action === "create" ? "已新增" : row.action === "update" ? "已更新" : "保持原值" }}</span>
        </template>
      </BusinessTable>
      <ElButton data-guide-action="excel.result" @click="getFile('/exchange/' + preview!.token + '/results')">下载导入结果</ElButton>
      <ElButton v-if="settlementRepeatAllowed && canImport" @click="importNextSettlement">作为新一期结算</ElButton>
    </template>

    <section v-if="issues.length && preview" class="exchange-issues" aria-label="需要处理">
      <div class="toolbar">
        <h3>需要处理</h3>
        <ElButton v-if="correctionAvailable" type="primary" plain @click="correctedCopy">
          {{ result ? "下载待处理记录" : "下载标出错误的原表" }}
        </ElButton>
        <ElButton data-guide-action="excel.issues" @click="getFile('/exchange/' + preview.token + '/errors')">下载问题清单</ElButton>
      </div>
      <p v-if="!correctionAvailable" class="muted">请按问题清单，在新表中只填写待处理记录。</p>
      <BusinessTable :rows="issueRows" :columns="issueColumns" :max-height="320" hide-toolbar
        :table-key="'exchange:' + kind + ':issues'" sort-mode="off" filter-mode="off" compact>
        <template #cell="{ row, column }">
          <span v-if="column.key === 'position'">{{ position(row) }}</span>
          <span v-else-if="column.key === 'field'">{{ issueDetails(row).label }}</span>
          <span v-else-if="column.key === 'raw_value'">{{ issueDetails(row).value }}</span>
          <span v-else-if="column.key === 'suggestion'">{{ issueDetails(row).suggestion }}</span>
          <span v-else>{{ row.reason }}</span>
        </template>
      </BusinessTable>
      <ElPagination v-if="issues.length > 30" v-model:current-page="issuePage"
        :total="issues.length" :page-size="30" layout="prev,pager,next,total" />
    </section>

    <div v-if="canImport && (!result || issues.length)" class="toolbar exchange-upload">
      <ElUpload :disabled="busy" accept=".xlsx" :auto-upload="false" :show-file-list="false"
        :on-change="chooseFile" :data-guide-action="preview || error ? 'excel.retry' : 'excel.preview'">
        <span class="upload-label">{{ uploadLabel }}</span>
      </ElUpload>
      <ElButton v-if="phase === 'checking'" data-guide-action="excel.cancel-preview" @click="controller?.abort()">取消检查</ElButton>
      <ElButton v-if="!busy && !result" text :aria-expanded="advanced" @click="advanced = !advanced">导入选项</ElButton>
    </div>
    <ElForm v-if="advanced && !busy && !result" label-position="top" novalidate>
      <ElFormItem v-if="!preview" label="允许修改的记录">
        <ElSelect v-model="mode" aria-label="允许修改的记录" style="max-width: 240px">
          <ElOption value="mixed" label="允许新增和修改" />
          <ElOption value="create" label="只新增记录" />
          <ElOption value="update" label="只修改已有记录" />
        </ElSelect>
      </ElFormItem>
      <ElCheckbox v-if="preview" :data-guide-action="atomic ? 'excel.atomic' : 'excel.partial'" v-model="atomic">
        有问题时，整批暂不保存
      </ElCheckbox>
    </ElForm>
    <template #footer>
      <ElButton :disabled="busy" @click="open = false">{{ result ? "完成" : "关闭" }}</ElButton>
      <ElButton v-if="preview && !result" data-guide-action="excel.commit" type="primary"
        :disabled="!preview.documents.length || !canImport || (atomic && !!issues.length)"
        :loading="phase === 'saving'" @click="commit">{{ saveLabel }}</ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
.exchange-heading, .exchange-upload { display: flex; align-items: center; gap: 10px; }
.exchange-upload { margin: 14px 0 5px; }
.current-file { overflow-wrap: anywhere; margin: 10px 0; }
.exchange-issues { margin-top: 14px; }
.change { margin: 0; }
.upload-label {
  display: inline-flex;
  align-items: center;
  padding: 7px 14px;
  border: 1px solid var(--el-color-primary);
  border-radius: var(--el-border-radius-base);
  color: var(--el-color-primary);
  font-weight: 600;
}
:deep(.el-upload:focus-visible .upload-label), :deep(.el-upload:hover .upload-label) {
  background: var(--el-color-primary-light-9);
  outline: 1px solid var(--el-color-primary);
}
</style>

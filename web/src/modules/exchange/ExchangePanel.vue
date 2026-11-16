<script setup lang="ts">
import { useAccess } from "../../shared/composables/use-access";
const can = useAccess();
import { ref, computed, inject, onUnmounted } from "vue";
import { guideCenterKey } from "../../guides/core/guide-center";
const openGuide = inject(guideCenterKey, null);
import { ElMessage, type UploadFile } from "element-plus";
import type { ExchangePreviewDocument, ExchangeCommitResult, WorkbookIssue, ExchangeMode } from "../../../../server/shared/types/exchange";
import { api, download } from "../../shared/api/client";
import { newClientId } from "../../shared/utils/id";
import { fieldName, factText, visibleFact } from "../../shared/utils/display";
import BusinessTable, { type TableColumn } from "../../shared/ui/BusinessTable.vue";
const props = defineProps<{
  kind: "demands" | "settlements" | "assets";
  selectedIds?: string[];
  query?: string;
  projectId?: string;
  readonly?: boolean;
}>();
interface ExchangePreviewResponse {
  token: string;
  documents: ExchangePreviewDocument[];
  issues: WorkbookIssue[];
  timings_ms: { parse: number; total: number };
  summary: {
    documents: number;
    invalid_documents: number;
    duplicate_issues: number;
    created: number;
    updated: number;
    unchanged: number;
    conflicts: number;
    missing_devices:number;
    ambiguous_locations:number;
    format_errors:number;
    precision_errors:number;
  };
}
type ExchangeDisplayRow = ExchangePreviewDocument | WorkbookIssue;
function rowField(row: ExchangeDisplayRow, key: string): unknown {
  return Object.entries(row).find(([field]) => field === key)?.[1];
}
const emit = defineEmits<{changed:[];inspect:[id:string]}>();
const exchangeSections=ref(["template","upload"]);
const dialog = ref(false),
  mode = ref<ExchangeMode>("mixed"),
  atomic = ref(props.kind === "assets"),
  preview = ref<ExchangePreviewResponse | null>(null),
  busy = ref(false),
  result = ref<ExchangeCommitResult | null>(null),
  requestKey = ref("");
const phase = ref(""),
  elapsedSeconds = ref(0),
  canCancelPreview = ref(false);
let timer: number | undefined;
let phaseStarted = 0;
let previewController: AbortController | null = null;
function beginPhase(title: string) {
  busy.value = true;
  phase.value = title;
  elapsedSeconds.value = 0;
  phaseStarted = performance.now();
  if (timer !== undefined) window.clearInterval(timer);
  timer = window.setInterval(() => {
    elapsedSeconds.value = Math.floor(
      (performance.now() - phaseStarted) / 1000,
    );
  }, 500);
}
function endPhase() {
  busy.value = false;
  phase.value = "";
  canCancelPreview.value = false;
  if (timer !== undefined) window.clearInterval(timer);
  timer = undefined;
}
function cancelPreview() {
  previewController?.abort();
}
onUnmounted(() => {
  previewController?.abort();
  if (timer !== undefined) window.clearInterval(timer);
});
const documentPage = ref(1),
  issuePage = ref(1),
  activePreviewTab = ref<'documents' | 'issues'>('documents');
const documentColumns: TableColumn[] = [
  { key: "number", label: props.kind === "demands" ? "导入关联号" : "业务编号", minWidth: 155 },
  { key: "action", label: "动作", minWidth: 105 },
  { key: "expectedResult", label: "预计结果", minWidth: 150, sortable: false, filterable: false },
  { key: "changes", label: "逐字段变化", minWidth: 335, sortable: false, filterable: false },
];
const issueColumns: TableColumn[] = [
  {key:"import_ref",label:"导入关联号",minWidth:135},
  {key:"demand_no",label:"正式需求编号",minWidth:155},
  {key:"location_ref",label:"位置关联号",minWidth:130},
  { key: "sheet", label: "工作表", minWidth: 120 },
  { key: "row", label: "行号", minWidth: 95 },
  { key: "field", label: "字段", minWidth: 155, sortable: false, filterable: false },
  { key: "raw_value", label: "原始值", minWidth: 175, sortable: false, filterable: false },
  { key: "reason", label: "问题", minWidth: 220 },
  { key: "suggestion", label: "建议", minWidth: 220 },
];
const documentFilters = ref<Record<string, string>>({}),
  issueFilters = ref<Record<string, string>>({}),
  documentSort = ref({ key: "", order: "" }),
  issueSort = ref({ key: "", order: "" });
function filteredSorted<T extends ExchangeDisplayRow>(items: T[], filters: Record<string, string>, sort: { key: string; order: string }): T[] {
  const active = Object.entries(filters).filter(([, value]) => value.trim());
  const result = items.filter(item => active.every(([key, value]) =>
    String(rowField(item, key) ?? "").toLocaleLowerCase("zh-CN")
      .includes(value.trim().toLocaleLowerCase("zh-CN"))));
  if (sort.key && sort.order) result.sort((left, right) => {
    const a = rowField(left, sort.key);
    const b = rowField(right, sort.key);
    const diff = typeof a === "number" && typeof b === "number"
      ? a - b : String(a ?? "").localeCompare(String(b ?? ""), "zh-CN", { numeric: true });
    return sort.order === "ascending" ? diff : -diff;
  });
  return result;
}
const allDocuments = computed<ExchangePreviewDocument[]>(() => preview.value?.documents || []);
const allIssues = computed<WorkbookIssue[]>(() => result.value?.issues || preview.value?.issues || []);
const filteredDocuments = computed(() =>
  filteredSorted(allDocuments.value, documentFilters.value, documentSort.value));
const filteredIssues = computed(() =>
  filteredSorted(allIssues.value, issueFilters.value, issueSort.value));
const displayedDocuments = computed(() => filteredDocuments.value.slice((documentPage.value - 1) * 30, documentPage.value * 30));
const displayedIssues = computed(() => filteredIssues.value.slice((issuePage.value - 1) * 30, issuePage.value * 30));
function onDocumentsSort(value: { key: string; order: string }) {
  documentSort.value = value;
  documentPage.value = 1;
}
function onIssuesSort(value: { key: string; order: string }) {
  issueSort.value = value;
  issuePage.value = 1;
}
function onDocumentsFilter(value: Record<string, string>) {
  documentFilters.value = value;
  documentPage.value = 1;
}
function onIssuesFilter(value: Record<string, string>) {
  issueFilters.value = value;
  issuePage.value = 1;
}
function predictedResult(row: ExchangePreviewDocument) {
  if (row.action === "unchanged") return "保持原值";
  if (props.kind === "assets") return "保存完整台账";
  if (props.kind === "settlements") return "保存结算草稿";
  const previous = row.payload.expected_version;
  return "需求第 " + ((typeof previous === "number" ? previous : 0) + 1) + " 版";
}
async function exportFile(report = false, selected = false) {
  const query = new URLSearchParams({
    q: props.query || "",
    report: String(report),
    ...(props.projectId ? { project_id: props.projectId } : {}),
  });
  if (selected)
    for (const id of props.selectedIds || []) query.append("id", id);
  await download(
    `/exchange/${props.kind}/export?${query}`,
  );
}
async function upload(file: UploadFile) {
  beginPhase("正在上传和预检 Excel 数据");
  previewController = new AbortController();
  canCancelPreview.value = true;
  preview.value = null;
  result.value = null;
  documentPage.value = 1;
  activePreviewTab.value = 'documents';
  issuePage.value = 1;
  documentFilters.value = {};
  issueFilters.value = {};
  documentSort.value = { key: "", order: "" };
  issueSort.value = { key: "", order: "" };
  try {
    const response = await fetch(
      `/api/exchange/${props.kind}/preview?mode=${mode.value}&project_id=${props.projectId || ""}`,
      {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
        body: file.raw,
        signal: previewController.signal,
      },
    );
    const value = await response.json();
    if (!response.ok) throw new Error(value.message);
    preview.value = value as ExchangePreviewResponse;
    exchangeSections.value=["preview"];
    requestKey.value = newClientId();
    // Show errors immediately instead of leaving them hidden behind the first tab.
    activePreviewTab.value = value.issues?.length ? 'issues' : 'documents';
  } catch (e) {
    if ((e as Error).name === "AbortError")
      ElMessage.info("已取消上传或预检请求；不会提交业务数据");
    else ElMessage.error((e as Error).message);
  } finally {
    previewController = null;
    endPhase();
  }
}
async function commit() {
  beginPhase("正在原子提交业务单据");
  try {
    result.value = await api<ExchangeCommitResult>(
      `/exchange/${preview.value!.token}/commit`,
      "POST",
      { request_key: requestKey.value, atomic: atomic.value },
    );
    exchangeSections.value=["result"];
    ElMessage.success("导入结果已保存");
    emit("changed");
  } catch (e) {
    ElMessage.error((e as Error).message);
  } finally {
    endPhase();
  }
}
</script>
<template>
  <ElButton data-guide-action="excel.import" @click="dialog = true">Excel 批量处理</ElButton>
  <ElDialog append-to-body
    v-model="dialog"
    :title="kind === 'assets' ? '设备台账 Excel（线路／物理杆塔／逻辑杆塔／档距）' : 'Excel 数据交换'"
    width="1060px"
    :close-on-click-modal="false"
    :close-on-press-escape="!busy"
    :show-close="!busy"
  >
    <template #header>
      <div class="exchange-guide-heading">
        <strong>{{ kind === 'assets' ? "设备台账 Excel（线路／物理杆塔／逻辑杆塔／档距）" : 'Excel 数据交换' }}</strong>
        <ElButton v-if="openGuide" data-guide-modal-help size="small" text @click="openGuide">使用指引</ElButton>
      </div>
    </template>
    <ElAlert
      v-if="busy"
      :title="phase + ' · ' + elapsedSeconds + ' 秒'"
      :description="
        canCancelPreview
          ? '预检尚未写入正式业务数据，可以取消当前请求。'
          : '正在提交完整业务单据。为保护原子性，提交期间不可中断；完成后将显示实际结果。'
      "
      type="info"
      :closable="false"
      show-icon
    />
    <ElButton data-guide-action="excel.cancel-preview"
      v-if="busy && canCancelPreview"
      type="warning"
      @click="cancelPreview"
      >取消预检</ElButton
    >
    <ElCollapse v-model="exchangeSections">
    <ElCollapseItem title="下载模板与维护导出" name="template">
    <div class="toolbar">
      <ElButton data-guide-action="excel.template"
        @click="
          download(
            `/exchange/${kind}/template?project_id=${projectId || ''}`,
          )
        "
        >空白模板</ElButton
      ><ElButton data-guide-action="excel.export-filtered" @click="exportFile()">筛选结果维护导出</ElButton
      ><ElButton data-guide-action="excel.export-selected"
        :disabled="!selectedIds?.length"
        @click="exportFile(false, true)"
        >勾选项维护导出</ElButton
      ><ElButton @click="exportFile(true)">业务报表</ElButton>
    </div>
    </ElCollapseItem>
    <ElCollapseItem title="上传并预检" name="upload">
    <ElAlert
      :title="
        kind === 'assets'
          ? '统一工作簿包含线路、物理杆塔、逻辑杆塔、档距。普通新建杆塔只填逻辑杆塔表；独立实物维护使用物理杆塔表。系统按真实关联与依赖顺序办理。'
          : kind === 'settlements'
            ? '导入仅保存结算草稿，提交与审核需分别确认。金额与本次新增解决量独立填写。'
            : '需求更新生成新的正式内容版本。缺少位置或物资行保持原值，删除须明确标记。'
      "
      type="info"
      :closable="false"
    />
    <div class="toolbar" style="margin-top: 18px">
      <ElSelect v-model="mode" style="width: 180px"
        ><ElOption label="仅新增" value="create" /><ElOption
          label="仅更新"
          value="update" /><ElOption
          label="混合新增与更新"
          value="mixed" /></ElSelect
      ><ElUpload
        :disabled="readonly || !can('write') || busy"
        accept=".xlsx"
        :auto-upload="false"
        :show-file-list="false"
        :on-change="upload"
        ><ElButton :data-guide-action="preview?.issues.length ? 'excel.retry' : 'excel.preview'" :disabled="readonly || !can('write')" type="primary" :loading="busy"
          >上传并预检</ElButton
        ></ElUpload
      >
    </div>
    </ElCollapseItem>
    <ElCollapseItem title="查看差异并确认提交" name="preview">
    <template v-if="preview"
      ><ElCheckbox :data-guide-action="atomic ? 'excel.atomic' : 'excel.partial'" v-model="atomic" :disabled="busy">整个批次全部成功或全部回滚</ElCheckbox><div class="toolbar">
        <ElTag>共 {{ preview.summary.documents }} 张单据</ElTag
        ><ElTag type="success">有效 {{ preview.documents.length }}</ElTag
        ><ElTag type="danger"
          >无效 {{ preview.summary.invalid_documents }}</ElTag
        ><ElTag type="warning"
          >重复 {{ preview.summary.duplicate_issues }} / 版本冲突
          {{ preview.summary.conflicts }}</ElTag
        ><ElTag>新增 {{ preview.summary.created }}</ElTag
        ><ElTag>更新 {{ preview.summary.updated }}</ElTag
        ><ElTag type="info">无变化 {{ preview.summary.unchanged }}</ElTag
        ><ElTag type="danger">缺失设备 {{preview.summary.missing_devices||0}} / 位置歧义 {{preview.summary.ambiguous_locations||0}} / 格式 {{preview.summary.format_errors||0}} / 精度 {{preview.summary.precision_errors||0}}</ElTag
        ><ElTag type="danger">问题 {{ preview.issues.length }}</ElTag
        ><ElButton data-guide-action="excel.issues"
          @click="
            download(`/exchange/${preview.token}/errors`, '导入问题.xlsx')
          "
          >下载问题清单</ElButton
        >
      </div>
      <ElTabs v-model="activePreviewTab"
        ><ElTabPane label="单据与逐字段变化" name="documents"
          ><BusinessTable :key="requestKey + ':documents'" :table-key="'exchange:' + kind + ':documents'"
              :rows="displayedDocuments" :columns="documentColumns" :max-height="380" compact
              sort-mode="remote" filter-mode="remote"
              @sort-change="onDocumentsSort" @filter-change="onDocumentsFilter">
              <template #cell="{ row, column }">
                <span v-if="column.key === 'action'">{{ row.action === 'create' ? '新增' : row.action === 'update' ? '修改' : '保持原值' }}</span>
                <span v-else-if="column.key === 'expectedResult'">{{ predictedResult(row) }}</span>
                <div v-else-if="column.key === 'changes'">
                  <div v-for="change in (row.changes || []).filter((item: {field:string}) => visibleFact(item.field))" :key="change.field">
                    <strong>{{ fieldName(change.field) }}</strong>
                    {{ factText(change.before, change.field) }} → {{ factText(change.after, change.field) }}
                  </div>
                </div>
                <span v-else>{{ rowField(row, column.key) ?? '—' }}</span>
              </template>
            </BusinessTable><ElPagination
            v-model:current-page="documentPage"
            :total="filteredDocuments.length"
            :page-size="30"
            layout="prev,pager,next,total"
          /> </ElTabPane
        ><ElTabPane label="问题清单" name="issues"
          ><BusinessTable :key="requestKey + ':issues'" :table-key="'exchange:' + kind + ':issues'"
              :rows="displayedIssues" :columns="issueColumns" :max-height="380" compact
              sort-mode="remote" filter-mode="remote"
              @sort-change="onIssuesSort" @filter-change="onIssuesFilter">
              <template #cell="{ row, column }">
                <span v-if="column.key === 'field'">{{ fieldName(row.field) }}</span>
                <span v-else-if="column.key === 'raw_value'">{{ factText(row.raw_value, row.field) }}</span>
                <span v-else>{{ rowField(row, column.key) ?? '—' }}</span>
              </template>
            </BusinessTable><ElPagination
            v-model:current-page="issuePage"
            :total="filteredIssues.length"
            :page-size="30"
            layout="prev,pager,next,total" /></ElTabPane></ElTabs
    ></template>
    </ElCollapseItem>
    <ElCollapseItem title="下载结果与回查" name="result">
    <ElAlert
      v-if="result"
      class="error-banner"
      :title="`已处理 ${result.results.length} 张单据，失败 ${result.issues.length} 项`"
      :type="result.issues.length ? 'warning' : 'success'"
      :closable="false"
    />
    <p v-if="preview" class="muted">
      解析 {{ (preview.timings_ms.parse / 1000).toFixed(2) }} 秒 · 预检共
      {{ (preview.timings_ms.total / 1000).toFixed(2) }} 秒<span v-if="result">
        · 正式校验 {{ (result.timings_ms.revalidation / 1000).toFixed(2) }} 秒 ·
        逐单据写入
        {{ (result.timings_ms.business_writes / 1000).toFixed(2) }} 秒</span
      >
    </p>
    <ElButton data-guide-action="excel.result"
      v-if="result"
      @click="download(`/exchange/${preview!.token}/results`, '导入结果.xlsx')"
      >下载导入结果</ElButton
    >
    <BusinessTable v-if="result && kind === 'demands'" :rows="result.results" :columns="[{key:'import_ref',label:'导入关联号'},{key:'number',label:'正式需求编号'},{key:'action',label:'处理结果'}]"
      table-key="exchange:demand-results" client-side :max-height="300" :actions-width="120">
      <template #cell="{row,column}">{{column.key==='import_ref'?row.import_ref:column.key==='number'?row.number:row.action==='create'?'已新增':row.action==='update'?'已更新':'保持原值'}}</template>
      <template #actions="{row}"><ElButton size="small" @click="dialog=false;emit('inspect',row.id)">查看需求</ElButton></template>
    </BusinessTable>
    </ElCollapseItem></ElCollapse>
    <template #footer
      ><ElButton :disabled="busy" @click="dialog = false">关闭</ElButton
      ><ElButton data-guide-action="excel.commit"
        type="primary"
        :disabled="
          readonly || !can('write') ||
          !preview ||
          !!result ||
          (atomic && preview.issues.length > 0)
        "
        :loading="busy"
        @click="commit"
        >确认提交有效单据</ElButton
      ></template
    >
  </ElDialog>
</template>

<style scoped>
.exchange-guide-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-right:30px}
.exchange-guide-heading strong{font-weight:600;font-size:16px}
</style>

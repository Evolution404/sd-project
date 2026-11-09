<script setup lang="ts">
import { useAccess } from "../services/access";
const can = useAccess();
import { ref, computed, onUnmounted } from "vue";
import { ElMessage } from "element-plus";
import { api, download, type Row } from "../services/api";
import { newClientId } from "../services/id";
import { fieldName, factText, visibleFact } from "../services/display";
const props = defineProps<{
  kind: "demands" | "settlements" | "assets";
  selectedIds?: string[];
  query?: string;
  projectId?: string;
}>();
const emit = defineEmits(["changed"]);
const dialog = ref(false),
  mode = ref("mixed"),
  atomic = ref(false),
  preview = ref<Row | null>(null),
  busy = ref(false),
  result = ref<Row | null>(null),
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
  issuePage = ref(1);
const displayedDocuments = computed(
  () =>
    preview.value?.documents.slice(
      (documentPage.value - 1) * 30,
      documentPage.value * 30,
    ) || [],
);
const allIssues = computed(
  () => result.value?.issues || preview.value?.issues || [],
);
const displayedIssues = computed(() =>
  allIssues.value.slice((issuePage.value - 1) * 30, issuePage.value * 30),
);
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
    `${props.kind}-${report ? "报表" : "数据维护"}.xlsx`,
  );
}
async function upload(file: Row) {
  beginPhase("正在上传和预检 Excel 数据");
  previewController = new AbortController();
  canCancelPreview.value = true;
  preview.value = null;
  result.value = null;
  documentPage.value = 1;
  issuePage.value = 1;
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
    preview.value = value;
    requestKey.value = newClientId();
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
    result.value = await api(
      `/exchange/${preview.value!.token}/commit`,
      "POST",
      { request_key: requestKey.value, atomic: atomic.value },
    );
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
  <ElButton @click="dialog = true">Excel 批量处理</ElButton>
  <ElDialog
    v-model="dialog"
    title="Excel 数据交换"
    width="1060px"
    :close-on-click-modal="false"
    :close-on-press-escape="!busy"
    :show-close="!busy"
  >
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
    <ElButton
      v-if="busy && canCancelPreview"
      type="warning"
      @click="cancelPreview"
      >取消预检</ElButton
    >
    <div class="toolbar">
      <ElButton
        @click="
          download(
            `/exchange/${kind}/template?project_id=${projectId || ''}`,
            `${kind}-模板.xlsx`,
          )
        "
        >空白模板</ElButton
      ><ElButton @click="exportFile()">筛选结果维护导出</ElButton
      ><ElButton
        :disabled="!selectedIds?.length"
        @click="exportFile(false, true)"
        >勾选项维护导出</ElButton
      ><ElButton @click="exportFile(true)">业务报表</ElButton>
    </div>
    <ElAlert
      :title="
        kind === 'assets'
          ? '线路与杆塔仅填写真实业务属性。共塔须明确指向已有回路，歧义记录需核对后提交。'
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
        :disabled="!can('write') || busy"
        accept=".xlsx"
        :auto-upload="false"
        :show-file-list="false"
        :on-change="upload"
        ><ElButton :disabled="!can('write')" type="primary" :loading="busy"
          >上传并预检</ElButton
        ></ElUpload
      ><ElCheckbox v-model="atomic" :disabled="busy"
        >整个批次全部成功或全部回滚</ElCheckbox
      >
    </div>
    <template v-if="preview"
      ><div class="toolbar">
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
        ><ElTag type="danger">问题 {{ preview.issues.length }}</ElTag
        ><ElButton
          @click="
            download(`/exchange/${preview.token}/errors`, '导入问题.xlsx')
          "
          >下载问题清单</ElButton
        >
      </div>
      <ElTabs
        ><ElTabPane label="单据与逐字段变化"
          ><ElTable :data="displayedDocuments" max-height="380"
            ><ElTableColumn
              prop="number"
              label="业务编号"
              width="140"
            /><ElTableColumn label="动作" width="100"
              ><template #default="{ row }">{{
                row.action === "create"
                  ? "新增"
                  : row.action === "update"
                    ? "修改"
                    : "保持原值"
              }}</template></ElTableColumn
            ><ElTableColumn label="预计结果" width="120"
              ><template #default="{ row }">{{
                row.action === "unchanged"
                  ? "保持原值"
                  : kind === "assets"
                    ? "保存完整台账"
                    : kind === "settlements"
                      ? "保存结算草稿"
                      : "需求 V" + ((row.payload.expected_version || 0) + 1)
              }}</template></ElTableColumn
            ><ElTableColumn label="变化"
              ><template #default="{ row }"
                ><div
                  v-for="change in row.changes.filter((item: Row) =>
                    visibleFact(item.field),
                  )"
                  :key="change.field"
                >
                  <strong>{{ fieldName(change.field) }}</strong>
                  {{ factText(change.before, change.field) }} →
                  {{ factText(change.after, change.field) }}
                </div></template
              ></ElTableColumn
            ></ElTable
          ><ElPagination
            v-model:current-page="documentPage"
            :total="preview.documents.length"
            :page-size="30"
            layout="prev,pager,next,total"
          /> </ElTabPane
        ><ElTabPane label="问题清单"
          ><ElTable :data="displayedIssues" max-height="380"
            ><ElTableColumn prop="sheet" label="工作表" /><ElTableColumn
              prop="row"
              label="行号"
              width="70" /><ElTableColumn label="字段"
              ><template #default="{ row }">{{
                fieldName(row.field)
              }}</template></ElTableColumn
            ><ElTableColumn prop="raw_value" label="原始值" min-width="180"
              ><template #default="{ row }">{{
                factText(row.raw_value, row.field)
              }}</template></ElTableColumn
            ><ElTableColumn
              prop="reason"
              label="问题"
              min-width="220" /><ElTableColumn
              prop="suggestion"
              label="建议" /></ElTable
          ><ElPagination
            v-model:current-page="issuePage"
            :total="allIssues.length"
            :page-size="30"
            layout="prev,pager,next,total" /></ElTabPane></ElTabs
    ></template>
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
    <ElButton
      v-if="result"
      @click="download(`/exchange/${preview!.token}/results`, '导入结果.xlsx')"
      >下载导入结果</ElButton
    >
    <template #footer
      ><ElButton :disabled="busy" @click="dialog = false">关闭</ElButton
      ><ElButton
        type="primary"
        :disabled="
          !can('write') ||
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

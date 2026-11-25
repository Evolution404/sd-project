<template>
  <el-dialog
    :model-value="true"
    title="导入 Excel"
    append-to-body
    align-center
    class="business-exchange-dialog"
    width="min(95vw, 1020px)"
    :close-on-click-modal="false"
    :show-close="!busy"
    :close-on-press-escape="!busy"
    @close="emit('close')"
  >
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <el-button data-guide-action="excel.template" :disabled="busy" @click="download('/' + kind + '/template?' + context())">
        下载模板
      </el-button>
      <el-button data-guide-action="excel.export-filtered" :disabled="busy" @click="download('/' + kind + '/export?' + exportQuery())">
        下载待修改的数据
      </el-button>
      <el-button data-guide-action="excel.export-selected" :disabled="busy || !selectedIds?.length" v-if="selectedIds" @click="download('/' + kind + '/export?' + exportQuery(),undefined,selectedIds)">下载勾选记录（{{selectedIds.length}}）</el-button>
      <el-upload
        :auto-upload="false"
        :show-file-list="false"
        accept=".xlsx"
        :disabled="busy"
        :on-change="chooseFile"
      >
        <el-button :data-guide-action="file ? 'excel.retry' : 'excel.preview'" type="primary" :disabled="busy">
          {{ file ? "重新上传" : "选择 Excel 文件" }}
        </el-button>
      </el-upload>
      <span v-if="file">{{ file.name }}</span>
    </div>
    <el-form label-position="top" novalidate :disabled="busy">
      <el-form-item label="导入方式">
        <el-radio-group v-model="mode">
          <el-radio value="mixed">允许新增和修改</el-radio>
          <el-radio value="create">仅新增</el-radio>
          <el-radio value="update">仅修改</el-radio>
        </el-radio-group>
      </el-form-item>
    </el-form>
    <el-alert v-if="error" class="mb-3" type="error" :title="error" :closable="false" />
    <el-alert v-if="checking" class="mb-3" type="info" title="正在检查工作簿" :closable="false">
      <el-button data-guide-action="excel.cancel-preview" link @click="controller?.abort()">停止检查</el-button>
    </el-alert>
    <template v-if="preview">
      <el-alert
        v-if="result"
        type="success"
        class="mb-3"
        :closable="false"
        :title="`已处理 ${result.results.length} 条，${result.issues.length} 项需处理`"
      >
        <el-button data-guide-action="excel.result" link @click="download(batchPath('results'))">下载导入结果</el-button>
      </el-alert>
      <el-alert
        v-else
        :type="preview.issues.length ? 'warning' : 'success'"
        class="mb-3"
        :closable="false"
        :title="`新增 ${preview.summary.created} 条，修改 ${preview.summary.updated} 条，保持 ${preview.summary.unchanged} 条，${preview.summary.invalid_documents} 条需处理`"
      />
      <el-tabs v-model="tab">
        <el-tab-pane :label="`需要处理（${issues.length}）`" name="issues">
          <section aria-label="需要处理">
            <div v-if="issues.length" class="mb-2 flex flex-wrap gap-2">
              <el-button data-guide-action="excel.issues" @click="download(batchPath('errors'))">下载问题清单</el-button>
              <el-button v-if="file" @click="download(batchPath('correction'), file)">
                下载待修正的原表
              </el-button>
            </div>
            <el-table :data="issueRows" border empty-text="没有待处理的问题">
              <el-table-column label="工作表与行号" min-width="170">
                <template #default="{ row }">{{ row.sheet }} 第 {{ row.row }} 行</template>
              </el-table-column>
              <el-table-column prop="reason" label="问题" min-width="245" />
              <el-table-column prop="suggestion" label="处理建议" min-width="245" />
            </el-table>
            <Pagination
              v-if="issues.length"
              v-model:page="issuePage"
              :limit="20"
              :total="issues.length"
              layout="total, prev, pager, next"
            />
          </section>
        </el-tab-pane>
        <el-tab-pane :label="`拟处理单据（${preview.documents.length}）`" name="documents">
          <el-table :data="documentRows" border>
            <el-table-column prop="number" label="关联编号" min-width="140" />
            <el-table-column prop="sheet" label="工作表" min-width="130" />
            <el-table-column prop="row" label="行号" width="85" />
            <el-table-column label="拟处理结果" min-width="125">
              <template #default="{ row }">
                {{ actionTitle[row.action as keyof typeof actionTitle] }}
              </template>
            </el-table-column>
          </el-table>
          <Pagination
            v-model:page="documentPage"
            :limit="20"
            :total="preview.documents.length"
            layout="total, prev, pager, next"
          />
        </el-tab-pane>
      </el-tabs>
      <el-checkbox
        v-if="!result"
        data-guide-action="excel.atomic" v-model="atomic"
        :disabled="busy"
        label="有问题时，整批暂不保存"
      />
    </template>
    <template #footer>
      <el-button :disabled="busy" @click="emit('close')">关闭</el-button>
      <el-button
        v-if="preview && !result"
        type="primary"
        :loading="saving"
        :disabled="!canCommit"
        data-guide-action="excel.commit" @click="commit"
      >
        {{ atomic ? "保存整批" : "保存可处理单据" }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { usePageOverlays } from "@/composables/usePageOverlays";
import { ElMessage, ElMessageBox, type UploadFile } from "element-plus";
import Pagination from "@/components/Pagination/index.vue";
import {
  commitWorkbook,
  downloadWorkbook,
  previewWorkbook,
  type ExchangeCommitResult,
  type ExchangeMode,
  type ExchangePreview,
  type WorkbookKind,
} from "@/api/business/exchange";
import { randomRequestId } from "@/utils/business/request-id";

const props = defineProps<{
  kind: WorkbookKind;
  appliedQuery?: string;
  projectId?: string;
  assetKind?: string;
  selectedIds?: readonly string[];
}>();
const emit = defineEmits<{ close: []; changed: [] }>();
const file = shallowRef<File>();
const preview = shallowRef<ExchangePreview>();
const result = shallowRef<ExchangeCommitResult>();
const checking = ref(false),
  saving = ref(false),
  error = ref("");
const controller = shallowRef<AbortController>();
const mode = ref<ExchangeMode>("mixed"),
  atomic = ref(true);
const tab = ref("issues"),
  issuePage = ref(1),
  documentPage = ref(1);
const actionTitle = { create: "新增", update: "修改", unchanged: "保持" };
let requestKey = "";
const busy = computed(() => checking.value || saving.value);
usePageOverlays([],{
  async mayLeave(){
    if(saving.value)return false;
    if(!file.value||result.value)return true;
    try{
      await ElMessageBox.confirm("Excel 检查或待保存记录尚未处理完毕，确定离开？","放弃导入办理",{
        type:"warning",confirmButtonText:"放弃并离开",cancelButtonText:"继续办理",
      });
      return true;
    }catch{return false}
  },
  invalidate:()=>controller.value?.abort(),
});
const issues = computed(() => result.value?.issues ?? preview.value?.issues ?? []);
const issueRows = computed(() =>
  issues.value.slice((issuePage.value - 1) * 20, issuePage.value * 20),
);
const documentRows = computed(
  () =>
    preview.value?.documents.slice((documentPage.value - 1) * 20, documentPage.value * 20) ?? [],
);
const canCommit = computed(
  () =>
    !busy.value &&
    Boolean(preview.value?.documents.length) &&
    !result.value &&
    (!atomic.value || !issues.value.length),
);

function context(query = new URLSearchParams()) {
  if (props.assetKind) query.set("asset_kind", props.assetKind);
  if (props.projectId) query.set("project_id", props.projectId);
  return query;
}
function exportQuery() {
  const query = context(new URLSearchParams(props.appliedQuery));
  query.delete("page");
  query.delete("page_size");
  return query;
}
function batchPath(action: string) {
  return "/" + encodeURIComponent(preview.value?.token ?? "") + "/" + action;
}
async function download(path: string, raw?: File, ids?:readonly string[]) {
  try {
    await downloadWorkbook(path, raw, ids);
  } catch (cause) {
    ElMessage.error((cause as Error).message);
  }
}
function chooseFile(entry: UploadFile) {
  if (entry.raw) void check(entry.raw);
}
async function check(raw: File) {
  if (busy.value) return;
  file.value = raw;
  preview.value = undefined;
  result.value = undefined;
  error.value = "";
  issuePage.value = 1;
  documentPage.value = 1;
  if (!raw.name.toLowerCase().endsWith(".xlsx")) {
    error.value = "请选择 .xlsx 文件";
    return;
  }
  checking.value = true;
  controller.value = new AbortController();
  try {
    const response = await previewWorkbook(
      props.kind,
      raw,
      context(new URLSearchParams({ mode: mode.value })),
      controller.value.signal,
    );
    preview.value = response;
    result.value = response.previous;
    requestKey = randomRequestId();
    tab.value = response.issues.length ? "issues" : "documents";
  } catch (cause) {
    error.value =
      (cause as Error).name === "AbortError"
        ? "已停止检查，可重新上传。"
        : (cause as Error).message;
  } finally {
    checking.value = false;
    controller.value = undefined;
  }
}
async function commit() {
  if (!canCommit.value || !preview.value) return;
  saving.value = true;
  error.value = "";
  try {
    if (!atomic.value && issues.value.length)
      await ElMessageBox.confirm(
        "有问题的单据将保留在处理结果中，确认保存其余可处理单据？",
        "保存可处理单据",
        { type: "warning" },
      );
    result.value = await commitWorkbook(preview.value.token, requestKey, atomic.value);
    issuePage.value = 1;
    if (result.value.issues.length) tab.value = "issues";
    emit("changed");
  } catch (cause) {
    if (cause !== "cancel" && cause !== "close") error.value = (cause as Error).message;
  } finally {
    saving.value = false;
  }
}
watch(mode, () => {
  if (file.value) void check(file.value);
});
onBeforeUnmount(() => controller.value?.abort());
</script>

<style scoped>
:global(.business-exchange-dialog.el-dialog) {
  display: flex;
  flex-direction: column;
  max-height: calc(100dvh - 32px);
}
:global(.business-exchange-dialog .el-dialog__body) {
  min-height: 0;
  overflow: auto;
}
</style>

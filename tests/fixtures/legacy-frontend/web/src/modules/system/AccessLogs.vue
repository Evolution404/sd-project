<script setup lang="ts">
import { computed, onMounted, reactive, ref, useId } from "vue";
import { ElMessage } from "element-plus";
import BusinessDetailDialog from "../../shared/ui/BusinessDetailDialog.vue";
import BusinessTable, { type TableColumn } from "../../shared/ui/BusinessTable.vue";
import { formatBeijingDateTime } from "../../shared/utils/datetime";
import { api, download } from "../../shared/api/client";
import { useListRoute } from "../../shared/composables/use-list-route";
import type { AccessRecord } from "../../../../server/shared/types/access-logs-api";
const page = ref(1), sort = ref("time"), direction = ref("desc"), filters = ref<Record<string, string>>({});
const from = ref(""), to = ref(""), ip = ref(""), username = ref(""), method = ref(""), status = ref(""), q = ref("");
const fields = { from, to, ip, username, method, status, q };
const filterFormId = useId();
const draft = reactive({ from: "", to: "", ip: "", username: "", method: "", status: "", q: "" });
function syncDraft() {
  for (const key of Object.keys(fields) as (keyof typeof fields)[]) draft[key] = fields[key].value;
}
const moreFilters = ref(false);
const fieldKeys = Object.keys(fields) as (keyof typeof fields)[];
const draftChanged = computed(() => fieldKeys.some(key => (draft[key] || "") !== fields[key].value));
const scopeLabel = computed(() => {
  const terms = [
    from.value && "自 " + from.value, to.value && "至 " + to.value, q.value && "关键词 " + q.value,
    ip.value && "来源 IP " + ip.value, username.value && "账号 " + username.value,
    method.value && "方法 " + method.value, status.value && "状态码 " + status.value,
    Object.keys(filters.value).length && "已应用列筛选",
  ];
  return terms.filter(Boolean).join("，") || "全部访问日志";
});
const rows = ref<AccessRecord[]>([]), total = ref(0), loading = ref(false), exporting = ref(false);
const detail = ref<AccessRecord | null>(null), dialog = ref(false), technicalOpen = ref(false), diagnostic = ref("");
const listError = ref("");
const retention = ref(30), maxBytes = ref(0);
const columns: TableColumn[] = [
  { key: "time", label: "北京时间", minWidth: 190 },
  { key: "ip", label: "客户端IP", minWidth: 150 },
  { key: "username", label: "账号", minWidth: 130 },
  { key: "method", label: "请求方法", minWidth: 120 },
  { key: "path", label: "请求路径", minWidth: 230, hideable: false },
  { key: "status", label: "状态码", minWidth: 100 },
  { key: "duration_ms", label: "耗时（毫秒）", minWidth: 140 },
  { key: "outcome", label: "访问结果", minWidth: 130 },
];
function logValue(row: AccessRecord, key: string) {
  const value = row[key as keyof AccessRecord];
  return key === "time" ? formatBeijingDateTime(String(value).replace(" ", "T") + "+08:00") : value === "" ? "—" : value;
}
function search() {
  return new URLSearchParams({ page: String(page.value), page_size: "30", sort: sort.value, direction: direction.value,
    filters: JSON.stringify(filters.value), from: from.value || "", to: to.value || "", ip: ip.value,
    username: username.value, method: method.value, status: status.value, q: q.value });
}
let sequence = 0;
async function load() {
  const request = ++sequence;
  loading.value = true;
  listError.value = "";
  try {
    const result = await api<{ items: AccessRecord[]; total: number; diagnostic: string; retention_days: number; max_file_bytes: number }>("/access-logs?" + search());
    if (request !== sequence) return;
    rows.value = result.items;
    total.value = result.total;
    diagnostic.value = result.diagnostic;
    retention.value = result.retention_days;
    maxBytes.value = result.max_file_bytes;
  } catch (error) { if (request === sequence) listError.value = (error as Error).message; }
  finally { if (request === sequence) loading.value = false; }
}
function refreshFirstPage() { page.value = 1; void load(); }
function apply() {
  for (const key of fieldKeys) fields[key].value = draft[key] || "";
  refreshFirstPage();
}
function sortChanged(value: { key: string; order: string }) {
  sort.value = value.key;
  direction.value = value.order === "ascending" ? "asc" : "desc";
  refreshFirstPage();
}
async function exportLogs() {
  exporting.value = true;
  if (draftChanged.value) apply();
  const applied = search();
  applied.delete("page");
  applied.delete("page_size");
  try { await download("/access-logs/export?" + applied); }
  catch (error) { ElMessage.error((error as Error).message); }
  finally { exporting.value = false; }
}
useListRoute({ page, sort, direction, filters, ...fields }, () => { syncDraft(); void load(); });
syncDraft();
onMounted(load);
</script>
<template>
  <ElAlert v-if="diagnostic" :title="diagnostic" type="error" :closable="false" show-icon />
  <div class="panel access-logs">
    <ElAlert v-if="listError" title="访问日志读取失败" type="error" :closable="false" show-icon>
      <p>{{ listError }}{{ rows.length ? '。当前显示上次结果。' : '' }}</p>
      <ElButton link type="primary" @click="load">重试</ElButton>
    </ElAlert>
    <ElForm :id="filterFormId" label-position="top" novalidate @submit.prevent="apply">
      <div class="log-filters">
        <ElFormItem label="开始时间（北京时间）"><ElDatePicker v-model="draft.from" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" format="YYYY-MM-DD HH:mm:ss" /></ElFormItem>
        <ElFormItem label="结束时间（北京时间）"><ElDatePicker v-model="draft.to" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" format="YYYY-MM-DD HH:mm:ss" /></ElFormItem>
        <ElFormItem label="关键词"><ElInput v-model="draft.q" clearable placeholder="路径、访问结果或请求ID" /></ElFormItem>
      </div>
      <ElButton link :aria-expanded="moreFilters" @click="moreFilters = !moreFilters">
        {{ moreFilters ? "收起更多筛选" : "更多筛选" }}
      </ElButton>
      <div v-show="moreFilters" class="log-filters">
        <ElFormItem label="客户端IP"><ElInput v-model="draft.ip" clearable /></ElFormItem>
        <ElFormItem label="账号"><ElInput v-model="draft.username" clearable /></ElFormItem>
        <ElFormItem label="请求方法"><ElSelect v-model="draft.method" clearable><ElOption v-for="value in ['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']" :key="value" :value="value" :label="value" /></ElSelect></ElFormItem>
        <ElFormItem label="状态码"><ElInput v-model="draft.status" clearable placeholder="例如 403" /></ElFormItem>
      </div>
    </ElForm>

    <BusinessTable detail-column="path" @open-detail="detail = $event; technicalOpen = false; dialog = true" :rows="rows" :columns="columns" :loading="loading" table-key="system:access-logs" :filter-state="filters"
      :sort-state="{ prop: sort, order: direction === 'asc' ? 'ascending' : 'descending' }"
      @sort-change="sortChanged" @filter-change="value => { filters = value; refreshFirstPage(); }">
      <template #toolbar="{ openSettings, clearFilters, hasActiveFilters }">
        <div class="unified-list-tools">
          <div class="toolbar">
            <span class="muted" role="status">{{ loading ? '正在查询…' : scopeLabel + ' · 共 ' + total + ' 条' }}</span>
            <ElButton v-if="hasActiveFilters" link type="primary" @click="clearFilters">清除列筛选</ElButton>
          </div>
          <div class="toolbar page-heading-actions">
            <ElButton :loading="loading" @click="load">刷新</ElButton>
            <ElButton class="business-column-setting-trigger" @click="openSettings">列设置</ElButton>
            <ElButton :loading="exporting" @click="exportLogs">{{ draftChanged ? "应用条件并下载" : "下载筛选日志" }}</ElButton>
            <ElButton type="primary" native-type="submit" :form="filterFormId" :disabled="loading">查询</ElButton>
          </div>
        </div>
      </template>
      <template #cell="{ row, column }"><span>{{ logValue(row, column.key) }}</span></template>
    </BusinessTable>
    <p v-if="maxBytes" class="log-policy">保留最近 {{ retention }} 个北京时间自然日，单文件上限 {{ (maxBytes / 1024 / 1024).toFixed(2) }} MB。下载文件为 UTF-8 JSONL。</p>
    <ElPagination v-model:current-page="page" :page-size="30" :total="total" layout="prev,pager,next,total" @current-change="load" />
  </div>
  <BusinessDetailDialog :open="dialog" title="访问请求详情" size="min(760px, 94vw)" @close="dialog = false">
    <section v-if="detail" class="access-detail">
      <header>
        <ElTag :type="detail.status < 400 ? 'success' : 'warning'" effect="light">{{ detail.outcome }}</ElTag>
        <h2>{{ detail.error_summary || '访问请求' }}</h2>
        <p>{{ logValue(detail, "time") }} · {{ detail.username || "未登录用户" }}</p>
      </header>
      <ElDescriptions :column="1" :label-width="145">
        <ElDescriptionsItem label="访问路径"><span class="log-detail-value">{{ detail.path }}</span></ElDescriptionsItem>
        <ElDescriptionsItem label="来源 IP">{{ detail.ip }}</ElDescriptionsItem>
        <ElDescriptionsItem label="响应时间">{{ detail.duration_ms }} 毫秒</ElDescriptionsItem>
      </ElDescriptions>
      <ElButton :aria-expanded="technicalOpen" @click="technicalOpen = !technicalOpen">
        {{ technicalOpen ? "收起技术详情" : "查看技术详情" }}
      </ElButton>
      <ElDescriptions v-if="technicalOpen" :column="1" :label-width="145" border>
        <ElDescriptionsItem label="请求方法">{{ detail.method }}</ElDescriptionsItem>
        <ElDescriptionsItem label="状态码">{{ detail.status }}</ElDescriptionsItem>
        <ElDescriptionsItem label="请求关联编号">{{ detail.request_id }}</ElDescriptionsItem>
        <ElDescriptionsItem v-if="detail.error_type" label="异常类型">{{ detail.error_type }}</ElDescriptionsItem>
      </ElDescriptions>
    </section>
  </BusinessDetailDialog>
</template>
<style scoped>
.log-filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap: 0 16px; }
.log-filters :deep(.el-date-editor), .log-filters :deep(.el-select) { width: 100%; }
.log-policy { color: var(--el-text-color-secondary); font-size: 13px; margin: 16px 0; }
.access-detail { display: grid; gap: 16px; }
.access-detail h2 { margin: 7px 0; font-size: 17px; }
.access-detail header p { margin: 0; color: var(--el-text-color-secondary); }
.access-detail > .el-button { justify-self: start; }
.log-detail-value { overflow-wrap: anywhere; }
</style>

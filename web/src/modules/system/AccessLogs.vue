<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import BusinessTable, { type TableColumn } from "../../shared/ui/BusinessTable.vue";
import { formatBeijingDateTime } from "../../shared/utils/datetime";
import { api, download } from "../../shared/api/client";
import { useListRoute } from "../../shared/composables/use-list-route";
import type { AccessRecord } from "../../../../server/platform/access-logs/service";
const page = ref(1), sort = ref("time"), direction = ref("desc"), filters = ref<Record<string, string>>({});
const from = ref(""), to = ref(""), ip = ref(""), username = ref(""), method = ref(""), status = ref(""), q = ref("");
const rows = ref<AccessRecord[]>([]), total = ref(0), loading = ref(false), exporting = ref(false);
const detail = ref<AccessRecord | null>(null), dialog = ref(false), diagnostic = ref("");
const retention = ref(30), maxBytes = ref(0);
const columns: TableColumn[] = [
  { key: "time", label: "北京时间", minWidth: 190 },
  { key: "ip", label: "客户端IP", minWidth: 150 },
  { key: "username", label: "账号", minWidth: 130 },
  { key: "method", label: "请求方法", minWidth: 120 },
  { key: "path", label: "请求路径", minWidth: 230 },
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
  try {
    const result = await api<{ items: AccessRecord[]; total: number; diagnostic: string; retention_days: number; max_file_bytes: number }>("/access-logs?" + search());
    if (request !== sequence) return;
    rows.value = result.items;
    total.value = result.total;
    diagnostic.value = result.diagnostic;
    retention.value = result.retention_days;
    maxBytes.value = result.max_file_bytes;
  } catch (error) { ElMessage.error((error as Error).message); }
  finally { if (request === sequence) loading.value = false; }
}
function apply() { page.value = 1; void load(); }
function sortChanged(value: { key: string; order: string }) {
  sort.value = value.key;
  direction.value = value.order === "ascending" ? "asc" : "desc";
  apply();
}
async function exportLogs() {
  exporting.value = true;
  try { await download("/access-logs/export?" + search()); }
  catch (error) { ElMessage.error((error as Error).message); }
  finally { exporting.value = false; }
}
useListRoute({ page, sort, direction, filters, from, to, ip, username, method, status, q }, load);
onMounted(load);
</script>
<template>
  <ElAlert v-if="diagnostic" :title="diagnostic" type="error" :closable="false" show-icon />
  <div class="panel access-logs">
    <ElForm label-position="top" novalidate @submit.prevent="apply">
      <div class="log-filters">
        <ElFormItem label="开始时间（北京时间）"><ElDatePicker v-model="from" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" format="YYYY-MM-DD HH:mm:ss" /></ElFormItem>
        <ElFormItem label="结束时间（北京时间）"><ElDatePicker v-model="to" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" format="YYYY-MM-DD HH:mm:ss" /></ElFormItem>
        <ElFormItem label="客户端IP"><ElInput v-model="ip" clearable /></ElFormItem>
        <ElFormItem label="账号"><ElInput v-model="username" clearable /></ElFormItem>
        <ElFormItem label="请求方法"><ElSelect v-model="method" clearable><ElOption v-for="value in ['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']" :key="value" :value="value" :label="value" /></ElSelect></ElFormItem>
        <ElFormItem label="状态码"><ElInput v-model="status" clearable placeholder="例如 403" /></ElFormItem>
        <ElFormItem label="关键词"><ElInput v-model="q" clearable placeholder="路径、访问结果或请求ID" @keyup.enter="apply" /></ElFormItem>
      </div>
      <div class="log-actions"><ElButton type="primary" @click="apply">查询</ElButton><ElButton :loading="loading" @click="load">刷新</ElButton><ElButton :loading="exporting" @click="exportLogs">下载筛选日志</ElButton></div>
    </ElForm>
    <p class="log-policy">保留最近 {{ retention }} 个北京时间自然日，单文件上限 {{ (maxBytes / 1024 / 1024).toFixed(2) }} MB。下载文件为 UTF-8 JSONL。</p>
    <BusinessTable :rows="rows" :columns="columns" :loading="loading" table-key="system:access-logs" :filter-state="filters"
      :sort-state="{ prop: sort, order: direction === 'asc' ? 'ascending' : 'descending' }"
      @sort-change="sortChanged" @filter-change="value => { filters = value; apply(); }">
      <template #cell="{ row, column }"><span>{{ logValue(row, column.key) }}</span></template>
      <template #actions="{ row }"><ElButton link type="primary" @click="detail = row; dialog = true">查看</ElButton></template>
    </BusinessTable>
    <ElPagination v-model:current-page="page" :page-size="30" :total="total" layout="prev,pager,next,total" @current-change="load" />
  </div>
  <ElDialog v-model="dialog" title="访问请求详情" width="760px" append-to-body>
    <ElDescriptions v-if="detail" :column="1" border>
      <ElDescriptionsItem v-for="column in [...columns, { key: 'request_id', label: '请求关联ID' }, { key: 'error_type', label: '异常类型' }, { key: 'error_summary', label: '安全错误摘要' }]" :key="column.key" :label="column.label"><span class="log-detail-value">{{ logValue(detail, column.key) }}</span></ElDescriptionsItem>
    </ElDescriptions>
    <template #footer><ElButton @click="dialog = false">关闭</ElButton></template>
  </ElDialog>
</template>
<style scoped>
.log-filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 0 16px; }
.log-filters :deep(.el-date-editor), .log-filters :deep(.el-select) { width: 100%; }
.log-actions { display: flex; flex-wrap: wrap; gap: 10px; }
.log-actions :deep(.el-button) { margin-left: 0; }
.log-policy { color: var(--el-text-color-secondary); font-size: 13px; margin: 16px 0; }
.log-detail-value { overflow-wrap: anywhere; }
</style>

<template>
  <div class="page-container">
    <el-tabs v-model="tab">
      <el-tab-pane label="IP 授权" name="ips" />
      <el-tab-pane label="访问日志" name="logs" />
    </el-tabs>
    <el-alert v-if="error" class="mb-3" type="error" :title="error" :closable="false" />
    <template v-if="tab === 'ips'">
      <div class="mb-3 flex flex-wrap items-center gap-3">
        <el-switch data-guide-action="system.ip" v-if="policy" :model-value="policy.ip_restriction_enabled" :disabled="savingPolicy"
          aria-label="访问限制" @change="changePolicy(Boolean($event))" />
        <span v-if="policy">{{ policy.ip_restriction_enabled ? "访问限制已开启" : "访问限制已关闭" }}</span>
        <el-button v-else :loading="loadingPolicy" @click="loadPolicy()">读取访问限制</el-button>
        <el-button type="primary" data-guide-action="system.ip-add" @click="openGrant()">新增 IP 授权</el-button>
      </div>
      <CrudPage embedded ref="grantPage" :search-config="grantSearch" :table-config="grantTable">
        <template #table-cell-created_at="{ row }">{{ formatBeijingDateTime(row.created_at) }}</template>
      </CrudPage>
    </template>
    <template v-else>
      <el-alert v-if="diagnostic" class="mb-3" type="warning" :title="diagnostic" :closable="false" />
      <CrudPage embedded :search-config="logSearch" :table-config="logTable">
        <template #table-cell-time="{ row }">{{ row.time }}</template>
      </CrudPage>
    </template>
  </div>
  <el-dialog v-model="grantOpen" :title="grantId ? '修改 IP 授权' : '新增 IP 授权'"
    width="min(94vw, 470px)" append-to-body :close-on-click-modal="false" :close-on-press-escape="!savingGrant">
    <el-alert v-if="grantError" class="mb-3" type="error" :title="grantError" :closable="false" />
    <el-form label-position="top" novalidate @submit.prevent="submitGrant">
      <el-form-item label="IP 地址" required>
        <el-input v-model="grantIp" maxlength="45" />
      </el-form-item>
      <el-form-item label="用途说明">
        <el-input v-model="grantNote" type="textarea" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button :disabled="savingGrant" @click="grantOpen = false">取消</el-button>
      <el-button type="primary" :loading="savingGrant" @click="submitGrant">保存授权</el-button>
    </template>
  </el-dialog>
  <el-drawer v-model="logOpen" title="访问记录详情" size="min(96vw, 730px)" append-to-body>
    <el-descriptions v-if="selectedLog" border :column="1">
      <el-descriptions-item v-for="column in logFields" :key="column.prop" :label="column.label">
        <span class="break-all">{{ selectedLog[column.prop] === "" ? "—" : selectedLog[column.prop] }}</span>
      </el-descriptions-item>
    </el-descriptions>
  </el-drawer>
</template>

<script setup lang="ts">
import { nativeListQuery, applyNativeListQuery } from "@/utils/business/native-list-query";
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { LIST_QUERY_KEY } from "@/components/Crud/utils/list-state";
import CrudPage from "@/components/Crud/CrudPage.vue";
import type { CrudRecord, CrudSearchConfig, CrudTableConfig } from "@/components/Crud/types";
import { formatBeijingDateTime } from "@/utils/business/datetime";
import {
  deleteIpGrant, listAccessRecords, listIpGrants, readAccessPolicy, saveIpGrant, setAccessPolicy,
  type AccessPolicy, type AccessRecord, type IpGrant,
} from "@/api/business/access";

const route = useRoute();
const router = useRouter();
const tab = computed({
  get: () => route.query.tab === "logs" ? "logs" : "ips",
  set(next) {
    if (next === tab.value) return;
    void router.replace({ query: { ...route.query, tab: next === "logs" ? "logs" : undefined, [LIST_QUERY_KEY]: undefined } });
  },
});
const policy = ref<AccessPolicy>();
const error = ref(""), diagnostic = ref("");
const loadingPolicy = ref(false), savingPolicy = ref(false);
const grantPage = ref<InstanceType<typeof CrudPage>>();
const grantOpen = ref(false), savingGrant = ref(false), grantError = ref("");
const grantId = ref<string>(), grantIp = ref(""), grantNote = ref("");
const logOpen = ref(false), selectedLog = ref<AccessRecord>();
let exportQuery: URLSearchParams | undefined;
let logRequest = 0;

async function loadPolicy(clear = true) {
  if (clear) error.value = "";
  loadingPolicy.value = true;
  try {
    policy.value = await readAccessPolicy();
  } catch (cause) {
    error.value = (cause as Error).message;
  } finally {
    loadingPolicy.value = false;
  }
}
async function changePolicy(enabled: boolean) {
  const version = policy.value?.version;
  if (!version || savingPolicy.value || policy.value?.ip_restriction_enabled === enabled) return;
  savingPolicy.value = true;
  error.value = "";
  try {
    const action = enabled ? "开启" : "关闭";
    await ElMessageBox.confirm(
      enabled ? "开启后，仅回环地址及已授权的 IP 可访问系统。" : "关闭后，未登记的 IP 也能访问登录入口，账号及业务权限仍须验证。",
      "确认" + action + "访问限制", { type: "warning", confirmButtonText: "确认" + action, cancelButtonText: "取消" },
    );
    policy.value = await setAccessPolicy(enabled, version);
  } catch (cause) {
    if (cause === "close" || cause === "cancel") return;
    error.value = (cause as Error).message;
    await loadPolicy(false);
  } finally {
    savingPolicy.value = false;
  }
}
function openGrant(row?: IpGrant) {
  grantId.value = row?.id;
  grantIp.value = row?.ip ?? "";
  grantNote.value = row?.note ?? "";
  grantError.value = "";
  grantOpen.value = true;
}
async function submitGrant() {
  if (savingGrant.value) return;
  savingGrant.value = true;
  grantError.value = "";
  try {
    await saveIpGrant(grantIp.value.trim(), grantNote.value.trim(), grantId.value);
    grantOpen.value = false;
    await grantPage.value?.refresh();
  } catch (cause) {
    grantError.value = (cause as Error).message;
  } finally {
    savingGrant.value = false;
  }
}
async function removeGrant(row: IpGrant) {
  try {
    await ElMessageBox.confirm("确认撤销 " + row.ip + " 的访问授权？", "撤销 IP 授权", {
      type: "warning", confirmButtonText: "撤销授权", cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  await deleteIpGrant(row.id);
  await grantPage.value?.refresh();
}
function paging(query: CrudRecord) {
  return { page: String(query.pageNum ?? 1), page_size: String(query.pageSize ?? 20) };
}
const grantSearch: CrudSearchConfig = {
  fields: [{ type: "input", prop: "q", label: "授权查询", attrs: { placeholder: "IP 地址或用途", clearable: true } }],
};
const grantTable: CrudTableConfig<CrudRecord, IpGrant> = {
  stateKey:"access:ips",
  rowKey: "id", table: { border: true }, tableTools: ["refresh", "columns", "search"],
  fetchData: async (query) => {
    const result = await listIpGrants(applyNativeListQuery(new URLSearchParams({ ...paging(query), q: String(query.q ?? "") }),nativeListQuery(query)));
    return { list: result.items, total: result.total };
  },
  columns: [
    { prop: "ip", sortable: "custom", label: "IP 地址", minWidth: 160 },
    { prop: "note", sortable: "custom", label: "用途说明", minWidth: 180 },
    { prop: "created_at", sortable: "custom", label: "登记时间", cellType: "custom", minWidth: 170 },
    { prop: "actions", label: "操作", cellType: "actions", minWidth: 150,
      actions: [
        { key: "edit", label: "修改授权", permission: "admin", onClick: ({ row }) => row && openGrant(row as IpGrant) },
        { key: "delete", label: "撤销授权", permission: "admin", onClick: ({ row }) => row && removeGrant(row as IpGrant) },
      ] },
  ],
};
const logSearch: CrudSearchConfig = { fields: [
  { type: "input", prop: "q", label: "日志检索", attrs: { clearable: true } },
  { type: "input", prop: "status", label: "状态码", attrs: { clearable: true, maxlength: 3 } },
  { type: "input", prop: "ip", label: "来源 IP", attrs: { clearable: true } },
  { type: "input", prop: "username", label: "登录账号", attrs: { clearable: true } },
  { type: "select", prop: "method", label: "请求方法", attrs: { clearable: true },
    options: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map(value => ({ label: value, value })) },
  { type: "date-picker", prop: "from", label: "开始时间（北京时间）",
    attrs: { type: "datetime", valueFormat: "YYYY-MM-DD HH:mm:ss" } },
  { type: "date-picker", prop: "to", label: "结束时间（北京时间）",
    attrs: { type: "datetime", valueFormat: "YYYY-MM-DD HH:mm:ss" } },
] };
const logFields: { prop: keyof AccessRecord; label: string }[] = [
  { prop: "time", label: "访问时间（北京时间）" }, { prop: "ip", label: "来源 IP" },
  { prop: "username", label: "账号" }, { prop: "method", label: "请求方法" },
  { prop: "path", label: "请求路径" }, { prop: "status", label: "状态码" },
  { prop: "outcome", label: "处理结果" }, { prop: "duration_ms", label: "耗时（毫秒）" },
  { prop: "request_id", label: "请求 ID" }, { prop: "error_type", label: "错误类型" },
  { prop: "error_summary", label: "错误摘要" },
];
const logTable: CrudTableConfig<CrudRecord, AccessRecord> = {
  stateKey:"access:logs",
  rowKey: "request_id", table: { border: true }, tableTools: ["refresh", "columns", "search"],
  toolbarActions: [{ key: "export", label: "导出当前查询", permission: "admin", onClick: () => {
    if (exportQuery) window.location.assign("/api/access-logs/export?" + exportQuery);
  } }],
  fetchData: async (query) => {
    const sequence = ++logRequest;
    const filters = new URLSearchParams();
    for (const key of ["q", "status", "ip", "username", "method", "from", "to"]) {
      if (query[key]) filters.set(key, String(query[key]));
    }
    const result = await listAccessRecords(new URLSearchParams({ ...Object.fromEntries(filters), ...paging(query) }));
    if (sequence === logRequest) {
      diagnostic.value = result.diagnostic;
      exportQuery = filters;
    }
    return { list: result.items, total: result.total };
  },
  columns: [
    { prop: "time", label: "访问时间", cellType: "custom", minWidth: 172 },
    { prop: "username", label: "账号", minWidth: 110 },
    { prop: "ip", label: "来源 IP", minWidth: 128 },
    { prop: "path", label: "请求路径", minWidth: 160 },
    { prop: "status", label: "状态码", width: 95 },
    { prop: "outcome", label: "处理结果", minWidth: 120 },
    { prop: "actions", label: "操作", cellType: "actions", width: 95,
      actions: [{ key: "detail", label: "查看详情", permission: "admin", onClick: ({ row }) => {
        selectedLog.value = row as AccessRecord;
        logOpen.value = true;
      } }] },
  ],
};
onMounted(() => loadPolicy());
</script>

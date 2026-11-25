<template>
  <div class="page-container">
    <el-tabs v-model="kind">
      <el-tab-pane label="业务审计" name="business" />
      <el-tab-pane label="账号安全事件" name="security" />
    </el-tabs>
    <CrudPage embedded :key="kind" :search-config="search" :table-config="table">
      <template #table-cell-created_at="{ row }">{{ formatBeijingDateTime(row.created_at) }}</template>
    </CrudPage>
  </div>
  <el-drawer v-model="opened" title="审计记录详情" size="min(96vw, 850px)" append-to-body>
    <el-skeleton v-if="loading" :rows="6" animated />
    <el-alert v-else-if="error" type="error" :title="error" :closable="false" />
    <template v-else-if="detail">
      <el-descriptions border :column="2">
        <el-descriptions-item label="操作">{{ selected?.action_label }}</el-descriptions-item>
        <el-descriptions-item label="业务对象">{{ selected?.entity_label }}</el-descriptions-item>
        <el-descriptions-item label="操作账号">{{ selected?.actor_username }}</el-descriptions-item>
        <el-descriptions-item label="记录时间">{{ formatBeijingDateTime(detail.original.created_at) }}</el-descriptions-item>
        <el-descriptions-item label="业务记录 ID" :span="2">{{ detail.original.entity_id }}</el-descriptions-item>
      </el-descriptions>
      <el-tabs v-model="snapshot" class="mt-4">
        <el-tab-pane label="变更前" name="before">
          <pre class="whitespace-pre-wrap break-all">{{ pretty(detail.original.before_json) }}</pre>
        </el-tab-pane>
        <el-tab-pane label="变更后" name="after">
          <pre class="whitespace-pre-wrap break-all">{{ pretty(detail.original.after_json) }}</pre>
        </el-tab-pane>
        <el-tab-pane label="后续审计记录" name="decisions">
          <el-empty v-if="!detail.decisions.length" description="暂无后续审计记录" />
          <el-timeline v-else>
            <el-timeline-item v-for="row in detail.decisions" :key="row.id"
              :timestamp="formatBeijingDateTime(row.created_at)">
              <pre class="whitespace-pre-wrap break-all">{{ pretty(row.after_json) }}</pre>
            </el-timeline-item>
          </el-timeline>
        </el-tab-pane>
      </el-tabs>
    </template>
  </el-drawer>
</template>

<script setup lang="ts">
import { nativeListQuery, applyNativeListQuery } from "@/utils/business/native-list-query";
import { computed, ref } from "vue";
import CrudPage from "@/components/Crud/CrudPage.vue";
import type { CrudRecord, CrudSearchConfig, CrudTableConfig } from "@/components/Crud/types";
import { formatBeijingDateTime } from "@/utils/business/datetime";

interface AuditSnapshot {
  id: string;
  entity_id: string;
  created_at: string;
  before_json: string | null;
  after_json: string | null;
}

const kind = ref("business");
const opened = ref(false), loading = ref(false);
const error = ref(""), snapshot = ref("after");
const selected = ref<CrudRecord>();
const detail = ref<{ original: AuditSnapshot; decisions: AuditSnapshot[] }>();
let sequence = 0;

async function read<T>(path: string): Promise<T> {
  const response = await fetch("/api/audit" + path, { credentials: "same-origin" });
  const result = await response.json();
  if (!response.ok) throw Error(result.message || "审计记录读取失败");
  return result as T;
}
async function openDetails(row: CrudRecord) {
  const request = ++sequence;
  selected.value = row;
  snapshot.value = "after";
  detail.value = undefined;
  error.value = "";
  opened.value = true;
  loading.value = true;
  try {
    const record = await read<NonNullable<typeof detail.value>>("/" + encodeURIComponent(String(row.id)));
    if (request === sequence) detail.value = record;
  } catch (cause) {
    if (request === sequence) error.value = (cause as Error).message;
  } finally {
    if (request === sequence) loading.value = false;
  }
}
function pretty(value: string | null) {
  return value ? JSON.stringify(JSON.parse(value), null, 2) : "无记录";
}

const search: CrudSearchConfig = {
  fields: [{ type: "input", prop: "keywords", label: "审计检索", attrs: { clearable: true, placeholder: "按账号、对象或操作查询" } }],
};
const table = computed<CrudTableConfig>(() => ({
  stateKey:"audit:"+kind.value,
  table: { border: true },
  rowKey: "id",
  tableTools: ["refresh", "columns", "search"],
  fetchData: async (nativeQuery) => {
    const {pageNum,pageSize,keywords}=nativeQuery;
    const query = new URLSearchParams({
      page: String(pageNum ?? 1), page_size: String(pageSize ?? 20),
      q: String(keywords ?? ""), sort: "created_at", direction: "desc",
    });
    applyNativeListQuery(query, nativeListQuery(nativeQuery));
    const result = await read<{ items: CrudRecord[]; total: number }>((kind.value === "security" ? "/security" : "") + "?" + query);
    return { list: result.items, total: result.total };
  },
  columns: kind.value === "security" ? [
    { prop: "created_at", sortable: "custom", label: "发生时间", cellType: "custom", minWidth: 170 },
    { prop: "event_label", sortable: "custom", label: "安全事件", minWidth: 155 },
    { prop: "username", sortable: "custom", label: "账号", minWidth: 135 },
    { prop: "actor_username", sortable: "custom", label: "操作人", minWidth: 135 },
    { prop: "ip", sortable: "custom", label: "来源 IP", minWidth: 160 },
  ] : [
    { prop: "created_at", sortable: "custom", label: "发生时间", cellType: "custom", minWidth: 170 },
    { prop: "entity_label", sortable: "custom", label: "业务对象", minWidth: 130 },
    { prop: "action_label", sortable: "custom", label: "操作", minWidth: 130 },
    { prop: "actor_username", sortable: "custom", label: "操作账号", minWidth: 130 },
    { prop: "entity_id", sortable: "custom", label: "业务记录 ID", minWidth: 300 },
    { prop: "actions", label: "操作", cellType: "actions", width: 120, fixed: "right",
      actions: [{ key: "details", label: "查看详情", permission: "audit.read",
        onClick: ({ row }) => row && openDetails(row) }] },
  ],
}));
</script>

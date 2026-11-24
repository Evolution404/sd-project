<template>
  <CrudPage embedded :key="kind" :search-config="search" :table-config="table">
    <template #table-cell-project_name="{ row }">
      <el-link type="primary" @click="openProject(String(row.project_id))">{{ row.project_name }}</el-link>
    </template>
    <template #table-cell-amount_fen="{ row }">{{ projectMoney(row.amount_fen) }}</template>
    <template #table-cell-status="{ row }">
      {{ row.status === "voided" ? "已作废" : row.status === "stale" ? "所用版本已变更" : row.is_final ? "已最终核对" : "有效" }}
    </template>
  </CrudPage>
  <el-drawer v-model="open" title="财务正式历史" size="min(96%, 1030px)" append-to-body destroy-on-close>
    <BusinessHistoryViewer v-if="target" :target="target" />
  </el-drawer>
</template>

<script setup lang="ts">
import { historyScopeField, nativeListQuery, nativeColumnFilter } from "@/utils/business/native-list-query";
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { usePageOverlays } from "@/composables/usePageOverlays";
import CrudPage from "@/components/Crud/CrudPage.vue";
import type { CrudSearchConfig, CrudTableConfig } from "@/components/Crud/types";
import type { HistoryTarget } from "../../../../server/shared/types/history";
import { listPortfolioFinance } from "@/api/business/finance";
import { projectMoney } from "@/api/business/projects";
import BusinessHistoryViewer from "./BusinessHistoryViewer.vue";

const props = defineProps<{ kind: "costs" | "reconciliations" }>();
const router = useRouter();
const open = ref(false);
const target = ref<HistoryTarget>();
usePageOverlays([open],{invalidate:()=>{target.value=undefined}});
const search = computed<CrudSearchConfig>(()=>({
  fields: [
    { type: "input", prop: "keywords", label: "财务检索", attrs: { clearable: true, placeholder: "费用事项或项目编号" } },
    { type: "input", prop: "projectName", label: "项目名称", attrs: { clearable: true } },
    ...(props.kind==="reconciliations"?[historyScopeField("finance.reconcile-show-deleted")]:[]),
  ],
}));
const table = computed<CrudTableConfig>(() => ({
  stateKey:"finance:portfolio:"+props.kind,
  table: { border: true }, rowKey: "id", tableTools: ["refresh", "columns", "search"],
  async fetchData(query) {
    const projectName = String(query.projectName || "").trim();
    const result = await listPortfolioFinance(props.kind, Number(query.pageNum) || 1, Number(query.pageSize) || 20,
      String(query.keywords || ""), projectName ? { project_name: projectName } : {}, nativeListQuery(query, ["status"]));
    return { list: result.items, total: result.total };
  },
  columns: [
    { prop: "label", sortable: "custom", label: "费用事项", minWidth: 170, fixed: "left" },
    { prop: "project_name", sortable: "custom", label: "所属项目", cellType: "custom", minWidth: 195 },
    { prop: "project_code", sortable: "custom", label: "项目编号", minWidth: 115 },
    { prop: "amount_fen", sortable: "custom", label: props.kind === "costs" ? "实际金额" : "已核对结算金额", cellType: "custom", minWidth: 135 },
    { prop: "occurred_on", sortable: "custom", label: "费用发生日期", minWidth: 130 },
    { prop: "version_no", sortable: "custom", label: "正式版本", width: 100 },
    { prop: "status", sortable: "custom", ...nativeColumnFilter("status",[{text:"有效",value:"active"},{text:"已作废",value:"voided"},...(props.kind==="reconciliations"?[{text:"所用版本已变更",value:"stale"}]:[])]), label: "状态", cellType: "custom", minWidth: 130 },
    { prop: "actions", label: "操作", cellType: "actions", fixed: "right", width: 130,
      actions: [{ key: "trace", label: "查看正式历史", permission: "read", onClick: ({ row }) => {
        if (!row) return;
        target.value = { kind: props.kind, id: String(row.id), project: String(row.project_id) };
        open.value = true;
      } }] },
  ],
}));
function openProject(id: string) {
  return router.push({ name: "Finance", query: { project: id, work: props.kind } });
}
</script>

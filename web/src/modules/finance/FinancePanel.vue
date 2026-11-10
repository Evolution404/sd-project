<script setup lang="ts">
import { useListRoute } from "../../shared/composables/use-list-route";import { useDialogDraftGuard } from "../../shared/forms/use-dialog-draft";
import RowActions from "../../shared/ui/RowActions.vue";
import BusinessHistory from "../../shared/ui/BusinessHistory.vue";
import { useAccess } from "../../shared/composables/use-access";
const can = useAccess();
import { ref, watch, computed } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import FieldControl from "../../shared/ui/FieldControl.vue";
import BusinessTable, { type TableColumn } from "../../shared/ui/BusinessTable.vue";
import ExchangePanel from "../exchange/ExchangePanel.vue";
import EvidencePanel from "../files/EvidencePanel.vue";
const evidence = ref<Row | null>(null);
import {
  api,
  today,
  type Row,
  money,
  quantity,
  statusText,
} from "../../shared/api/client";
const formRef = ref();
const props = defineProps<{ project: Row }>();
const showDeletedNodes = ref(false),
  showDeletedCosts = ref(false),
  showDeletedReconciliations = ref(false);
function enabledPath(node: Row) {
  let current: Row | undefined = node;
  while (current) {
    if (current.deleted || current.status !== "active") return false;
    current = props.project.cost_nodes.find(
      (parent: Row) => parent.id === current!.parent_id,
    );
  }
  return true;
}
const activeLeaves = computed(() =>
  props.project.cost_nodes.filter(
    (node: Row) =>
      enabledPath(node) &&
      !props.project.cost_nodes.some(
        (child: Row) => child.parent_id === node.id,
      ),
  ),
);
const displayedNodes = computed(() =>
  props.project.cost_nodes.filter(
    (node: Row) => showDeletedNodes.value || !node.deleted,
  ),
);
const emit = defineEmits(["changed"]);
const costs = ref<Row[]>([]),
  listLoading = ref(false),
  bills = ref<Row[]>([]),
  summary = ref<Row>({}),
  dialog = ref(""),
  form = ref<Row>({}),
  editing = ref<Row | null>(null),
  busy = ref(false),
  selected = ref<Row[]>([]),
  history = ref<Row | null>(null),
  reconciliations = ref<Row[]>([]);
const financeColumns: Record<string, TableColumn[]> = {
  nodes: [
    { key: "name", label: "科目名称", minWidth: 180 },
    { key: "parent_id", label: "上级科目", sortable: false, filterable: false },
    { key: "status", label: "状态" },
  ],
  costs: [
    // Keep operational state and amount visible beside the fixed action
    // column even in a 760px project-detail dialog.
    { key: "title", label: "事项", minWidth: 165 },
    { key: "status", label: "状态", minWidth: 105 },
    { key: "amount_fen", label: "实际金额", minWidth: 125 },
    { key: "occurred_on", label: "发生日期", minWidth: 115 },
  ],
  bills: [
    { key: "number", label: "结算编号", minWidth: 175 },
    { key: "review", label: "正式版本与状态", minWidth: 180, sortable: false, filterable: false },
    { key: "amount", label: "本次金额", minWidth: 145, sortable: false, filterable: false },
  ],
  reconciliations: [
    { key: "reconciled_cost_fen", label: "实际费用份额", minWidth: 165 },
    { key: "reconciled_settlement_fen", label: "结算核定额", minWidth: 165 },
    { key: "evidence", label: "核对依据", minWidth: 180 },
    { key: "status", label: "状态" },
  ],
  demands: [
    { key: "demand_no", label: "需求编号", minWidth: 190 },
    { key: "approved_quantity_scaled", label: "批准数量" },
    { key: "resolved_quantity_scaled", label: "已解决" },
    { key: "remaining_quantity_scaled", label: "未解决数量" },
    { key: "excess_quantity_scaled", label: "超量数量" },
  ],
};
const financeSort = ref({ costs: "", bills: "", reconciliations: "" });
const financeDirection = ref({ costs: "desc", bills: "desc", reconciliations: "desc" });
const financeFilters = ref<Record<string, Record<string, string>>>({ costs: {}, bills: {}, reconciliations: {} });
function financeTableSort(table: "costs" | "bills" | "reconciliations", value: { key: string; order: string }) {
  financeSort.value[table] = value.key;
  financeDirection.value[table] = value.order === "ascending" ? "asc" : "desc";
  if (table === "costs") costPage.value = 1;
  else if (table === "bills") billPage.value = 1;
  else reconPage.value = 1;
  load();
}
function financeTableFilter(table: "costs" | "bills" | "reconciliations", value: Record<string, string>) {
  financeFilters.value[table] = value;
  if (table === "costs") costPage.value = 1;
  else if (table === "bills") billPage.value = 1;
  else reconPage.value = 1;
  load();
}
const costPage = ref(1),
  billPage = ref(1),
  reconPage = ref(1),
  costTotal = ref(0),
  billTotal = ref(0),
  reconTotal = ref(0);
let loadSequence = 0;
async function load() {
  const sequence = ++loadSequence;
  listLoading.value = true;
  try {
    const [costResult, billResult, summaryResult, reconResult] = await Promise.all([
      api(`/projects/${props.project.id}/costs?page=${costPage.value}&page_size=30&deleted=${showDeletedCosts.value}&sort=${encodeURIComponent(financeSort.value.costs || "created_at")}&direction=${financeDirection.value.costs}&filters=${encodeURIComponent(JSON.stringify(financeFilters.value.costs))}`),
      api(`/projects/${props.project.id}/settlements?page=${billPage.value}&page_size=30&sort=${encodeURIComponent(financeSort.value.bills || "created_at")}&direction=${financeDirection.value.bills}&filters=${encodeURIComponent(JSON.stringify(financeFilters.value.bills))}`),
      api(`/projects/${props.project.id}/summary`),
      api(`/reconciliations?page=${reconPage.value}&page_size=30&project_id=${props.project.id}&deleted=${showDeletedReconciliations.value}&sort=${encodeURIComponent(financeSort.value.reconciliations || "created_at")}&direction=${financeDirection.value.reconciliations}&filters=${encodeURIComponent(JSON.stringify(financeFilters.value.reconciliations))}`),
    ]);
    if (sequence !== loadSequence) return;
    costs.value = costResult.items;
    costTotal.value = costResult.total;
    bills.value = billResult.items;
    billTotal.value = billResult.total;
    summary.value = summaryResult;
    reconciliations.value = reconResult.items;
    reconTotal.value = reconResult.total;
  } catch (error) {
    if (sequence === loadSequence) ElMessage.error((error as Error).message);
  } finally {
    if (sequence === loadSequence) listLoading.value = false;
  }
}
const draftGuard = useDialogDraftGuard(() => form.value);
function closeEditor() { void draftGuard.confirmClose(() => { dialog.value = ""; }); }
function beforeEditorClose(done: () => void) { void draftGuard.confirmClose(done); }
function edit(type: string, row?: Row) {
  editing.value = row || null;
  dialog.value = type;
  if (type === "node")
    form.value = row
      ? { ...row, expected_version: row.version_no }
      : { name: "", status: "active" };
  if (type === "cost")
    form.value = row
      ? {
          ...row,
          cost_node_id: props.project.cost_nodes.find(
            (n: Row) => n.current_version_id === row.cost_node_version_id,
          )?.id,
          expected_version: row.version_no,
        }
      : {
          title: "",
          occurred_on: today(),
          amount_fen: 0,
          evidence: "",
          status: "active",
        };
  if (type === "settlement")
    form.value = row
      ? {
          ...(row.draft?.document || row.version || {}),
          number: row.number,
          expected_version: row.version?.version_no || 0,
          expected_edit_version: row.draft?.edit_version || 0,
          items: structuredClone(row.draft?.document.items || row.items),
          resolutions: structuredClone(
            row.draft?.document.resolutions || row.resolutions,
          ),
        }
      : {
          number: "",
          approval_version_id: props.project.approval?.id,
          funding_version_id: props.project.funding?.id || null,
          settlement_on: today(),
          basis: "",
          items: [{ quantity_scaled: 0, amount_fen: 0, evidence: "" }],
          resolutions: [],
        };
  if (type === "reconcile")
    form.value = row
      ? {
          ...row,
          request_key: undefined,
          expected_version: row.version_no,
          is_final: !!row.is_final,
        }
      : {
          expected_version: 0,
          reconciled_cost_fen: 0,
          reconciled_settlement_fen: 0,
          evidence: "",
          is_final: true,
        };
  draftGuard.capture();
}
async function save() {
  if (busy.value) return;
  busy.value = true;
  try {
    if (!(await formRef.value?.validate().catch(() => false))) return;
    if (dialog.value === "node")
      await api(
        `/projects/${props.project.id}/nodes${editing.value ? "/" + editing.value.id : ""}`,
        "POST",
        form.value,
      );
    if (dialog.value === "cost")
      await api(
        `/projects/${props.project.id}/costs${editing.value ? "/" + editing.value.entry_id : ""}`,
        "POST",
        form.value,
      );
    if (dialog.value === "settlement")
      await api(
        `/projects/${props.project.id}/settlements${editing.value ? "/" + editing.value.id : ""}`,
        "POST",
        form.value,
      );
    if (dialog.value === "reconcile")
      await api("/reconciliations", "POST", form.value);
    ElMessage.success("费用或结算数据已保存，正在刷新列表");
    await load();
    emit("changed");
    dialog.value = "";
  } catch (e) {
    ElMessage.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function action(row: Row, name: string) {
  try {
    await ElMessageBox.confirm(
      name === "submit"
        ? "确认将完整结算草稿正式提交审核？"
        : "确认记录本次结算审核决定？",
      "结算确认",
    );
    await api(
      `/settlements/${row.id}/${name === "submit" ? "submit" : "review"}`,
      "POST",
      {
        expected_version: row.version?.version_no || 0,
        expected_edit_version: row.draft?.edit_version || 0,
        expected_event_seq: row.review?.event_seq || 0,
        action: name,
      },
    );
    await load();
    emit("changed");
  } catch (e) {
    if (e instanceof Error) ElMessage.error(e.message);
  }
}
async function voidCost(row: Row) {
  await ElMessageBox.confirm("撤销保留原始费用和历史核对。", "撤销费用");
  await api(`/projects/${props.project.id}/costs/${row.entry_id}`, "POST", {
    ...row,
    expected_version: row.version_no,
    status: "voided",
  });
  await load();
}
async function removeBill(row: Row) {
  try {
    await ElMessageBox.confirm(
      "删除将正式注销当前有效结算，取消其当前结算金额及解决量，原始版本继续保留。",
      "删除结算单",
      { type: "warning" },
    );
    await api("/settlements/" + row.id, "DELETE", {
      expected_version: row.version?.version_no || 0,
      expected_edit_version: row.draft?.edit_version || 0,
    });
    await load();
    emit("changed");
  } catch (e) {
    if (e instanceof Error) ElMessage.error(e.message);
  }
}
async function removeFinancial(type: string, row: Row) {
  try {
    await ElMessageBox.confirm(
      type === "nodes"
        ? "删除后该科目及其子级不能新增费用或结算，历史保留。"
        : "删除将正式撤销当前费用，历史和核对记录保留。",
      "确认删除",
    );
    await api(
      `/projects/${props.project.id}/${type}/${type === "costs" ? row.entry_id : row.id}`,
      "DELETE",
      { expected_version: row.version_no },
    );
    await load();
    emit("changed");
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message);
  }
}
async function removeReconciliation(row: Row) {
  try {
    await ElMessageBox.confirm(
      "撤销当前核对份额并从正常列表删除，原始核对及双金额历史保留。",
      "删除费用核对",
    );
    await api("/reconciliations/" + row.record_id, "DELETE", {
      expected_version: row.version_no,
    });
    await load();
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message);
  }
}
async function reconciliationHistory(row: Row) {
  history.value = await api("/reconciliations/" + row.record_id);
}
async function showHistory(row: Row) {
  history.value = await api("/settlements/" + row.id + "/history");
}
useListRoute({
  costPage, billPage, reconPage,
  deletedNodes: showDeletedNodes, deletedCosts: showDeletedCosts, deletedReconciliations: showDeletedReconciliations,
  costsSort: computed({ get: () => financeSort.value.costs, set: value => { financeSort.value.costs = value; } }),
  costsDirection: computed({ get: () => financeDirection.value.costs, set: value => { financeDirection.value.costs = value; } }),
  costsFilters: computed({ get: () => financeFilters.value.costs, set: value => { financeFilters.value.costs = value; } }),
  billsSort: computed({ get: () => financeSort.value.bills, set: value => { financeSort.value.bills = value; } }),
  billsDirection: computed({ get: () => financeDirection.value.bills, set: value => { financeDirection.value.bills = value; } }),
  billsFilters: computed({ get: () => financeFilters.value.bills, set: value => { financeFilters.value.bills = value; } }),
  reconciliationsSort: computed({ get: () => financeSort.value.reconciliations, set: value => { financeSort.value.reconciliations = value; } }),
  reconciliationsDirection: computed({ get: () => financeDirection.value.reconciliations, set: value => { financeDirection.value.reconciliations = value; } }),
  reconciliationsFilters: computed({ get: () => financeFilters.value.reconciliations, set: value => { financeFilters.value.reconciliations = value; } }),
}, load);
watch(() => props.project.id, load, { immediate: true });
</script>
<template>
  <template v-if="evidence"
    ><ElButton @click="evidence = null">关闭附件区</ElButton
    ><EvidencePanel
      :key="evidence.ownerId"
      :owner-kind="evidence.ownerKind"
      :owner-id="evidence.ownerId"
  /></template>
  <div class="metric-grid">
    <div class="metric">
      <span>正式参考价格</span>
      <strong>{{ summary.reference_total_fen == null ? '未完整计价' : '¥' + money(summary.reference_total_fen) }}</strong>
    </div>
    <div class="metric">
      <span>批准预算</span>
      <strong>{{ summary.approved_budget_fen == null ? '尚未批准' : '¥' + money(summary.approved_budget_fen) }}</strong>
    </div>
    <div class="metric">
      <span>真实费用</span><strong>¥{{ money(summary.actual_cost_fen) }}</strong>
    </div>
    <div class="metric">
      <span>已批准结算</span><strong>¥{{ money(summary.settlement_fen) }}</strong>
    </div>
  </div>
  <div class="panel">
    <div class="toolbar" style="flex-wrap:wrap">
      <span>参考价与批准预算差额：<strong>{{ summary.reference_budget_difference_fen == null ? '未具备比较条件' : '¥' + money(summary.reference_budget_difference_fen) }}</strong></span>
      <span>实际费用与参考价差额：<strong>{{ summary.actual_reference_difference_fen == null ? '未具备比较条件' : '¥' + money(summary.actual_reference_difference_fen) }}</strong></span>
      <span>待核对费用：<strong>¥{{ money(summary.unreconciled_cost_fen) }}</strong></span>
    </div>
    <p class="muted">参考价格、批准预算、真实费用和分期结算是不同业务事实，不要求相等。缺少任何需求报价时不显示完整参考总价。</p>
  </div>
  <div class="panel">
    <div class="toolbar">
      <h2>费用科目</h2>
      <ElButton :disabled="!can('write')" @click="edit('node')"
        >新增科目</ElButton
      >
    </div>
    <ElCheckbox v-model="showDeletedNodes">包含已删除科目</ElCheckbox
    ><BusinessTable client-side table-key="finance:nodes" :rows="displayedNodes" :columns="financeColumns.nodes" :actions-width="190">
      <template #cell="{ row, column }">
        <span v-if="column.key === 'parent_id'">{{ project.cost_nodes.find((n: Row) => n.id === row.parent_id)?.name || '根科目' }}</span>
        <ElTag v-else-if="column.key === 'status'" :type="row.deleted ? 'danger' : 'info'" effect="plain">{{ row.deleted ? '已删除' : statusText[row.status] || row.status }}</ElTag>
        <span v-else>{{ row[column.key] ?? '—' }}</span>
      </template>
      <template #actions="{ row }">
        <RowActions :actions="[
          { label: '编辑版本', disabled: !can('write') || row.deleted, run: () => edit('node', row) },
          { label: '删除', danger: true, disabled: !can('admin') || row.deleted, run: () => removeFinancial('nodes', row) },
        ]" />
      </template>
    </BusinessTable>
  </div>
  <div class="panel">
    <div class="toolbar">
      <h2>实际费用</h2>
      <ElCheckbox v-model="showDeletedCosts" @change="costPage = 1; load()"
        >包含已删除费用</ElCheckbox
      >
      <ElButton
        :disabled="!can('cost.confirm')"
        type="primary"
        @click="edit('cost')"
        >核定费用</ElButton
      >
    </div>
    <BusinessTable table-key="finance:costs" :loading="listLoading" :filter-state="financeFilters.costs"
      :sort-state="{ prop: financeSort.costs, order: financeSort.costs ? (financeDirection.costs === 'asc' ? 'ascending' : 'descending') : null }" :rows="costs" :columns="financeColumns.costs" :actions-width="145"
      @sort-change="financeTableSort('costs', $event)" @filter-change="financeTableFilter('costs', $event)">
      <template #cell="{ row, column }">
        <span v-if="column.key === 'amount_fen'">¥{{ money(row.amount_fen) }}</span>
        <ElTag v-else-if="column.key === 'status'" :type="row.deleted ? 'danger' : 'info'" effect="plain">{{ row.deleted ? '已删除' : statusText[row.status] || row.status }}</ElTag>
        <span v-else>{{ row[column.key] ?? '—' }}</span>
      </template>
      <template #actions="{ row }">
        <RowActions :actions="[
          { label: '附件', run: () => evidence = { ownerKind: 'cost_version_id', ownerId: row.id } },
          { label: '更正', disabled: !can('cost.confirm') || row.deleted, run: () => edit('cost', row) },
          { label: '撤销', danger: true, disabled: !can('cost.confirm') || row.deleted, run: () => voidCost(row) },
          { label: '删除', danger: true, disabled: !can('admin') || row.deleted, run: () => removeFinancial('costs', row) },
        ]" />
      </template>
    </BusinessTable>
    <ElPagination v-model:current-page="costPage" :total="costTotal" :page-size="30"
      layout="prev,pager,next,total" @current-change="load" />
  </div>
  <div class="panel">
    <div class="toolbar">
      <h2>独立结算单</h2>
      <ElButton
        type="primary"
        :disabled="!can('write') || project.status !== 'approved'"
        @click="edit('settlement')"
        >新增结算草稿</ElButton
      ><ExchangePanel
        kind="settlements"
        :project-id="project.id"
        :selected-ids="selected.map((x) => x.id)"
        @changed="load"
      />
    </div>
    <BusinessTable table-key="finance:bills" :loading="listLoading" :filter-state="financeFilters.bills"
      :sort-state="{ prop: financeSort.bills, order: financeSort.bills ? (financeDirection.bills === 'asc' ? 'ascending' : 'descending') : null }" :rows="bills" :columns="financeColumns.bills" selectable :actions-width="190"
      @selection-change="selected = $event" @sort-change="financeTableSort('bills', $event)"
      @filter-change="financeTableFilter('bills', $event)">
      <template #cell="{ row, column }">
        <span v-if="column.key === 'review'">第 {{ row.version?.version_no || 0 }} 版 · {{ row.draft ? '有草稿' : statusText[row.review?.action] || '待编制' }}</span>
        <span v-else-if="column.key === 'amount'">¥{{ money((row.draft?.document.items || row.items || []).reduce((sum: number, item: Row) => sum + item.amount_fen, 0)) }}</span>
        <span v-else>{{ row[column.key] ?? '—' }}</span>
      </template>
      <template #actions="{ row }">
        <RowActions :actions="[
          ...(row.review?.action === 'submit' ? [
            { label: '批准', primary: true, disabled: !can('settlement.approve'), run: () => action(row, 'approve') },
            { label: '退回', disabled: !can('settlement.approve'), run: () => action(row, 'return') },
          ] : []),
          ...(row.draft ? [{ label: '正式提交', primary: true, disabled: !can('write'), run: () => action(row, 'submit') }] : []),
          { label: '编制 / 修订', disabled: !can('write'), run: () => edit('settlement', row) },
          ...(row.version ? [{ label: '附件', run: () => evidence = { ownerKind: 'settlement_version_id', ownerId: row.version.id } }] : []),
          { label: '历史', run: () => showHistory(row) },
          { label: '删除', danger: true, disabled: !can('admin'), run: () => removeBill(row) },
        ]" />
      </template>
    </BusinessTable>
    <ElPagination v-model:current-page="billPage" :total="billTotal" :page-size="30"
      layout="prev,pager,next,total" @current-change="load" />
  </div>
  <div class="panel">
    <div class="toolbar">
      <h2>费用与结算核对</h2>
      <ElCheckbox v-model="showDeletedReconciliations" @change="reconPage = 1; load()"
        >包含已删除核对</ElCheckbox
      ><ElButton :disabled="!can('cost.confirm')" @click="edit('reconcile')"
        >新增正式核对</ElButton
      >
    </div>
    <BusinessTable table-key="finance:reconciliations" :loading="listLoading" :filter-state="financeFilters.reconciliations"
      :sort-state="{ prop: financeSort.reconciliations, order: financeSort.reconciliations ? (financeDirection.reconciliations === 'asc' ? 'ascending' : 'descending') : null }" :rows="reconciliations"
      :columns="financeColumns.reconciliations" :actions-width="190"
      @sort-change="financeTableSort('reconciliations', $event)"
      @filter-change="financeTableFilter('reconciliations', $event)">
      <template #cell="{ row, column }">
        <span v-if="column.key === 'reconciled_cost_fen' || column.key === 'reconciled_settlement_fen'">¥{{ money(row[column.key]) }}</span>
        <ElTag v-else-if="column.key === 'status'" effect="plain">{{ row.deleted ? '已删除' : row.status === 'voided' ? '已撤销' : '有效' }}</ElTag>
        <span v-else>{{ row[column.key] ?? '—' }}</span>
      </template>
      <template #actions="{ row }">
        <RowActions :actions="[
          { label: '更正', disabled: !can('cost.confirm') || row.deleted, run: () => edit('reconcile', row) },
          { label: '历史', run: () => reconciliationHistory(row) },
          { label: '删除', danger: true, disabled: !can('cost.confirm') || row.deleted, run: () => removeReconciliation(row) },
        ]" />
      </template>
    </BusinessTable>
    <ElPagination v-model:current-page="reconPage" :total="reconTotal" :page-size="30"
      layout="prev,pager,next,total" @current-change="load" />
  </div>
  <div class="panel">
    <h2>实际解决需求</h2>
    <BusinessTable client-side table-key="finance:demands" :rows="summary.demands || []"
      :columns="financeColumns.demands">
      <template #cell="{ row, column }">
        <span v-if="column.key.endsWith('_quantity_scaled')">{{ quantity(row[column.key]) }}</span>
        <span v-else>{{ row[column.key] ?? '—' }}</span>
      </template>
    </BusinessTable>
  </div>
  <ElDialog append-to-body
    :model-value="!!dialog"
    :title="
      {
        node: '费用科目版本',
        cost: '核定真实费用',
        settlement: '结算草稿',
        reconcile: '正式费用核对',
      }[dialog]
    "
    width="1000px"
    :close-on-click-modal="false"
    :before-close="beforeEditorClose"
    @close="dialog = ''"
    ><ElForm ref="formRef" label-position="top" novalidate :model="form"
      ><div class="form-grid">
        <template v-if="dialog === 'node'"
          ><ElFormItem
            label="名称"
            prop="name"
            :rules="[{ required: true, message: '请填写名称' }]"
            required
            ><ElInput v-model="form.name" /></ElFormItem
          ><ElFormItem label="上级科目"
            ><ElSelect v-model="form.parent_id" clearable :disabled="!!editing"
              ><ElOption
                v-for="n in project.cost_nodes.filter((node: Row) =>
                  enabledPath(node),
                )"
                :key="n.id"
                :value="n.id"
                :label="n.name" /></ElSelect></ElFormItem
          ><ElFormItem label="状态"
            ><ElSelect v-model="form.status"
              ><ElOption label="启用" value="active" /><ElOption
                label="停用"
                value="inactive" /></ElSelect></ElFormItem
        ></template>
        <template v-if="dialog === 'cost'"
          ><ElFormItem
            label="费用事项"
            prop="title"
            :rules="[{ required: true, message: '请填写费用事项' }]"
            required
            ><ElInput v-model="form.title" /></ElFormItem
          ><ElFormItem
            label="末级费用科目"
            prop="cost_node_id"
            :rules="[{ required: true, message: '请填写末级费用科目' }]"
            required
            ><ElSelect v-model="form.cost_node_id" :disabled="!!editing"
              ><ElOption
                v-for="n in project.cost_nodes.filter(
                  (n: Row) =>
                    !project.cost_nodes.some(
                      (child: Row) => child.parent_id === n.id,
                    ),
                )"
                :key="n.id"
                :value="n.id"
                :label="n.name" /></ElSelect></ElFormItem
          ><ElFormItem
            label="实际金额（元）"
            prop="amount_fen"
            :rules="[{ required: true, message: '请填写实际金额（元）' }]"
            required
            ><FieldControl
              v-model="form.amount_fen"
              :field="{ type: 'money' }" /></ElFormItem
          ><ElFormItem
            label="发生日期"
            prop="occurred_on"
            :rules="[{ required: true, message: '请填写发生日期' }]"
            required
            ><ElDatePicker
              v-model="form.occurred_on"
              value-format="YYYY-MM-DD" /></ElFormItem
          ><ElFormItem
            label="费用凭据"
            prop="evidence"
            :rules="[{ required: true, message: '请填写费用凭据' }]"
            required
            class="full-width"
            ><ElInput v-model="form.evidence" type="textarea" /></ElFormItem
        ></template>
        <template v-if="dialog === 'settlement'"
          ><ElFormItem label="结算日期"
            ><ElDatePicker
              v-model="form.settlement_on"
              value-format="YYYY-MM-DD" /></ElFormItem
          ><ElFormItem
            label="采用批准版本"
            prop="approval_version_id"
            :rules="[{ required: true, message: '请填写采用批准版本' }]"
            required
            ><ElSelect v-model="form.approval_version_id"
              ><ElOption
                v-for="ap in project.approvals.filter(
                  (x: Row) => x.status === 'approved',
                )"
                :key="ap.id"
                :value="ap.id"
                :label="'批准第' + ap.version_no" /></ElSelect></ElFormItem
          ><ElFormItem label="结算依据"
            ><ElInput v-model="form.basis" /></ElFormItem
          ><ElFormItem v-if="editing?.version" label="修订动作"
            ><ElSelect v-model="form.change_type"
              ><ElOption label="完整修订" value="revision" /><ElOption
                label="正式注销"
                value="void" /></ElSelect></ElFormItem
        ></template>
        <template v-if="dialog === 'reconcile'"
          ><ElFormItem
            label="实际费用"
            prop="cost_version_id"
            :rules="[{ required: true, message: '请填写实际费用' }]"
            required
            ><ElSelect v-model="form.cost_version_id"
              ><ElOption
                v-for="cost in costs.filter((x) => x.status === 'active')"
                :key="cost.id"
                :value="cost.id"
                :label="
                  cost.title + ' ¥' + money(cost.amount_fen)
                " /></ElSelect></ElFormItem
          ><ElFormItem
            label="已批准结算明细"
            prop="settlement_item_version_id"
            :rules="[{ required: true, message: '请填写已批准结算明细' }]"
            required
            ><ElSelect v-model="form.settlement_item_version_id"
              ><template
                v-for="bill in bills.filter(
                  (x) => x.review?.action === 'approve',
                )"
                :key="bill.id"
                ><ElOption
                  v-for="item in bill.items"
                  :key="item.id"
                  :value="item.id"
                  :label="
                    bill.number + ' ¥' + money(item.amount_fen)
                  " /></template></ElSelect></ElFormItem
          ><ElFormItem
            label="费用份额（元）"
            prop="reconciled_cost_fen"
            :rules="[{ required: true, message: '请填写费用份额（元）' }]"
            required
            ><FieldControl
              v-model="form.reconciled_cost_fen"
              :field="{ type: 'money' }" /></ElFormItem
          ><ElFormItem
            label="核定结算额（元）"
            prop="reconciled_settlement_fen"
            :rules="[{ required: true, message: '请填写核定结算额（元）' }]"
            required
            ><FieldControl
              v-model="form.reconciled_settlement_fen"
              :field="{ type: 'money' }" /></ElFormItem
          ><ElFormItem label="核对依据"
            ><ElInput v-model="form.evidence" /></ElFormItem
          ><ElFormItem label="最终核对"
            ><ElSwitch v-model="form.is_final" /></ElFormItem
        ></template>
      </div>
      <template v-if="dialog === 'settlement' && form.change_type !== 'void'"
        ><h3>本次费用明细</h3>
        <div v-for="(item, index) in form.items" :key="index" class="panel">
          <div class="form-grid">
            <ElFormItem label="费用科目" required
              ><ElSelect v-model="item.cost_node_id"
                ><ElOption
                  v-for="node in activeLeaves"
                  :key="node.id"
                  :value="node.id"
                  :label="node.name" /></ElSelect></ElFormItem
            ><ElFormItem label="关联需求（共同费用可不选）"
              ><ElSelect v-model="item.project_scope_id" clearable
                ><ElOption
                  v-for="scope in project.scopes"
                  :key="scope.id"
                  :value="scope.id"
                  :label="
                    scope.demand_no || scope.demand_id
                  " /></ElSelect></ElFormItem
            ><ElFormItem label="费用计价数量"
              ><FieldControl
                v-model="item.quantity_scaled"
                :field="{ type: 'quantity' }" /></ElFormItem
            ><ElFormItem label="本次金额（元）" required
              ><FieldControl
                v-model="item.amount_fen"
                :field="{ type: 'money' }" /></ElFormItem
            ><ElFormItem label="依据" required
              ><ElInput v-model="item.evidence"
            /></ElFormItem>
          </div>
          <ElButton type="danger" @click="form.items.splice(index, 1)"
            >删除本行</ElButton
          >
        </div>
        <ElButton
          @click="
            form.items.push({ quantity_scaled: 0, amount_fen: 0, evidence: '' })
          "
          >添加费用明细</ElButton
        >
        <h3>本次新增解决需求</h3>
        <ElAlert
          title="实际解决数量独立于费用计价数量。只补结费用时填写0。"
          type="info"
          :closable="false"
        />
        <div v-for="(r, index) in form.resolutions" :key="index" class="panel">
          <div class="form-grid">
            <ElFormItem label="项目需求" required
              ><ElSelect v-model="r.project_scope_id"
                ><ElOption
                  v-for="scope in project.scopes"
                  :key="scope.id"
                  :value="scope.id"
                  :label="
                    scope.demand_no || scope.demand_id
                  " /></ElSelect></ElFormItem
            ><ElFormItem label="本次新增解决量" required
              ><FieldControl
                v-model="r.resolved_quantity_scaled"
                :field="{ type: 'quantity' }" /></ElFormItem
            ><ElFormItem label="完成依据"
              ><ElInput v-model="r.evidence"
            /></ElFormItem>
          </div>
          <ElButton type="danger" @click="form.resolutions.splice(index, 1)"
            >删除本行</ElButton
          >
        </div>
        <ElButton
          @click="
            form.resolutions.push({ resolved_quantity_scaled: 0, evidence: '' })
          "
          >添加解决需求</ElButton
        ></template
      ></ElForm
    ><template #footer
      ><ElButton @click="closeEditor">取消</ElButton
      ><ElButton
        :disabled="
          !can(
            dialog === 'cost' || dialog === 'reconcile'
              ? 'cost.confirm'
              : 'write',
          )
        "
        type="primary"
        :loading="busy"
        @click="save"
        >{{ dialog === "settlement" ? "保存草稿" : "保存" }}</ElButton
      ></template
    ></ElDialog
  >
  <ElDialog append-to-body
    :model-value="!!history"
    title="正式版本历史"
    width="950px"
    @close="history = null"
  >
    <BusinessHistory :value="history" />
  </ElDialog>
</template>

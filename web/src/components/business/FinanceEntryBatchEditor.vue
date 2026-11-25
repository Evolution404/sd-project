<template>
  <el-dialog :model-value="true" :title="title" width="min(92vw, 1450px)" append-to-body
    :close-on-click-modal="false" :show-close="!busy" :close-on-press-escape="!busy" :before-close="beforeDialogClose">
    <div :aria-label="title">
      <el-text v-if="kind === 'nodes' && !revising">上级科目 {{ parent?.name || "无（一级科目）" }}</el-text>
      <el-alert v-if="error" type="error" :title="error" :closable="false" class="mb-2" />
      <BusinessWorksheet ref="sheet" :name="title + '明细'" :rows="rows" :columns="columns" session-key="finance-batch"
        :disabled="busy" :validate="validate" removable remove-label="移除选中明细"
        @rows-change="rows = $event" @readiness-change="ready = $event">
        <template #toolbar>
          <template v-if="!revising && kind !== 'reconciliations'">
            <el-input-number v-model="newCount" aria-label="新增行数" :min="1" :max="maxNewRows" :precision="0"
              :disabled="!ready || busy || rows.length >= MAX_FINANCE_ENTRY_BATCH" />
            <el-button :disabled="!ready || busy || !newCount || rows.length >= MAX_FINANCE_ENTRY_BATCH" @click="addBlankRows">新增录入行</el-button>
          </template>
          <el-button v-if="revising || kind === 'reconciliations'" :disabled="!ready || busy || rows.length >= MAX_FINANCE_ENTRY_BATCH"
            @click="picker = 'records'">{{ recordLabel }}</el-button>
          <el-button v-if="!revising && kind === 'costs'" :disabled="!ready || busy || !rows.length"
            @click="openReferencePicker('category')">选择费用科目</el-button>
          <el-button v-if="!revising && kind === 'reconciliations'" :disabled="!ready || busy || !rows.length"
            @click="openReferencePicker('item')">选择生效结算明细</el-button>
        </template>
      </BusinessWorksheet>
      <el-alert v-if="issues.length" type="error" title="请修正以下明细后重新预检" :closable="false" class="mt-2">
        <div v-for="issue in issues" :key="issue.ref + '/' + issue.field">
          <el-button link type="danger" @click="sheet?.focusField(issue.ref, issue.field || '')">明细 {{ issue.ref }}</el-button>
          {{ issue.message }}
        </div>
      </el-alert>
      <el-alert v-else-if="prepared" type="success" :title="'已预检 ' + rows.length + ' 条明细'" :closable="false" class="mt-2" />
    </div>
    <template #footer>
      <el-button :disabled="busy" @click="closeEditor">关闭</el-button>
      <el-button :disabled="busy || !ready || !rows.length" @click="preflight">预检明细</el-button>
      <el-button type="primary" :loading="busy" :disabled="!prepared" @click="commit">{{ commitLabel }}</el-button>
    </template>
  </el-dialog>
  <CostCategoryPicker v-if="picker === 'category'" :nodes="nodes" @confirm="assignCategory" @close="picker = ''" />
  <NativeRecordPicker v-if="picker === 'records'" :title="recordLabel" :columns="recordColumns"
    placeholder="搜索名称、编号或依据" confirm-label="添加所选记录" :loader="loadRecords"
    @confirm="addRecords" @close="picker = ''" />
  <NativeRecordPicker v-if="picker === 'item'" single title="选择生效结算明细" :columns="itemPickerColumns"
    placeholder="搜索结算单编号或费用科目" confirm-label="确认选择" :loader="loadItems"
    @confirm="assignItem" @close="picker = ''" />
</template>

<script setup lang="ts">
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, ref, shallowRef } from "vue";
import BusinessWorksheet from "@/components/BusinessWorksheet/BusinessWorksheet.vue";
import type { WorksheetColumn, WorksheetIssue, WorksheetRow, WorksheetValues } from "@/components/BusinessWorksheet/univer-engine";
import { listActualCosts, listCostReconciliations, listReconciliationItems, submitFinanceEntryBatch,
  type ActualCost, type CostNode, type CostReconciliation, type ReconciliationItem } from "@/api/business/finance";
import { fenToYuan, yuanToFen } from "@/api/business/funding";
import { randomRequestId } from "@/utils/business/request-id";
import { MAX_FINANCE_ENTRY_BATCH, type FinanceEntryBatch, type FinanceEntryBatchIssue } from "../../../../server/shared/types/finance-workflows";
import CostCategoryPicker from "./CostCategoryPicker.vue";
import NativeRecordPicker from "./NativeRecordPicker.vue";

const props = defineProps<{ projectId: string; settlementId?: string; nodes: CostNode[];
  kind: FinanceEntryBatch["kind"]; revising: boolean; parent?: CostNode }>();
const emit = defineEmits<{ close: []; saved: [] }>();
type RecordChoice = { id: string; label: string; category: string; version: number; date?: string;
  node?: CostNode; cost?: ActualCost; reconciliation?: CostReconciliation };
type ItemChoice = ReconciliationItem & { amount: string };
interface Bindings { node?: CostNode; cost?: ActualCost; reconciliation?: CostReconciliation; category?: CostNode; item?: ReconciliationItem }

const rows = shallowRef<readonly WorksheetRow[]>([]);
const bindings = new WeakMap<WorksheetRow, Bindings>();
const sheet = ref<InstanceType<typeof BusinessWorksheet>>();
const ready = ref(false), busy = ref(false), error = ref("");
const picker = ref<"" | "records" | "category" | "item">("");
const issues = ref<FinanceEntryBatchIssue[]>([]);
const prepared = ref<{ fingerprint: string; requestKey: string; input: string }>();
let sequence = 0;
let targets = new Set<string>();
const newCount = ref<number | undefined>(1);
const maxNewRows = computed(() => Math.max(1, MAX_FINANCE_ENTRY_BATCH - rows.value.length));
const title = computed(() => props.kind === "nodes" ? (props.revising ? "批量修订同级费用科目" : "批量新增费用科目")
  : props.kind === "costs" ? (props.revising ? "批量修订实际费用" : "批量登记实际费用")
    : (props.revising ? "批量修订费用核对" : "批量新增费用核对"));
const recordLabel = computed(() => props.kind === "nodes" ? "选择待修订科目"
  : props.kind === "costs" ? "选择待修订实际费用"
    : props.revising ? "选择待修订核对" : "选择实际费用");
const commitLabel = computed(() => props.kind === "costs" ? "整批核定费用" : "整批保存");
const recordColumns: { key: keyof RecordChoice; label: string }[] = [
  { key: "label", label: "名称或费用事项" }, { key: "category", label: "费用科目或上级" },
  { key: "version", label: "当前版本" }, { key: "date", label: "发生日期" },
];
const itemPickerColumns: { key: keyof ItemChoice; label: string }[] = [
  { key: "number", label: "结算编号" }, { key: "cost_node_name", label: "费用科目" },
  { key: "demand_no", label: "需求编号" }, { key: "amount", label: "结算金额（元）" },
];

const money = (key: string, title: string): WorksheetColumn => ({ key, title, width: 145, numeric: true, editable: true, required: true });
const columns = computed<WorksheetColumn[]>(() => {
  if (props.kind === "nodes") return [
    { key: "parent", title: "上级科目", width: 220 },
    { key: "name", title: "科目名称", width: 250, editable: true, required: true },
    { key: "reason", title: "说明", width: 300, editable: true },
  ];
  if (props.kind === "costs") return [
    { key: "cost_node_id", title: "费用科目", width: 150 },
    { key: "title", title: "费用事项", width: 195, editable: true, required: true },
    money("amount_fen", "实际金额（元）"),
    { key: "occurred_on", title: "发生日期", width: 136, editable: true, required: true },
    { key: "invoice_number", title: "发票号", width: 145, editable: true },
    { key: "evidence", title: "费用凭据", width: 230, editable: true, required: true },
    { key: "reason", title: "说明", width: 205, editable: true },
  ];
  return [
    { key: "cost_version_id", title: "实际费用事项", width: 185 },
    { key: "cost_version", title: "费用版本", width: 97 },
    { key: "settlement_item_version_id", title: "结算编号", width: 135 },
    { key: "category", title: "费用科目", width: 135 },
    money("reconciled_cost_fen", "核对实际费用（元）"),
    money("reconciled_settlement_fen", "核对结算金额（元）"),
    { key: "is_final", title: "最终核对", width: 108, editable: true, options: ["否", "是"], required: true },
    { key: "evidence", title: "核对依据", width: 230, editable: true },
  ];
});

function worksheetRow(binding: Bindings = {}, id = String(++sequence)): WorksheetRow {
  const { node, cost, reconciliation, category, item } = binding;
  const byId = (key?: string | null) => props.nodes.find(candidate => candidate.id === key);
  const values: Record<string, string> = {};
  if (props.kind === "nodes") Object.assign(values, {
    parent: (node ? byId(node.parent_id) : props.parent)?.name || "",
    name: node?.name || "", reason: "",
  });
  else if (props.kind === "costs") Object.assign(values, {
    cost_node_id: cost?.cost_node_name || category?.name || "", title: cost?.title || "",
    amount_fen: cost ? fenToYuan(cost.amount_fen) : "", occurred_on: cost?.occurred_on || "",
    invoice_number: cost?.invoice_number || "", evidence: cost?.evidence || "", reason: "",
  });
  else Object.assign(values, {
    cost_version_id: cost?.title || reconciliation?.cost_title || "",
    cost_version: String(cost?.version_no || reconciliation?.cost_version || ""),
    settlement_item_version_id: item?.number || reconciliation?.settlement_number || "",
    category: item?.cost_node_name || cost?.cost_node_name || reconciliation?.item_cost_node_name || "",
    reconciled_cost_fen: reconciliation ? fenToYuan(reconciliation.reconciled_cost_fen) : "",
    reconciled_settlement_fen: reconciliation ? fenToYuan(reconciliation.reconciled_settlement_fen) : "",
    is_final: reconciliation?.is_final ? "是" : "否", evidence: reconciliation?.evidence || "",
  });
  const row: WorksheetRow = { id, label: values.name || values.title || values.cost_version_id || "明细 " + id, values };
  bindings.set(row, binding);
  return row;
}
async function addBlankRows() {
  const count = newCount.value;
  if (!count || !Number.isSafeInteger(count) || count < 1 || count > maxNewRows.value) return;
  await sheet.value?.addRows(Array.from({ length: count }, () => worksheetRow()));
}
function loadFrom<T>(items: T[], page: number) {
  return { total: items.length, items: items.slice((page - 1) * 20, page * 20) };
}
async function loadRecords(keyword: string, page: number): Promise<{ items: RecordChoice[]; total: number }> {
  if (props.kind === "nodes") {
    const matches = props.nodes.filter(node => !node.deleted && node.name.includes(keyword));
    return loadFrom(matches.map(node => ({ id: node.id, node, label: node.name, version: node.version_no,
      category: props.nodes.find(parent => parent.id === node.parent_id)?.name || "" })), page);
  }
  if (props.kind === "reconciliations" && props.revising) {
    const filters: Record<string, string> = { status: "active" };
    if (props.settlementId) filters.settlement_id = props.settlementId;
    const result = await listCostReconciliations(props.projectId, page, 20, keyword, { filters });
    return { ...result, items: result.items.map(reconciliation => ({
      id: reconciliation.record_id, reconciliation, label: reconciliation.cost_title,
      category: reconciliation.item_cost_node_name, version: reconciliation.version_no,
    })) };
  }
  const result = await listActualCosts(props.projectId, page, 20, keyword, false, { filters: { status: "active" } });
  return { ...result, items: result.items.map(cost => ({ id: cost.entry_id, cost, label: cost.title,
    category: cost.cost_node_name, version: cost.version_no, date: cost.occurred_on })) };
}
async function addRecords(choices: RecordChoice[]) {
  const existing = rows.value.map(row => bindings.get(row)!);
  const selected = choices.filter(choice => !existing.some(binding =>
    binding.node?.id === choice.id || (props.revising && binding.cost?.entry_id === choice.id) ||
    binding.reconciliation?.record_id === choice.id));
  if (selected.length > maxNewRows.value) return ElMessage.warning("所选记录超过单批上限");
  if (props.kind === "nodes" && new Set([...existing.map(binding => binding.node?.parent_id),
    ...selected.map(choice => choice.node?.parent_id)]).size > 1) return ElMessage.warning("请选取同一上级的费用科目");
  if (selected.length) await sheet.value?.addRows(selected.map(({ node, cost, reconciliation }) => worksheetRow({ node, cost, reconciliation })));
  picker.value = "";
}
async function openReferencePicker(next: "category" | "item") {
  targets = new Set(sheet.value?.selectedRowIds() || []);
  if (!targets.size) return ElMessage.warning("请先在工作表选择要设置引用的行");
  const chosen = rows.value.filter(row => targets.has(row.id)).map(row => bindings.get(row)!);
  if (next === "item" && new Set(chosen.map(row => row.cost?.cost_node_id)).size !== 1)
    return ElMessage.warning("请选择同一费用科目的工作表行");
  await sheet.value?.finishEditing();
  picker.value = next;
}
async function applyReferences(next: Partial<Bindings>) {
  const additions = rows.value.filter(row => targets.has(row.id)).map(row => worksheetRow({ ...bindings.get(row), ...next }, row.id));
  picker.value = "";
  await sheet.value?.replaceRowReferences(additions);
}
async function assignCategory(id: string) {
  const category = props.nodes.find(row => row.id === id && row.selectable);
  if (category) await applyReferences({ category });
}
async function loadItems(keyword: string, page: number) {
  const chosen = rows.value.find(row => targets.has(row.id));
  const category = chosen && bindings.get(chosen)?.cost?.cost_node_id;
  if (!category) return { items: [], total: 0 };
  const filters: Record<string, string> = { cost_node_id: category };
  if (props.settlementId) filters.settlement_id = props.settlementId;
  const result = await listReconciliationItems(props.projectId, keyword, page, filters);
  return { ...result, items: result.items.map(item => ({ ...item, amount: fenToYuan(item.amount_fen) })) };
}
async function assignItem(items: ItemChoice[]) {
  if (items[0]) await applyReferences({ item: items[0] });
}
function validate(values: WorksheetValues) {
  const failures: WorksheetIssue[] = [];
  for (const [index, row] of rows.value.entries()) {
    const input = values[row.id];
    if (!input) continue;
    const issue = (field: string, message: string) => failures.push({ row: index + 1, rowId: row.id, field,
      column: columns.value.findIndex(column => column.key === field), cell: "", location: row.label, message });
    for (const column of columns.value) {
      const value = input[column.key]?.trim();
      if (column.required && !value) issue(column.key, "请填写" + column.title);
      else if (column.numeric) {
        try {
          if (!yuanToFen(value) && props.kind === "costs") issue(column.key, "实际金额须大于 0 元");
        } catch (cause) { issue(column.key, (cause as Error).message); }
      } else if (column.options && !column.options.includes(value)) issue(column.key, "请选择合法选项");
    }
    const binding = bindings.get(row)!;
    if (props.kind === "costs" && !binding.cost && !binding.category) issue("cost_node_id", "请选择有效的末级费用科目");
    if (props.kind === "reconciliations" && !binding.reconciliation && !binding.item)
      issue("settlement_item_version_id", "请选择生效结算明细");
  }
  return failures;
}
function batchInput(values: WorksheetValues): FinanceEntryBatch {
  const kind = props.kind;
  if (kind === "nodes") return { kind, rows: rows.value.map(row => {
    const node = bindings.get(row)?.node;
    const { name, reason } = values[row.id];
    return { kind, ref: row.id, id: node?.id, values: { name, reason,
      parent_id: node ? node.parent_id : props.parent?.id ?? null, expected_version: node?.version_no } };
  }) };
  if (kind === "costs") return { kind, rows: rows.value.map(row => {
    const { cost, category } = bindings.get(row)!;
    const { title, amount_fen, occurred_on, invoice_number, evidence, reason } = values[row.id];
    return { kind, ref: row.id, id: cost?.entry_id, values: { title, amount_fen: yuanToFen(amount_fen),
      occurred_on, invoice_number: invoice_number || null, evidence, reason,
      cost_node_id: cost?.cost_node_id || category?.id, expected_version: cost?.version_no } };
  }) };
  return { kind, rows: rows.value.map(row => {
    const { reconciliation, cost, item } = bindings.get(row)!;
    const { reconciled_cost_fen, reconciled_settlement_fen, evidence, is_final } = values[row.id];
    return { kind, ref: row.id, id: reconciliation?.record_id, values: {
      expected_version: reconciliation?.version_no,
      cost_version_id: reconciliation?.cost_version_id || cost?.id,
      settlement_item_version_id: reconciliation?.settlement_item_version_id || item?.id,
      reconciled_cost_fen: yuanToFen(reconciled_cost_fen), reconciled_settlement_fen: yuanToFen(reconciled_settlement_fen),
      is_final: is_final === "是", evidence,
    } };
  }) };
}
async function mayLeave() {
  if (busy.value) return false;
  if (!rows.value.length) return true;
  try {
    await ElMessageBox.confirm("关闭将放弃尚未提交的批量明细。", "放弃批量录入",
      { confirmButtonText: "放弃修改", cancelButtonText: "继续填写", type: "warning" });
    return true;
  } catch { return false; }
}
async function closeEditor() {
  if (await mayLeave()) emit("close");
}
async function beforeDialogClose(done: () => void) {
  if (!await mayLeave()) return;
  done();
  emit("close");
}
defineExpose({ mayLeave });
async function preflight() {
  if (busy.value) return;
  error.value = ""; issues.value = []; prepared.value = undefined;
  busy.value = true;
  try {
    const values = await sheet.value?.prepareSave();
    if (!values) return;
    const input = batchInput(values);
    const result = await submitFinanceEntryBatch(props.projectId, input);
    issues.value = result.issues;
    if (result.fingerprint) prepared.value = { fingerprint: result.fingerprint, requestKey: randomRequestId(), input: JSON.stringify(input) };
  } catch (cause) { error.value = (cause as Error).message; }
  finally { busy.value = false; }
}
async function commit() {
  if (!prepared.value || busy.value) return;
  const proof = prepared.value;
  busy.value = true;
  try {
    const values = await sheet.value?.prepareSave();
    if (!values) return;
    const input = batchInput(values);
    if (JSON.stringify(input) !== proof.input) {
      prepared.value = undefined; error.value = "录入内容已变化，请重新预检";
      return;
    }
    await ElMessageBox.confirm("确认后将一次写入 " + input.rows.length + " 条正式记录。", commitLabel.value,
      { confirmButtonText: "确认提交", cancelButtonText: "继续核对" });
    const result = await submitFinanceEntryBatch(props.projectId, input, proof);
    issues.value = result.issues;
    if (issues.value.length) { prepared.value = undefined; return; }
    ElMessage.success("已整批保存 " + result.count + " 条明细");
    emit("saved");
  } catch (cause) {
    if (cause !== "cancel" && cause !== "close") error.value = (cause as Error).message;
  } finally { busy.value = false; }
}
</script>

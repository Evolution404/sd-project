<script setup lang="ts">
import BusinessHistory from "./BusinessHistory.vue";
import { useAccess } from "../services/access";
const can = useAccess();
import { ref, watch, computed } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import FieldControl from "./FieldControl.vue";
import ExchangePanel from "./ExchangePanel.vue";
import EvidencePanel from "./EvidencePanel.vue";
const evidence = ref<Row | null>(null);
import {
  api,
  today,
  type Row,
  money,
  quantity,
  statusText,
} from "../services/api";
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
  bills = ref<Row[]>([]),
  summary = ref<Row>({}),
  dialog = ref(""),
  form = ref<Row>({}),
  editing = ref<Row | null>(null),
  busy = ref(false),
  selected = ref<Row[]>([]),
  history = ref<Row | null>(null),
  reconciliations = ref<Row[]>([]);
const costPage = ref(1),
  billPage = ref(1),
  costTotal = ref(0),
  billTotal = ref(0);
async function load() {
  const costResult = await api(
      `/projects/${props.project.id}/costs?page=${costPage.value}&page_size=30&deleted=${showDeletedCosts.value}`,
    ),
    billResult = await api(
      `/projects/${props.project.id}/settlements?page=${billPage.value}&page_size=30`,
    );
  costs.value = costResult.items;
  costTotal.value = costResult.total;
  bills.value = billResult.items;
  billTotal.value = billResult.total;
  summary.value = await api(`/projects/${props.project.id}/summary`);
  reconciliations.value = (
    await api(
      `/reconciliations?page_size=200&project_id=${props.project.id}&deleted=${showDeletedReconciliations.value}`,
    )
  ).items;
}
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
}
async function save() {
  if (!(await formRef.value?.validate().catch(() => false))) return;
  busy.value = true;
  try {
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
    dialog.value = "";
    await load();
    emit("changed");
    ElMessage.success("已保存");
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
      <span>批准预算</span
      ><strong>{{ money(summary.approved_budget_fen) }}</strong>
    </div>
    <div class="metric">
      <span>真实费用</span><strong>{{ money(summary.actual_cost_fen) }}</strong>
    </div>
    <div class="metric">
      <span>已批准结算</span
      ><strong>{{ money(summary.settlement_fen) }}</strong>
    </div>
    <div class="metric">
      <span>待核对费用</span
      ><strong>{{ money(summary.unreconciled_cost_fen) }}</strong>
    </div>
  </div>
  <div class="panel">
    <div class="toolbar">
      <h2>费用科目</h2>
      <ElButton :disabled="!can('write')" @click="edit('node')"
        >新增科目</ElButton
      >
    </div>
    <ElCheckbox v-model="showDeletedNodes">包含已删除科目</ElCheckbox
    ><ElTable :data="displayedNodes"
      ><ElTableColumn prop="name" label="科目名称" /><ElTableColumn label="上级"
        ><template #default="{ row }">{{
          project.cost_nodes.find((n: Row) => n.id === row.parent_id)?.name ||
          "根科目"
        }}</template></ElTableColumn
      ><ElTableColumn label="状态"
        ><template #default="{ row }">{{
          statusText[row.status] || row.status
        }}</template></ElTableColumn
      ><ElTableColumn label="操作"
        ><template #default="{ row }"
          ><ElButton
            :disabled="!can('write')"
            size="small"
            @click="edit('node', row)"
            >编辑版本</ElButton
          ><ElButton
            :disabled="!can('admin')"
            size="small"
            type="danger"
            @click="removeFinancial('nodes', row)"
            >删除</ElButton
          ></template
        ></ElTableColumn
      ></ElTable
    >
  </div>
  <div class="panel">
    <div class="toolbar">
      <h2>实际费用</h2>
      <ElCheckbox v-model="showDeletedCosts" @change="load"
        >包含已删除费用</ElCheckbox
      >
      <ElButton
        :disabled="!can('cost.confirm')"
        type="primary"
        @click="edit('cost')"
        >核定费用</ElButton
      >
    </div>
    <ElTable :data="costs"
      ><ElTableColumn prop="title" label="事项" min-width="160" /><ElTableColumn
        prop="occurred_on"
        label="发生日期"
        width="120"
      /><ElTableColumn label="实际金额"
        ><template #default="{ row }"
          >¥{{ money(row.amount_fen) }}</template
        ></ElTableColumn
      ><ElPagination
        v-model:current-page="costPage"
        :total="costTotal"
        :page-size="30"
        layout="prev,pager,next,total"
        @current-change="load"
      /><ElTableColumn label="状态"
        ><template #default="{ row }">{{
          statusText[row.status] || row.status
        }}</template></ElTableColumn
      ><ElTableColumn label="操作" min-width="180"
        ><template #default="{ row }"
          ><ElButton
            size="small"
            @click="
              evidence = { ownerKind: 'cost_version_id', ownerId: row.id }
            "
            >附件</ElButton
          ><ElButton
            :disabled="!can('cost.confirm')"
            size="small"
            @click="edit('cost', row)"
            >更正</ElButton
          ><ElButton
            :disabled="!can('cost.confirm')"
            size="small"
            type="danger"
            @click="voidCost(row)"
            >撤销</ElButton
          ><ElButton
            :disabled="!can('admin')"
            size="small"
            type="danger"
            @click="removeFinancial('costs', row)"
            >删除</ElButton
          ></template
        ></ElTableColumn
      ></ElTable
    >
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
    <ElTable :data="bills" @selection-change="selected = $event"
      ><ElTableColumn type="selection" width="40" /><ElTableColumn
        prop="number"
        label="结算编号"
        min-width="140"
      /><ElTableColumn label="正式版本 / 状态" min-width="150"
        ><template #default="{ row }"
          >V{{ row.version?.version_no || 0 }} ·
          {{
            row.draft ? "有草稿" : statusText[row.review?.action] || "待编制"
          }}</template
        ></ElTableColumn
      ><ElPagination
        v-model:current-page="billPage"
        :total="billTotal"
        :page-size="30"
        layout="prev,pager,next,total"
        @current-change="load"
      /><ElTableColumn label="本次金额"
        ><template #default="{ row }"
          >¥{{
            money(
              (row.draft?.document.items || row.items).reduce(
                (sum: number, item: Row) => sum + item.amount_fen,
                0,
              ),
            )
          }}</template
        ></ElTableColumn
      ><ElTableColumn label="操作" min-width="350"
        ><template #default="{ row }"
          ><ElButton
            :disabled="!can('write')"
            size="small"
            @click="edit('settlement', row)"
            >编制 / 修订</ElButton
          ><ElButton
            :disabled="!can('write')"
            v-if="row.draft"
            size="small"
            @click="action(row, 'submit')"
            >正式提交</ElButton
          ><ElButton
            :disabled="!can('settlement.approve')"
            v-if="row.review?.action === 'submit'"
            size="small"
            type="primary"
            @click="action(row, 'approve')"
            >批准</ElButton
          ><ElButton
            :disabled="!can('settlement.approve')"
            v-if="row.review?.action === 'submit'"
            size="small"
            @click="action(row, 'return')"
            >退回</ElButton
          ><ElButton
            v-if="row.version"
            size="small"
            @click="
              evidence = {
                ownerKind: 'settlement_version_id',
                ownerId: row.version.id,
              }
            "
            >附件</ElButton
          ><ElButton size="small" @click="showHistory(row)">历史</ElButton
          ><ElButton
            :disabled="!can('admin')"
            size="small"
            type="danger"
            @click="removeBill(row)"
            >删除</ElButton
          ></template
        ></ElTableColumn
      ></ElTable
    >
  </div>
  <div class="panel">
    <div class="toolbar">
      <h2>费用与结算核对</h2>
      <ElCheckbox v-model="showDeletedReconciliations" @change="load"
        >包含已删除核对</ElCheckbox
      ><ElButton :disabled="!can('cost.confirm')" @click="edit('reconcile')"
        >新增正式核对</ElButton
      >
    </div>
    <ElTable :data="reconciliations"
      ><ElTableColumn label="实际费用份额"
        ><template #default="{ row }">{{
          money(row.reconciled_cost_fen)
        }}</template></ElTableColumn
      ><ElTableColumn label="结算核定额"
        ><template #default="{ row }">{{
          money(row.reconciled_settlement_fen)
        }}</template></ElTableColumn
      ><ElTableColumn prop="evidence" label="核对依据" /><ElTableColumn
        label="状态"
        ><template #default="{ row }">{{
          row.deleted ? "已删除" : row.status === "voided" ? "已撤销" : "有效"
        }}</template></ElTableColumn
      ><ElTableColumn label="操作" min-width="230"
        ><template #default="{ row }"
          ><ElButton
            :disabled="!can('cost.confirm') || row.deleted"
            @click="edit('reconcile', row)"
            >更正</ElButton
          ><ElButton @click="reconciliationHistory(row)">历史</ElButton
          ><ElButton
            type="danger"
            :disabled="!can('cost.confirm') || row.deleted"
            @click="removeReconciliation(row)"
            >删除</ElButton
          ></template
        ></ElTableColumn
      ></ElTable
    >
  </div>
  <div class="panel">
    <h2>实际解决需求</h2>
    <ElTable :data="summary.demands"
      ><ElTableColumn
        prop="demand_no"
        label="需求编号"
        min-width="200"
      /><ElTableColumn label="批准数量"
        ><template #default="{ row }">{{
          quantity(row.approved_quantity_scaled)
        }}</template></ElTableColumn
      ><ElTableColumn label="已解决"
        ><template #default="{ row }">{{
          quantity(row.resolved_quantity_scaled)
        }}</template></ElTableColumn
      ><ElTableColumn label="未解决 / 超量"
        ><template #default="{ row }"
          >{{ quantity(row.remaining_quantity_scaled) }} /
          {{ quantity(row.excess_quantity_scaled) }}</template
        ></ElTableColumn
      ></ElTable
    >
  </div>
  <ElDialog
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
                :label="'批准 V' + ap.version_no" /></ElSelect></ElFormItem
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
      ><ElButton @click="dialog = ''">取消</ElButton
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
  <ElDialog
    :model-value="!!history"
    title="正式版本历史"
    width="950px"
    @close="history = null"
  >
    <BusinessHistory :value="history" />
  </ElDialog>
</template>

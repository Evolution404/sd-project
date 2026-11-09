<script setup lang="ts">
import BusinessHistory from "../components/BusinessHistory.vue";
import { useAccess } from "../services/access";
const can = useAccess();
import { ref, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import FieldControl from "../components/FieldControl.vue";
import BusinessTable, { type TableColumn } from "../components/BusinessTable.vue";
import PricingQuoteDialog from "../components/PricingQuoteDialog.vue";
import FinancePanel from "../components/FinancePanel.vue";
import { api, type Row, money, quantity, statusText } from "../services/api";
const formRef = ref(),
  actors = ref<Row[]>([]);
const props = defineProps<{ financeOnly?: boolean }>();
const rows = ref<Row[]>([]),
  total = ref(0),
  page = ref(1),
  query = ref(""),
  sortKey = ref(""),
  sortDirection = ref("desc"),
  columnFilters = ref<Record<string, string>>({}),
  detail = ref<Row | null>(null),
  dialog = ref(""),
  form = ref<Row>({}),
  editing = ref<Row | null>(null),
  busy = ref(false),
  demands = ref<Row[]>([]),
  history = ref<Row | null>(null),
  tab = ref("scope"),
  approvalRows = ref<Row[]>([]),
  priceScopeContext = ref<Row | null>(null),
  quoteOpen = ref(false);
const editingCharge = ref<Row | null>(null);
const showDeleted = ref(false);
// Approval decision fields must remain visible: column customization cannot
// hide a selected scope or its approved quantity during a formal submission.
const approvalEditorColumns: TableColumn[] = [
  { key: "selected", label: "纳入批准", minWidth: 125, sortable: false, filterable: false, hideable: false },
  { key: "label", label: "作业位置", minWidth: 190, sortable: false, filterable: false, hideable: false },
  { key: "approved_quantity_scaled", label: "批准数量", minWidth: 180, sortable: false, filterable: false, hideable: false },
];
const projectScopeColumns: TableColumn[] = [
  { key: "demand_no", label: "需求编号", minWidth: 215 },
  { key: "binding", label: "状态", sortable: false, filterable: false },
];
const projectApprovalColumns: TableColumn[] = [
  { key: "demand_no", label: "需求", minWidth: 185 },
  { key: "quantity_scaled", label: "承接数量" },
  { key: "locations", label: "位置数", sortable: false, filterable: false },
];
const projectChargeColumns: TableColumn[] = [
  { key: "rule_title", label: "批次或项目参考费用", minWidth: 210 },
  { key: "amount_fen", label: "金额", minWidth: 140 },
];
function resetListPage() {
  page.value = 1;
  void load();
}
const projectColumns: TableColumn[] = [
  { key: "code", label: "项目编号", minWidth: 150 },
  { key: "name", label: "项目名称", minWidth: 220 },
  { key: "status", label: "阶段" },
  { key: "approval", filterable: false, label: "批准预算", sortable: false },
  { key: "scopes", filterable: false, label: "关联需求数", sortable: false },
];
function sortTable(value: { key: string; order: string }) {
  sortKey.value = value.key;
  sortDirection.value = value.order === "ascending" ? "asc" : "desc";
  page.value = 1;
  load();
}
function filterTable(value: Record<string, string>) {
  columnFilters.value = value;
  page.value = 1;
  load();
}
async function load() {
  const value = await api(
    `/projects?page=${page.value}&q=${encodeURIComponent(query.value)}&deleted=${showDeleted.value}&sort=${encodeURIComponent(sortKey.value || "created_at")}&direction=${sortDirection.value}&filters=${encodeURIComponent(JSON.stringify(columnFilters.value))}`,
  );
  rows.value = value.items;
  total.value = value.total;
  if (detail.value)
    detail.value = await api("/projects/" + detail.value.id + "?deleted=true");
}
async function open(row: Row) {
  detail.value = await api("/projects/" + row.id + "?deleted=true");
  tab.value = props.financeOnly ? "finance" : "scope";
}
function editProject(row?: Row) {
  editing.value = row || null;
  form.value = row
    ? { ...row, expected_version: row.profile_version }
    : { code: "", name: "", framework_id: "" };
  dialog.value = "project";
}
async function searchDemands(q = "") {
  demands.value = (
    await api("/demands?page_size=200&q=" + encodeURIComponent(q))
  ).items;
}
async function openDialog(type: string) {
  editingCharge.value = null;
  dialog.value = type;
  form.value = {};
  if (type === "link") await searchDemands();
  if (type === "funding")
    form.value = {
      agreement_id: detail.value?.funding?.agreement_id,
      expected_version: detail.value?.funding?.version_no || 0,
    };
  if (type === "approval") {
    approvalRows.value = [];
    for (const scope of detail.value!.scopes.filter((x: Row) => x.binding)) {
      const demand = await api("/demands/" + scope.demand_id);
      approvalRows.value.push({
        project_scope_id: scope.id,
        demand_version: demand.current_version,
        demand_no: demand.demand_no,
        selected: true,
        locations: demand.work_locations.map((loc: Row, index: number) => ({
          location_item_no: index + 1,
          approved_quantity_scaled: loc.quantity_scaled,
          selected: true,
          label:
            loc.location_snapshot_json.location_label ||
            loc.location_snapshot_json.physical_code ||
            loc.location_snapshot_json.tower_no ||
            loc.span_id,
        })),
        materials: [],
      });
    }
    form.value = {
      approved_budget_fen: detail.value?.approval?.approved_budget_fen || 0,
      basis: "",
      expected_version: detail.value?.version,
      expected_approval_version_id: detail.value?.approval?.id || null,
    };
  }
}
async function save() {
  if (!(await formRef.value?.validate().catch(() => false))) return;
  busy.value = true;
  try {
    if (dialog.value === "project")
      await api(
        "/projects" + (editing.value ? "/" + editing.value.id : ""),
        "POST",
        form.value,
      );
    if (dialog.value === "link") {
      const demand = demands.value.find((x) => x.id === form.value.demand_id);
      await api(`/projects/${detail.value!.id}/link`, "POST", {
        ...form.value,
        expected_version: demand?.current_version,
      });
    }
    if (dialog.value === "funding")
      await api(`/projects/${detail.value!.id}/funding`, "POST", form.value);
    if (dialog.value === "approval")
      await api(`/projects/${detail.value!.id}/approvals`, "POST", {
        ...form.value,
        scopes: approvalRows.value
          .filter((x) => x.selected)
          .map((x) => ({
            ...x,
            locations: x.locations.filter((loc: Row) => loc.selected),
          })),
      });
    if (dialog.value === "charge")
      await api(
        "/charges" + (editingCharge.value ? "/" + editingCharge.value.id : ""),
        "POST",
        {
          ...form.value,
          approval_version_id: detail.value!.approvals.find(
            (x: Row) => x.status === "draft",
          )?.id,
        },
      );
    dialog.value = "";
    await load();
    ElMessage.success("已保存");
  } catch (e) {
    ElMessage.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function action(name: string, approval?: Row) {
  try {
    await ElMessageBox.confirm(
      name === "close"
        ? "确认接受当前需求解决和费用差异，正式结项？"
        : "确认执行此次正式操作？",
      "正式确认",
    );
    if (name === "stock" || name === "close")
      await api(`/projects/${detail.value!.id}/${name}`, "POST", {
        expected_version: detail.value!.version,
      });
    if (name === "approve")
      await api(
        `/projects/${detail.value!.id}/approvals/${approval!.id}/approve`,
        "POST",
        { expected_version: detail.value!.version },
      );
    if (name === "discard")
      await api(
        `/projects/${detail.value!.id}/approvals/${approval!.id}`,
        "DELETE",
        {},
      );
    await load();
  } catch (e) {
    if (e instanceof Error) ElMessage.error(e.message);
  }
}
async function release(scope: Row) {
  try {
    await ElMessageBox.confirm(
      "明确解绑后，该需求可由其他项目承接。当前批准范围仍含此需求时，先正式变更移出或结项。",
      "显式解绑",
    );
    const history = await api("/demands/" + scope.demand_id + "/history"),
      binding = history.bindings.find((x: Row) => x.id === scope.id);
    await api(`/projects/${detail.value!.id}/release/${scope.id}`, "POST", {
      expected_event_seq: binding.events.at(-1).event_seq,
    });
    await load();
  } catch (e) {
    if (e instanceof Error) ElMessage.error(e.message);
  }
}
function priceScope(scope: Row) {
  priceScopeContext.value = scope;
  quoteOpen.value = true;
}
function editCharge(charge: Row) {
  editingCharge.value = charge;
  form.value = {
    ...JSON.parse(charge.pricing_inputs_json),
    reference_price_catalog_id: charge.reference_price_catalog_id,
  };
  dialog.value = "charge";
}
async function removeCharge(charge: Row) {
  try {
    await ElMessageBox.confirm(
      "删除本草稿参考费用，原计算依据保存在审计中。",
      "删除参考费用",
    );
    await api("/charges/" + charge.id, "DELETE", {});
    await load();
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message);
  }
}
async function removeProject() {
  try {
    await ElMessageBox.confirm(
      "删除后从正常项目列表移除，正式范围、费用、结算和证据历史继续保留。",
      "删除子项目",
    );
    await api(`/projects/${detail.value!.id}`, "DELETE", {
      expected_version: detail.value!.version,
    });
    detail.value = null;
    await load();
    ElMessage.success("项目已删除，可在包含已删除中查询");
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message);
  }
}
async function showHistory() {
  history.value = await api(`/projects/${detail.value!.id}/history`);
}
onMounted(async () => {
  actors.value = await api("/actors");
  await load();
});
</script>
<template>
  <template v-if="!detail"
    ><div class="page-heading">
      <div>
        <div class="section-caption">
          {{ financeOnly ? "实际费用与结算" : "项目管理" }}
        </div>
        <h1>{{ financeOnly ? "实际费用与结算" : "年度框架与子项目" }}</h1>
        <p>
          {{
            financeOnly
              ? "进入子项目办理真实费用、独立结算与正式核对。"
              : "以完整需求范围立项，保留批准预算与资金归属历史。"
          }}
        </p>
      </div>
      <div class="page-heading-actions">
        <ElButton
          :disabled="!can('write')"
          v-if="!financeOnly"
          type="primary"
          @click="editProject()"
          >新增子项目</ElButton
        >
      </div>
    </div>
    <div class="panel">
      <div class="toolbar">
        <ElInput
          v-model="query"
          clearable
          placeholder="搜索项目编号或名称"
          @change="resetListPage"
        /><ElCheckbox v-model="showDeleted" @change="resetListPage"
          >包含已删除</ElCheckbox
        ><ElButton @click="load">刷新</ElButton>
      </div>
      <BusinessTable :rows="rows" :columns="projectColumns" table-key="project:list"
        @sort-change="sortTable" @filter-change="filterTable">
        <template #cell="{ row, column }">
          <ElTag v-if="column.key === 'status'" effect="plain">{{ statusText[row.status] }}</ElTag>
          <span v-else-if="column.key === 'approval'">¥{{ money(row.approval?.approved_budget_fen) }}</span>
          <span v-else-if="column.key === 'scopes'">{{ row.scopes?.filter((x: Row) => x.binding).length || 0 }}</span>
          <span v-else>{{ row[column.key] ?? '—' }}</span>
        </template>
        <template #actions="{ row }">
          <ElButton size="small" @click="open(row)">进入项目</ElButton>
        </template>
      </BusinessTable>
      <ElPagination
        v-model:current-page="page"
        :total="total"
        :page-size="30"
        layout="prev,pager,next,total"
        @current-change="load"
      /></div
  ></template>
  <template v-else
    ><div class="detail-header">
      <ElButton @click="detail = null">返回项目列表</ElButton>
      <h1>{{ detail.name }}</h1>
      <ElTag>{{ statusText[detail.status] }}</ElTag
      ><span class="muted">{{ detail.code }}</span>
    </div>
    <div class="toolbar">
      <ElButton
        :disabled="!can('write') || detail.deleted"
        @click="editProject(detail)"
        >修订档案</ElButton
      ><ElButton :disabled="!can('write')" @click="openDialog('funding')"
        >资金归属</ElButton
      ><ElButton @click="showHistory">档案与阶段历史</ElButton
      ><ElButton
        type="danger"
        :disabled="!can('admin') || detail.deleted"
        @click="removeProject"
        >删除项目</ElButton
      ><ElButton
        :disabled="!can('project.stock')"
        v-if="detail.status === 'reserve'"
        type="primary"
        @click="action('stock')"
        >确认入库</ElButton
      ><ElButton
        :disabled="!can('project.close')"
        v-if="detail.status === 'approved'"
        type="primary"
        @click="action('close')"
        >审核结项</ElButton
      >
    </div>
    <div class="panel">
      <ElDescriptions :column="2" border
        ><ElDescriptionsItem label="项目类别">{{
          detail.category_name || "未指定"
        }}</ElDescriptionsItem
        ><ElDescriptionsItem label="归口单位">{{
          detail.managing_unit_name || "未指定"
        }}</ElDescriptionsItem
        ><ElDescriptionsItem label="责任人">{{
          detail.owner_username || "未指定"
        }}</ElDescriptionsItem
        ><ElDescriptionsItem label="管理人员">{{
          detail.manager_username || "未指定"
        }}</ElDescriptionsItem
        ><ElDescriptionsItem label="计划期间"
          >{{ detail.planned_start_on || "未指定" }} 至
          {{ detail.planned_end_on || "未指定" }}</ElDescriptionsItem
        ><ElDescriptionsItem label="初步估算">{{
          money(detail.preliminary_estimate_fen)
        }}</ElDescriptionsItem></ElDescriptions
      >
    </div>
    <ElTabs v-model="tab"
      ><ElTabPane name="scope" label="需求与批准范围" /><ElTabPane
        name="finance"
        label="费用与结算"
    /></ElTabs>
    <template v-if="tab === 'scope'"
      ><div class="panel">
        <div class="toolbar">
          <h2>当前关联需求</h2>
          <ElButton
            :disabled="!can('write') || detail.status === 'closed'"
            @click="openDialog('link')"
            >关联需求</ElButton
          >
        </div>
        <BusinessTable client-side table-key="project:scopes" :rows="detail.scopes || []"
          :columns="projectScopeColumns" :actions-width="135">
          <template #cell="{ row, column }">
            <ElTag v-if="column.key === 'binding'" :type="row.binding ? 'success' : 'info'" effect="plain">
              {{ row.binding ? '当前关联' : '已解绑' }}
            </ElTag>
            <span v-else>{{ row[column.key] ?? '—' }}</span>
          </template>
          <template #actions="{ row }">
            <ElButton :disabled="!can('write') || !row.binding" size="small" @click="release(row)">显式解绑</ElButton>
          </template>
        </BusinessTable>
      </div>
      <div class="toolbar">
        <ElButton
          type="primary"
          :disabled="
            !can('write') || !['stocked', 'approved'].includes(detail.status)
          "
          @click="openDialog('approval')"
          >{{ detail.approval ? "编制正式变更" : "编制立项范围" }}</ElButton
        ><ElButton :disabled="!can('write')" @click="openDialog('charge')"
          >增加批次 / 项目参考费用</ElButton
        >
      </div>
      <div
        v-for="approval in detail.approvals"
        :key="approval.id"
        class="panel"
      >
        <div class="toolbar">
          <h2>第 {{ approval.version_no }} 次批准</h2>
          <ElTag>{{ statusText[approval.status] }}</ElTag
          ><ElButton
            :disabled="
              !can(
                approval.version_no === 1
                  ? 'project.approve'
                  : 'change.approve',
              )
            "
            v-if="approval.status === 'draft'"
            type="primary"
            @click="action('approve', approval)"
            >正式批准</ElButton
          ><ElButton
            :disabled="!can('write')"
            v-if="approval.status === 'draft'"
            type="danger"
            @click="action('discard', approval)"
            >删除草稿</ElButton
          >
        </div>
        <ElDescriptions :column="2" border
          ><ElDescriptionsItem label="批准预算"
            >¥{{ money(approval.approved_budget_fen) }}</ElDescriptionsItem
          ><ElDescriptionsItem label="参考价格">{{
            approval.reference.complete
              ? "完整参考价 ¥" + money(approval.reference.total_fen)
              : "未完整计价，已计价小计 ¥" +
                money(approval.reference.subtotal_fen)
          }}</ElDescriptionsItem></ElDescriptions
        ><BusinessTable client-side table-key="project:approval-scopes" :rows="approval.scopes || []"
          :columns="projectApprovalColumns" :actions-width="170">
          <template #cell="{ row, column }">
            <span v-if="column.key === 'quantity_scaled'">{{ quantity(row.quantity_scaled) }}</span>
            <span v-else-if="column.key === 'locations'">{{ row.locations?.length || 0 }}</span>
            <span v-else>{{ row[column.key] ?? '—' }}</span>
          </template>
          <template v-if="approval.status === 'draft'" #actions="{ row }">
            <ElButton :disabled="!can('write')" size="small" @click="priceScope(row)">按承接范围核价</ElButton>
          </template>
        </BusinessTable>
        <BusinessTable v-if="approval.reference.charges.length" client-side
          table-key="project:approval-charges" :rows="approval.reference.charges"
          :columns="projectChargeColumns" :actions-width="190">
          <template #cell="{ row, column }">
            <span v-if="column.key === 'amount_fen'">¥{{ money(row.amount_fen) }}</span>
            <span v-else>{{ row[column.key] ?? '—' }}</span>
          </template>
          <template v-if="approval.status === 'draft'" #actions="{ row }">
            <ElButton :disabled="!can('write')" size="small" @click="editCharge(row)">更正</ElButton>
            <ElButton :disabled="!can('write')" type="danger" size="small" @click="removeCharge(row)">删除</ElButton>
          </template>
        </BusinessTable>
      </div></template
    >
    <ElAlert
      v-if="detail.deleted && tab === 'finance'"
      title="项目已归档删除，费用与结算记录可在档案历史中查询。"
      type="info"
      :closable="false"
    /><FinancePanel
      v-if="tab === 'finance' && !detail.deleted"
      :project="detail"
      @changed="load"
    />
  </template>
  <ElDialog
    :model-value="!!dialog"
    :title="
      {
        project: editing ? '修订项目档案' : '新增子项目',
        link: '关联专业需求',
        funding: '变更资金归属',
        approval: '编制完整批准范围',
        charge: '批次 / 项目独立参考费用',
      }[dialog]
    "
    width="950px"
    :close-on-click-modal="false"
    @close="dialog = ''"
    ><ElForm ref="formRef" :model="form" label-position="top" novalidate
      ><div class="form-grid">
        <template v-if="dialog === 'project'"
          ><ElFormItem
            label="项目名称"
            prop="name"
            :rules="[{ required: true, message: '请填写项目名称' }]"
            required
            ><ElInput v-model="form.name" /></ElFormItem
          ><ElFormItem
            label="年度框架"
            prop="framework_id"
            :rules="[{ required: true, message: '请填写年度框架' }]"
            required
            ><FieldControl
              v-model="form.framework_id"
              :field="{ type: 'ref', reference: 'frameworks' }"
              :disabled="!!editing" /></ElFormItem
          ><ElFormItem label="项目类别"
            ><FieldControl
              v-model="form.category_id"
              :field="{ type: 'ref', reference: 'categories' }" /></ElFormItem
          ><ElFormItem label="归口单位"
            ><FieldControl
              v-model="form.managing_unit_id"
              :field="{
                type: 'ref',
                reference: 'organizations',
              }" /></ElFormItem
          ><ElFormItem label="初步估算（元）"
            ><FieldControl
              v-model="form.preliminary_estimate_fen"
              :field="{ type: 'money' }" /></ElFormItem
          ><ElFormItem label="计划开始"
            ><ElDatePicker
              v-model="form.planned_start_on"
              value-format="YYYY-MM-DD" /></ElFormItem
          ><ElFormItem label="计划结束"
            ><ElDatePicker
              v-model="form.planned_end_on"
              value-format="YYYY-MM-DD" /></ElFormItem
          ><ElFormItem label="责任人"
            ><ElSelect
              v-model="form.owner_id"
              clearable
              filterable
              @clear="form.owner_id = null"
              ><ElOption
                v-for="actor in actors"
                :key="actor.id"
                :value="actor.id"
                :label="actor.username" /></ElSelect></ElFormItem
          ><ElFormItem label="管理人员"
            ><ElSelect
              v-model="form.manager_id"
              clearable
              filterable
              @clear="form.manager_id = null"
              ><ElOption
                v-for="actor in actors"
                :key="actor.id"
                :value="actor.id"
                :label="actor.username" /></ElSelect></ElFormItem
        ></template>
        <template v-if="dialog === 'link'"
          ><ElFormItem
            label="专业需求"
            prop="demand_id"
            :rules="[{ required: true, message: '请填写专业需求' }]"
            required
            class="full-width"
            ><ElSelect
              v-model="form.demand_id"
              filterable
              remote
              :remote-method="searchDemands"
              ><ElOption
                v-for="d in demands.filter(
                  (x) => !x.binding && x.status !== 'cancelled',
                )"
                :key="d.id"
                :value="d.id"
                :label="
                  d.demand_no + ' · ' + d.problem_description
                " /></ElSelect></ElFormItem
        ></template>
        <template v-if="dialog === 'funding'"
          ><ElFormItem label="执行协议（允许暂未指定）" class="full-width"
            ><FieldControl
              v-model="form.agreement_id"
              :field="{ type: 'ref', reference: 'agreements' }" /></ElFormItem
        ></template>
        <template v-if="dialog === 'approval'"
          ><ElFormItem
            label="批准预算（元）"
            prop="approved_budget_fen"
            :rules="[{ required: true, message: '请填写批准预算（元）' }]"
            required
            ><FieldControl
              v-model="form.approved_budget_fen"
              :field="{ type: 'money' }" /></ElFormItem
          ><ElFormItem label="批准依据"
            ><ElInput v-model="form.basis" /></ElFormItem
        ></template>
        <template v-if="dialog === 'charge'"
          ><ElFormItem
            label="正式价格规则"
            prop="reference_price_catalog_id"
            :rules="[{ required: true, message: '请填写正式价格规则' }]"
            required
            ><FieldControl
              v-model="form.reference_price_catalog_id"
              :field="{ type: 'ref', reference: 'prices' }" /></ElFormItem
          ><ElFormItem
            label="唯一批次 / 项目费用键"
            prop="charge_scope_key"
            :rules="[
              { required: true, message: '请填写唯一批次 / 项目费用键' },
            ]"
            required
            ><ElInput v-model="form.charge_scope_key" /></ElFormItem
          ><ElFormItem
            label="计价数量"
            prop="quantity_scaled"
            :rules="[{ required: true, message: '请填写计价数量' }]"
            required
            ><FieldControl
              v-model="form.quantity_scaled"
              :field="{ type: 'quantity' }" /></ElFormItem
        ></template>
      </div>
      <template v-if="dialog === 'approval'"
        ><div
          v-for="scope in approvalRows"
          :key="scope.project_scope_id"
          class="panel"
        >
          <ElCheckbox v-model="scope.selected">{{ scope.demand_no }}</ElCheckbox
          ><BusinessTable :table-key="'project:approval-editor:' + scope.project_scope_id"
            :rows="scope.locations" :columns="approvalEditorColumns" compact>
            <template #cell="{ row, column }">
              <ElCheckbox v-if="column.key === 'selected'" v-model="row.selected" />
              <FieldControl v-else-if="column.key === 'approved_quantity_scaled'"
                v-model="row.approved_quantity_scaled" :field="{ type: 'quantity' }" />
              <span v-else>{{ row[column.key] ?? '—' }}</span>
            </template>
          </BusinessTable>
          <h3 class="subheading">批准物资（按承接范围明确数量）</h3>
          <div
            v-for="(item, index) in scope.materials"
            :key="index"
            class="toolbar"
          >
            <FieldControl
              v-model="item.material_id"
              :field="{ type: 'ref', reference: 'materials' }"
            /><FieldControl
              v-model="item.quantity_scaled"
              :field="{ type: 'quantity' }"
            /><ElButton type="danger" @click="scope.materials.splice(index, 1)"
              >移除</ElButton
            >
          </div>
          <ElButton @click="scope.materials.push({ quantity_scaled: 10000 })"
            >添加批准物资</ElButton
          >
        </div></template
      ></ElForm
    ><template #footer
      ><ElButton @click="dialog = ''">取消</ElButton
      ><ElButton
        :disabled="!can('write')"
        type="primary"
        :loading="busy"
        @click="save"
        >保存</ElButton
      ></template
    ></ElDialog
  >
  <ElDialog
    :model-value="!!history"
    title="项目正式历史"
    width="950px"
    @close="history = null"
  >
    <BusinessHistory :value="history" />
  </ElDialog>
  <PricingQuoteDialog
    v-if="priceScopeContext"
    v-model="quoteOpen"
    :demand-id="priceScopeContext.demand_id"
    :expected-version="priceScopeContext.demand_version"
    :scope-id="priceScopeContext.id"
    @confirmed="load"
  />
</template>

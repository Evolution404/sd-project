<script setup lang="ts">
import { factText } from "../services/display";
import BusinessHistory from "../components/BusinessHistory.vue";
import { useAccess } from "../services/access";
const can = useAccess();
import { ref, watch, onMounted, computed } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import ExtraFieldsEditor from "../components/ExtraFieldsEditor.vue";
import FactorDefinitionEditor from "../components/FactorDefinitionEditor.vue";
import PriceConditionsEditor from "../components/PriceConditionsEditor.vue";
import OperationFeaturesEditor from "../components/OperationFeaturesEditor.vue";
import PricingModelEditor from "../components/PricingModelEditor.vue";
import ExchangePanel from "../components/ExchangePanel.vue";
import FieldControl from "../components/FieldControl.vue";
import BusinessTable, { type TableColumn } from "../components/BusinessTable.vue";
import { api, type Row, statusText, money, quantity } from "../services/api";
const props = defineProps<{ kinds: string[]; title: string }>();
const definitions = ref<Row>({}),
  kind = ref(props.kinds[0]!),
  rows = ref<Row[]>([]),
  selectedIds = ref<string[]>([]),
  total = ref(0),
  page = ref(1),
  query = ref(""),
  sortKey = ref(""),
  sortDirection = ref(""),
  columnFilters = ref<Record<string, string>>({}),
  deleted = ref(false),
  dialog = ref(false),
  loading = ref(false),
  editing = ref<Row | null>(null),
  form = ref<Row>({}),
  errors = ref<Row>({}),
  formRef = ref(),
  detail = ref<Row | null>(null),
  referenceNames = ref<Row>({}),
  businessLabels = ref<Row>({}),
  history = ref<Row | null>(null),
  tab = ref("basic");
const replacing = ref(false),
  replacement = ref<Row | null>(null),
  replacementForm = ref<Row>({});
async function openReplacement() {
  replacement.value = await api(
    `/catalog/physical/${detail.value!.id}/replacement`,
  );
  replacementForm.value = {};
  replacing.value = true;
}
async function saveReplacement() {
  try {
    await api(`/catalog/physical/${detail.value!.id}/replacement`, "POST", {
      expected_version: replacement.value!.physical.version,
      bindings: replacement.value!.bindings.map((row: Row) => ({
        id: row.id,
        version: row.version,
      })),
      properties: replacementForm.value,
    });
    replacing.value = false;
    await load();
    detail.value = await api(`/catalog/physical/${detail.value!.id}`);
    ElMessage.success("整基更换已记录，原实体及关联历史已归档");
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
}
const catalogPermission = computed(() =>
  ["frameworks", "agreements"].includes(kind.value) ? "write" : "admin",
);
let loadSequence = 0;
async function load() {
  const sequence = ++loadSequence,
    requestedKind = kind.value;
  loading.value = true;
  try {
    const result = await api(
      `/catalog/${requestedKind}?page=${page.value}&q=${encodeURIComponent(query.value)}&deleted=${deleted.value}&sort=${encodeURIComponent(sortKey.value || "created_at")}&direction=${sortDirection.value || "desc"}&filters=${encodeURIComponent(JSON.stringify(columnFilters.value))}`,
    );
    if (sequence !== loadSequence || requestedKind !== kind.value) return;
    rows.value = result.items;
    total.value = result.total;
  } catch (e) {
    ElMessage.error((e as Error).message);
  } finally {
    if (sequence === loadSequence) loading.value = false;
  }
}
function edit(row?: Row, historical = false) {
  editing.value = row || null;
  errors.value = {};
  form.value = {
    historical_update: historical,
    physical_mode: row?.physical_tower_id ? "shared" : "new",
    physical_properties: {},
  };
  for (const f of fields()) {
    const value =
      row?.[f.key] ??
      f.default ??
      (f.type === "text" && !f.nullable ? "" : null);
    form.value[f.key] =
      f.type === "json"
        ? typeof value === "string"
          ? value
          : JSON.stringify(value, null, 2)
        : value;
  }
  tab.value = "basic";
  dialog.value = true;
}
function fields() {
  const c = definitions.value[kind.value];
  return c
    ? [...c.rootFields, ...c.fields].filter(
        (f) =>
          !f.systemManaged &&
          !(kind.value === "towers" && f.key === "sort_rank"),
      )
    : [];
}
function visible(f: Row) {
  if (kind.value === "physical" && f.key === "asset_no" && !editing.value) return false;
  if (kind.value === "lines") {
    if (f.key === "parent_line_id") return form.value.line_kind === "branch";
    if (f.key === "junction_tower_id") return form.value.line_kind === "branch" && !!form.value.parent_line_id;
  }
  if (kind.value === "operations" && f.key === "work_target_type") return false;
  if (
    kind.value === "towers" &&
    !editing.value &&
    f.key === "physical_tower_id"
  )
    return form.value.physical_mode === "shared";
  if (kind.value === "factors" && f.key === "fields_json") return false;
  if (
    kind.value === "operations" &&
    ["pricing_features_json", "fields_json"].includes(f.key)
  )
    return false;
  if (kind.value !== "prices") return true;
  if (
    [
      "additional_conditions_json",
      "calculation_params_json",
      "quantity_brackets_json",
      "fee_components_json",
    ].includes(f.key)
  )
    return false;
  if (f.key === "base_fee_fen")
    return form.value.pricing_mode === "base_plus_unit";
  if (f.key === "unit_price_fen")
    return ["fixed", "per_unit", "base_plus_unit"].includes(
      form.value.pricing_mode,
    );
  return true;
}
const physicalAttributeFields = computed<Row[]>(() => (definitions.value.physical?.fields || []).filter((field: Row) => !["status", "asset_no"].includes(field.key)));
function dependentFilter(f: Row): Record<string, string> {
  if (kind.value === "lines" && f.key === "parent_line_id") return { line_kind: "main" };
  if (kind.value === "lines" && f.key === "junction_tower_id") return { line_id: form.value.parent_line_id || "" };
  if (kind.value === "spans" && ["start_tower_id", "end_tower_id"].includes(f.key))
    return { line_id: form.value.line_id || "", exclude_id: form.value[f.key === "start_tower_id" ? "end_tower_id" : "start_tower_id"] || "" };
  return {};
}
function dependentDisabled(f: Row) {
  return (kind.value === "lines" && f.key === "junction_tower_id" && !form.value.parent_line_id)
    || (kind.value === "spans" && ["start_tower_id", "end_tower_id"].includes(f.key) && !form.value.line_id);
}
function fieldChanged(key: string) {
  if (kind.value === "lines") {
    if (key === "line_kind" && form.value.line_kind !== "branch") {
      form.value.parent_line_id = null; form.value.junction_tower_id = null;
    }
    if (key === "parent_line_id") form.value.junction_tower_id = null;
  }
  if (kind.value === "spans") {
    if (key === "line_id") { form.value.start_tower_id = null; form.value.end_tower_id = null; }
    if (key === "start_tower_id" && form.value.start_tower_id === form.value.end_tower_id) form.value.end_tower_id = null;
    if (key === "end_tower_id" && form.value.start_tower_id === form.value.end_tower_id) form.value.start_tower_id = null;
  }
}
const physicalBindingColumns: TableColumn[] = [
  { key: "line_name", label: "线路", minWidth: 170 },
  { key: "voltage_name", label: "电压等级" },
  { key: "tower_no", label: "逻辑杆塔号" },
  { key: "logical_status", label: "状态" },
];
const replacementBindingColumns: TableColumn[] = [
  { key: "label", label: "本次全部关联回路", minWidth: 250 },
];
const tableColumns = computed<TableColumn[]>(() => {
  const core: Record<string, TableColumn[]> = {
    lines: [
      { key: "name", label: "线路名称", minWidth: 180 },
      { key: "voltage_level_name", label: "电压等级" },
      { key: "line_kind", label: "线路类型" },
      { key: "parent_line_name", label: "所属主线", minWidth: 150 },
      { key: "junction_tower_no", label: "接入杆塔" },
      { key: "erection_type", label: "架设方式" },
      { key: "status", label: "状态" },
    ],
    physical: [
      { key: "tower_code", label: "系统编号", minWidth: 220 },
      { key: "tower_type", label: "塔型" },
      { key: "model", label: "型号" },
      { key: "height_scaled", label: "高度（米）" },
      { key: "commissioned_on", label: "投运日期" },
      { key: "related_lines", label: "关联线路", minWidth: 190 },
      { key: "related_towers", label: "关联杆塔号", minWidth: 150 },
      { key: "current_circuits", label: "关联回路数" },
      { key: "status", label: "状态" },
    ],
    towers: [
      { key: "line_name", label: "所属线路", minWidth: 170 },
      { key: "voltage_level_name", label: "电压等级" },
      { key: "tower_no", label: "杆塔号" },
      { key: "operations_team", label: "运维班组" },
      { key: "management_department", label: "管辖部门" },
      { key: "status", label: "状态" },
    ],
    spans: [
      { key: "line_name", label: "所属线路", minWidth: 170 },
      { key: "start_tower_no", label: "起点杆塔" },
      { key: "end_tower_no", label: "终点杆塔" },
      { key: "transmission_center_length_mm", label: "中心管辖长度（米）" },
      { key: "status", label: "状态" },
    ],
  };
  if (core[kind.value]) return core[kind.value];
  const c = definitions.value[kind.value];
  if (!c) return [];
  return [...c.rootFields, ...c.fields]
    .filter((f: Row) => !f.systemManaged && f.type !== "json" && f.key !== "work_target_type")
    .map((f: Row) => ({ key: f.key, label: f.label, minWidth: ["name", "title"].includes(f.key) ? 190 : 130 }));
});
function tableCell(row: Row, column: TableColumn) {
  const key = column.key, value = row[key];
  if (value === null || value === undefined || value === "") return "—";
  if (key === "height_scaled" || key === "transmission_center_length_mm")
    return Number(value) / (key === "height_scaled" ? 10000 : 1000);
  if (typeof value === "boolean") return value ? "是" : "否";
  if (key === "status" || key === "line_kind" || key === "pricing_mode" || key === "pricing_scope")
    return statusText[String(value)] || value;
  const f = [...(definitions.value[kind.value]?.rootFields || []), ...(definitions.value[kind.value]?.fields || [])].find((f: Row) => f.key === key);
  if (f?.type === "ref") return value ? "已关联（查看详情）" : "—";
  if (f?.type === "money") return "¥" + money(value);
  if (f?.type === "quantity") return quantity(value);
  return value;
}
function tableSort(value: { key: string; order: string }) {
  sortKey.value = value.key;
  sortDirection.value = value.order === "ascending" ? "asc" : "desc";
  page.value = 1;
  load();
}
function tableFilter(values: Record<string, string>) {
  columnFilters.value = values;
  page.value = 1;
  load();
}
function group(f: Row) {
  if (kind.value !== "operations") return "basic";
  if (["fields_json", "pricing_features_json"].includes(f.key)) return "extra";
  if (
    [
      "completion_standard",
      "entry_hint",
      "default_target_object",
      "default_quantity_scaled",
    ].includes(f.key)
  )
    return "template";
  return "basic";
}
async function save() {
  if (!(await formRef.value?.validate().catch(() => false))) return;
  loading.value = true;
  try {
    const c = definitions.value[kind.value];
    if (
      kind.value === "towers" &&
      !editing.value &&
      form.value.physical_mode === "new"
    )
      delete form.value.physical_tower_id;
    await api(
      "/catalog/" + kind.value + (editing.value ? "/" + editing.value.id : ""),
      "POST",
      {
        ...form.value,
        ...(kind.value === "prices"
          ? {
              base_fee_fen:
                form.value.pricing_mode === "base_plus_unit"
                  ? form.value.base_fee_fen
                  : 0,
              unit_price_fen: ["fixed", "per_unit", "base_plus_unit"].includes(
                form.value.pricing_mode,
              )
                ? form.value.unit_price_fen
                : 0,
              quantity_brackets_json:
                form.value.pricing_mode === "quantity_bracket"
                  ? form.value.quantity_brackets_json
                  : "[]",
              fee_components_json:
                form.value.pricing_mode === "composite"
                  ? form.value.fee_components_json
                  : "[]",
            }
          : {}),
        expected_version:
          editing.value?.[c.sequence || "version_no"] ||
          editing.value?.version ||
          1,
      },
    );
    dialog.value = false;
    ElMessage.success("已保存正式版本");
    await load();
    if (detail.value)
      detail.value = await api(
        `/catalog/${kind.value}/${detail.value.id}?deleted=true`,
      );
  } catch (e) {
    errors.value = (e as Row).fields || {};
    if (errors.value.physical_candidates && !form.value.physical_tower_id) {
      try {
        await ElMessageBox.confirm(
          "已有同号杆塔。请核对 " +
            errors.value.physical_candidates
              .map((row: Row) => row.label)
              .join("、") +
            "。确认本次是不同实物才继续新建，共塔请取消并选择已有实体。",
          "确认实际杆塔关系",
        );
        form.value.confirm_distinct = true;
        await save();
        return;
      } catch {
        return;
      }
    }
    ElMessage.error((e as Error).message);
  } finally {
    loading.value = false;
  }
}
async function remove(row: Row) {
  await ElMessageBox.confirm(
    "删除后从正常列表与新增选择中移除，正式历史和已有引用保留。",
    "确认删除",
    { type: "warning" },
  );
  const c = definitions.value[kind.value];
  try {
    await api("/catalog/" + kind.value + "/" + row.id, "DELETE", {
      expected_version: row[c.sequence || "version_no"] || row.version || 1,
    });
    await load();
    if (detail.value)
      detail.value = await api(
        `/catalog/${kind.value}/${detail.value.id}?deleted=true`,
      );
  } catch (e) {
    ElMessage.error((e as Error).message);
  }
}
async function openDetail(row: Row) {
  detail.value = row;
  history.value = null;
  referenceNames.value = {};
  for (const field of fields().filter(
    (field) => field.type === "ref" && row[field.key],
  )) {
    try {
      const record = await api(
        `/catalog/${field.reference}/${row[field.key]}?deleted=true`,
      );
      referenceNames.value[field.key] =
        record.label || record.name || record.tower_no || "历史关联对象";
    } catch {
      referenceNames.value[field.key] = "历史关联对象";
    }
  }
}
function display(field: Row, value: unknown) {
  if (value == null || value === "") return "—";
  if (field.type === "money") return "¥" + money(value as number);
  if (field.type === "quantity") return quantity(value as number);
  if (field.type === "ref")
    return referenceNames.value[field.key] || "历史关联对象";
  if (field.type === "boolean") return value ? "是" : "否";
  if (field.key === "status") return statusText[String(value)] || value;
  return value;
}
async function viewHistory(row: Row) {
  await openDetail(row);
  history.value = await api(`/catalog/${kind.value}/history/${row.id}`);
}
function selectRows(selected: Row[]) {
  selectedIds.value = selected.map((row) => String(row.id));
}
watch(kind, () => {
  selectedIds.value = [];
  sortKey.value = "";
  columnFilters.value = {};
  rows.value = [];
  detail.value = null;
  history.value = null;
  page.value = 1;
  load();
});
watch(
  () => props.kinds,
  () => {
    kind.value = props.kinds[0]!;
  },
);
onMounted(async () => {
  [definitions.value, businessLabels.value] = await Promise.all([
    api("/catalogs"),
    api("/display-labels"),
  ]);
  await load();
});
</script>
<template>
  <template v-if="!detail">
    <div class="page-heading">
      <div>
        <div class="section-caption">基础数据管理</div>
        <h1>{{ title }}</h1>
        <p>统一维护业务定义，正式变更保留版本与关联历史。</p>
      </div>
      <div class="page-heading-actions">
        <ElButton
          :disabled="!can(catalogPermission)"
          type="primary"
          @click="edit()"
          >新增{{ definitions[kind]?.title }}</ElButton
        ><ExchangePanel
          v-if="['lines', 'towers', 'physical', 'spans'].includes(kind)"
          kind="assets"
          :query="query"
          :selected-ids="selectedIds"
          @changed="load"
        />
      </div>
    </div>
    <ElTabs v-model="kind"
      ><ElTabPane
        v-for="key in kinds"
        :key="key"
        :name="key"
        :label="definitions[key]?.title || key"
    /></ElTabs>
    <div class="panel">
      <div class="toolbar">
        <ElInput
          v-model="query"
          clearable
          placeholder="搜索名称或真实属性"
          @change="
            page = 1;
            load();
          "
        /><ElCheckbox v-model="deleted" @change="page = 1; load()">包含已删除</ElCheckbox
        ><ElButton @click="load">刷新</ElButton
        ><span class="muted">共 {{ total }} 项</span>
      </div>
      <BusinessTable :rows="rows" :columns="tableColumns" :table-key="'catalog:' + kind" :loading="loading"
        :selectable="['lines','physical','towers','spans'].includes(kind)" :actions-width="295"
        @selection-change="selectRows" @sort-change="tableSort" @filter-change="tableFilter">
        <template v-if="kind === 'physical'" #expand="{ row }">
          <div class="physical-circuits">
            <div class="subheading">关联回路明细（{{ row.bindings?.length || 0 }}）</div>
            <BusinessTable client-side :table-key="'physical:bindings'" :rows="row.bindings || []"
              :columns="physicalBindingColumns">
              <template #cell="{ row: link, column }">
                <ElTag v-if="column.key === 'logical_status'" effect="plain">
                  {{ link.logical_deleted ? '已删除' : statusText[link.logical_status] || link.logical_status }}
                </ElTag>
                <span v-else>{{ link[column.key] ?? '—' }}</span>
              </template>
            </BusinessTable>
          </div>
        </template>
        <template #cell="{ row, column }">
          <ElTag v-if="column.key === 'status'" :type="row.deleted ? 'danger' : row.status === 'active' ? 'success' : 'info'" effect="plain">{{ row.deleted ? "已删除" : tableCell(row, column) }}</ElTag>
          <span v-else>{{ tableCell(row, column) }}</span>
        </template>
        <template #actions="{ row }">
          <ElButton size="small" @click="openDetail(row)">查看</ElButton>
          <ElButton size="small" :disabled="!can(catalogPermission) || row.deleted" @click="edit(row)">编辑</ElButton>
          <ElButton v-if="row.deleted && definitions[kind]?.equipment" size="small" :disabled="!can('admin')" @click="edit(row, true)">更正历史</ElButton>
          <ElButton size="small" @click="viewHistory(row)">历史</ElButton>
          <ElButton size="small" type="danger" :disabled="!can('admin') || row.deleted" @click="remove(row)">删除</ElButton>
        </template>
      </BusinessTable>
      <ElPagination
        v-model:current-page="page"
        :page-size="30"
        :total="total"
        layout="prev, pager, next, total"
        @current-change="load"
      />
    </div>
  </template>
  <template v-else
    ><div class="detail-header">
      <ElButton
        @click="
          detail = null;
          history = null;
        "
        >返回列表</ElButton
      >
      <h1>
        {{ detail.label || detail.name || detail.title }}
      </h1>
      <ElTag>{{
        detail.deleted ? "已删除" : statusText[detail.status] || detail.status
      }}</ElTag>
    </div>
    <div class="toolbar">
      <ElButton
        :disabled="!can(catalogPermission) || detail.deleted"
        @click="edit(detail)"
        >编辑</ElButton
      ><ElButton @click="viewHistory(detail)">完整历史</ElButton
      ><ElButton
        v-if="
          kind === 'physical' && detail.status !== 'retired' && !detail.deleted
        "
        :disabled="!can('admin')"
        @click="openReplacement"
        >整基更换</ElButton
      ><ElButton
        type="danger"
        :disabled="!can('admin') || detail.deleted"
        @click="remove(detail)"
        >删除</ElButton
      >
    </div>
    <div class="panel">
      <h2>正式定义</h2>
      <ElDescriptions :column="2" border
        ><ElDescriptionsItem
          v-for="field in fields()"
          :key="field.key"
          :label="field.label"
          :span="field.type === 'json' ? 2 : 1"
        >
          <span v-if="field.type === 'json'">{{
            factText(detail[field.key], field.key, businessLabels)
          }}</span>
          <span v-else>{{
            display(field, detail[field.key])
          }}</span></ElDescriptionsItem
        ></ElDescriptions
      >
    </div>
    <BusinessHistory
      v-if="detail.identity_decisions?.length"
      :value="{ identity_decisions: detail.identity_decisions }" />
    <BusinessHistory
      v-if="detail.replacements?.length"
      :value="{ replacements: detail.replacements }" />
    <div v-if="history" class="panel">
      <h2>完整版本与审计历史</h2>
      <BusinessHistory :value="history" /></div
  ></template>
  <ElDialog
    v-model="replacing"
    title="整基杆塔更换"
    width="850px"
    :close-on-click-modal="false"
    ><ElAlert
      title="核对全部关联回路后建立新实物。历史需求继续采用原正式位置。"
      type="info"
      :closable="false"
    /><BusinessTable client-side table-key="physical:replacement-bindings"
      :rows="replacement?.bindings || []" :columns="replacementBindingColumns" /><ElForm :model="replacementForm" label-position="top" novalidate
      ><div class="form-grid">
        <ElFormItem
          v-for="f in physicalAttributeFields"
          :key="f.key"
          :label="'新杆塔' + f.label"
          ><FieldControl v-model="replacementForm[f.key]" :field="f"
        /></ElFormItem></div></ElForm
    ><template #footer
      ><ElButton @click="replacing = false">取消</ElButton
      ><ElButton type="primary" @click="saveReplacement"
        >确认整基更换</ElButton
      ></template
    ></ElDialog
  >
  <ElDialog
    v-model="dialog"
    :title="(editing ? '编辑' : '新增') + (definitions[kind]?.title || '')"
    width="800px"
    :close-on-click-modal="false"
  >
    <ElForm ref="formRef" :model="form" label-position="top" novalidate>
      <ElTabs v-model="tab"
        ><ElTabPane label="基本定义" name="basic" /><ElTabPane
          v-if="kind === 'operations'"
          label="录入模板"
          name="template" /><ElTabPane
          v-if="kind === 'operations'"
          label="附加字段"
          name="extra" /><ElTabPane label="影响与预览" name="impact"
      /></ElTabs>
      <ElAlert
        v-if="tab === 'impact'"
        title="提交会生成新定义版本。已签署需求、批准范围、费用与结算继续引用原正式版本。"
        type="info"
        :closable="false"
      />
      <template v-if="kind === 'towers' && !editing"
        ><ElFormItem label="实际杆塔关系"
          ><ElRadioGroup v-model="form.physical_mode"
            ><ElRadioButton value="new">新建独立杆塔</ElRadioButton
            ><ElRadioButton value="shared"
              >与已有杆塔共用实体</ElRadioButton
            ></ElRadioGroup
          ></ElFormItem
        >
        <ElCollapse v-if="form.physical_mode === 'new'"
          ><ElCollapseItem title="实物属性（按需填写）" name="physical"
            ><div class="form-grid">
              <ElFormItem
                v-for="f in physicalAttributeFields"
                :key="f.key"
                :label="f.label"
                ><FieldControl
                  v-model="form.physical_properties[f.key]"
                  :field="f"
              /></ElFormItem></div></ElCollapseItem></ElCollapse
      ></template>
      <div class="form-grid">
        <ElFormItem
          v-for="f in fields()"
          v-show="group(f) === tab && visible(f)"
          :key="f.key"
          :label="f.label"
          :prop="f.key"
          :error="errors[f.key]"
          :rules="
            f.required
              ? [
                  {
                    required: true,
                    message: '请填写' + f.label,
                    trigger: 'blur',
                  },
                ]
              : []
          "
          :class="{ 'full-width': f.type === 'json' }"
          ><FieldControl
            v-model="form[f.key]"
            :field="f"
            :filters="dependentFilter(f)"
            :disabled="(!!editing && !!f.immutable) || dependentDisabled(f)"
            @update:model-value="fieldChanged(f.key)"
        /></ElFormItem>
      </div>
      <ExtraFieldsEditor
        v-if="kind === 'operations' && tab === 'extra'"
        :operation="form"
      />
      <FactorDefinitionEditor
        v-if="kind === 'factors' && tab === 'basic'"
        :factor="form"
      />
      <PriceConditionsEditor
        v-if="kind === 'prices' && tab === 'basic'"
        :rule="form"
      />
      <OperationFeaturesEditor
        v-if="kind === 'operations' && tab === 'extra'"
        :operation="form"
      />
      <PricingModelEditor
        v-if="kind === 'prices' && tab === 'basic'"
        :rule="form"
      /> </ElForm
    ><template #footer
      ><ElButton @click="dialog = false">取消</ElButton
      ><ElButton
        :disabled="!can(catalogPermission)"
        type="primary"
        :loading="loading"
        @click="save"
        >保存</ElButton
      ></template
    >
  </ElDialog>
</template>

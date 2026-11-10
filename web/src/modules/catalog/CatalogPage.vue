<script setup lang="ts">
import BusinessDetailDialog from "../../shared/ui/BusinessDetailDialog.vue";
import { useEntityDialog } from "../../shared/composables/use-entity-dialog";
import { useDescriptionColumns } from "../../shared/composables/use-description-columns";import { useDialogDraftGuard } from "../../shared/forms/use-dialog-draft";
const descriptionColumns = useDescriptionColumns();
import { useRoute, useRouter } from "vue-router";
import { useListRoute } from "../../shared/composables/use-list-route";
const route = useRoute(), router = useRouter();
import RowActions from "../../shared/ui/RowActions.vue";
import { factText } from "../../shared/utils/display";
import BusinessHistory from "../../shared/ui/BusinessHistory.vue";
import { useAccess } from "../../shared/composables/use-access";
const can = useAccess();
import { ref, watch, onMounted, computed, nextTick } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import ExtraFieldsEditor from "../work-standards/ExtraFieldsEditor.vue";
import FactorDefinitionEditor from "../pricing/FactorDefinitionEditor.vue";
import PriceConditionsEditor from "../pricing/PriceConditionsEditor.vue";
import OperationFeaturesEditor from "../work-standards/OperationFeaturesEditor.vue";
import PricingModelEditor from "../pricing/PricingModelEditor.vue";
import ExchangePanel from "../exchange/ExchangePanel.vue";
import FieldControl from "../../shared/ui/FieldControl.vue";
import BusinessTable, { type TableColumn } from "../../shared/ui/BusinessTable.vue";
import { api, type Row, statusText, money, quantity } from "../../shared/api/client";
const props = defineProps<{ kinds: string[]; title: string }>();
const definitions = ref<Row>({}),
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
  saving = ref(false),
  editing = ref<Row | null>(null),
  form = ref<Row>({}),
  errors = ref<Row>({}),
  formRef = ref(),
  detail = ref<Row | null>(null),
  businessLabels = ref<Row>({}),
  history = ref<Row | null>(null),
  tab = ref("basic"),
  priceCheck = ref<Row | null>(null),
  priceCheckError = ref(""),
  priceChecking = ref(false),
  priceCheckPanel = ref<HTMLElement | null>(null),
  sampleQuantity = ref(10000),
  latestOperationVersion = ref<number | null>(null);
const kind = computed({
  get: () => String(route.params.kind || props.kinds[0]),
  set: value => { void router.push({ name: route.name!, params: { kind: value }, query: {} }); },
});
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
    await refreshDetail();
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
const draftGuard = useDialogDraftGuard(() => form.value);
function closeEditor() { void draftGuard.confirmClose(() => { dialog.value = false; }); }
function beforeEditorClose(done: () => void) { void draftGuard.confirmClose(done); }
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
  priceCheck.value = null;
  priceCheckError.value = "";
  latestOperationVersion.value = null;
  sampleQuantity.value = 10000;
  if (kind.value === "prices") {
    form.value.operation_version = row?.operation_version ?? null;
    form.value.adopt_latest_operation_version = false;
    void loadLatestOperationVersion();
  }
  dialog.value = true;
  draftGuard.capture();
}
function copyPrice(row: Row) {
  edit(row);
  editing.value = null;
  form.value.title = row.title + "（副本）";
  form.value.operation_version = null;
  form.value.adopt_latest_operation_version = false;
  priceCheck.value = null;
  draftGuard.capture();
}
async function loadLatestOperationVersion() {
  const id = form.value.operation_id;
  latestOperationVersion.value = null;
  if (!id) return;
  try {
    const operation = await api("/catalog/operations/" + id);
    if (form.value.operation_id === id) latestOperationVersion.value = operation.version;
  } catch {
    latestOperationVersion.value = null;
  }
}
function adoptLatestOperationVersion() {
  if (!latestOperationVersion.value) return;
  form.value.adopt_latest_operation_version = true;
  form.value.operation_version = latestOperationVersion.value;
  priceCheck.value = null;
}
async function previewPrice() {
  if (priceChecking.value) return;
  priceChecking.value = true;
  priceCheck.value = null;
  priceCheckError.value = "";
  try {
    if (form.value.price_features_load_error || form.value.price_features_loading)
      throw new Error(form.value.price_features_load_error || "请先完成价格特征加载");
    priceCheck.value = await api("/catalog/prices/preview", "POST", {
      ...form.value,
      sample_quantity_scaled: sampleQuantity.value,
      existing_id: editing.value?.id,
    });
  } catch (error) {
    priceCheckError.value = (error as Error).message;
  } finally {
    priceChecking.value = false;
    if (priceCheck.value || priceCheckError.value) {
      await nextTick();
      priceCheckPanel.value?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }
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
const towerNatureField = computed(() => definitions.value.physical?.fields.find((field: Row) => field.key === "tower_nature"));
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
  if (kind.value === "prices") {
    priceCheck.value = null;
    if (key === "operation_id") {
      form.value.operation_version = null;
      form.value.adopt_latest_operation_version = false;
      void loadLatestOperationVersion();
    }
  }
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
const optionalPhysicalFields = computed(() => physicalAttributeFields.value.filter(field => field.key !== "tower_nature"));
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
      { key: "status", label: "状态" },
    ],
    physical: [
      { key: "tower_code", label: "系统编号", minWidth: 220 },
      { key: "tower_type", label: "塔型" },
      { key: "tower_nature", label: "杆塔性质" },
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
      { key: "tower_nature", label: "杆塔性质" },
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
    .filter((f: Row) => !f.systemManaged && f.type !== "json" && (kind.value === "objects" || f.key !== "work_target_type"))
    .map((f: Row) => ({ key: f.key, label: f.label, minWidth: ["name", "title"].includes(f.key) ? 190 : 130 }));
});
function tableCell(row: Row, column: TableColumn) {
  const key = column.key, value = row[key];
  if (value === null || value === undefined || value === "") return "—";
  if (key === "height_scaled" || key === "transmission_center_length_mm")
    return Number(value) / (key === "height_scaled" ? 10000 : 1000);
  if (typeof value === "boolean") return value ? "是" : "否";
  const f = [...(definitions.value[kind.value]?.rootFields || []), ...(definitions.value[kind.value]?.fields || [])].find((f: Row) => f.key === key);
  if (f?.type === "boolean") return value ? "是" : "否";
  if (f?.type === "select" || ["tower_nature", "line_kind"].includes(key))
    return statusText[String(value)] || value;
  if (f?.type === "ref") return value ? row[key + "_label"] || "历史关联记录" : "—";
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
  if (kind.value === "prices") {
    if (["voltage_level_id", "tower_type", "work_mode", "specification",
      "additional_conditions_json"].includes(f.key)) return "conditions";
    if (["pricing_scope", "pricing_mode", "base_fee_fen", "unit_price_fen",
      "quantity_brackets_json", "calculation_params_json",
      "fee_components_json"].includes(f.key)) return "pricing";
    return "basic";
  }
  if (kind.value !== "operations") return "basic";
  if (f.key === "pricing_features_json") return "pricingInfo";
  if (f.key === "fields_json") return "extra";
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
  if (saving.value) return;
  saving.value = true;
  try {
    if (!(await formRef.value?.validate().catch(() => false))) {
      const invalid = formRef.value?.fields?.find((item: Row) =>
        item.validateState === "error");
      const definition = fields().find((item: Row) => item.key === invalid?.prop);
      if (definition && ["prices", "operations"].includes(kind.value))
        tab.value = group(definition);
      await nextTick();
      (formRef.value?.$el as HTMLElement | undefined)
        ?.querySelector<HTMLElement>(".el-form-item.is-error input")?.focus();
      ElMessage.warning("请完善标红的必填信息后保存");
      return;
    }
    if (kind.value === "operations" &&
      (form.value.price_features_load_error || form.value.price_features_loading)) {
      ElMessage.error(form.value.price_features_load_error || "计价所需信息尚未加载完毕");
      return;
    }
    if (kind.value === "prices") {
      await previewPrice();
      if (!priceCheck.value?.valid) {
        ElMessage.error(priceCheckError.value || "价格规则预检查未通过");
        return;
      }
    }
    const c = definitions.value[kind.value];
    if (
      kind.value === "towers" &&
      !editing.value &&
      form.value.physical_mode === "new"
    )
      delete form.value.physical_tower_id;
    const saved = await api(
      "/catalog/" + kind.value + (editing.value ? "/" + editing.value.id : ""),
      "POST",
      {
        ...form.value,
        ...(kind.value === "towers" && form.value.physical_mode === "shared" ? { physical_properties: {} } : {}),
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
    // The form stays locked until its list/detail refresh completes. Otherwise
    // a rapid second creation opens while the previous saving flag is true.
    ElMessage.success("正式版本已保存，正在刷新列表");
    await load();
    await refreshDetail();
    dialog.value = false;
    for (const warning of saved.warnings || []) ElMessage.warning({ message: warning, duration: 8000 });
  } catch (e) {
    errors.value = (e as Row).fields || {};
    ElMessage.error((e as Error).message);
  } finally {
    saving.value = false;
  }
}
// One-step price retirement preserves original terms and references. A later
// reactivation still requires explicit validation of the current definitions.
async function retirePrice(row: Row) {
  if (kind.value !== "prices" || row.deleted || row.status !== "active") return;
  try {
    await ElMessageBox.confirm(
      "停用后不再参与新的参考报价；已有报价及历史规则不变。仅记录状态变化，不修改计价条件。",
      "停用参考价格规则",
      { type: "warning", confirmButtonText: "确认停用" },
    );
    await api("/catalog/prices/" + row.id, "POST", {
      status: "inactive",
      expected_version: row.version_no,
      reason: "正式停用参考价格规则",
    });
    ElMessage.success("参考价格规则已停用，正式历史已保留");
    await load();
    await refreshDetail();
  } catch (error) {
    if (error instanceof Error) ElMessage.error(error.message);
  }
}
async function remove(row: Row) {
  try {
    await ElMessageBox.confirm(
      "删除后从正常列表与新增选择中移除，正式历史和已有引用保留。",
      "确认删除",
      { type: "warning" },
    );
    const c = definitions.value[kind.value];
    await api("/catalog/" + kind.value + "/" + row.id, "DELETE", {
      expected_version: row[c.sequence || "version_no"] || row.version || 1,
    });
    await load();
    await refreshDetail();
  } catch (e) {
    if (e instanceof Error) ElMessage.error(e.message);
  }
}
async function hydrateDetail(id: string) {
  const requestedKind = kind.value;
  const row = await api(`/catalog/${requestedKind}/${id}?deleted=true`);
  history.value = null;
  const names: Row = {};
  for (const field of fields().filter(
    (field) => field.type === "ref" && row[field.key],
  )) {
    try {
      const record = await api(
        `/catalog/${field.reference}/${row[field.key]}?deleted=true`,
      );
      names[field.key] =
        record.label || record.name || record.tower_no || "历史关联对象";
    } catch {
      names[field.key] = "历史关联对象";
    }
  }
  return { ...row, reference_names: names };
}

async function refreshDetail() {
  const id = detail.value?.id;
  if (!id) return;
  const value = await hydrateDetail(id);
  if (detail.value?.id === id) detail.value = value;
}
function openDetail(row: Row) { return detailDialog.open(row.id); }
function display(field: Row, value: unknown) {
  if (value == null || value === "") return "—";
  if (field.type === "money") return "¥" + money(value as number);
  if (field.type === "quantity") return quantity(value as number);
  if (field.type === "length_m") return Number(value) / 1000;
  if (field.type === "ref")
    return detail.value?.reference_names?.[field.key] || "历史关联对象";
  if (field.type === "boolean") return value ? "是" : "否";
  if (field.type === "select" || field.key === "tower_nature") return statusText[String(value)] || value;
  return value;
}
async function viewHistory(row: Row) {
  if (detail.value?.id !== row.id) await detailDialog.open(row.id);
  if (detail.value?.id !== row.id) return;
  const value = await api(`/catalog/${kind.value}/history/${row.id}`);
  if (detail.value?.id === row.id) history.value = value;
}
function selectRows(selected: Row[]) {
  selectedIds.value = selected.map((row) => String(row.id));
}
watch(kind, () => {
  selectedIds.value = [];
  rows.value = [];
  history.value = null;
  void load();
});
useListRoute({ q: query, page, deleted, sort: sortKey, direction: sortDirection, filters: columnFilters }, load);
const detailDialog = useEntityDialog(detail, hydrateDetail, () => { dialog.value = false; replacing.value = false; history.value = null; });
const { isOpen: detailOpen, loading: detailLoading, error: detailError } = detailDialog;
onMounted(async () => {
  [definitions.value, businessLabels.value] = await Promise.all([
    api("/catalogs"),
    api("/display-labels"),
  ]);
  await load();
});
</script>
<template>
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
    <ElTabs v-if="kinds.length > 1" v-model="kind"
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
      <BusinessTable :rows="rows" :columns="tableColumns" :table-key="'catalog:' + kind" :loading="loading" :filter-state="columnFilters"
        :sort-state="{ prop: sortKey, order: sortKey ? (sortDirection === 'asc' ? 'ascending' : 'descending') : null }"
        :selectable="['lines','physical','towers','spans'].includes(kind)" :actions-width="180"
        @selection-change="selectRows" @sort-change="tableSort" @filter-change="tableFilter">
        <template #cell="{ row, column }">
          <ElTag v-if="column.key === 'status'" :type="row.deleted ? 'danger' : row.status === 'active' ? 'success' : 'info'" effect="plain">{{ row.deleted ? "已删除" : tableCell(row, column) }}</ElTag>
          <span v-else>{{ tableCell(row, column) }}</span>
        </template>
        <template #actions="{ row }">
          <RowActions :actions="[
            { label: '查看', run: () => openDetail(row) },
            { label: '编辑', disabled: !can(catalogPermission) || row.deleted, run: () => edit(row) },
            ...(kind === 'prices' ? [{ label: '复制规则', disabled: !can(catalogPermission) || row.deleted, run: () => copyPrice(row) }] : []),
            ...(kind === 'prices' && row.status === 'active' ? [{ label: '停用', danger: true, disabled: !can('admin') || row.deleted, run: () => retirePrice(row) }] : []),
            ...(row.deleted && definitions[kind]?.equipment ? [{ label: '更正历史', disabled: !can('admin'), run: () => edit(row, true) }] : []),
            { label: '历史', run: () => viewHistory(row) },
            { label: '删除', danger: true, disabled: !can('admin') || row.deleted, run: () => remove(row) },
          ]" />
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

  <BusinessDetailDialog :open="detailOpen" :title="(definitions[kind]?.title || '业务') + '详情'" :loading="detailLoading" :error="detailError"
    @close="detailDialog.close" @retry="detailDialog.reload">
    <template v-if="detail"><div class="detail-header">
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
      ><ElButton v-if="kind === 'prices'" :disabled="!can(catalogPermission) || detail.deleted" @click="copyPrice(detail)">复制规则</ElButton
      ><ElButton v-if="kind === 'prices' && detail.status === 'active' && !detail.deleted"
        :disabled="!can('admin')" @click="retirePrice(detail)">停用规则</ElButton
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
      <ElDescriptions :column="descriptionColumns" border
        ><ElDescriptionsItem
          v-for="field in fields()"
          :key="field.key"
          :label="field.label"
          :span="field.type === 'json' ? descriptionColumns : 1"
        >
          <span v-if="field.type === 'json'">{{
            factText(detail[field.key], field.key, businessLabels)
          }}</span>
          <span v-else>{{
            display(field, detail[field.key])
          }}</span></ElDescriptionsItem
        ><ElDescriptionsItem v-if="kind === 'towers'" label="杆塔性质">{{ statusText[detail.tower_nature] || '未填写' }}</ElDescriptionsItem></ElDescriptions
      >
    </div>
          <div v-if="kind === 'physical'" class="panel">
            <div class="subheading">关联逻辑杆塔（{{ detail.bindings?.length || 0 }}）</div>
            <BusinessTable client-side :table-key="'physical:bindings'" :rows="detail.bindings || []"
              :columns="physicalBindingColumns">
              <template #cell="{ row: link, column }">
                <ElTag v-if="column.key === 'logical_status'" effect="plain">
                  {{ link.logical_deleted ? '已删除' : statusText[link.logical_status] || link.logical_status }}
                </ElTag>
                <span v-else>{{ link[column.key] ?? '—' }}</span>
              </template>
            </BusinessTable>
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
  </BusinessDetailDialog>
  <ElDialog append-to-body
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
  <ElDialog append-to-body
    :key="kind"
    v-model="dialog"
    :title="(editing ? '编辑' : '新增') + (definitions[kind]?.title || '')"
    width="800px"
    :close-on-click-modal="false"
    :before-close="beforeEditorClose"
  >
    <ElForm ref="formRef" :model="form" label-position="top" novalidate>
      <ElTabs v-if="kind === 'operations' || kind === 'prices'" v-model="tab">
        <template v-if="kind === 'operations'">
          <ElTabPane label="基本定义" name="basic" />
          <ElTabPane label="录入模板" name="template" />
          <ElTabPane label="附加字段" name="extra" />
          <ElTabPane label="计价所需信息" name="pricingInfo" />
        </template>
        <template v-else>
          <ElTabPane label="基本信息" name="basic" />
          <ElTabPane label="适用条件" name="conditions" />
          <ElTabPane label="计价方式" name="pricing" />
        </template>
      </ElTabs>
      <div v-if="kind === 'prices' && tab === 'basic'" class="panel">
        <div class="toolbar" style="flex-wrap:wrap">
          <span class="muted">操作类型正式版本：{{ form.adopt_latest_operation_version
            ? latestOperationVersion : (editing?.operation_version || latestOperationVersion || '待选择') }}</span>
          <ElButton v-if="editing && latestOperationVersion &&
            editing.operation_id === form.operation_id &&
            latestOperationVersion !== editing.operation_version &&
            !form.adopt_latest_operation_version" type="warning" plain
            @click="adoptLatestOperationVersion">采用最新 V{{ latestOperationVersion }} 作业标准</ElButton>
        </div>
        <p v-if="form.adopt_latest_operation_version" class="muted">
          将采用新的操作类型定义版本；请在“适用条件”中重新核对特征。
        </p>
      </div>
      <template v-if="kind === 'towers' && !editing"
        ><ElFormItem label="实际杆塔关系"
          ><ElRadioGroup v-model="form.physical_mode"
            ><ElRadioButton value="new">新建独立杆塔</ElRadioButton
            ><ElRadioButton value="shared"
              >与已有杆塔共用实体</ElRadioButton
            ></ElRadioGroup
          ></ElFormItem
        >
        <ElFormItem v-if="form.physical_mode === 'new' && towerNatureField" label="杆塔性质">
          <FieldControl v-model="form.physical_properties.tower_nature" :field="towerNatureField" />
        </ElFormItem>
        <ElCollapse v-if="form.physical_mode === 'new'"
          ><ElCollapseItem title="实物属性（按需填写）" name="physical"
            ><div class="form-grid">
              <ElFormItem
                v-for="f in optionalPhysicalFields"
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
        v-if="kind === 'prices' && tab === 'conditions'"
        :rule="form"
      />
      <OperationFeaturesEditor
        v-if="kind === 'operations' && tab === 'pricingInfo'"
        :operation="form"
      />
      <PricingModelEditor
        v-if="kind === 'prices' && tab === 'pricing'"
        :rule="form"
      />
      <div v-if="kind === 'prices'" ref="priceCheckPanel" class="panel" style="margin-top:12px">
        <div class="form-grid">
          <ElFormItem label="示例工作量（用于检查计算结果）">
            <FieldControl v-model="sampleQuantity" :field="{ type: 'quantity' }" />
          </ElFormItem>
        </div>
        <ElAlert v-if="priceCheckError" type="error" :closable="false" :title="'规则检查未通过：' + priceCheckError" />
        <template v-if="priceCheck">
          <ElAlert :type="priceCheck.overlaps?.length ? 'warning' : 'success'" :closable="false"
            :title="priceCheck.overlaps?.length ? '存在可能重叠的参考价格规则' : '规则完整性检查通过'" />
          <div v-if="priceCheck.overlaps?.length" class="toolbar" style="margin-top:8px;flex-wrap:wrap">
            <ElTag v-for="item in priceCheck.overlaps" :key="item.id" type="warning">{{ item.title }}</ElTag>
          </div>
          <p class="muted">所采用操作类型版本：V{{ priceCheck.operation_version }}。检查不会写入数据；冲突规则须在正式报价时明确选择依据。</p>
          <p v-if="priceCheck.sample"><strong>试算金额：¥{{ money(priceCheck.sample.amount_fen) }}</strong>
            <span class="muted">（工作量 {{ quantity(priceCheck.sample.quantity_scaled) }}，仅供核对计算模型）</span></p>
          <p v-else-if="priceCheck.sample_error" class="muted">
            暂不能试算：{{ priceCheck.sample_error }}。需先提供真实费用基数或选择有效的数量分档。</p>
        </template>
      </div></ElForm
    ><template #footer
      ><ElButton @click="closeEditor">取消</ElButton
      ><ElButton v-if="kind === 'prices'" :loading="priceChecking" @click="previewPrice">保存前检查</ElButton
      ><ElButton
        :disabled="!can(catalogPermission)"
        type="primary"
        :loading="saving"
        @click="save"
        >保存</ElButton
      ></template
    >
  </ElDialog>
</template>

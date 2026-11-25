<template>
  <ElCard shadow="never">
    <div class="flex flex-wrap items-center justify-between gap-4 mb-4">
      <h2 class="text-lg font-semibold">{{ mode === "create" ? "批量新增专业需求" : "批量修订需求资料" }}</h2>
      <div class="page-heading-actions flex flex-wrap gap-2">
        <ElButton :disabled="busy || adding" @click="cancel">返回需求列表</ElButton>
        <ElButton :disabled="busy || adding" @click="preflight">预检</ElButton>
        <ElButton type="primary" :disabled="busy || adding || !pending" @click="submit">整批提交</ElButton>
      </div>
    </div>
    <ElForm v-if="mode === 'create' && prioritiesReady" novalidate class="business-control-row mb-3">
      <ElFormItem label="本批操作类型" label-position="left" class="mb-0">
        <ElSelect :model-value="operation?.id" filterable remote :remote-method="searchOperations"
          :disabled="busy || adding || operationFrozen" placeholder="搜索操作类型" @change="chooseOperation">
          <ElOption v-for="item in operations" :key="item.id" :label="item.name" :value="item.id" />
        </ElSelect>
      </ElFormItem>
      <ElFormItem label="新增行数" label-position="left" class="mb-0">
        <ElInputNumber v-model="newRows" :min="1" :max="Math.max(1, 5000 - tables.documents.rows.length)"
          :precision="0" :disabled="!operation || busy || adding" />
      </ElFormItem>
      <ElButton type="primary" :disabled="!operation || busy || adding" @click="addDemand">新增需求行</ElButton>
    </ElForm>
    <ElAlert v-if="error" class="mb-3" type="error" :title="error" :closable="false" />
    <ElSkeleton v-if="loadingPriorities" :rows="5" animated />
    <ElButton v-else-if="!prioritiesReady" @click="loadPriorities">重新加载优先级</ElButton>
    <ElTabs v-else v-model="tab">
      <ElTabPane v-for="key in visibleTables" :key="key" :label="titles[key]" :name="key" lazy>
        <div v-if="mode === 'create' && key === 'documents' && operation" class="business-control-row mb-3">
          <ElSelect v-model="kind" aria-label="位置类型" :disabled="busy" style="width: 155px">
            <ElOption v-for="value in locationKinds" :key="value" :value="value" :label="locationNames[value]" />
          </ElSelect>
          <ElButton :disabled="busy || adding || !tables.documents.rows.length" @click="openReference('equipment')">为选中需求添加位置</ElButton>
          <ElButton :disabled="busy || adding || !tables.documents.rows.length" @click="openReference('materials')">为选中需求添加物资</ElButton>
          <ElButton :disabled="busy || adding || !tables.documents.rows.length" @click="addSource">为选中需求添加来源</ElButton>
        </div>
        <BusinessWorksheet :ref="instance => bindSheet(key, instance)" :session-key="(operation?.id ?? mode) + key" :name="titles[key]"
          :rows="tables[key].rows" :columns="columns[key]" :validate="noLocalIssues" :disabled="busy"
          :removable="mode === 'create'" remove-label="移除选中行"
          @rows-change="rows => tables[key].rows = rows" @change="values => tables[key].values = values" />
      </ElTabPane>
    </ElTabs>
    <NativeRecordPicker v-if="reference === 'equipment'" title="选择批量作业设备" placeholder="搜索杆塔、线路或档距"
      confirm-label="添加所选位置" :columns="equipmentColumns" :loader="loadEquipment" :selectable="selectableEquipment"
      :saving="busy || adding" @close="reference = null" @confirm="addEquipment" />
    <NativeRecordPicker v-if="reference === 'materials'" title="选择批量预计物资" placeholder="搜索名称、规格或型号"
      confirm-label="添加预计物资" :columns="materialPickerColumns" :loader="loadMaterials" :selectable="selectableMaterial"
      :saving="busy || adding" @close="reference = null" @confirm="addMaterials" />
    <ElAlert v-if="preview" class="mt-3" :type="preview.issues.length ? 'warning' : 'success'" :closable="false"
      :title="`预检 ${preview.summary.documents} 条，新增 ${preview.summary.created} 条，修订 ${preview.summary.updated} 条，问题 ${preview.issues.length} 项`" />
    <ElTable v-if="preview?.issues.length" :data="preview.issues" border max-height="230" class="mt-3">
      <ElTableColumn prop="sheet" label="工作表" width="130" />
      <ElTableColumn label="预检行号" width="100">
        <template #default="{ row }">
          <ElButton link type="primary" @click="focusIssue(row as WorkbookIssue)">{{ row.row }}</ElButton>
        </template>
      </ElTableColumn>
      <ElTableColumn prop="import_ref" label="需求组号" width="130" />
      <ElTableColumn prop="reason" label="问题" />
    </ElTable>
  </ElCard>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowReactive, shallowRef, watchEffect } from "vue";
import type { ComponentPublicInstance } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import BusinessWorksheet from "@/components/BusinessWorksheet/BusinessWorksheet.vue";
import type { WorksheetColumn, WorksheetRow, WorksheetValues } from "@/components/BusinessWorksheet/univer-engine";
import NativeRecordPicker from "@/components/business/NativeRecordPicker.vue";
import { attributeInput, attributeOptions, attributeText, worksheetAttribute } from "@/components/business/demand-worksheet-attributes";
import { commitWorkbook, previewDemandWorksheet, type DemandWorksheetTables, type ExchangePreview } from "@/api/business/exchange";
import type { DemandRow } from "@/api/business/demands";
import { listEquipment, type EquipmentRow } from "@/api/business/equipment";
import { queryMaterials, type Material } from "@/api/business/materials";
import { listDictionaries, type DictionaryRow } from "@/api/business/dictionaries";
import { listStandards, readOperationDefinition, type WorkStandardRow } from "@/api/business/standards";
import { formatScaledDecimal } from "@/utils/business/fixed-scale";
import { randomRequestId } from "@/utils/business/request-id";
import { listRouteIdentity } from "@/components/Crud/utils/list-state";
import type { DemandLocationKind } from "../../../../server/shared/types/demands";
import type { OperationRecord } from "../../../../server/shared/types/work-standards";
import type { WorkbookIssue } from "../../../../server/shared/types/exchange";
import type { OperationAttribute } from "../../../../server/shared/types/operation-attributes";

const props = defineProps<{ mode: "create" | "update"; records: DemandRow[] }>();
const emit = defineEmits<{ cancel: []; saved: [] }>();
type TableKey = keyof DemandWorksheetTables;
type CellValues = DemandWorksheetTables[TableKey][number];
interface DraftTable { rows: readonly WorksheetRow[]; values: WorksheetValues; }
const tableOrder: TableKey[] = ["documents", "work_locations", "materials", "sources"];
const titles: Record<TableKey, string> = { documents: "需求清单", work_locations: "作业位置", materials: "预计物资", sources: "补充来源" };
const sheets: Partial<Record<TableKey, InstanceType<typeof BusinessWorksheet>>> = {};
const references = new WeakMap<WorksheetRow, CellValues>();
const baseRows: WorksheetRow[] = props.records.map(row => {
  const draft: WorksheetRow = {
    id: row.id, label: row.demand_no,
    values: { import_ref: row.demand_no, operation_name: row.operation_snapshot, problem_description: row.problem_description,
      completion_standard: row.completion_standard, target_object: row.target_object, expected_on: row.expected_on ?? "",
      priority: row.priority_snapshot ?? "", reason: "" },
  };
  references.set(draft, { id: row.id, expected_version: row.current_version });
  return draft;
});
const emptyTable = () => shallowReactive<DraftTable>({ rows: [], values: {} });
const tables = {
  documents: shallowReactive<DraftTable>({ rows: baseRows, values: {} }),
  work_locations: emptyTable(), materials: emptyTable(), sources: emptyTable(),
};
const visibleTables = computed(() => props.mode === "create" ? tableOrder : ["documents"] as const);
const tab = ref<TableKey>("documents");
const error = ref("");
const busy = ref(false);
const adding = ref(false);
const operationFrozen = ref(false);
const newRows = ref<number | undefined>(1);
const preview = shallowRef<ExchangePreview>();
const pending = shallowRef<{ token: string; key: string; signature: string }>();
const noLocalIssues = () => [];
const operations = ref<WorkStandardRow[]>([]);
const priorities = shallowRef<DictionaryRow[]>([]);
const prioritiesReady = ref(false), loadingPriorities = ref(true);
const operation = shallowRef<OperationRecord>();
const reference = ref<"equipment" | "materials" | null>(null);
const parent = ref("");
let sequence = 0;
let operationSearch = 0;
let previewRowIds: Record<TableKey, string[]> = { documents: [], work_locations: [], materials: [], sources: [] };
let active = true;

const locationNames = { physical_tower: "物理杆塔", logical_tower: "逻辑杆塔", span: "档距" };
const locationCatalogs = { physical_tower: "physical", logical_tower: "towers", span: "spans" } as const;
const locationKinds = computed<DemandLocationKind[]>(() => operation.value?.attribution_unit === "physical_tower"
  ? ["physical_tower"] : operation.value?.object_position === "corridor" ? ["logical_tower", "span"] : ["logical_tower"]);
const kind = ref<DemandLocationKind>("physical_tower");
const modeLabels = ["未明确", "停电", "不停电"];

const group: WorksheetColumn = { key: "import_ref", title: props.mode === "create" ? "需求组号" : "需求编号", width: 135 };
const ordinaryColumns: Record<TableKey, WorksheetColumn[]> = {
  documents: [group, { key: "operation_name", title: "操作类型", width: 185 },
    { key: "problem_description", title: "问题描述", width: 295, editable: true, required: true },
    { key: "completion_standard", title: "验收标准", width: 240, editable: true, required: true },
    { key: "target_object", title: "处理部位", width: 180, editable: true },
    { key: "expected_on", title: "预计解决时间", width: 145, editable: true },
    { key: "reason", title: "修订说明", width: 180, editable: true },
  ],
  work_locations: [group, { key: "name", title: "作业位置", width: 155 },
    { key: "line", title: "线路", width: 160 }, { key: "start", title: "起点杆塔号", width: 110 }, { key: "end", title: "终点杆塔号", width: 110 },
    { key: "quantity_scaled", title: "需求数量", width: 120, editable: true, numeric: true, required: true },
    { key: "work_mode", title: "作业方式", width: 120, editable: true, options: modeLabels },
    { key: "specification", title: "设备规格", width: 170, editable: true },
  ],
  materials: [group, { key: "name", title: "物资名称", width: 185 }, { key: "model", title: "型号", width: 155 },
    { key: "specification", title: "规格", width: 155 }, { key: "unit", title: "单位", width: 95 },
    { key: "quantity_scaled", title: "预计数量", width: 120, editable: true, numeric: true, required: true },
    { key: "note", title: "说明", width: 180, editable: true }],
  sources: [group, { key: "description", title: "来源说明", width: 420, editable: true, required: true },
    { key: "discovered_on", title: "发现日期", width: 150, editable: true }],
};
if (props.mode === "create") ordinaryColumns.documents.pop();
const attributes = computed(() => (JSON.parse(operation.value?.attributes_schema_json || "[]") as OperationAttribute[])
  .filter(field => field.enabled && worksheetAttribute(field)));
function attributeDefinition(field: OperationAttribute): WorksheetColumn {
  return {
    key: "attribute:" + field.key, title: field.label, width: 160, editable: true,
    numeric: field.type === "integer" || field.type === "decimal", options: attributeOptions(field),
    multiple: field.type === "multiselect", required: field.requirement === "save",
  };
}
const columns = computed<Record<TableKey, WorksheetColumn[]>>(() => ({
  ...ordinaryColumns,
  documents: [...ordinaryColumns.documents,
    { key: "priority", title: "优先级", width: 130, editable: true, options: priorities.value.map(row => row.name) },
    ...attributes.value.filter(field => field.scope === "demand").map(attributeDefinition)],
  work_locations: [...ordinaryColumns.work_locations, ...attributes.value.filter(field => field.scope === "location").map(attributeDefinition)],
}));
function attributeDefaults(scope: OperationAttribute["scope"]) {
  return Object.fromEntries(attributes.value.filter(field => field.scope === scope)
    .map(field => ["attribute:" + field.key, attributeText(field, field.default_value)]));
}

const equipmentColumns = computed<{ key: keyof EquipmentRow; label: string; width?: number }[]>(() => kind.value === "physical_tower"
  ? [{ key: "asset_no", label: "现场铭牌", width: 170 }, { key: "tower_code", label: "物理杆塔编号" }, { key: "tower_material_label", label: "杆塔材质" }]
  : kind.value === "span"
    ? [{ key: "line_id_label", label: "线路" }, { key: "start_tower_no", label: "起点杆塔号" }, { key: "end_tower_no", label: "终点杆塔号" }]
    : [{ key: "line_id_label", label: "线路" }, { key: "voltage_level_name", label: "电压等级" }, { key: "tower_no", label: "杆塔号" }]);
const materialPickerColumns: { key: keyof Material; label: string; width?: number }[] = [
  { key: "name", label: "物资名称", width: 170 }, { key: "model", label: "型号" }, { key: "specification", label: "规格" },
  { key: "unit_id_label", label: "单位" },
];

function bindSheet(key: TableKey, instance: Element | ComponentPublicInstance | null) {
  if (instance) sheets[key] = instance as InstanceType<typeof BusinessWorksheet>;
  else delete sheets[key];
}
async function searchOperations(keyword: string) {
  const request = ++operationSearch;
  try {
    const result = await listStandards("operations", { keyword, size: 30 });
    if (request === operationSearch) operations.value = result.items.filter(row => row.status === "active" && !row.deleted);
  } catch (failure) {
    if (active && request === operationSearch) error.value = (failure as Error).message;
  }
}
async function loadPriorities() {
  loadingPriorities.value = true;
  error.value = "";
  try {
    const size = 200;
    const first = await listDictionaries("priorities", { size });
    const rows = first.items.slice();
    const pages = Math.ceil(first.total / size);
    for (let page = 2; page <= pages; page++) rows.push(...(await listDictionaries("priorities", { page, size })).items);
    if (!active) return;
    priorities.value = rows.filter(row => row.status === "active" && !row.deleted);
    prioritiesReady.value = true;
  } catch (failure) {
    if (active) error.value = (failure as Error).message;
  } finally {
    loadingPriorities.value = false;
  }
}
void loadPriorities();
if (props.mode === "create") void searchOperations("");
async function chooseOperation(id: string) {
  busy.value = true;
  try {
    operation.value = await readOperationDefinition(id);
    kind.value = locationKinds.value[0];
  } catch (failure) {
    error.value = (failure as Error).message;
  } finally {
    busy.value = false;
  }
}
function draftRow(values: Record<string, string>, referenceFields: CellValues = {}): WorksheetRow {
  const row = { id: String(++sequence), label: values.import_ref, values };
  references.set(row, referenceFields);
  return row;
}
async function append(key: TableKey, rows: WorksheetRow[]) {
  if (adding.value || !rows.length) return false;
  if (key !== "documents" && tableOrder.slice(1).reduce((total, section) => total + tables[section].rows.length, 0) + rows.length > 25000) {
    error.value = "一批最多25000行明细";
    return false;
  }
  adding.value = true;
  try {
    tab.value = key;
    await nextTick();
    const target = sheets[key];
    if (!target || !await target.addRows(rows)) throw Error("工作表尚未就绪，未添加本次明细");
    return true;
  } catch (failure) {
    error.value = (failure as Error).message;
    return false;
  } finally {
    adding.value = false;
  }
}
async function addDemand() {
  const count = newRows.value;
  if (!operation.value || adding.value) return;
  if (!count || !Number.isSafeInteger(count) || count < 1 || tables.documents.rows.length + count > 5000) {
    error.value = "请填写新增行数。一批最多5000条需求";
    return;
  }
  const { id, name, version, completion_standard, default_target_object } = operation.value;
  const added = await append("documents", Array.from({ length: count }, () => draftRow({
    import_ref: "XQ" + (sequence + 1), operation_name: name, problem_description: "",
    completion_standard: completion_standard ?? "", target_object: default_target_object, expected_on: "",
    ...attributeDefaults("demand"),
  }, { operation_id: id, operation_version: version })));
  if (added) operationFrozen.value = true;
}
function selectedParent() {
  const ids = sheets.documents?.selectedRowIds() ?? [];
  const root = ids.length === 1 ? tables.documents.rows.find(row => row.id === ids[0]) : undefined;
  if (!root) ElMessage.warning("请在需求清单选择一个需求");
  return root?.values.import_ref;
}
function openReference(type: typeof reference.value) {
  const root = selectedParent();
  if (!root) return;
  parent.value = root;
  reference.value = type;
}
function loadEquipment(keyword: string, page: number) {
  return listEquipment(locationCatalogs[kind.value], { keyword, page, size: 20 });
}
function selectableEquipment(row: EquipmentRow) {
  const idKey = kind.value === "span" ? "span_id" : kind.value === "physical_tower" ? "physical_tower_id" : "logical_tower_id";
  return !row.deleted && !["inactive", "retired"].includes(row.status) &&
    !tables.work_locations.rows.some(item => item.values.import_ref === parent.value && references.get(item)?.[idKey] === row.id);
}
async function addEquipment(selection: EquipmentRow[]) {
  if (busy.value) return;
  const type = kind.value;
  const locationKey = type === "physical_tower" ? "physical_tower_id" : type === "logical_tower" ? "logical_tower_id" : "span_id";
  const eligible = selection.filter(selectableEquipment);
  if (tables.work_locations.rows.filter(row => row.values.import_ref === parent.value).length + eligible.length > 5000) {
    error.value = "一条需求最多5000处作业位置";
    return;
  }
  const rows = eligible.map(row => draftRow({
    import_ref: parent.value, name: row.label, line: row.line_id_label || row.line_name || "",
    start: row.start_tower_no || "", end: row.end_tower_no || "",
    quantity_scaled: formatScaledDecimal(operation.value?.default_quantity_scaled, 4), work_mode: "未明确", specification: "",
    ...attributeDefaults("location"),
  }, { location_kind: type, location_ref: "WZ" + (sequence + 1), [locationKey]: row.id, ...(type === "span" ? { span_version: row.version } : {}) }));
  if (await append("work_locations", rows)) reference.value = null;
}
function loadMaterials(keyword: string, page: number) { return queryMaterials({ keyword, page, pageSize: 20, status: "active" }); }
function selectableMaterial(row: Material) {
  return !row.deleted && row.status === "active" && !tables.materials.rows.some(item =>
    item.values.import_ref === parent.value && references.get(item)?.material_id === row.id);
}
async function addMaterials(selection: Material[]) {
  if (busy.value) return;
  const rows = selection.filter(selectableMaterial).map(row => draftRow({
    import_ref: parent.value, name: row.name, model: row.model, specification: row.specification,
    unit: row.unit_id_label, quantity_scaled: "1", note: "",
  }, { material_id: row.id }));
  if (await append("materials", rows)) reference.value = null;
}
async function addSource() {
  const root = selectedParent();
  if (root) await append("sources", [draftRow({ import_ref: root, description: "", discovered_on: "" })]);
}
function collect(key: TableKey, rowIds?: string[]) {
  const table = tables[key];
  return table.rows.flatMap(row => {
    const values = table.values[row.id] ?? row.values;
    const edits = columns.value[key].filter(column => column.editable)
      .map(column => [column.key, values[column.key] ?? ""] as const)
      .filter(([field, value]) => props.mode === "create" || (row.values[field] ?? "") !== value);
    if (props.mode === "update" && !edits.length) return [];
    const fact: CellValues = { import_ref: row.values.import_ref, ...references.get(row) };
    for (const [field, value] of edits) {
      if (field === "priority") {
        if (value) fact.priority_name = value;
        else fact.priority_id = null;
        continue;
      }
      if (!field.startsWith("attribute:")) {
        fact[field] = value === "" && ["expected_on", "discovered_on"].includes(field) ? null : value;
        continue;
      }
      const attribute = attributes.value.find(item => "attribute:" + item.key === field)!;
      const key = "attribute_" + Array.from(new TextEncoder().encode(attribute.key), byte => byte.toString(16).padStart(2, "0")).join("");
      if (!value.trim()) {
        fact[key] = null;
        continue;
      }
      try {
        const validated = attributeInput(attribute, value);
        fact[key] = attribute.type === "select" ? [String(validated)] : validated;
      } catch {
        fact[key] = value;
      }
    }
    rowIds?.push(row.id);
    return [fact];
  });
}
function payload(ids?: Record<TableKey, string[]>): DemandWorksheetTables {
  return {
    documents: collect("documents", ids?.documents), work_locations: collect("work_locations", ids?.work_locations),
    materials: collect("materials", ids?.materials), sources: collect("sources", ids?.sources),
  };
}
function signature() { return JSON.stringify(payload()); }
watchEffect(() => {
  if (pending.value && pending.value.signature !== signature()) pending.value = undefined;
});
async function focusIssue(issue: WorkbookIssue) {
  const key = tableOrder.find(table => titles[table] === issue.sheet);
  if (!key) return;
  const id = previewRowIds[key][issue.row - 2];
  if (!id) return;
  tab.value = key;
  await nextTick();
  const field = ["priority_id", "priority_name"].includes(issue.field) ? "priority" : columns.value[key].find(column => column.title === issue.field)?.key ?? issue.field;
  if (!sheets[key]?.focusField(id, field)) ElMessage.info("该行已移除，请重新预检");
}
async function syncSheets() {
  for (const key of visibleTables.value) await sheets[key]?.finishEditing();
}
async function preflight() {
  if (busy.value) return;
  busy.value = true;
  preview.value = undefined;
  pending.value = undefined;
  error.value = "";
  try {
    await syncSheets();
    const ids = { documents: [], work_locations: [], materials: [], sources: [] };
    const input = payload(ids);
    if (!input.documents.length) throw Error("没有需要预检的需求资料");
    const checked = await previewDemandWorksheet(props.mode, input);
    if (!active) return;
    preview.value = checked;
    previewRowIds = ids;
    if (!checked.issues.length && !checked.previous) {
      pending.value = { token: checked.token, key: randomRequestId(), signature: JSON.stringify(input) };
    }
    if (checked.previous) ElMessage.info("相同资料已提交，请在需求列表核对");
  } catch (failure) {
    error.value = (failure as Error).message;
  } finally {
    busy.value = false;
  }
}
async function submit() {
  const candidate = pending.value;
  if (!candidate || busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    await syncSheets();
    if (candidate.signature !== signature()) throw Error("录入内容已修改，请重新预检");
    await ElMessageBox.confirm("提交已预检需求。服务端重新核对版本和业务规则，整批写入。", "提交专业需求",
      { type: "warning", confirmButtonText: "确认提交", cancelButtonText: "继续编辑" });
    const result = await commitWorkbook(candidate.token, candidate.key, true);
    ElMessage.success("已处理 " + result.results.length + " 条需求");
    emit("saved");
  } catch (failure) {
    if (failure !== "cancel" && failure !== "close") error.value = (failure as Error).message;
  } finally {
    busy.value = false;
  }
}
async function mayLeave() {
  if (busy.value || adding.value) return false;
  await syncSheets();
  if (!payload().documents.length) return true;
  try {
    await ElMessageBox.confirm("批量工作表有未保存的资料，确定离开？", "离开批量录入",
      { type: "warning", confirmButtonText: "放弃修改", cancelButtonText: "继续编辑" });
    return true;
  } catch { return false; }
}
async function cancel() { if (await mayLeave()) emit("cancel"); }
onBeforeRouteLeave(mayLeave);
onBeforeRouteUpdate((to, from) => listRouteIdentity(to.fullPath) === listRouteIdentity(from.fullPath) ? true : mayLeave());
function beforeUnload(event: BeforeUnloadEvent) {
  if (busy.value || payload().documents.length || Object.values(sheets).some(sheet => sheet.changed())) {
    event.preventDefault();
    event.returnValue = "";
  }
}
window.addEventListener("beforeunload", beforeUnload);
onBeforeUnmount(() => { active = false; operationSearch++; window.removeEventListener("beforeunload", beforeUnload); });
</script>

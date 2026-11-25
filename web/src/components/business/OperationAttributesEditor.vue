<template>
  <el-table v-if="readonly" :data="fields" row-key="key" border>
    <el-table-column label="名称" prop="label" min-width="150" />
    <el-table-column label="层级" width="95">
      <template #default="{ row }">{{ scopeNames[row.scope as OperationAttribute["scope"]] }}</template>
    </el-table-column>
    <el-table-column label="类型" width="95">
      <template #default="{ row }">{{ typeNames[row.type as OperationAttribute["type"]] }}</template>
    </el-table-column>
    <el-table-column label="参与计价" width="100">
      <template #default="{ row }">{{ row.pricing ? "是" : "否" }}</template>
    </el-table-column>
    <el-table-column label="状态" width="90">
      <template #default="{ row }">{{ row.enabled ? "启用" : "停用" }}</template>
    </el-table-column>
  </el-table>
  <div v-else>
    <BusinessWorksheet ref="attributeSheet" data-guide-action="standards.attribute-edit" name="附加属性"
      :rows="attributeRows" :columns="attributeColumns" session-key="attribute-definitions" :validate="validateAttributes"
      :disabled="disabled" removable remove-label="移除未保存属性"
      @change="attributeValues = $event" @rows-change="attributeRows = $event" @readiness-change="attributesReady = $event">
      <template #toolbar>
        <el-input-number v-model="attributeCount" aria-label="新增属性行数" :min="1" :max="Math.max(1,100-attributeRows.length)"
          :disabled="disabled || !attributesReady || attributeRows.length >= 100" :precision="0" />
        <el-button data-guide-action="standards.attribute" :disabled="disabled || !attributesReady || attributeRows.length >= 100"
          @click="addAttributes">添加附加属性</el-button>
        <el-button data-guide-action="standards.attribute-save" :disabled="disabled || !attributesReady"
          @click="checkDefinitions">校验属性和选项</el-button>
      </template>
    </BusinessWorksheet>
    <h3 class="my-3 font-semibold">枚举选项</h3>
    <BusinessWorksheet ref="optionSheet" name="枚举选项" :rows="optionRows" :columns="optionColumns"
      session-key="attribute-options" :validate="validateOptions" :disabled="disabled"
      :visible-row="optionVisible" removable remove-guide="standards.option-remove" remove-label="移除选中选项"
      @change="optionValues = $event" @rows-change="optionRows = $event" @readiness-change="optionsReady = $event">
      <template #toolbar>
        <el-input-number v-model="optionCount" aria-label="新增选项行数" :min="1" :max="100" :precision="0"
          :disabled="disabled || !optionsReady" />
        <el-button data-guide-action="standards.option-add" :disabled="disabled || !optionsReady"
          @click="addOptions">为所选属性添加选项</el-button>
      </template>
    </BusinessWorksheet>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, shallowRef } from "vue";
import { ElMessage } from "element-plus";
import { validateAttributeSchema } from "../../../../server/shared/operation-attributes";
import type { AssetAttribute, AttributeValue, OperationAttribute } from "../../../../server/shared/types/operation-attributes";
import type { QuantityPrecision } from "../../../../server/shared/quantity-precision";
import type { DictionaryRow } from "@/api/business/dictionaries";
import { randomRequestId } from "@/utils/business/request-id";
import BusinessWorksheet from "@/components/BusinessWorksheet/BusinessWorksheet.vue";
import type { WorksheetColumn, WorksheetIssue, WorksheetRow, WorksheetValues } from "@/components/BusinessWorksheet/univer-engine";

const props = defineProps<{ units: DictionaryRow[]; readonly: boolean; disabled?: boolean }>();
const fields = defineModel<OperationAttribute[]>({ required: true });
const typeNames = {
  text: "文字", textarea: "长文字", integer: "整数", decimal: "小数",
  select: "单选", multiselect: "多选", boolean: "是否", date: "日期",
} satisfies Record<OperationAttribute["type"], string>;
const scopeNames = { demand: "需求级", location: "位置级" };
const sourceNames = { manual: "手工录入", asset: "引用设备台账" };
const requirementNames = { optional: "可选", save: "保存必填", pricing: "计价必需" };
const assetNames = { voltage_level_id: "电压等级", tower_material: "杆塔材质", tower_nature: "杆塔性质" };
const yesNoNames = { yes: "是", no: "否" };
const enabledNames = { enabled: "启用", disabled: "停用" };
const original = new Map(fields.value.map(field => [field.key, field]));
const approach = (field: OperationAttribute) => field.type === "integer" || field.type === "decimal";
const optionGroups = new Map<string, string>();
const optionIds = new Map<string, string>();
const ordinals = new Map<string, string>();
const historicalUnit = "采用历史单位";
const attributeCount = ref<number | undefined>(1), optionCount = ref<number | undefined>(1);
const attributeSheet = ref<InstanceType<typeof BusinessWorksheet>>(), optionSheet = ref<InstanceType<typeof BusinessWorksheet>>();
const attributesReady = ref(false), optionsReady = ref(false);
const unitNames = computed(() => {
  const labels = props.units.filter(unit => unit.status === "active").map(unit => unit.name);
  return labels.filter(name => labels.indexOf(name) === labels.lastIndexOf(name));
});
const optionColumns: WorksheetColumn[] = [
  { key: "attribute", title: "属性序号", width: 105, numeric: true },
  { key: "label", title: "选项名称", width: 275, editable: true, required: true },
  { key: "default", title: "默认选项", width: 135, editable: true, options: Object.values(yesNoNames), required: true },
];
const choose = (key: string, title: string, choices: Record<string, string>, width = 115): WorksheetColumn =>
  ({ key, title, width, editable: true, options: Object.values(choices) });
const attributeColumns = computed<WorksheetColumn[]>(() => [
  { key: "number", title: "属性序号", width: 100, numeric: true },
  { key: "label", title: "属性名称", width: 165, editable: true, required: true },
  choose("scope", "层级", scopeNames),
  choose("source", "数据来源", sourceNames, 146),
  choose("type", "字段类型", typeNames),
  choose("asset", "台账字段", assetNames, 125),
  choose("requirement", "必填规则", requirementNames),
  choose("pricing", "参与计价", yesNoNames),
  choose("enabled", "状态", enabledNames, 100),
  { key: "sort", title: "排序", width: 90, editable: true, numeric: true },
  { key: "unit", title: "数值单位", width: 135, editable: true, options: [...unitNames.value, historicalUnit] },
  { key: "precision", title: "允许小数位", width: 110, editable: true, numeric: true },
  { key: "min", title: "最小值", width: 100, editable: true, numeric: true },
  { key: "max", title: "最大值", width: 100, editable: true, numeric: true },
  { key: "default", title: "默认值", width: 185, editable: true },
  { key: "hint", title: "填写提示", width: 210, editable: true },
]);
function attributeRow(field: OperationAttribute, permanent = false): WorksheetRow {
  const number = String(ordinals.size + 1);
  ordinals.set(field.key, number);
  const defaults = field.type === "select" || field.type === "multiselect" ? "" : typeof field.default_value === "boolean"
    ? field.default_value ? yesNoNames.yes : yesNoNames.no : String(field.default_value ?? "");
  const unit = (field.type === "integer" || field.type === "decimal") && field.unit_id
    ? props.units.find(row => row.id === field.unit_id)?.name || historicalUnit : "";
  return { id: field.key, label: field.label || "属性 " + number, unremovable: permanent, values: {
    number, label: field.label, scope: scopeNames[field.scope], source: sourceNames[field.source], type: typeNames[field.type],
    asset: field.asset_field ? assetNames[field.asset_field] : "", requirement: requirementNames[field.requirement],
    pricing: field.pricing ? yesNoNames.yes : yesNoNames.no, enabled: field.enabled ? enabledNames.enabled : enabledNames.disabled,
    sort: String(field.sort_order), unit, precision: "precision" in field ? String(field.precision) : "",
    min: "min" in field ? field.min ?? "" : "", max: "max" in field ? field.max ?? "" : "",
    default: defaults, hint: field.hint,
  } };
}
function optionRow(attribute: string, option: { value: string; label: string }, marked = false): WorksheetRow {
  const id = JSON.stringify([attribute, option.value]);
  optionGroups.set(id, attribute);
  optionIds.set(id, option.value);
  return { id, label: option.label || "属性 " + ordinals.get(attribute), values: {
    attribute: ordinals.get(attribute) || "", label: option.label, default: marked ? yesNoNames.yes : yesNoNames.no,
  } };
}
const attributeRows = shallowRef<readonly WorksheetRow[]>(fields.value.map(field => attributeRow(field, true)));
const optionRows = shallowRef<readonly WorksheetRow[]>(fields.value.flatMap(field => {
  if (field.source !== "manual" || (field.type !== "select" && field.type !== "multiselect")) return [];
  const defaults = new Set(Array.isArray(field.default_value) ? field.default_value : [field.default_value]);
  return field.options.map(option => optionRow(field.key, option, defaults.has(option.value)));
}));
const attributeValues = shallowRef<WorksheetValues>(Object.fromEntries(attributeRows.value.map(row => [row.id, row.values])));
const optionValues = shallowRef<WorksheetValues>(Object.fromEntries(optionRows.value.map(row => [row.id, row.values])));
const optionVisible = computed(() => {
  const available = new Set(attributeRows.value.map(row => row.id));
  return (row: WorksheetRow) => available.has(optionGroups.get(row.id) || "");
});
const enumType = (value: string | undefined) => value === typeNames.select || value === typeNames.multiselect;
function reverse<K extends string>(labels: Record<K, string>, value: string): K {
  const option = (Object.keys(labels) as K[]).find(key => labels[key] === value);
  if (!option) throw Error("请选择有效业务选项");
  return option;
}
function booleanValue(raw: string) { return reverse(yesNoNames, raw) === "yes"; }
async function addAttributes() {
  const length = attributeCount.value;
  if (!length || !Number.isInteger(length) || length > 100 - attributeRows.value.length) return;
  const rows = Array.from({ length }, (_, index) => attributeRow({
    key: randomRequestId(), label: "", type: "text", scope: "location", source: "manual", requirement: "optional",
    pricing: false, enabled: true, sort_order: attributeRows.value.length + index + 1, hint: "",
  }));
  await attributeSheet.value?.addRows(rows);
}
async function addOptions() {
  const ids = attributeSheet.value?.selectedRowIds() ?? [];
  if (ids.length !== 1) { ElMessage.warning("请在附加属性工作表选择一条属性"); return; }
  await attributeSheet.value?.finishEditing();
  const input = attributeValues.value[ids[0]];
  if (!input || !enumType(input.type) || input.source !== sourceNames.manual) {
    ElMessage.warning("仅手工单选或多选属性可添加选项"); return;
  }
  const length = optionCount.value;
  if (!length || !Number.isInteger(length) || !Number.isSafeInteger(length) ||
      length + optionRows.value.filter(row => optionGroups.get(row.id) === ids[0]).length > 100) {
    ElMessage.warning("每条属性最多 100 个选项"); return;
  }
  await optionSheet.value?.addRows(Array.from({ length }, () => optionRow(ids[0], { value: randomRequestId(), label: "" })));
}
function issue(row: WorksheetRow, index: number, field: string, columns: readonly WorksheetColumn[], message: string): WorksheetIssue {
  return { row: index + 1, column: Math.max(0, columns.findIndex(column => column.key === field)), cell: "",
    rowId: row.id, field, location: row.label, message };
}
function buildOptions(id: string, values: WorksheetValues) {
  return optionRows.value.flatMap(row => optionGroups.get(row.id) === id ? [{
    value: optionIds.get(row.id)!, label: (values[row.id]?.label ?? "").trim(), default: values[row.id]?.default === yesNoNames.yes,
  }] : []);
}
function buildAttribute(row: WorksheetRow, input: WorksheetValues[string], options: WorksheetValues): OperationAttribute {
  const prior = original.get(row.id);
  let currentField = "label";
  try {
    const select = <K extends string>(field: string, names: Record<K, string>) => {
      currentField = field;
      return reverse(names, input[field]);
    };
    const type = select("type", typeNames);
    const source = select("source", sourceNames);
    const base = {
      key: row.id, label: input.label.trim(), scope: select("scope", scopeNames), source,
      requirement: select("requirement", requirementNames), pricing: select("pricing", yesNoNames) === "yes",
      enabled: select("enabled", enabledNames) === "enabled", sort_order: Number(input.sort), hint: input.hint || "",
    };
    currentField = "sort";
    if (!/^[0-9]+$/.test(input.sort) || !Number.isSafeInteger(base.sort_order)) throw Error("排序须为非负整数");
    currentField = "label";
    if (!base.label) throw Error("请填写属性名称");
    let asset: AssetAttribute | undefined;
    if (source === "asset") {
      asset = select("asset", assetNames);
      currentField = "scope";
      if (base.scope !== "location" || type !== "select" || input.default) throw Error("台账属性须采用位置级单选，不能填写手工默认值");
    } else if (input.asset) {
      currentField = "asset";
      throw Error("手工属性不可填写台账字段");
    }
    let defaultValue: AttributeValue | undefined;
    const defaults = input.default || "";
    let result: OperationAttribute;
    if (type === "integer" || type === "decimal") {
      const adopted = prior && approach(prior) && "precision" in prior && input.unit === row.values.unit && prior.unit_id ? prior : undefined;
      const unit = adopted ? undefined : props.units.find(item => item.name === input.unit && unitNames.value.includes(item.name));
      currentField = "unit";
      if (input.unit && !adopted && !unit) throw Error("请填写唯一可用的计量单位名称");
      currentField = "precision";
      const precision = adopted?.precision ?? unit?.quantity_precision ?? Number(input.precision || (type === "integer" ? "0" : "2"));
      if (!Number.isInteger(precision) || precision < 0 || precision > 4 || (type === "integer" && precision !== 0))
        throw Error("精度须为 0 至 4 位且整数精度须为 0");
      if (input.precision && Number(input.precision) !== precision) throw Error("精度须与采用的单位正式版本一致");
      currentField = "default";
      if (defaults) {
        if (type === "integer" && !/^[+-]?[0-9]+$/.test(defaults)) throw Error("默认值须为整数");
        defaultValue = type === "integer" ? Number(defaults) : defaults;
      }
      result = { ...base, type, precision: precision as QuantityPrecision,
        min: input.min || undefined, max: input.max || undefined,
        unit_id: adopted?.unit_id ?? unit?.id, unit_version: adopted?.unit_version ?? unit?.version };
    } else if (type === "select" || type === "multiselect") {
      currentField = "type";
      if (defaults) throw Error("枚举默认值请在选项工作表标记");
      const choices = source === "asset" ? [] : buildOptions(row.id, options);
      const selected = choices.filter(option => option.default).map(option => option.value);
      if (type === "select" && selected.length > 1) throw Error("单选属性最多设置一个默认选项");
      defaultValue = type === "select" ? selected[0] : selected.length ? selected : undefined;
      if (type === "multiselect" && prior?.type === "multiselect" && Array.isArray(prior.default_value) &&
          prior.default_value.length === selected.length && prior.default_value.every(value => selected.includes(value)))
        defaultValue = prior.default_value;
      result = { ...base, type, asset_field: asset, options: choices.map(({ value, label }) => ({ value, label })) };
    } else {
      currentField = "default";
      if (defaults) defaultValue = type === "boolean" ? booleanValue(defaults) : defaults;
      result = { ...base, type };
    }
    if (defaultValue !== undefined) result.default_value = defaultValue;
    currentField = "default";
    validateAttributeSchema([result]);
    return result;
  } catch (cause) {
    throw Object.assign(Error((cause as Error).message), { field: currentField });
  }
}
function validateAttributes(values: WorksheetValues): WorksheetIssue[] {
  const seen = new Set<string>();
  return attributeRows.value.flatMap((row, index) => {
    if (!values[row.id]) return [];
    try {
      const field = buildAttribute(row, values[row.id], optionValues.value);
      const key = JSON.stringify([field.scope, field.label]);
      if (seen.has(key)) return [issue(row, index, "label", attributeColumns.value, "同层级属性名称不能重复")];
      seen.add(key);
      return [];
    } catch (cause) {
      const failure = cause as Error & { field?: string };
      return [issue(row, index, failure.field ?? "label", attributeColumns.value, failure.message)];
    }
  });
}
function validateOptions(values: WorksheetValues): WorksheetIssue[] {
  const counts = new Map<string, number>();
  for (const row of optionRows.value) {
    const name = JSON.stringify([optionGroups.get(row.id), values[row.id]?.label?.trim()]);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return optionRows.value.flatMap((row, index) => {
    if (!optionVisible.value(row)) return [];
    const owner = optionGroups.get(row.id)!;
    const field = attributeValues.value[owner];
    if (!field || field.source !== sourceNames.manual || !enumType(field.type)) return [];
    const originalField = original.get(owner);
    const oldChoices = originalField && "options" in originalField ? originalField.options : [];
    const label = values[row.id]?.label?.trim() || "";
    const count = counts.get(JSON.stringify([owner, label])) ?? 0;
    const oldLabel = oldChoices.find(option => option.value === optionIds.get(row.id))?.label;
    const inherited = oldLabel === label && (count === 1 || oldChoices.filter(option => option.label === label).length === count);
    if (!label) return [issue(row, index, "label", optionColumns, "请填写选项名称")];
    if (!inherited && (count > 1 || label.includes(",") || (field.type === typeNames.multiselect && label.includes("/"))))
      return [issue(row, index, "label", optionColumns, "选项名称须唯一，不可使用工作表保留分隔符")];
    if (!Object.values(yesNoNames).includes(values[row.id]?.default))
      return [issue(row, index, "default", optionColumns, "默认选项须为是或否")];
    return [];
  });
}
async function prepare() {
  await attributeSheet.value?.finishEditing();
  const options = await optionSheet.value?.prepareSave();
  if (!options) return null;
  optionValues.value = options;
  const values = await attributeSheet.value?.prepareSave();
  if (!values) return null;
  return attributeRows.value.map(row => buildAttribute(row, values[row.id], options));
}
async function checkDefinitions() {
  if (await prepare()) ElMessage.success("属性及选项校验通过");
}
async function finishEditing() {
  await attributeSheet.value?.finishEditing();
  await optionSheet.value?.finishEditing();
}
defineExpose({ prepare, finishEditing, changed: () => Boolean(attributeSheet.value?.changed() || optionSheet.value?.changed()) });
</script>

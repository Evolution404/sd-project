<template>
  <BusinessWorksheet ref="sheet" data-guide-action="pricing.retire" name="参考价格主规则"
    :rows="rows" :columns="columns" :validate="validate" session-key="price-rule"
    :disabled="disabled" @change="apply" />
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import type { PriceForm } from "@/api/business/pricing";
import type { OptionItem } from "@/api/common";
import BusinessWorksheet from "@/components/BusinessWorksheet/BusinessWorksheet.vue";
import type { WorksheetColumn, WorksheetIssue, WorksheetRow, WorksheetValues } from "@/components/BusinessWorksheet/univer-engine";

const props = defineProps<{ voltages: OptionItem[]; materials: OptionItem[]; disabled?: boolean }>();
const form = defineModel<PriceForm>({ required: true });
const initial = form.value;
const sheet = ref<InstanceType<typeof BusinessWorksheet>>();
const statuses = { active: "启用", inactive: "停用" } as const;
const modes = { both: "不限", outage: "停电", non_outage: "不停电" } as const;
function labels(options: OptionItem[]) {
  return options.map(option => option.label).filter((label, _index, values) => values.indexOf(label) === values.lastIndexOf(label));
}
function label(options: OptionItem[], value: string | null) {
  return value ? options.find(option => String(option.value) === value)?.label || "已采用正式值" : "";
}
const initialValues = {
  title: initial.title, status: statuses[initial.status], price_source: initial.price_source, price_date: initial.price_date,
  effective_on: initial.effective_on, basis: initial.basis, reason: initial.reason,
  work_mode: modes[initial.work_mode], voltage_level_id: label(props.voltages, initial.voltage_level_id),
  tower_material: label(props.materials, initial.tower_material), specification: initial.specification,
};
const rows: WorksheetRow[] = [{ id: "rule", label: "参考价格主规则", values: initialValues }];
const columns = computed<WorksheetColumn[]>(() => [
  { key: "title", title: "规则名称", width: 250, editable: true, required: true },
  { key: "status", title: "状态", width: 110, editable: true, options: Object.values(statuses), required: true },
  { key: "price_source", title: "价格来源", width: 185, editable: true, required: true },
  { key: "price_date", title: "价格日期", width: 135, editable: true, required: true },
  { key: "effective_on", title: "生效日期", width: 135, editable: true, required: true },
  { key: "basis", title: "计价依据", width: 250, editable: true, required: true },
  { key: "reason", title: "修订理由", width: 190, editable: true },
  { key: "work_mode", title: "作业方式", width: 110, editable: true, options: Object.values(modes), required: true },
  { key: "voltage_level_id", title: "适用电压等级", width: 140, editable: true, options: labels(props.voltages) },
  { key: "tower_material", title: "适用杆塔材质", width: 150, editable: true, options: labels(props.materials) },
  { key: "specification", title: "适用规格", width: 155, editable: true },
]);
function idFor(options: OptionItem[], value: string | undefined, priorLabel: string, prior: string | null) {
  if (!value) return null;
  if (prior && value === priorLabel) return prior;
  const matches = options.filter(option => option.label === value);
  return matches.length === 1 ? String(matches[0].value) : undefined;
}
function validDate(raw: string) {
  const date = new Date(raw);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) && Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === raw;
}
function validate(values: WorksheetValues): WorksheetIssue[] {
  const input = values.rule;
  if (!input) return [];
  return columns.value.flatMap((column, index) => {
    const raw = input[column.key]?.trim();
    let message = "";
    if (column.required && !raw) message = "请填写" + column.title;
    else if ((column.key === "price_date" || column.key === "effective_on") && !validDate(raw)) message = "请填写有效日期 YYYY-MM-DD";
    else if (column.key === "voltage_level_id" && idFor(props.voltages, raw, initialValues.voltage_level_id, initial.voltage_level_id) === undefined)
      message = "请选择唯一有效的电压等级";
    else if (column.key === "tower_material" && idFor(props.materials, raw, initialValues.tower_material, initial.tower_material) === undefined)
      message = "请选择唯一有效的杆塔材质";
    else if ((column.key === "status" || column.key === "work_mode") && !column.options?.includes(raw)) message = "请选择有效业务选项";
    return message ? [{ row: 1, column: index, cell: "", rowId: "rule", field: column.key, location: "参考价格主规则", message }] : [];
  });
}
function apply(values: WorksheetValues) {
  const row = values.rule;
  if (!row || validate(values).length) return;
  const status = row.status === statuses.active ? "active" : "inactive";
  const workMode = row.work_mode === modes.outage ? "outage" : row.work_mode === modes.non_outage ? "non_outage" : "both";
  const next = {
    title: row.title, status, price_source: row.price_source, price_date: row.price_date, effective_on: row.effective_on,
    basis: row.basis, reason: row.reason, work_mode: workMode, specification: row.specification,
    voltage_level_id: idFor(props.voltages, row.voltage_level_id, initialValues.voltage_level_id, initial.voltage_level_id) ?? null,
    tower_material: idFor(props.materials, row.tower_material, initialValues.tower_material, initial.tower_material) ?? null,
  } satisfies Partial<PriceForm>;
  if (Object.entries(next).some(([field, value]) => form.value[field as keyof PriceForm] !== value))
    form.value = { ...form.value, ...next };
}
async function prepare() {
  const values = await sheet.value?.prepareSave();
  if (!values) return false;
  apply(values);
  return true;
}
defineExpose({ prepare, changed: () => sheet.value?.changed(), finishEditing: () => sheet.value?.finishEditing() });
</script>

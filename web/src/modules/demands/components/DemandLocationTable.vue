<script setup lang="ts">
import { computed, ref } from "vue";
import type {
  OperationAttribute,
  AttributeValues,
} from "../../../../../server/shared/types/operation-attributes";
import type { LocationDraft } from "../types/demand";
import BusinessTable from "../../../shared/ui/BusinessTable.vue";
import AttributeFields from "../../../shared/ui/AttributeFields.vue";
import FieldControl from "../../../shared/ui/FieldControl.vue";
const props = defineProps<{
  rows: LocationDraft[];
  definitions: OperationAttribute[];
  precision?: number;
  unit: string;
  errors: Record<string, unknown>;
}>();
const emit = defineEmits<{
  remove: [ids: string[]];
  invalid: [id: string, value: boolean];
}>();
const selected = ref<LocationDraft[]>([]),
  editing = ref<LocationDraft | null>(null),
  batch = ref(false),
  quantityEnabled = ref(false),
  batchQuantityInvalid = ref(false),
  modeEnabled = ref(false);
const batchQuantity = ref(10000),
  batchMode = ref<"outage" | "non_outage" | "unspecified">("unspecified"),
  batchAttributes = ref<AttributeValues>({}),
  attributeKeys = ref<string[]>([]);
const columns = [
  { key: "line_name", label: "线路", minWidth: 130 },
  { key: "label", label: "作业位置", minWidth: 170 },
  { key: "quantity_scaled", label: "需求数量", minWidth: 170 },
  { key: "work_mode", label: "作业方式", minWidth: 105 },
  { key: "attributes", label: "附加属性", minWidth: 190 },
  { key: "complete", label: "信息状态", minWidth: 110 },
];
const fields = computed(() =>
  props.definitions.filter(
    (field) =>
      field.scope === "location" && field.source === "manual" && field.enabled,
  ),
);
function summary(row: LocationDraft) {
  return (
    fields.value
      .filter((field) => row.attributes[field.key] !== undefined)
      .map((field) => {
        const value = row.attributes[field.key];
        let display = String(value);
        if (field.type === "select")
          display = field.options.find((option) => option.value === value)?.label || display;
        if (field.type === "multiselect" && Array.isArray(value))
          display = value.map((item) => field.options.find((option) => option.value === item)?.label || item).join("、");
        if (field.type === "boolean") display = value ? "是" : "否";
        return field.label + " " + display;
      })
      .join("、") || "—"
  );
}
function missing(row: LocationDraft) {
  return props.definitions
    .filter(
      (field) =>
        field.scope === "location" &&
        field.enabled &&
        field.source === "manual" &&
        field.requirement === "save" &&
        (row.attributes[field.key] === undefined ||
          row.attributes[field.key] === ""),
    )
    .map((field) => field.label);
}
function updateQuantity(row: LocationDraft, value: unknown) {
  row.quantity_scaled = typeof value === "number" ? value : 0;
}
function rowError(row: LocationDraft, field = "quantity_scaled") {
  return String(props.errors["work_locations." + row.id + "." + field] || "");
}
function applyBatch() {
  const ids = new Set(selected.value.map((row) => row.id));
  for (const row of props.rows.filter((row) => ids.has(row.id))) {
    if (quantityEnabled.value) row.quantity_scaled = batchQuantity.value;
    if (modeEnabled.value) row.work_mode = batchMode.value;
    for (const key of attributeKeys.value) {
      const value = batchAttributes.value[key];
      if (value === undefined) delete row.attributes[key];
      else row.attributes[key] = value;
    }
  }
  batch.value = false;
}
</script>
<template>
  <div class="toolbar">
    <ElButton data-guide-action="demands.batch"
      :disabled="!selected.length"
      @click="
        batch = true;
        quantityEnabled = false;
        batchQuantityInvalid = false;
        modeEnabled = false;
        attributeKeys = [];
        batchAttributes = {};
      "
      >批量填写共同信息</ElButton
    ><ElButton data-guide-action="demands.location-remove-bulk"
      type="danger"
      plain
      :disabled="!selected.length"
      @click="
        emit(
          'remove',
          selected.map((row) => row.id),
        );
        selected = [];
      "
      >移除选中位置</ElButton
    ><span class="muted">{{ rows.length }}处，已选{{ selected.length }}处</span>
  </div>
  <BusinessTable
    :rows="rows"
    :columns="columns"
    table-key="demand:location-workbench"
    selectable
    client-side
    :max-height="410"
    :actions-width="145"
    @selection-change="selected = $event"
  >
    <template #cell="{ row, column }">
      <ElFormItem
        v-if="column.key === 'quantity_scaled'"
        :error="rowError(row)"
        :label="
          precision === 0
            ? '需求数量（整数）'
            : '需求数量（最多' + precision + '位小数）'
        "
        class="quantity-cell"
        ><FieldControl
          :model-value="row.quantity_scaled"
          :field="{ type: 'quantity', quantityPrecision: precision }"
          @update:model-value="updateQuantity(row, $event)"
          @validity-change="emit('invalid', row.id, $event)"
        /><span>{{ unit }}</span></ElFormItem
      >
      <span v-else-if="column.key === 'attributes'">{{ summary(row) }}</span>
      <span v-else-if="column.key === 'complete'">{{
        missing(row).length ? "缺少" + missing(row).join("、") : "已填写"
      }}</span>
      <span v-else-if="column.key === 'work_mode'">{{
        { outage: "停电", non_outage: "不停电", unspecified: "未明确" }[
          row.work_mode || "unspecified"
        ]
      }}</span>
      <span v-else-if="column.key === 'line_name'">{{
        row.line_name || "独立实物"
      }}</span
      ><span v-else>{{ row.label }}</span>
    </template>
    <template #actions="{ row }"
      ><ElButton data-guide-action="demands.location-edit" size="small" @click="editing = row">编辑</ElButton
      ><ElButton data-guide-action="demands.location-remove"
        size="small"
        type="danger"
        link
        @click="emit('remove', [row.id])"
        >移除</ElButton
      ></template
    >
  </BusinessTable>
  <ElDialog
    :model-value="!!editing"
    append-to-body
    title="编辑作业位置"
    width="min(760px,94vw)"
    @close="editing = null"
  >
    <ElForm v-if="editing" label-position="top" novalidate
      ><p>{{ editing.line_name }} {{ editing.label }}</p>
      <ElFormItem label="需求数量"
        ><FieldControl
          :model-value="editing.quantity_scaled"
          :field="{ type: 'quantity', quantityPrecision: precision }"
          @update:model-value="updateQuantity(editing!, $event)"
          @validity-change="emit('invalid', editing!.id, $event)"
      /></ElFormItem>
      <ElFormItem label="作业方式"
        ><ElSelect v-model="editing.work_mode"
          ><ElOption label="未明确" value="unspecified" /><ElOption
            label="停电"
            value="outage" /><ElOption
            label="不停电"
            value="non_outage" /></ElSelect
      ></ElFormItem>
      <AttributeFields
        v-model="editing.attributes"
        :definitions="definitions"
        scope="location"
        :errors="errors"
        :path="'work_locations.' + editing.id + '.attributes'"
      />
      <ElFormItem label="作业规格（按需填写）"
        ><ElInput v-model="editing.specification"
      /></ElFormItem> </ElForm
    ><template #footer
      ><ElButton type="primary" @click="editing = null"
        >完成</ElButton
      ></template
    >
  </ElDialog>
  <ElDialog
    v-model="batch"
    append-to-body
    title="批量填写共同信息"
    width="min(780px,94vw)"
  >
    <p>应用到选中的{{ selected.length }}处位置。勾选需要更新的字段。</p>
    <ElForm label-position="top" novalidate>
      <ElCheckbox v-model="quantityEnabled">需求数量</ElCheckbox
      ><ElFormItem v-if="quantityEnabled"
        ><FieldControl
          :model-value="batchQuantity"
          :field="{ type: 'quantity', quantityPrecision: precision }"
          @update:model-value="
            batchQuantity = typeof $event === 'number' ? $event : 0
          "
          @validity-change="batchQuantityInvalid = $event"
      /></ElFormItem>
      <ElCheckbox v-model="modeEnabled">作业方式</ElCheckbox
      ><ElSelect v-if="modeEnabled" v-model="batchMode"
        ><ElOption label="未明确" value="unspecified" /><ElOption
          label="停电"
          value="outage" /><ElOption label="不停电" value="non_outage"
      /></ElSelect>
      <ElCheckboxGroup v-model="attributeKeys"
        ><ElCheckbox
          v-for="field in fields"
          :key="field.key"
          :value="field.key"
          >{{ field.label }}</ElCheckbox
        ></ElCheckboxGroup
      >
      <AttributeFields
        v-model="batchAttributes"
        :definitions="
          fields.filter((field) => attributeKeys.includes(field.key))
        "
        scope="location"
      /> </ElForm
    ><template #footer
      ><ElButton @click="batch = false">取消</ElButton
      ><ElButton data-guide-action="demands.batch-apply" type="primary" :disabled="quantityEnabled && (batchQuantityInvalid || precision === undefined)" @click="applyBatch"
        >应用到选中位置</ElButton
      ></template
    >
  </ElDialog>
</template>
<style scoped>
.quantity-cell {
  margin: 0;
}
.quantity-cell :deep(.el-form-item__label) {
  position: absolute;
  clip-path: inset(50%);
  width: 1px;
  height: 1px;
  overflow: hidden;
}
.quantity-cell :deep(.el-form-item__content) {
  gap: 5px;
}
.toolbar {
  flex-wrap: wrap;
}
</style>

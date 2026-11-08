<script setup lang="ts">
import { computed, ref, onMounted, watch } from "vue";
import { ElMessage } from "element-plus";
import { api, statusText, type Row } from "../services/api";
const props = defineProps<{
  field: Row;
  modelValue: any;
  disabled?: boolean;
}>();
const emit = defineEmits(["update:modelValue"]);
const options = ref<Row[]>([]);
const value = computed({
  get: () => props.modelValue,
  set: (v) => emit("update:modelValue", v === undefined ? null : v),
});
const numeric = computed({
  get: () =>
    props.modelValue == null
      ? undefined
      : props.modelValue /
        (props.field.type === "money"
          ? 100
          : props.field.type === "quantity"
            ? 10000
            : 1),
  set: (v) =>
    emit(
      "update:modelValue",
      v == null
        ? null
        : props.field.type === "decimal"
          ? v
          : Math.round(
              v *
                (props.field.type === "money"
                  ? 100
                  : props.field.type === "quantity"
                    ? 10000
                    : 1),
            ),
    ),
});
let requestSequence = 0;
async function search(q = "") {
  if (props.field.type !== "ref") return;
  const sequence = ++requestSequence,
    reference = props.field.reference,
    selectedId = props.modelValue;
  try {
    const response = await api(
      "/catalog/" + reference + "?page_size=200&q=" + encodeURIComponent(q),
    );
    let selected = null;
    if (
      selectedId &&
      !response.items.some((item: Row) => item.id === selectedId)
    ) {
      try {
        selected = await api(
          "/catalog/" + reference + "/" + selectedId + "?deleted=true",
        );
      } catch {
        selected = { id: selectedId, label: "原关联需重新选择" };
      }
    }
    if (sequence === requestSequence)
      options.value = selected ? [selected, ...response.items] : response.items;
  } catch (error) {
    if (sequence === requestSequence) ElMessage.error((error as Error).message);
  }
}
onMounted(() => search());
watch(
  () => [props.field.reference, props.modelValue],
  () => search(),
);
</script>
<template>
  <ElSelect
    v-if="field.type === 'ref'"
    v-model="value"
    :disabled="disabled"
    clearable
    filterable
    remote
    :remote-method="search"
    placeholder="搜索并选择"
  >
    <ElOption
      v-for="item in options"
      :key="item.id"
      :value="item.id"
      :label="
        item.label ||
        item.name ||
        item.title ||
        item.tower_no ||
        item.tower_code ||
        '业务记录'
      "
    />
  </ElSelect>
  <ElSelect
    v-else-if="field.type === 'select'"
    v-model="value"
    :disabled="disabled"
    clearable
    ><ElOption
      v-for="option in field.options"
      :key="option"
      :value="option"
      :label="statusText[option] || option"
  /></ElSelect>
  <ElSwitch
    v-else-if="field.type === 'boolean'"
    v-model="value"
    :active-value="field.booleanNative ? true : 1"
    :inactive-value="field.booleanNative ? false : 0"
    :disabled="disabled"
  />
  <ElDatePicker
    v-else-if="field.type === 'date'"
    v-model="value"
    value-format="YYYY-MM-DD"
    :disabled="disabled"
  />
  <ElInputNumber
    v-else-if="['money', 'quantity', 'integer', 'decimal'].includes(field.type)"
    v-model="numeric"
    :precision="
      field.type === 'money'
        ? 2
        : field.type === 'quantity'
          ? 4
          : field.type === 'decimal'
            ? 6
            : 0
    "
    :disabled="disabled"
    :controls="false"
  />
  <ElInput
    v-else-if="field.type === 'json'"
    v-model="value"
    type="textarea"
    :rows="5"
    :disabled="disabled"
  />
  <ElInput
    v-else
    v-model="value"
    :disabled="disabled"
    :type="field.type === 'password' ? 'password' : 'text'"
  />
</template>

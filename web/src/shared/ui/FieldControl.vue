<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch } from "vue";

import { api, statusText, type Row } from "../api/client";
const props = defineProps<{
  field: Row;
  modelValue: any;
  disabled?: boolean;
  filters?: Record<string, string>;
}>();
const emit = defineEmits(["update:modelValue"]);
const options = ref<Row[]>([]);
const searchError = ref("");
let failedQuery = "";
const optionLabel = (item: Row) =>
  item.label || item.name || item.title || item.tower_no || "业务记录";
const ambiguous = computed(() => {
  const counts = new Map<string, number>();
  for (const item of options.value)
    counts.set(optionLabel(item), (counts.get(optionLabel(item)) || 0) + 1);
  return options.value.some(
    (item) =>
      item.id === props.modelValue && counts.get(optionLabel(item))! > 1,
  );
});
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
            : props.field.type === "length_m"
              ? 1000
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
                    : props.field.type === "length_m"
                      ? 1000
                      : 1),
            ),
    ),
});
let requestSequence = 0;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let inFlight: AbortController | null = null;
function search(q = "", immediate = false) {
  if (props.field.type !== "ref") return;
  const sequence = ++requestSequence;
  if (debounceTimer) clearTimeout(debounceTimer);
  inFlight?.abort();
  inFlight = new AbortController();
  const controller = inFlight;
  const execute = async () => {
    const reference = props.field.reference;
    const selectedId = props.modelValue;
    try {
      const searchParams = new URLSearchParams({ page_size: "100", q });
      for (const [key, item] of Object.entries(props.filters || {}))
        if (item) searchParams.set(key, item);
      const response = await api(
        "/catalog/" + reference + "?" + searchParams.toString(),
        "GET", undefined, controller.signal,
      );
      let selected = null;
      if (selectedId && !response.items.some((item: Row) => item.id === selectedId)) {
        try {
          selected = await api(
            "/catalog/" + reference + "/" + selectedId + "?deleted=true",
            "GET", undefined, controller.signal,
          );
        } catch (error) {
          if (controller.signal.aborted) return;
          selected = { id: selectedId, label: "原关联需重新选择" };
        }
      }
      if (sequence === requestSequence && !controller.signal.aborted)
        options.value = selected ? [selected, ...response.items] : response.items;
    } catch (error) {
      if (sequence === requestSequence && !controller.signal.aborted) {
        failedQuery = q;
        searchError.value = (error as Error).message;
      }
    }
  };
  if (immediate) void execute();
  else debounceTimer = setTimeout(execute, 240);
}
onMounted(() => search("", true));
watch(
  () => [props.field.reference, props.modelValue, JSON.stringify(props.filters || {})],
  () => search("", true),
);
onUnmounted(() => {
  if (debounceTimer) clearTimeout(debounceTimer);
  inFlight?.abort();
});
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
    no-data-text="没有匹配记录，请更换关键词"
  >
    <ElOption
      v-for="item in options"
      :key="item.id"
      :value="item.id"
      :label="optionLabel(item)"
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
    v-else-if="['money', 'quantity', 'integer', 'decimal', 'length_m'].includes(field.type)"
    v-model="numeric"
    :precision="
      field.type === 'money'
        ? 2
        : field.type === 'quantity'
          ? 4
          : field.type === 'length_m'
            ? 3
            : field.type === 'decimal'
              ? 6
              : 0
    "
    :disabled="disabled"
    :min="field.type === 'length_m' ? 0 : undefined"
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
  <ElAlert
    v-if="field.type === 'ref' && ambiguous"
    type="warning"
    :closable="false"
    title="存在同名对象，请到台账核对名称和真实属性后再保存。"
  />
  <div v-if="field.type === 'ref' && searchError" class="reference-search-error">
    <ElAlert type="error" :closable="false" :title="'关联记录查询失败：' + searchError" />
    <ElButton size="small" link type="primary" @click="search(failedQuery, true)">重新加载</ElButton>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch, inject } from "vue";

import { choiceLabels } from "../utils/choice-labels";
import { api, statusText } from "../api/client";
import { exactScaledDecimalText, formatScaledDecimal, quantityFitsUnitPrecision } from "../utils/fixed-scale";
import type { CatalogKind, CatalogFieldType } from "../../../../server/shared/types/catalog";
import type { Page } from "../../../../server/shared/types/contracts";
interface FormField {
  key?: string;
  label?: string;
  type: CatalogFieldType | "password";
  reference?: CatalogKind;
  options?: string[];
  quantityPrecision?: number;
  booleanNative?: boolean;
  adoptedLabel?: string;
  adoptedVersionId?: string;
}
interface ReferenceOption {
  id: string;
  label?: string;
  name?: string;
  title?: string;
  tower_no?: string;
  fiscal_year?: number;
  counterparty_name?: string | null;
  effective_from?: string | null;
  effective_to?: string | null;
  contract_number?: string | null;
}
import { referenceSelectorsKey } from "./reference-selectors";
const referenceSelectors = inject(referenceSelectorsKey, {});
const props = defineProps<{
  field: FormField;
  modelValue: unknown;
  disabled?: boolean;
  selectedLabel?: string;
  filters?: Record<string, string>;
}>();
const emit = defineEmits(["update:modelValue", "validity-change"]);
const options = ref<ReferenceOption[]>([]);
const searchError = ref("");
let failedQuery = "";
const optionLabels = computed(() => {
  const kind = props.field.reference;
  return choiceLabels(options.value, item => {
    if (kind === "frameworks" || kind === "agreements")
      return item.name || item.title || item.label || "业务记录";
    return (item.id === props.modelValue && props.selectedLabel)
      || item.label || item.name || item.title || item.tower_no || "业务记录";
  }, item => {
    if (kind === "frameworks") return [item.fiscal_year];
    if (kind === "agreements") return [item.counterparty_name, item.effective_from, item.effective_to, item.contract_number];
    return [];
  });
});
const selectedOptionLabel = computed(() => optionLabels.value.get(String(props.modelValue))
  || props.selectedLabel || (searchError.value ? "原关联待核对" : "正在读取关联名称"));
const ambiguous = computed(() => {
  const selected = optionLabels.value.get(String(props.modelValue));
  return selected !== undefined && [...optionLabels.value.values()].filter(label => label === selected).length > 1;
});
const value = computed<string | number | null>({
  get: () => typeof props.modelValue === "string" || typeof props.modelValue === "number"
    ? props.modelValue : null,
  set: (v) => emit("update:modelValue", v === undefined ? null : v),
});
const switchValue = computed<boolean | number>({
  get: () => props.field.booleanNative ? Boolean(props.modelValue) : Number(props.modelValue || 0),
  set: v => emit("update:modelValue", v),
});
const validQuantityPrecision = computed(() =>
  typeof props.field.quantityPrecision === "number" &&
  Number.isInteger(props.field.quantityPrecision) &&
  props.field.quantityPrecision >= 0 && props.field.quantityPrecision <= 4);
const numericEditing = ref(false);
const numericInput = ref("");
const numericError = ref("");
// Distinguish the echoed value of this control from an external form reset.
// An invalid draft must survive an own-model echo, but never an external edit.
let lastEmittedNumeric: number | null | undefined;
let awaitingOwnEcho = false;
function emitNumeric(value: number | null) {
  lastEmittedNumeric = value;
  awaitingOwnEcho = true;
  emit("update:modelValue", value);
}
const numericPlaces = computed(() =>
  props.field.type === "money" ? 2 :
  props.field.type === "quantity" ? 4 :
  props.field.type === "length_m" ? 3 : 0);
const isFixedScaled = computed(() =>
  ["money", "quantity", "length_m", "integer"].includes(props.field.type));
watch(
  () => [props.modelValue, props.field.type, props.field.quantityPrecision] as const,
  (next, previous) => {
    const definitionChanged = previous && (
      next[1] !== previous[1] || next[2] !== previous[2]);
    // A valid keystroke may emit the prior number immediately before a later
    // invalid digit. Do not erase the later error when the old v-model echoes.
    const ownEcho = awaitingOwnEcho && Object.is(next[0], lastEmittedNumeric);
    awaitingOwnEcho = false;
    if (definitionChanged || !ownEcho &&
        (next[0] !== previous?.[0] || !numericEditing.value && !numericError.value)) {
      numericInput.value = formatScaledDecimal(
        typeof props.modelValue === "number" ? props.modelValue : null,
        numericPlaces.value);
      numericError.value = "";
      emit("validity-change", false);
    }
  },
  { immediate: true },
);
function updateNumericText(raw: string) {
  numericInput.value = raw;
  if (!raw.trim()) {
    numericError.value = "";
    emit("validity-change", false);
    emitNumeric(null);
    return;
  }
  const scaled = exactScaledDecimalText(raw, numericPlaces.value);
  if (scaled === null) {
    numericError.value = "数值小数位数超出精度或安全整数范围，不能保存";
    emit("validity-change", true);
    return;
  }
  if (props.field.type === "quantity") {
    if (!validQuantityPrecision.value) {
      numericError.value = "正式单位数量精度尚未确认，不能填写数量";
      emit("validity-change", true);
      return;
    }
    if (!quantityFitsUnitPrecision(scaled, props.field.quantityPrecision!)) {
      numericError.value = "数量超过正式计量单位允许的小数位";
      emit("validity-change", true);
      return;
    }
  }
  numericError.value = "";
  emit("validity-change", false);
  emitNumeric(scaled);
}
function numericBlur() {
  numericEditing.value = false;
  if (!numericError.value) numericInput.value = formatScaledDecimal(
    typeof props.modelValue === "number" ? props.modelValue : null,
    numericPlaces.value);
}
const numeric = computed({
  get: () => typeof props.modelValue === "number" ? props.modelValue : undefined,
  set: (value: number | undefined) => emit("update:modelValue", value ?? null),
});
let requestSequence = 0;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let inFlight: AbortController | null = null;
function search(q = "", immediate = false) {
  if (props.field.type !== "ref" || !props.field.reference || referenceSelectors[props.field.reference]) return;
  const sequence = ++requestSequence;
  if (debounceTimer) clearTimeout(debounceTimer);
  inFlight?.abort();
  inFlight = new AbortController();
  const controller = inFlight;
  const execute = async () => {
    const reference = props.field.reference;
    const selectedId = typeof props.modelValue === "string" ? props.modelValue : null;
    try {
      const searchParams = new URLSearchParams({ page_size: "100", q });
      for (const [key, item] of Object.entries(props.filters || {}))
        if (item) searchParams.set(key, item);
      const response = await api<Page<ReferenceOption>>(
        "/catalog/" + reference + "?" + searchParams.toString(),
        "GET", undefined, controller.signal,
      );
      let selected = null;
      if (selectedId && !response.items.some(item => item.id === selectedId)) {
        try {
          selected = await api<ReferenceOption>(
            "/catalog/" + reference + "/" + selectedId + "?deleted=true",
            "GET", undefined, controller.signal,
          );
        } catch (error) {
          if (controller.signal.aborted) return;
          selected = { id: selectedId, label: "原关联需重新选择" };
        }
      }
      if (sequence === requestSequence && !controller.signal.aborted) {
        options.value = selected ? [selected, ...response.items] : response.items;
        searchError.value = "";
      }
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
  <component v-if="field.type === 'ref' && referenceSelectors[field.reference || '']" :is="referenceSelectors[field.reference || '']" v-model="value" :disabled="disabled" :historical-label="field.adoptedLabel" :historical-version-id="field.adoptedVersionId" />
  <ElSelect
    v-else-if="field.type === 'ref'"
    v-model="value"
    :disabled="disabled"
    clearable
    filterable
    remote
    :remote-method="search"
    placeholder="搜索并选择"
    no-data-text="没有匹配记录，请更换关键词"
  >
    <template #label>{{ selectedOptionLabel }}</template>
    <ElOption
      v-for="item in options"
      :key="item.id"
      :value="item.id"
      :label="optionLabels.get(item.id)!"
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
    v-model="switchValue"
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
  <ElInput
    v-else-if="isFixedScaled && (field.type !== 'quantity' || validQuantityPrecision)"
    :model-value="numericInput"
    inputmode="decimal"
    autocomplete="off"
    :disabled="disabled"
    @focus="numericEditing = true"
    @update:model-value="updateNumericText"
    @blur="numericBlur"
  />
  <ElAlert v-else-if="field.type === 'quantity'"
    type="warning" :closable="false"
    title="尚未确认正式单位数量精度，此处不能填写数量。" />
  <ElInputNumber
    v-else-if="field.type === 'decimal'"
    v-model="numeric"
    :precision="6"
    :controls="false"
    :disabled="disabled"
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
  <ElAlert v-if="isFixedScaled && numericError"
    type="error" :closable="false" :title="numericError" />
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

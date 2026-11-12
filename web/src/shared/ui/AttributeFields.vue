<script setup lang="ts">
import { computed } from "vue";
import type {
  AttributeScope,
  AttributeValue,
  AttributeValues,
  OperationAttribute,
} from "../../../../server/shared/types/operation-attributes";
import { validateAttributeValue } from "../../../../server/shared/operation-attributes";
const props = defineProps<{
  definitions: OperationAttribute[];
  scope: AttributeScope;
  modelValue: AttributeValues;
  errors?: Record<string, unknown>;
  path?: string;
  defaults?: boolean;
}>();
const emit = defineEmits<{ "update:modelValue": [value: AttributeValues] }>();
const fields = computed(() =>
  props.definitions
    .filter(
      (field) =>
        field.scope === props.scope &&
        field.source === "manual" &&
        field.enabled,
    )
    .sort((a, b) => a.sort_order - b.sort_order),
);
function update(field: OperationAttribute, value: unknown) {
  const next = { ...props.modelValue };
  if (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && !value.length)
  )
    delete next[field.key];
  else
    next[field.key] = (
      field.type === "integer" && /^-?\d+$/.test(String(value))
        ? Number(value)
        : value
    ) as AttributeValue;
  emit("update:modelValue", next);
}
function error(field: OperationAttribute): string {
  const external =
    props.errors?.[(props.path ? props.path + "." : "") + field.key];
  if (external) return String(external);
  const value = props.modelValue[field.key];
  if (value === undefined || value === "") return "";
  try {
    validateAttributeValue(field, value);
    return "";
  } catch (failure) {
    return (failure as Error).message;
  }
}
</script>
<template>
  <div class="form-grid attribute-fields">
    <ElFormItem
      v-for="field in fields"
      :key="field.key"
      :label="
        field.label +
        (!defaults && field.requirement === 'pricing' ? '（计价必需）' : '')
      "
      :required="!defaults && field.requirement === 'save'"
      :error="error(field)"
      :class="{ 'full-width': field.type === 'textarea' }"
    >
      <ElSelect
        v-if="field.type === 'select' || field.type === 'multiselect'"
        :model-value="modelValue[field.key]"
        :multiple="field.type === 'multiselect'"
        clearable
        @update:model-value="update(field, $event)"
      >
        <ElOption
          v-for="option in field.options"
          :key="option.value"
          :label="option.label"
          :value="option.value"
        />
      </ElSelect>
      <ElSelect
        v-else-if="field.type === 'boolean'"
        :model-value="modelValue[field.key]"
        clearable
        @update:model-value="update(field, $event)"
      >
        <ElOption label="是" :value="true" /><ElOption
          label="否"
          :value="false"
        />
      </ElSelect>
      <ElDatePicker
        v-else-if="field.type === 'date'"
        :model-value="String(modelValue[field.key] || '')"
        value-format="YYYY-MM-DD"
        @update:model-value="update(field, $event)"
      />
      <ElInput
        v-else
        :model-value="String(modelValue[field.key] ?? '')"
        :type="field.type === 'textarea' ? 'textarea' : 'text'"
        :rows="3"
        :placeholder="field.hint"
        @update:model-value="update(field, $event)"
      />
      <span v-if="field.hint" class="muted attribute-hint">{{
        field.hint
      }}</span>
    </ElFormItem>
  </div>
</template>
<style scoped>
.attribute-hint {
  display: block;
  font-size: 12px;
  line-height: 1.6;
  width: 100%;
}
</style>

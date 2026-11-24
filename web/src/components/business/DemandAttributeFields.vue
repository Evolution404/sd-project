<template>
  <el-form-item
    v-for="field in fields"
    :key="field.key"
    :label="field.label"
    :required="field.requirement === 'save' && field.source === 'manual'"
  >
    <span v-if="field.source === 'asset'">
      {{ modelValue[field.key] ?? "保存时从所选设备读取" }}
    </span>
    <el-select
      v-else-if="field.type === 'select' || field.type === 'multiselect'"
      :model-value="modelValue[field.key]"
      :multiple="field.type === 'multiselect'"
      clearable
      filterable
      @update:model-value="(value) => change(field.key, value)"
    >
      <el-option
        v-for="option in field.options"
        :key="option.value"
        :label="option.label"
        :value="option.value"
      />
    </el-select>
    <el-radio-group
      v-else-if="field.type === 'boolean'"
      :model-value="booleanValue(field.key)"
      @update:model-value="(value) => change(field.key, value)"
    >
      <el-radio :value="true">是</el-radio>
      <el-radio :value="false">否</el-radio>
    </el-radio-group>
    <el-date-picker
      v-else-if="field.type === 'date'"
      :model-value="String(modelValue[field.key] ?? '')"
      type="date"
      value-format="YYYY-MM-DD"
      @update:model-value="(value) => change(field.key, value)"
    />
    <el-input
      v-else
      :model-value="String(modelValue[field.key] ?? '')"
      :type="field.type === 'textarea' ? 'textarea' : 'text'"
      :inputmode="field.type === 'decimal' || field.type === 'integer' ? 'decimal' : undefined"
      @update:model-value="(value) => change(field.key, value)"
    />
    <small v-if="field.hint" class="w-full">{{ field.hint }}</small>
  </el-form-item>
</template>

<script setup lang="ts">
import type {
  AttributeValues,
  OperationAttribute,
} from "../../../../server/shared/types/operation-attributes";
const props = defineProps<{ fields: OperationAttribute[]; modelValue: AttributeValues }>();
const emit = defineEmits<{ "update:modelValue": [values: AttributeValues] }>();
function booleanValue(key: string) {
  const value = props.modelValue[key];
  return typeof value === "boolean" ? value : undefined;
}
function change(key: string, value: unknown) {
  const next = { ...props.modelValue };
  if (value === "" || value == null || (Array.isArray(value) && !value.length)) delete next[key];
  else if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    Array.isArray(value)
  )
    next[key] = value;
  emit("update:modelValue", next);
}
</script>

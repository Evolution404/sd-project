<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { api } from "../../shared/api/client";
import type {
  OperationAttribute,
  AttributeCondition,
} from "../../../../server/shared/types/operation-attributes";
const props = defineProps<{
  rule: {
    operation_id?: unknown;
    operation_version?: unknown;
    adopt_latest_operation_version?: unknown;
    additional_conditions_json?: unknown;
    price_features_loading?: boolean;
    price_features_load_error?: string;
  };
}>();
const definitions = ref<OperationAttribute[]>([]),
  conditions = ref<Record<string, AttributeCondition>>({}),
  loading = ref(false),
  error = ref("");
let sequence = 0;
watch(
  () => props.rule,
  (rule) => {
    conditions.value = JSON.parse(
      String(rule.additional_conditions_json || "{}"),
    );
  },
  { immediate: true },
);
watch(
  () => [
    props.rule.operation_id,
    props.rule.operation_version,
    props.rule.adopt_latest_operation_version,
  ],
  async () => {
    const seq = ++sequence;
    definitions.value = [];
    error.value = "";
    if (!props.rule.operation_id) return;
    loading.value = true;
    props.rule.price_features_loading = true;
    props.rule.price_features_load_error = "";
    try {
      const result = await api<{ items: OperationAttribute[] }>(
        "/catalog/operations/" +
          props.rule.operation_id +
          "/attributes" +
          (props.rule.operation_version &&
          !props.rule.adopt_latest_operation_version
            ? "?version=" + props.rule.operation_version
            : ""),
      );
      if (seq === sequence)
        definitions.value = result.items.filter(
          (field) => field.pricing && field.enabled,
        );
    } catch (failure) {
      if (seq === sequence) {
        error.value = (failure as Error).message;
        props.rule.price_features_load_error = error.value;
      }
    } finally {
      if (seq === sequence) {
        loading.value = false;
        props.rule.price_features_loading = false;
      }
    }
  },
  { immediate: true },
);
const stale = computed(() =>
  Object.keys(conditions.value).filter(
    (key) => !definitions.value.some((field) => field.key === key),
  ),
);
function enable(field: OperationAttribute, value: boolean) {
  if (value)
    conditions.value[field.key] = {
      op: field.type === "integer" || field.type === "decimal" ? "range" : "eq",
    };
  else delete conditions.value[field.key];
}
watch(
  conditions,
  (value) => {
    props.rule.additional_conditions_json = JSON.stringify(value);
  },
  { deep: true },
);
</script>
<template>
  <section data-guide-action="pricing.condition" class="full-width">
    <ElAlert
      v-if="loading"
      title="正在读取操作类型统一属性"
      type="info"
      :closable="false"
    />
    <ElAlert v-if="error" :title="error" type="error" :closable="false" />
    <div v-for="field in definitions" :key="field.key" class="panel">
      <ElCheckbox
        :model-value="!!conditions[field.key]"
        @change="enable(field, Boolean($event))"
        >限制{{ field.label }}（{{
          field.scope === "demand" ? "需求级" : "位置级"
        }}）</ElCheckbox
      >
      <div v-if="conditions[field.key]" class="form-grid">
        <template v-if="field.type === 'integer' || field.type === 'decimal'">
          <ElFormItem label="匹配方式"
            ><ElSelect v-model="conditions[field.key].op"
              ><ElOption label="范围匹配" value="range" /><ElOption
                label="精确匹配"
                value="eq" /></ElSelect
          ></ElFormItem>
          <template v-if="conditions[field.key].op === 'range'">
            <ElFormItem label="最小值" required
              ><ElInput v-model="conditions[field.key].min"
            /></ElFormItem>
            <ElFormItem label="最大值" required
              ><ElInput v-model="conditions[field.key].max"
            /></ElFormItem>
          </template>
          <ElFormItem v-else label="适用数值" required
            ><ElInput
              :model-value="String(conditions[field.key].value ?? '')"
              @update:model-value="conditions[field.key].value = $event"
              @change="
                field.type === 'integer' &&
                (conditions[field.key].value = Number(
                  conditions[field.key].value,
                ))
              "
          /></ElFormItem>
        </template>
        <ElFormItem
          v-else-if="field.type === 'boolean'"
          label="适用取值"
          required
          ><ElSelect v-model="conditions[field.key].value"
            ><ElOption label="是" :value="true" /><ElOption
              label="否"
              :value="false" /></ElSelect
        ></ElFormItem>
        <ElFormItem
          v-else-if="field.type === 'select' && field.source === 'manual'"
          label="适用取值"
          required
          ><ElSelect v-model="conditions[field.key].value"
            ><ElOption
              v-for="option in field.options"
              :key="option.value"
              :label="option.label"
              :value="option.value" /></ElSelect
        ></ElFormItem>
        <ElFormItem v-else label="台账正式取值" required
          ><ElInput
            :model-value="String(conditions[field.key].value ?? '')"
            @update:model-value="conditions[field.key].value = $event"
        /></ElFormItem>
      </div>
    </div>
    <ElAlert
      v-if="!loading && !definitions.length"
      title="该操作正式版本尚未开放附加属性计价条件"
      type="info"
      :closable="false"
    />
    <ElButton data-guide-action="pricing.condition-remove"
      v-for="key in stale"
      :key="key"
      type="danger"
      plain
      @click="delete conditions[key]"
      >移除不适用的原条件</ElButton
    >
  </section>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { api, type Row } from "../services/api";
const props = defineProps<{ rule: Row }>(),
  definitions = ref<Row[]>([]),
  conditions = ref<Row>({});
watch(
  () => props.rule,
  (rule) => {
    try {
      conditions.value = JSON.parse(rule.additional_conditions_json || "{}");
    } catch {
      conditions.value = {};
    }
  },
  { immediate: true },
);
watch(
  () => props.rule.operation_id,
  async (operationId) => {
    definitions.value = [];
    if (!operationId) return;
    const operation = await api("/catalog/operations/" + operationId);
    for (const feature of JSON.parse(operation.pricing_features_json || "[]")) {
      const factor = await api("/catalog/factors/" + feature.factor_id),
        history = await api("/catalog/factors/history/" + feature.factor_id),
        version = history.find(
          (row: Row) => row.version === feature.factor_version,
        );
      if (version)
        definitions.value.push({
          ...feature,
          code: factor.code,
          name: version.name,
          definition: JSON.parse(version.fields_json),
        });
    }
  },
  { immediate: true },
);
function enable(feature: Row, selected: boolean) {
  if (selected)
    conditions.value[feature.code] = {
      factor_version: feature.factor_version,
      op: feature.definition.kind === "number" ? "range" : "eq",
      ...(feature.definition.kind === "number"
        ? { min: 0, max: 0 }
        : { value: "" }),
    };
  else delete conditions.value[feature.code];
}
watch(
  conditions,
  (value) => (props.rule.additional_conditions_json = JSON.stringify(value)),
  { deep: true },
);
</script>
<template>
  <section v-if="definitions.length">
    <h3 class="subheading">现场特征适用条件</h3>
    <div v-for="feature in definitions" :key="feature.code" class="panel">
      <ElCheckbox
        :model-value="!!conditions[feature.code]"
        @change="enable(feature, Boolean($event))"
        >限制{{ feature.name }}</ElCheckbox
      >
      <div v-if="conditions[feature.code]" class="form-grid">
        <template v-if="feature.definition.kind === 'number'"
          ><ElFormItem label="最小值" required
            ><ElInputNumber
              v-model="conditions[feature.code].min"
              :precision="0" /></ElFormItem
          ><ElFormItem label="最大值" required
            ><ElInputNumber
              v-model="conditions[feature.code].max"
              :precision="0" /></ElFormItem></template
        ><ElFormItem v-else label="适用取值" required
          ><ElSelect
            v-if="feature.definition.values?.length"
            v-model="conditions[feature.code].value"
            ><ElOption
              v-for="option in feature.definition.values"
              :key="String(option)"
              :value="typeof option === 'object' ? option.value : option"
              :label="
                typeof option === 'object' ? option.label : option
              " /></ElSelect
          ><ElInput v-else v-model="conditions[feature.code].value"
        /></ElFormItem>
      </div>
    </div>
  </section>
</template>

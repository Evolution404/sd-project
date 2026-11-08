<script setup lang="ts">
import { ref, watch } from "vue";
import { api, type Row } from "../services/api";
const props = defineProps<{ operation?: Row | null; location: Row }>();
const definitions = ref<Row[]>([]),
  values = ref<Row>({});
watch(
  () => [props.operation, props.location],
  async () => {
    let actual;
    try {
      actual =
        typeof props.location.site_features_json === "string"
          ? JSON.parse(props.location.site_features_json)
          : props.location.site_features_json || {};
    } catch {
      actual = {};
    }
    values.value = actual;
    definitions.value = [];
    const declared = JSON.parse(props.operation?.pricing_features_json || "[]");
    for (const feature of declared) {
      const history = await api(
          "/catalog/factors/history/" + feature.factor_id,
        ),
        definition = history.find(
          (version: Row) => version.version === feature.factor_version,
        ),
        current = await api("/catalog/factors/" + feature.factor_id);
      if (definition)
        definitions.value.push({
          ...feature,
          ...definition,
          code: current.code,
          definition: JSON.parse(definition.fields_json),
        });
    }
  },
  { immediate: true },
);
function update(feature: Row, value: unknown) {
  values.value[feature.code] = {
    factor_version: feature.factor_version,
    value,
  };
  props.location.site_features_json = JSON.stringify(values.value);
}
</script>
<template>
  <div v-if="definitions.length" class="form-grid">
    <ElFormItem
      v-for="feature in definitions"
      :key="feature.factor_id"
      :label="feature.name"
      :required="feature.required"
      ><ElSelect
        v-if="
          feature.definition.kind === 'enum' &&
          feature.definition.values?.length
        "
        :model-value="values[feature.code]?.value"
        @update:model-value="update(feature, $event)"
        ><ElOption
          v-for="option in feature.definition.values"
          :key="String(option)"
          :value="typeof option === 'object' ? option.value : option"
          :label="
            typeof option === 'object' ? option.label : option
          " /></ElSelect
      ><ElInputNumber
        v-else-if="feature.definition.kind === 'number'"
        :model-value="values[feature.code]?.value"
        :precision="0"
        @update:model-value="update(feature, $event)" /><ElInput
        v-else
        :model-value="values[feature.code]?.value"
        @update:model-value="update(feature, $event)"
    /></ElFormItem>
  </div>
  <ElCollapse
    ><ElCollapseItem
      title="补充作业规格（参考规则限定规格时填写）"
      name="specification"
      ><ElFormItem label="本位置作业规格"
        ><ElInput
          v-model="location.specification"
          placeholder="按现场作业对象的具体规格填写" /></ElFormItem></ElCollapseItem
  ></ElCollapse>
</template>

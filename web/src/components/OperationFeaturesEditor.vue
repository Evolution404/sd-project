<script setup lang="ts">
import { ref, watch } from "vue";
import { api, type Row } from "../services/api";
const props = defineProps<{ operation: Row }>();
const features = ref<Row[]>([]),
  factors = ref<Row[]>([]);
watch(
  () => props.operation,
  (value) => {
    try {
      features.value = JSON.parse(value.pricing_features_json || "[]");
    } catch {
      features.value = [];
    }
  },
  { immediate: true },
);
watch(
  features,
  (values) => (props.operation.pricing_features_json = JSON.stringify(values)),
  { deep: true },
);
api("/catalog/factors?page_size=200").then(
  (value) => (factors.value = value.items),
);
function select(feature: Row) {
  feature.factor_version = factors.value.find(
    (f) => f.id === feature.factor_id,
  )?.version;
}
</script>
<template>
  <section>
    <h3 class="subheading">操作需要的价格特征</h3>
    <div v-for="(feature, index) in features" :key="index" class="panel">
      <div class="form-grid">
        <ElFormItem label="价格特征" required
          ><ElSelect v-model="feature.factor_id" @change="select(feature)"
            ><ElOption
              v-for="factor in factors"
              :key="factor.id"
              :value="factor.id"
              :label="factor.name" /></ElSelect></ElFormItem
        ><ElFormItem label="数据来源"
          ><ElSelect v-model="feature.source"
            ><ElOption label="设备台账" value="asset" /><ElOption
              label="现场填写"
              value="manual" /><ElOption
              label="台账或现场"
              value="either" /></ElSelect></ElFormItem
        ><ElFormItem label="是否必填"
          ><ElSwitch v-model="feature.required"
        /></ElFormItem>
      </div>
      <ElButton type="danger" @click="features.splice(index, 1)"
        >移除此特征</ElButton
      >
    </div>
    <ElButton @click="features.push({ source: 'either', required: false })"
      >添加价格特征</ElButton
    >
  </section>
</template>

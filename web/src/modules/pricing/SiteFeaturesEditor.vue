<script setup lang="ts">
import { ref, watch } from "vue";
import { api, type Row } from "../../shared/api/client";
const props = defineProps<{ operation?: Row | null; location: Row }>();
const definitions = ref<Row[]>([]);
const values = ref<Row>({});
let requestId = 0;
watch(() => props.location.site_features_json, (raw) => {
  try {
    values.value = typeof raw === "string" ? JSON.parse(raw || "{}") : raw || {};
  } catch {
    values.value = {};
  }
}, { immediate: true });
const loading = ref(false);
const loadError = ref("");
const reloadCount = ref(0);
watch(() => [props.operation?.id, props.operation?.version, reloadCount.value], async () => {
  const request = ++requestId;
  definitions.value = [];
  loadError.value = "";
  props.location.price_features_load_error = "";
  const operation = props.operation;
  if (!operation?.id) return;
  loading.value = true;
  props.location.price_features_loading = true;
  try {
    const response = await api("/catalog/operations/" + operation.id +
      "/pricing-definitions?version=" + operation.version);
    if (request === requestId) definitions.value =
      response.items.filter((feature: Row) => feature.source !== "asset");
  } catch (error) {
    if (request === requestId) {
      loadError.value = (error as Error).message;
      props.location.price_features_load_error = loadError.value;
    }
  } finally {
    if (request === requestId) {
      loading.value = false;
      props.location.price_features_loading = false;
    }
  }
}, { immediate: true });
function update(feature: Row, value: unknown) {
  const next = { ...values.value };
  if (value === null || value === undefined || value === "") {
    delete next[feature.code];
  } else {
    next[feature.code] = { factor_version: feature.factor_version, value };
  }
  values.value = next;
  props.location.site_features_json = JSON.stringify(next);
}
</script>
<template>
  <ElAlert v-if="loading" type="info" :closable="false" title="正在加载现场计价信息" />
  <ElAlert v-if="loadError" type="error" :closable="false" :title="'现场计价信息加载失败：' + loadError" />
  <ElButton v-if="loadError" @click="reloadCount++">重试加载</ElButton>
  <div v-if="definitions.length">
    <h3 class="subheading">额外计价信息</h3>
    <p class="muted">仅填写现场实际情况。标有“正式计价必需”的信息可在需求登记后补充，但确认完整报价前必须填写。</p>
    <div class="form-grid">
      <ElFormItem v-for="feature in definitions" :key="feature.factor_id"
        :label="feature.name + (feature.unit ? '（' + feature.unit + '）' : '') +
          (feature.required ? ' · 正式计价必需' : '')">
        <ElSelect v-if="feature.definition.kind === 'enum' && feature.definition.values?.length"
          :model-value="values[feature.code]?.value" clearable placeholder="请选择现场实际值"
          @update:model-value="update(feature,$event)">
          <ElOption v-for="option in feature.definition.values" :key="String(option)"
            :value="typeof option === 'string' ? option : option.value"
            :label="typeof option === 'string' ? option : option.label" />
        </ElSelect>
        <ElInputNumber v-else-if="feature.definition.kind === 'number'"
          :model-value="values[feature.code]?.value" :precision="0"
          :min="feature.definition.min ?? -9007199254740991"
          :max="feature.definition.max ?? 9007199254740991"
          @update:model-value="update(feature,$event)" />
        <ElInput v-else :model-value="values[feature.code]?.value"
          placeholder="旧版文字特征" @update:model-value="update(feature,$event)" />
      </ElFormItem>
    </div>
  </div>
  <ElCollapse>
    <ElCollapseItem title="补充作业规格（参考规则限定规格时填写）" name="specification">
      <ElFormItem label="本位置作业规格">
        <ElInput v-model="location.specification" placeholder="按现场作业对象的具体规格填写" />
      </ElFormItem>
    </ElCollapseItem>
  </ElCollapse>
</template>

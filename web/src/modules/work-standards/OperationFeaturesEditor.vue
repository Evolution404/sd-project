<script setup lang="ts">
import { ref, watch, onMounted } from "vue";
import { api } from "../../shared/api/client";

import type { Page } from "../../../../server/shared/types/contracts";
import type {
  PricingFeatureDeclaration,
  PriceFactorRecord,
} from "../../../../server/shared/types/work-standards";
const props = defineProps<{
  operation: {
    pricing_features_json?: unknown;
    price_features_load_error?: string;
  };
}>();
const features = ref<Partial<PricingFeatureDeclaration>[]>([]);
const factors = ref<PriceFactorRecord[]>([]);
const listLoading = ref(false);
const listError = ref("");
async function loadFactors() {
  listLoading.value = true;
  listError.value = "";
  props.operation.price_features_load_error = "";
  try {
    const all: PriceFactorRecord[] = [];
    let page = 1;
    while (true) {
      const result = await api<Page<PriceFactorRecord>>(
        "/catalog/factors?page_size=200&page=" + page,
      );
      all.push(...result.items);
      if (all.length >= result.total) break;
      page++;
      if (page > 1000) throw new Error("价格特征数量超出查询范围");
    }
    factors.value = all;
  } catch (error) {
    listError.value = (error as Error).message;
    props.operation.price_features_load_error = listError.value;
  } finally {
    listLoading.value = false;
  }
}
watch(
  () => props.operation,
  (value) => {
    try {
      features.value = JSON.parse(String(value.pricing_features_json || "[]"));
    } catch {
      features.value = [];
    }
  },
  { immediate: true },
);
watch(
  features,
  (values) => {
    props.operation.pricing_features_json = JSON.stringify(values);
  },
  { deep: true },
);
onMounted(() => {
  void loadFactors();
});
function select(feature: Partial<PricingFeatureDeclaration>) {
  const factor = factors.value.find((item) => item.id === feature.factor_id);
  feature.factor_version = factor?.version;
  feature.source = "manual";
}
function usedByOther(id: string, index: number) {
  return features.value.some(
    (feature, i) => i !== index && feature.factor_id === id,
  );
}
</script>
<template>
  <section class="full-width">
    <ElAlert
      v-if="listLoading"
      title="正在加载价格特征"
      type="info"
      :closable="false"
    />
    <ElAlert
      v-if="listError"
      :title="'价格特征加载失败：' + listError"
      type="error"
      :closable="false"
    />
    <ElButton v-if="listError" @click="loadFactors">重试加载</ElButton>
    <h3 class="subheading">计价所需信息</h3>
    <p class="muted">
      只选择需要现场补充的额外计价条件。线路电压、塔型等已有属性直接在参考价格适用条件中设置。
    </p>
    <div v-for="(feature, index) in features" :key="index" class="panel">
      <div class="form-grid">
        <ElFormItem label="额外价格特征" required>
          <ElSelect
            v-model="feature.factor_id"
            filterable
            placeholder="选择价格特征"
            @change="select(feature)"
          >
            <ElOption
              v-for="factor in factors"
              :key="factor.id"
              :label="factor.name"
              :value="factor.id"
              :disabled="
                factor.status !== 'active' ||
                usedByOther(factor.id, Number(index))
              "
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="正式计价必需">
          <ElSwitch v-model="feature.required" />
        </ElFormItem>
      </div>
      <ElAlert
        v-if="feature.source !== 'manual'"
        title="历史台账特征：保留原正式引用，但不再允许新增；新规则请直接使用内置适用条件。"
        type="warning"
        :closable="false"
      />
      <ElButton type="danger" text @click="features.splice(Number(index), 1)"
        >移除此特征</ElButton
      >
    </div>
    <ElButton
      :disabled="listLoading || !!listError"
      @click="features.push({ source: 'manual', required: false })"
    >
      添加计价信息
    </ElButton>
  </section>
</template>

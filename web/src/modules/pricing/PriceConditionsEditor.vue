<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { api } from "../../shared/api/client";
import type { FactorDefinition } from "../../../../server/modules/pricing/features";
import type { PriceCondition } from "../../../../server/modules/pricing/model";
import type {
  PriceFactorRecord,
  PricingFeatureDeclaration,
} from "../../../../server/shared/types/work-standards";
import type { Page } from "../../../../server/shared/types/contracts";
interface Feature extends PricingFeatureDeclaration {
  code: string;
  name: string;
  definition: FactorDefinition;
  unit: string;
}
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
const definitions = ref<Feature[]>([]);
const conditions = ref<Record<string, PriceCondition>>({});
const knownFactors = ref<PriceFactorRecord[]>([]);
async function loadKnownFactors() {
  const all: PriceFactorRecord[] = [];
  for (let page = 1; page <= 1000; page++) {
    const result = await api<Page<PriceFactorRecord>>(
      "/catalog/factors?page_size=200&deleted=true&page=" + page,
    );
    all.push(...result.items);
    if (all.length >= result.total) return all;
  }
  throw new Error("价格特征数量超出查询范围");
}
loadKnownFactors()
  .then((items) => {
    knownFactors.value = items;
  })
  .catch(() => {
    knownFactors.value = [];
  });
const staleCodes = computed(() =>
  Object.keys(conditions.value).filter(
    (code) =>
      !definitions.value.some(
        (item) =>
          item.code === code &&
          item.factor_version === conditions.value[code]?.factor_version,
      ),
  ),
);
let requestId = 0;

watch(
  () => props.rule,
  (rule) => {
    try {
      conditions.value = JSON.parse(
        String(rule.additional_conditions_json || "{}"),
      );
    } catch {
      conditions.value = {};
    }
  },
  { immediate: true },
);
const loading = ref(false);
const loadError = ref("");
const reloadCount = ref(0);
watch(
  () => [
    props.rule.operation_id,
    props.rule.operation_version,
    props.rule.adopt_latest_operation_version,
    reloadCount.value,
  ],
  async () => {
    const request = ++requestId;
    const operationId = props.rule.operation_id;
    definitions.value = [];
    loadError.value = "";
    props.rule.price_features_load_error = "";
    if (!operationId) {
      loading.value = false;
      props.rule.price_features_loading = false;
      return;
    }
    loading.value = true;
    props.rule.price_features_loading = true;
    try {
      const requestedVersion = props.rule.operation_version;
      const url =
        "/catalog/operations/" +
        operationId +
        "/pricing-definitions" +
        (requestedVersion ? "?version=" + requestedVersion : "");
      const response = await api<{ items: Feature[] }>(url);
      if (request === requestId) definitions.value = response.items;
    } catch (error) {
      if (request === requestId) {
        loadError.value = (error as Error).message;
        props.rule.price_features_load_error = loadError.value;
      }
    } finally {
      if (request === requestId) {
        loading.value = false;
        props.rule.price_features_loading = false;
      }
    }
  },
  { immediate: true },
);
function enable(feature: Feature, selected: boolean) {
  if (selected)
    conditions.value[feature.code] = {
      factor_version: feature.factor_version,
      op: feature.definition.kind === "number" ? "range" : "eq",
      ...(feature.definition.kind === "number"
        ? { min: feature.definition.min ?? 0, max: feature.definition.min ?? 0 }
        : {
            value: feature.definition.values?.[0]
              ? typeof feature.definition.values[0] === "string"
                ? feature.definition.values[0]
                : feature.definition.values[0].value
              : "",
          }),
    };
  else delete conditions.value[feature.code];
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
  <section class="full-width">
    <ElAlert
      v-if="loading"
      type="info"
      :closable="false"
      title="正在读取正式价格特征定义"
    />
    <ElAlert
      v-if="loadError"
      type="error"
      :closable="false"
      :title="'无法读取价格特征：' + loadError"
    />
    <ElButton v-if="loadError" @click="reloadCount++">重试加载</ElButton>
    <h3 class="subheading">额外现场条件</h3>
    <p class="muted">
      不勾选表示不限制该特征。电压等级、塔型、作业方式和规格直接使用上面的已有业务字段。
    </p>
    <div v-for="feature in definitions" :key="feature.code" class="panel">
      <ElCheckbox
        :model-value="!!conditions[feature.code]"
        @change="enable(feature, Boolean($event))"
        >限制{{ feature.name }}</ElCheckbox
      >
      <div v-if="conditions[feature.code]" class="form-grid">
        <template v-if="feature.definition.kind === 'number'">
          <ElFormItem
            :label="'最小值' + (feature.unit ? '（' + feature.unit + '）' : '')"
            required
          >
            <ElInputNumber
              v-model="conditions[feature.code].min"
              :precision="0"
              :min="feature.definition.min ?? -9007199254740991"
              :max="feature.definition.max ?? 9007199254740991"
            />
          </ElFormItem>
          <ElFormItem
            :label="'最大值' + (feature.unit ? '（' + feature.unit + '）' : '')"
            required
          >
            <ElInputNumber
              v-model="conditions[feature.code].max"
              :precision="0"
              :min="feature.definition.min ?? -9007199254740991"
              :max="feature.definition.max ?? 9007199254740991"
            />
          </ElFormItem>
        </template>
        <ElFormItem v-else label="适用取值" required>
          <ElSelect
            v-if="feature.definition.values?.length"
            v-model="conditions[feature.code].value"
          >
            <ElOption
              v-for="option in feature.definition.values"
              :key="String(option)"
              :value="typeof option === 'string' ? option : option.value"
              :label="typeof option === 'string' ? option : option.label"
            />
          </ElSelect>
          <ElInput
            v-else
            v-model="conditions[feature.code].value"
            placeholder="旧版本自由文字条件"
          />
        </ElFormItem>
      </div>
    </div>
    <div v-if="staleCodes.length" class="panel">
      <ElAlert
        title="存在与当前操作类型不兼容的历史适用条件。请核对后逐项移除，或切回原操作类型。"
        :closable="false"
        type="warning"
      />
      <div class="toolbar" style="flex-wrap: wrap; margin-top: 12px">
        <ElButton
          v-for="(code, index) in staleCodes"
          :key="code"
          type="danger"
          plain
          @click="delete conditions[code]"
          >移除原条件：{{
            knownFactors.find((item) => item.code === code)?.name ||
            "第" + (Number(index) + 1) + "项"
          }}</ElButton
        >
      </div>
    </div>
  </section>
</template>

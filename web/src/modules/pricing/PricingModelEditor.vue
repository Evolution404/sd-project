<script setup lang="ts">
import { ref, watch } from "vue";
import FormulaParameters from "./FormulaParameters.vue";
import { statusText } from "../../shared/api/client";
import type { PricingParameters } from "../../../../server/modules/pricing/model";
type FormulaDraft = {
  [K in keyof PricingParameters]?: PricingParameters[K] | null;
};
interface ComponentDraft {
  coverage_key: string;
  formula_mode: string;
  parameters: FormulaDraft;
}
const props = defineProps<{
  rule: {
    pricing_mode?: string;
    calculation_params_json?: unknown;
    quantity_brackets_json?: unknown;
    fee_components_json?: unknown;
  };
}>();
const parameters = ref<FormulaDraft>({}),
  components = ref<ComponentDraft[]>([]);
function parse<T>(value: unknown, fallback: T): T {
  try {
    return (
      typeof value === "string" ? JSON.parse(value) : value || fallback
    ) as T;
  } catch {
    return fallback;
  }
}
watch(
  () => props.rule,
  (rule) => {
    parameters.value = {
      ...parse<FormulaDraft>(rule.calculation_params_json, {}),
      brackets: parse<FormulaDraft["brackets"]>(
        rule.quantity_brackets_json,
        [],
      ),
    };
    components.value = parse<ComponentDraft[]>(rule.fee_components_json, []);
  },
  { immediate: true },
);
watch(
  parameters,
  (values) => {
    const { brackets, ...params } = values;
    for (const key of Object.keys(params) as (keyof typeof params)[])
      if (params[key] === null) delete params[key];
    props.rule.calculation_params_json = JSON.stringify(params);
    props.rule.quantity_brackets_json = JSON.stringify(brackets || []);
  },
  { deep: true },
);
watch(
  components,
  (values) => {
    props.rule.fee_components_json = JSON.stringify(values);
  },
  { deep: true },
);
</script>
<template>
  <section class="full-width">
    <h3 class="subheading">计算参数</h3>
    <FormulaParameters
      :mode="rule.pricing_mode || 'per_unit'"
      :parameters="parameters"
    /><template v-if="rule.pricing_mode === 'composite'"
      ><div v-for="(component, index) in components" :key="index" class="panel">
        <div class="form-grid">
          <ElFormItem label="费用项名称" required
            ><ElInput v-model="component.coverage_key" /></ElFormItem
          ><ElFormItem label="费用模型" required
            ><ElSelect v-model="component.formula_mode"
              ><ElOption
                v-for="mode in [
                  'fixed',
                  'per_unit',
                  'base_plus_unit',
                  'quantity_bracket',
                  'progressive_bracket',
                  'group',
                  'rate',
                ]"
                :key="mode"
                :value="mode"
                :label="statusText[mode] || mode" /></ElSelect
          ></ElFormItem>
        </div>
        <FormulaParameters
          :mode="component.formula_mode"
          :parameters="component.parameters"
          component
        /><ElButton type="danger" @click="components.splice(index, 1)"
          >删除费用组成</ElButton
        >
      </div>
      <ElButton
        @click="
          components.push({
            coverage_key: '',
            formula_mode: 'per_unit',
            parameters: { unit_price_fen: 0 },
          })
        "
        >增加费用组成</ElButton
      ></template
    >
  </section>
</template>

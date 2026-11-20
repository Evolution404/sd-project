<script setup lang="ts">
import { ref, watch } from "vue";
import FormulaParameters from "./FormulaParameters.vue";
import { statusText } from "../../shared/api/client";
import type { PricingParameters } from "../../../../server/shared/types/pricing-api";
type FormulaDraft = {
  [K in keyof PricingParameters]?: PricingParameters[K] | null;
};
interface ComponentDraft {
  coverage_key: string;
  formula_mode: string;
  parameters: FormulaDraft;
}
const props = defineProps<{
  quantityPrecision?: number;
  rule: {
    pricing_mode?: string;
    calculation_params_json?: unknown;
    quantity_brackets_json?: unknown;
    fee_components_json?: unknown;
  };
}>();
const parameters = ref<FormulaDraft>({}),
  components = ref<ComponentDraft[]>([]);
const emit = defineEmits<{ "validity-change": [invalid: boolean] }>();
const invalidComponents = ref<Record<string, boolean>>({});
const componentIds = new WeakMap<ComponentDraft, string>();
let nextComponentId = 0;
function componentId(component: ComponentDraft): string {
  let id = componentIds.get(component);
  if (!id) { id = "component-" + ++nextComponentId; componentIds.set(component, id); }
  return id;
}
function markInvalid(key: string, invalid: boolean) {
  if (invalid) invalidComponents.value = { ...invalidComponents.value, [key]: true };
  else {
    const next = { ...invalidComponents.value };
    delete next[key];
    invalidComponents.value = next;
  }
  emit("validity-change", Object.values(invalidComponents.value).some(Boolean));
}
function removeComponent(index: number) {
  const item = components.value[index];
  if (item) markInvalid(componentId(item), false);
  components.value.splice(index, 1);
}
watch(() => props.rule.pricing_mode, () => {
  invalidComponents.value = {};
  emit("validity-change", false);
});
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
    invalidComponents.value = {};
    emit("validity-change", false);
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
      :quantity-precision="quantityPrecision"
      @validity-change="markInvalid('main', $event)"
    /><template v-if="rule.pricing_mode === 'composite'"
      ><div v-for="(component, index) in components" :key="componentId(component)" class="panel">
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
          :quantity-precision="quantityPrecision"
          component
          @validity-change="markInvalid(componentId(component), $event)"
        /><ElButton data-guide-action="pricing.model-remove" type="danger" @click="removeComponent(index)"
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

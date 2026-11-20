<script setup lang="ts">
import { watch } from "vue";
import FieldControl from "../../shared/ui/FieldControl.vue";
import type { PricingParameters } from "../../../../server/shared/types/pricing-api";
type FormulaDraft = {
  [K in keyof PricingParameters]?: PricingParameters[K] | null;
};
const props = defineProps<{
  mode: string;
  parameters: FormulaDraft;
  component?: boolean;
  quantityPrecision?: number;
}>();
const emit = defineEmits<{ "validity-change": [invalid: boolean] }>();
const invalidFields = new Map<string, boolean>();
const rowIds = new WeakMap<object, string>();
let nextRowId = 0;
function rowId(row: object): string {
  let id = rowIds.get(row);
  if (!id) { id = "row-" + ++nextRowId; rowIds.set(row, id); }
  return id;
}
function markInvalid(field: string, invalid: boolean) {
  if (invalid) invalidFields.set(field, true);
  else invalidFields.delete(field);
  emit("validity-change", invalidFields.size > 0);
}
function forgetRow(row: object) {
  const prefix = rowIds.get(row) + ".";
  for (const key of invalidFields.keys())
    if (key.startsWith(prefix)) invalidFields.delete(key);
  emit("validity-change", invalidFields.size > 0);
}
function removeBracket(index: number) {
  const row = props.parameters.brackets?.[index];
  if (row) forgetRow(row);
  props.parameters.brackets?.splice(index, 1);
}
function removeTier(index: number) {
  const row = props.parameters.tiers?.[index];
  if (row) forgetRow(row);
  props.parameters.tiers?.splice(index, 1);
}
watch(() => [props.mode, props.parameters] as const, () => {
  invalidFields.clear();
  emit("validity-change", false);
});
function addBracket() {
  props.parameters.brackets ||= [];
  props.parameters.brackets.push({
    min_quantity_scaled: 10000,
    max_quantity_scaled: null,
    base_fee_fen: 0,
    unit_price_fen: 0,
  });
}
function addTier() {
  props.parameters.tiers ||= [];
  props.parameters.tiers.push({
    up_to_quantity_scaled: null,
    unit_price_fen: 0,
  });
}
</script>
<template>
  <div class="form-grid">
    <template
      v-if="component && ['fixed', 'per_unit', 'base_plus_unit'].includes(mode)"
      ><ElFormItem label="单价 / 固定金额（元）" required
        ><FieldControl
          v-model="parameters.unit_price_fen"
          :field="{ type: 'money' }" /></ElFormItem
      ><ElFormItem
        v-if="mode === 'base_plus_unit'"
        label="基础费（元）"
        required
        ><FieldControl
          v-model="parameters.base_fee_fen"
          :field="{ type: 'money' }" /></ElFormItem
    ></template>
    <template v-if="mode === 'group'"
      ><ElFormItem label="每组容量" required
        ><FieldControl
          v-model="parameters.group_size_scaled"
          :field="{ type: 'quantity', quantityPrecision: quantityPrecision }"
            @validity-change="markInvalid('group_size_scaled', $event)" /></ElFormItem
      ><ElFormItem label="每组金额（元）" required
        ><FieldControl
          v-model="parameters.group_fee_fen"
          :field="{ type: 'money' }" /></ElFormItem
    ></template>
    <template v-if="mode === 'rate'"
      ><ElFormItem label="计费基数" required
        ><ElSelect v-model="parameters.rate_basis"
          ><ElOption label="人工费用" value="labor" /><ElOption
            label="材料费用"
            value="materials" /><ElOption
            label="机械费用"
            value="machinery" /><ElOption
            label="批准范围参考费用小计（项目级）"
            value="approved_subtotal" /></ElSelect></ElFormItem
      ><ElFormItem label="费用计算比例（万分比）" required
        ><ElInputNumber
          v-model="parameters.rate_basis_points"
          :min="0"
          :max="10000"
          :precision="0" /></ElFormItem
    ></template>
    <ElFormItem label="最低收费（元，可不填）"
      ><FieldControl
        v-model="parameters.min_amount_fen"
        :field="{ type: 'money' }" /></ElFormItem
    ><ElFormItem label="封顶金额（元，可不填）"
      ><FieldControl
        v-model="parameters.max_amount_fen"
        :field="{ type: 'money' }"
    /></ElFormItem>
  </div>
  <template v-if="mode === 'quantity_bracket'"
    ><div
      v-for="(bracket, index) in parameters.brackets"
      :key="rowId(bracket)"
      class="panel"
    >
      <div class="form-grid">
        <ElFormItem label="起始数量" required
          ><FieldControl
            v-model="bracket.min_quantity_scaled"
            :field="{ type: 'quantity', quantityPrecision: quantityPrecision }"
            @validity-change="markInvalid(rowId(bracket) + '.min_quantity_scaled', $event)" /></ElFormItem
        ><ElFormItem label="结束数量（不填表示无上限）"
          ><FieldControl
            v-model="bracket.max_quantity_scaled"
            :field="{ type: 'quantity', quantityPrecision: quantityPrecision }"
            @validity-change="markInvalid(rowId(bracket) + '.max_quantity_scaled', $event)" /></ElFormItem
        ><ElFormItem label="本档基础费（元）" required
          ><FieldControl
            v-model="bracket.base_fee_fen"
            :field="{ type: 'money' }" /></ElFormItem
        ><ElFormItem label="本档单价（元）" required
          ><FieldControl
            v-model="bracket.unit_price_fen"
            :field="{ type: 'money' }"
        /></ElFormItem>
      </div>
      <ElButton data-guide-action="pricing.bracket-remove" type="danger" @click="removeBracket(index)"
        >删除此档</ElButton
      >
    </div>
    <ElButton data-guide-action="pricing.bracket-add" @click="addBracket">添加数量档</ElButton></template
  >
  <template v-if="mode === 'progressive_bracket'"
    ><div v-for="(tier, index) in parameters.tiers" :key="rowId(tier)" class="panel">
      <div class="form-grid">
        <ElFormItem label="累计数量上限（最后一档可不填）"
          ><FieldControl
            v-model="tier.up_to_quantity_scaled"
            :field="{ type: 'quantity', quantityPrecision: quantityPrecision }"
            @validity-change="markInvalid(rowId(tier) + '.up_to_quantity_scaled', $event)" /></ElFormItem
        ><ElFormItem label="本档单价（元）" required
          ><FieldControl
            v-model="tier.unit_price_fen"
            :field="{ type: 'money' }"
        /></ElFormItem>
      </div>
      <ElButton data-guide-action="pricing.progressive-remove" type="danger" @click="removeTier(index)"
        >删除此档</ElButton
      >
    </div>
    <ElButton data-guide-action="pricing.progressive-add" @click="addTier">添加累进档</ElButton></template
  >
</template>

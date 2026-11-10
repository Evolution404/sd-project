<script setup lang="ts">
import FieldControl from "../../shared/ui/FieldControl.vue";
import type { Row } from "../../shared/api/client";
const props = defineProps<{
  mode: string;
  parameters: Row;
  component?: boolean;
}>();
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
          :field="{ type: 'quantity' }" /></ElFormItem
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
      :key="index"
      class="panel"
    >
      <div class="form-grid">
        <ElFormItem label="起始数量" required
          ><FieldControl
            v-model="bracket.min_quantity_scaled"
            :field="{ type: 'quantity' }" /></ElFormItem
        ><ElFormItem label="结束数量（不填表示无上限）"
          ><FieldControl
            v-model="bracket.max_quantity_scaled"
            :field="{ type: 'quantity' }" /></ElFormItem
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
      <ElButton type="danger" @click="parameters.brackets.splice(index, 1)"
        >删除此档</ElButton
      >
    </div>
    <ElButton @click="addBracket">添加数量档</ElButton></template
  >
  <template v-if="mode === 'progressive_bracket'"
    ><div v-for="(tier, index) in parameters.tiers" :key="index" class="panel">
      <div class="form-grid">
        <ElFormItem label="累计数量上限（最后一档可不填）"
          ><FieldControl
            v-model="tier.up_to_quantity_scaled"
            :field="{ type: 'quantity' }" /></ElFormItem
        ><ElFormItem label="本档单价（元）" required
          ><FieldControl
            v-model="tier.unit_price_fen"
            :field="{ type: 'money' }"
        /></ElFormItem>
      </div>
      <ElButton type="danger" @click="parameters.tiers.splice(index, 1)"
        >删除此档</ElButton
      >
    </div>
    <ElButton @click="addTier">添加累进档</ElButton></template
  >
</template>

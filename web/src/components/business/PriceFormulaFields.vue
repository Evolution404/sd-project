<template>
  <el-row :gutter="16">
    <el-col v-if="['fixed', 'per_unit', 'base_plus_unit'].includes(formula.mode)" :span="12">
      <el-form-item :label="formula.mode === 'fixed' ? '固定金额（元）' : '单位费（元）'" required>
        <el-input v-model="formula.amount" inputmode="decimal" />
      </el-form-item>
    </el-col>
    <el-col v-if="formula.mode === 'base_plus_unit'" :span="12">
      <el-form-item label="基础费（元）" required><el-input v-model="formula.base" inputmode="decimal" /></el-form-item>
    </el-col>
    <template v-if="formula.mode === 'group'">
      <el-col :span="12"><el-form-item label="每组容量" required><el-input v-model="formula.capacity" inputmode="decimal" /></el-form-item></el-col>
      <el-col :span="12"><el-form-item label="每组金额（元）" required><el-input v-model="formula.groupAmount" inputmode="decimal" /></el-form-item></el-col>
    </template>
    <template v-if="formula.mode === 'rate'">
      <el-col :span="12">
        <el-form-item label="计费基数" required>
          <el-select v-model="formula.rateBasis">
            <el-option v-for="basis in rateBases" :key="basis.value" :label="basis.label" :value="basis.value"
              :disabled="basis.value === 'approved_subtotal' && scope === 'work_location'" />
          </el-select>
        </el-form-item>
      </el-col>
      <el-col :span="12">
        <el-form-item label="费率（万分比）" required>
          <el-input-number v-model="formula.ratePoints" :precision="0" :min="0" :max="10000" />
        </el-form-item>
      </el-col>
    </template>
    <el-col :span="12"><el-form-item label="最低收费（元）"><el-input v-model="formula.minimum" inputmode="decimal" /></el-form-item></el-col>
    <el-col :span="12"><el-form-item label="封顶金额（元）"><el-input v-model="formula.maximum" inputmode="decimal" /></el-form-item></el-col>
  </el-row>
  <template v-if="formula.mode === 'quantity_bracket'">
    <el-card v-for="(bracket, index) in formula.brackets" :key="index" class="mb-2" shadow="never">
      <el-row :gutter="16">
        <el-col :span="12"><el-form-item label="起始数量" required><el-input v-model="bracket.from" inputmode="decimal" /></el-form-item></el-col>
        <el-col :span="12"><el-form-item label="结束数量"><el-input v-model="bracket.through" placeholder="留空表示无上限" inputmode="decimal" /></el-form-item></el-col>
        <el-col :span="12"><el-form-item label="本档基础费（元）" required><el-input v-model="bracket.base" inputmode="decimal" /></el-form-item></el-col>
        <el-col :span="12"><el-form-item label="本档单价（元）" required><el-input v-model="bracket.unit" inputmode="decimal" /></el-form-item></el-col>
      </el-row>
      <el-button v-if="!readonly" link type="danger" data-guide-action="pricing.bracket-remove" @click="formula.brackets.splice(index, 1)">移除此档</el-button>
    </el-card>
    <el-button v-if="!readonly" data-guide-action="pricing.bracket-add" @click="formula.brackets.push({ from: '', through: '', base: '0', unit: '0' })">添加数量档</el-button>
  </template>
  <template v-if="formula.mode === 'progressive_bracket'">
    <el-card v-for="(tier, index) in formula.tiers" :key="index" class="mb-2" shadow="never">
      <el-row :gutter="16">
        <el-col :span="12"><el-form-item label="累计数量上限"><el-input v-model="tier.through" placeholder="末档可留空" inputmode="decimal" /></el-form-item></el-col>
        <el-col :span="12"><el-form-item label="本档单价（元）" required><el-input v-model="tier.unit" inputmode="decimal" /></el-form-item></el-col>
      </el-row>
      <el-button v-if="!readonly" link type="danger" data-guide-action="pricing.progressive-remove" @click="formula.tiers.splice(index, 1)">移除此档</el-button>
    </el-card>
    <el-button v-if="!readonly" data-guide-action="pricing.progressive-add" @click="formula.tiers.push({ through: '', unit: '0' })">添加累进档</el-button>
  </template>
</template>

<script setup lang="ts">
import type { PricingScope } from "../../../../server/shared/types/price-rules";
import { rateBases, type PriceFormula } from "@/api/business/price-formula";

defineProps<{ scope: PricingScope; readonly: boolean }>();
const formula = defineModel<PriceFormula>({ required: true });
</script>

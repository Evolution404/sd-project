<script setup lang="ts">
import { ref, watch } from "vue";
import type { Row } from "../services/api";
const props = defineProps<{ factor: Row }>(),
  definition = ref<Row>({ kind: "enum", values: [] });
watch(
  () => props.factor,
  (factor) => {
    try {
      definition.value = JSON.parse(factor.fields_json || "{}");
    } catch {
      definition.value = { kind: "enum", values: [] };
    }
  },
  { immediate: true },
);
watch(
  definition,
  (value) => (props.factor.fields_json = JSON.stringify(value)),
  { deep: true },
);
</script>
<template>
  <section>
    <div class="form-grid">
      <ElFormItem label="特征值类型" required
        ><ElSelect v-model="definition.kind"
          ><ElOption label="文字 / 枚举" value="enum" /><ElOption
            label="整数数值"
            value="number" /></ElSelect></ElFormItem
      ><ElFormItem
        v-if="definition.kind === 'enum'"
        label="可选取值（留空允许真实文字）"
        ><ElSelect
          v-model="definition.values"
          multiple
          filterable
          allow-create
          default-first-option
          ><ElOption
            v-for="option in definition.values"
            :key="String(option)"
            :value="typeof option === 'object' ? option.value : option"
            :label="
              typeof option === 'object' ? option.label : option
            " /></ElSelect></ElFormItem
      ><ElFormItem label="可自动取得的台账事实"
        ><ElSelect v-model="definition.asset_field" clearable
          ><ElOption label="物理杆塔塔型" value="tower_type" /><ElOption
            label="线路电压编码"
            value="voltage_code" /></ElSelect
      ></ElFormItem>
    </div>
  </section>
</template>

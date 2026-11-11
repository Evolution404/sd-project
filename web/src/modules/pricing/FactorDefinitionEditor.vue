<script setup lang="ts">
import { ref, watch, onMounted } from "vue";
import { api } from "../../shared/api/client";

import type { FactorDefinition } from "../../../../server/modules/pricing/features";
import type { DictionaryItem } from "../../../../server/shared/types/master-data";
import type { Page } from "../../../../server/shared/types/contracts";
const props = defineProps<{ factor: { fields_json?: unknown } }>();
const definition = ref<FactorDefinition>({ kind: "enum", values: [] });
const units = ref<DictionaryItem[]>([]);
const unitsLoading = ref(false);
const unitsError = ref("");
const newOption = ref("");

watch(
  () => props.factor,
  (factor) => {
    try {
      const raw =
        typeof factor.fields_json === "string"
          ? JSON.parse(factor.fields_json)
          : factor.fields_json;
      definition.value =
        raw && typeof raw === "object"
          ? { ...raw }
          : { kind: "enum", values: [] };
    } catch {
      definition.value = { kind: "enum", values: [] };
    }
  },
  { immediate: true },
);
watch(
  definition,
  (value) => {
    props.factor.fields_json = JSON.stringify(value);
  },
  { deep: true },
);
async function loadUnits() {
  unitsLoading.value = true;
  unitsError.value = "";
  try {
    const all: DictionaryItem[] = [];
    let page = 1;
    while (true) {
      const result = await api<Page<DictionaryItem>>(
        "/catalog/units?page_size=200&page=" + page,
      );
      all.push(...result.items);
      if (all.length >= result.total) break;
      page++;
      if (page > 1000) throw new Error("可选计量单位数量过多");
    }
    units.value = all;
  } catch (error) {
    unitsError.value = (error as Error).message;
  } finally {
    unitsLoading.value = false;
  }
}
onMounted(() => {
  void loadUnits();
});
function selectKind(value: string | number | boolean) {
  definition.value =
    value === "enum"
      ? { kind: "enum", values: [] }
      : { kind: "number", min: null, max: null };
}
function addOption() {
  const value = newOption.value.trim();
  if (
    !value ||
    definition.value.values?.some(
      (item) => (typeof item === "string" ? item : item.value) === value,
    )
  )
    return;
  (definition.value.values ||= []).push(value);
  newOption.value = "";
}
function removeOption(index: number) {
  definition.value.values?.splice(index, 1);
}
function selectUnit(unitId: string | null) {
  definition.value.unit_id = unitId || undefined;
  definition.value.unit_version = unitId
    ? units.value.find((unit) => unit.id === unitId)?.version
    : undefined;
}
</script>
<template>
  <section class="full-width">
    <div class="form-grid">
      <ElFormItem label="取值类型" required>
        <ElSegmented
          :model-value="definition.kind"
          :options="[
            { label: '选项', value: 'enum' },
            { label: '整数', value: 'number' },
          ]"
          @change="selectKind"
        />
      </ElFormItem>
    </div>
    <template v-if="definition.kind === 'enum'">
      <ElFormItem label="可选值（至少一项，不能重复）" required>
        <div class="full-width">
          <div class="toolbar">
            <ElInput
              v-model="newOption"
              placeholder="输入选项名称"
              @keyup.enter.prevent="addOption"
            />
            <ElButton type="primary" plain @click="addOption"
              >添加选项</ElButton
            >
          </div>
          <div class="toolbar" style="flex-wrap: wrap; margin-top: 12px">
            <ElTag
              v-for="(item, index) in definition.values"
              :key="index"
              closable
              @close="removeOption(Number(index))"
            >
              {{ typeof item === "string" ? item : item.label }}
            </ElTag>
          </div>
        </div>
      </ElFormItem>
    </template>
    <template v-else>
      <ElAlert
        v-if="unitsError"
        :title="'计量单位加载失败：' + unitsError"
        type="error"
        :closable="false"
      />
      <ElButton v-if="unitsError" @click="loadUnits">重试加载计量单位</ElButton>
      <div class="form-grid">
        <ElFormItem label="计量单位（选填）">
          <ElSelect
            :model-value="definition.unit_id"
            clearable
            filterable
            :loading="unitsLoading"
            placeholder="不指定单位"
            @update:model-value="selectUnit"
          >
            <ElOption
              v-for="unit in units"
              :key="unit.id"
              :value="unit.id"
              :label="unit.name"
              :disabled="unit.status !== 'active'"
            />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="最小允许值（选填）">
          <ElInputNumber
            v-model="definition.min"
            :precision="0"
            controls-position="right"
          />
        </ElFormItem>
        <ElFormItem label="最大允许值（选填）">
          <ElInputNumber
            v-model="definition.max"
            :precision="0"
            controls-position="right"
          />
        </ElFormItem>
      </div>
      <p class="muted">
        数值范围用于校验现场实际值；参考价格的分档在价格规则中设置。
      </p>
    </template>
  </section>
</template>

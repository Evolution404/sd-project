<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { OperationDetail } from "../../../../server/shared/types/work-standards";
import type { OperationAttribute } from "../../../../server/shared/types/operation-attributes";
import { api } from "../../shared/api/client";
import { formatBeijingDateTime } from "../../shared/utils/datetime";
import BusinessTable from "../../shared/ui/BusinessTable.vue";
import BusinessHistory from "../../shared/ui/BusinessHistory.vue";
const props = defineProps<{ id: string }>();
const detail = ref<OperationDetail | null>(null),
  version = ref<number>(),
  error = ref("");
watch(
  () => props.id,
  async (id) => {
    try {
      detail.value = await api<OperationDetail>(
        "/catalog/operations/" + id + "?history=true",
      );
      version.value = detail.value.item.version;
    } catch (failure) {
      error.value = (failure as Error).message;
    }
  },
  { immediate: true },
);
const selected = computed(() =>
  detail.value?.versions.find((row) => row.version === version.value),
);
const differences = computed(() => {
  if (!selected.value) return [];
  const current: OperationAttribute[] = JSON.parse(
    selected.value.attributes_schema_json,
  );
  const previous: OperationAttribute[] = JSON.parse(
    detail.value?.versions.find(
      (row) => row.version === Number(version.value) - 1,
    )?.attributes_schema_json || "[]",
  );
  const keys = [
    ...new Set([...current, ...previous].map((field) => field.key)),
  ];
  return keys
    .filter(
      (key) =>
        JSON.stringify(current.find((field) => field.key === key)) !==
        JSON.stringify(previous.find((field) => field.key === key)),
    )
    .map((key) => ({
      id: key,
      name: (current.find((field) => field.key === key) ||
        previous.find((field) => field.key === key))!.label,
      before: previous.find((field) => field.key === key) || null,
      after: current.find((field) => field.key === key) || null,
    }));
});
</script>
<template>
  <ElAlert v-if="error" :title="error" type="error" :closable="false" />
  <template v-if="detail">
    <ElSelect v-model="version"
      ><ElOption
        v-for="row in detail.versions"
        :key="row.id"
        :value="row.version"
        :label="'正式定义第' + row.version + '版 · ' + formatBeijingDateTime(row.changed_at)"
    /></ElSelect>
    <p v-if="selected" class="muted">
      {{ selected.name }} · {{ selected.reason || "未填写修改原因" }} ·
      {{ formatBeijingDateTime(selected.changed_at) }}
    </p>
    <h3>属性定义差异</h3>
    <BusinessHistory :value="differences" />
    <h3>采用该版本的需求</h3>
    <BusinessTable
      :rows="
        detail.adoptions.demands.filter(
          (row) => row.operation_version === version,
        )
      "
      :columns="[
        { key: 'demand_no', label: '需求编号' },
        { key: 'demand_version', label: '需求正式版本' },
      ]"
      table-key="operation:adopted-demands"
      client-side
      :actions-width="0"
      :max-height="250"
      ><template #cell="{ row, column }">{{
        column.key === "demand_no" ? row.demand_no : row.demand_version
      }}</template></BusinessTable
    >
    <h3>关联参考价格规则</h3>
    <BusinessTable
      :rows="
        detail.adoptions.prices.filter(
          (row) => row.operation_version === version,
        )
      "
      :columns="[
        { key: 'title', label: '规则名称' },
        { key: 'version_no', label: '规则正式版本' },
      ]"
      table-key="operation:adopted-prices"
      client-side
      :actions-width="0"
      :max-height="250"
      ><template #cell="{ row, column }">{{
        column.key === "title" ? row.title : row.version_no
      }}</template></BusinessTable
    >
    <ElCollapse
      ><ElCollapseItem title="完整正式版本及修改人审计"
        ><BusinessHistory
          :value="{
            versions: detail.versions,
            audits: detail.audits,
          }" /></ElCollapseItem
    ></ElCollapse>
  </template>
</template>

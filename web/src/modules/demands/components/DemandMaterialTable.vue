<script setup lang="ts">
import { ref } from "vue";
import type { MaterialDraft } from "../types/demand";
import FieldControl from "../../../shared/ui/FieldControl.vue";
import BusinessTable from "../../../shared/ui/BusinessTable.vue";
import DemandMaterialPicker from "./DemandMaterialPicker.vue";

defineProps<{ rows: MaterialDraft[] }>();
const emit = defineEmits<{
  add: [rows: MaterialDraft[]];
  remove: [ids: string[]];
  invalid: [id: string, value: boolean];
}>();
const selected = ref<MaterialDraft[]>([]);
const opening = ref(false);
</script>
<template>
  <div class="toolbar">
    <ElButton data-guide-action="demands.material"
      @click="opening = true"
      >添加预计物资</ElButton
    ><ElButton data-guide-action="demands.material-remove"
      :disabled="!selected.length"
      type="danger"
      plain
      @click="
        emit(
          'remove',
          selected.map((item) => item.id),
        )
      "
      >移除选中物资</ElButton
    >
  </div>
  <BusinessTable
    :rows="rows"
    :columns="[
      { key: 'name', label: '物资名称' },
      { key: 'model', label: '型号' },
      { key: 'specification', label: '规格' },
      { key: 'quantity_scaled', label: '预计数量', minWidth: 190 },
      { key: 'unit', label: '单位' },
    ]"
    table-key="demand:materials-editor"
    selectable
    client-side
    :actions-width="0"
    @selection-change="selected = $event"
  >
    <template #cell="{ row, column }"
      ><ElFormItem v-if="column.key === 'quantity_scaled'" :error="row.error"
        ><FieldControl
          :model-value="row.quantity_scaled"
          :field="{ type: 'quantity', quantityPrecision: row.precision }"
          @update:model-value="
            row.quantity_scaled = typeof $event === 'number' ? $event : 0
          "
          @validity-change="emit('invalid', row.id, $event)" /></ElFormItem
      ><span v-else>{{
        column.key === "name"
          ? row.name
          : column.key === "model"
            ? row.model
            : column.key === "unit"
              ? row.unit
              : row.specification
      }}</span></template
    >
  </BusinessTable>
  <DemandMaterialPicker
    v-model:open="opening"
    :existing="rows"
    @add="emit('add', $event)"
  />
</template>

<script setup lang="ts">
import { newClientId } from "../../../shared/utils/id";
import { ref } from "vue";
import type { MaterialRecord } from "../../../../../server/shared/types/master-data";
import type { MaterialDraft } from "../types/demand";
import { api } from "../../../shared/api/client";
import { readCurrentMaterialPrecision } from "../../../shared/api/quantity-precision";
import FieldControl from "../../../shared/ui/FieldControl.vue";
import BusinessTable from "../../../shared/ui/BusinessTable.vue";
import { ElMessage } from "element-plus";
const props = defineProps<{ rows: MaterialDraft[] }>();
const emit = defineEmits<{
  add: [row: MaterialDraft];
  remove: [ids: string[]];
  invalid: [id: string, value: boolean];
}>();
const ids = ref<string[]>([]),
  selected = ref<MaterialDraft[]>([]),
  opening = ref(false),
  loading = ref(false),
  candidates = ref<MaterialRecord[]>([]),
  query = ref("");
let searchSequence = 0;
async function search() {
  const sequence = ++searchSequence;
  try {
    const response = await api<{ items: MaterialRecord[] }>(
      "/catalog/materials?page_size=200&q=" + encodeURIComponent(query.value),
    );
    if (sequence !== searchSequence) return;
    candidates.value = response.items.filter(
      (item) => !props.rows.some((row) => row.material_id === item.id),
    );
  } catch (error) {
    if (sequence === searchSequence) {
      candidates.value = [];
      ids.value = [];
      ElMessage.error("查询可用物资失败：" + (error as Error).message);
    }
  }
}
async function add() {
  if (loading.value) return;
  loading.value = true;
  try {
    const additions = await Promise.all(ids.value.map(async (id): Promise<MaterialDraft> => {
      const item = candidates.value.find((candidate) => candidate.id === id);
      if (!item) throw Error("部分已选物资不在当前搜索结果，请重新选择");
      const precision = await readCurrentMaterialPrecision(id);
      return {
        id: newClientId(),
        material_id: id,
        name: item.name,
        model: item.model,
        specification: item.specification,
        unit: item.unit_id_label,
        quantity_scaled: 10000,
        precision,
      };
    }));
    // Resolve every adopted unit before changing the parent form.
    for (const item of additions) emit("add", item);
    opening.value = false;
    ids.value = [];
  } catch (failure) {
    ElMessage.error((failure as Error).message);
  } finally {
    loading.value = false;
  }
}
</script>
<template>
  <div class="toolbar">
    <ElButton data-guide-action="demands.material"
      @click="
        opening = true;
        search();
      "
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
  <ElDialog
    v-model="opening"
    title="选择预计物资"
    append-to-body
    width="min(700px,94vw)"
  >
    <ElInput
      v-model="query"
      placeholder="搜索名称、规格型号"
      @change="search"
    />
    <ElSelect v-model="ids" multiple filterable placeholder="可选择多种物资"
      ><ElOption
        v-for="item in candidates"
        :key="item.id"
        :value="item.id"
        :label="item.name + ' ' + item.model + ' ' + item.specification"
    /></ElSelect>
    <template #footer
      ><ElButton @click="opening = false">取消</ElButton
      ><ElButton data-guide-action="demands.material-add-confirm"
        :loading="loading"
        :disabled="!ids.length"
        type="primary"
        @click="add"
        >添加物资</ElButton
      ></template
    >
  </ElDialog>
</template>

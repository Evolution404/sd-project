import { computed, shallowRef, watch, type Ref } from "vue";
import { ElMessage } from "element-plus";

export function usePageSelection<T extends { id: string; deleted?: boolean }>(
  pageRows: Ref<T[]>, filterKey: () => string,
) {
  const records = shallowRef(new Map<string, T>());
  const selected = computed(() => [...records.value.values()]);
  const selectedIds = computed(() => [...records.value.keys()]);
  const eligibleIds = computed(() => selected.value.filter(row => !row.deleted).map(row => row.id));

  function clear() { records.value = new Map(); }
  watch(filterKey, () => {
    if (!records.value.size) return;
    clear();
    ElMessage.info("筛选已变化，已清空原有选中项");
  }, { flush: "sync" });

  function updatePage(picked: T[]) {
    const updated = new Map(records.value);
    for (const row of pageRows.value) updated.delete(row.id);
    for (const row of picked) updated.set(row.id, row);
    records.value = updated;
  }
  return { selected, selectedIds, eligibleIds, clear, updatePage };
}

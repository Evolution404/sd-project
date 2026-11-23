import { computed, inject, onMounted, provide, shallowRef, watch, type InjectionKey, type Ref } from "vue";
import { ElMessage } from "element-plus";

type Selectable = { id: string; deleted?: boolean };
const selectionMemory = Symbol() as InjectionKey<Map<string, { filter: string; rows: Selectable[] }>>;

export function providePageSelections() {
  const selections = new Map<string, { filter: string; rows: Selectable[] }>();
  provide(selectionMemory, selections);
  return () => selections.clear();
}

export function usePageSelection<T extends Selectable>(
  pageRows: Ref<T[]>, filterKey: () => string, listKey?: string,
) {
  const records = shallowRef(new Map<string, T>());
  const selected = computed(() => [...records.value.values()]);
  const selectedIds = computed(() => [...records.value.keys()]);
  const eligibleIds = computed(() => selected.value.filter(row => !row.deleted).map(row => row.id));
  const memory = inject(selectionMemory, null);
  if (listKey && memory) {
    onMounted(() => {
      const saved = memory.get(listKey);
      if (saved?.filter === filterKey()) {
        // Each key is owned by a single list and its row type.
        records.value = new Map((saved.rows as T[]).map(row => [row.id, row]));
      } else memory.delete(listKey);
    });
    watch(records, () => {
      if (records.value.size) memory.set(listKey, { filter: filterKey(), rows: [...records.value.values()] });
      else memory.delete(listKey);
    }, { flush: "sync" });
  }

  function clear() { records.value = new Map(); }
  watch(filterKey, () => {
    if (!records.value.size) return;
    clear();
    ElMessage.info("筛选已变化，已清空原有选中项");
  }, { flush: "sync" });
  watch(pageRows, freshRows => {
    if (!records.value.size) return;
    const refreshed = new Map(records.value);
    for (const row of freshRows) if (refreshed.has(row.id)) refreshed.set(row.id, row);
    records.value = refreshed;
  });

  function remove(ids: string[]) {
    const remaining = new Map(records.value);
    for (const id of ids) remaining.delete(id);
    records.value = remaining;
  }

  function updatePage(picked: T[]) {
    const updated = new Map(records.value);
    for (const row of pageRows.value) updated.delete(row.id);
    for (const row of picked) updated.set(row.id, row);
    records.value = updated;
  }
  return { selected, selectedIds, eligibleIds, clear, remove, updatePage };
}

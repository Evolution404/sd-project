import { ref, onUnmounted } from "vue";
import { onBeforeRouteUpdate } from "vue-router";
import type { Ref } from "vue";
import type { Row } from "../api/client";

export function useEntityDialog(detail: Ref<Row | null>, fetchEntity: (id: string) => Promise<Row>, resetTransient: () => void) {
  const isOpen = ref(false), loading = ref(false), error = ref("");
  let sequence = 0, currentId = "";
  async function open(id: string) {
    const current = ++sequence;
    currentId = id;
    resetTransient();
    detail.value = null;
    error.value = "";
    isOpen.value = true;
    loading.value = true;
    try {
      const value = await fetchEntity(id);
      if (current === sequence) detail.value = value;
    } catch (failure) {
      if (current === sequence) error.value = (failure as Error).message;
    } finally {
      if (current === sequence) loading.value = false;
    }
  }
  function close() {
    sequence++;
    isOpen.value = false;
    detail.value = null;
    resetTransient();
  }
  onBeforeRouteUpdate((to, from) => { if (to.params.kind !== from.params.kind) close(); });
  onUnmounted(() => { sequence++; });
  return { isOpen, loading, error, open, close, reload: () => open(currentId) };
}

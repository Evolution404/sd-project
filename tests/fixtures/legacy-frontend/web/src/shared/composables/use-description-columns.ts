import { ref, onMounted, onUnmounted } from "vue";

export function useDescriptionColumns() {
  const columns = ref(2);
  let observer: ResizeObserver | undefined;
  onMounted(() => {
    const workspace = document.querySelector(".workspace");
    if (!workspace) return;
    observer = new ResizeObserver(entries => {
      columns.value = entries[0]!.contentRect.width < 780 ? 1 : 2;
    });
    observer.observe(workspace);
  });
  onUnmounted(() => observer?.disconnect());
  return columns;
}

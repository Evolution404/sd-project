import { onDeactivated, onBeforeUnmount, type Ref } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate } from "vue-router";
import { listRouteIdentity } from "@/components/Crud/utils/list-state";

/**
 * Page-owned native floating layers. Cleanup happens only on actual
 * deactivation/unmount, not on a proposed (possibly cancelled) navigation.
 * The component owns its model values and any outstanding read sequences.
 */
export function usePageOverlays(
  layers: readonly Ref<boolean>[],
  options: { invalidate?: () => void; mayLeave?: () => boolean | Promise<boolean> } = {},
) {
  if (options.mayLeave) {
    onBeforeRouteLeave(options.mayLeave);
    onBeforeRouteUpdate((to, from) =>
      listRouteIdentity(to.fullPath) === listRouteIdentity(from.fullPath)
        ? true : options.mayLeave!());
  }
  const close = () => {
    for (const layer of layers) layer.value = false;
    options.invalidate?.();
  };
  onDeactivated(close);
  onBeforeUnmount(close);
  return close;
}

import { nextTick, onUnmounted } from "vue";
import { useRoute, useRouter, type RouteLocationRaw } from "vue-router";

export function useWorkRoute() {
  const route = useRoute(), router = useRouter();
  const origins = new Map<string, { path: string; scroll: number }>();
  const stop = router.afterEach(async (to, from, failure) => {
    const previous = origins.get(from.fullPath);
    if (!failure && previous?.path === to.fullPath) {
      await nextTick();
      window.scrollTo(0, previous.scroll);
    }
  });
  onUnmounted(stop);

  async function enter(target: RouteLocationRaw) {
    const destination = router.resolve(target).fullPath;
    const origin = { path: route.fullPath, scroll: window.scrollY };
    if (destination === origin.path) return;
    origins.set(destination, origin);
    const failure = await router.push(target);
    if (!failure) window.scrollTo(0, 0);
    else origins.delete(destination);
  }

  async function exit(fallback: RouteLocationRaw) {
    const previous = origins.get(route.fullPath);
    const target = previous?.path ?? router.resolve(fallback).fullPath;
    if (router.options.history.state.back !== target) {
      await router.replace(target);
      return;
    }
    await new Promise<void>(resolve => {
      const remove = router.afterEach(() => { remove(); resolve(); });
      router.back();
    });
  }

  return { enter, exit };
}

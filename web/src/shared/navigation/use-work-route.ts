import { inject, nextTick, onUnmounted, provide, type InjectionKey } from "vue";
import { useRoute, useRouter, type RouteLocationRaw } from "vue-router";

interface WorkOrigin { path: string; scroll: number }
function workNavigation() {
  const route = useRoute(), router = useRouter();
  const origins = new Map<string, WorkOrigin>();
  let pendingScroll: WorkOrigin | undefined;

  async function restoreScroll(listReady = true) {
    await nextTick();
    const origin = pendingScroll;
    if (!origin || route.fullPath !== origin.path) return;
    const documentRoot = document.scrollingElement;
    if (!listReady && documentRoot && documentRoot.scrollHeight - documentRoot.clientHeight < origin.scroll) return;
    pendingScroll = undefined;
    window.scrollTo(0, origin.scroll);
  }
  onUnmounted(router.afterEach((to, from, failure) => {
    if (failure) return;
    const previous = origins.get(from.fullPath);
    if (previous?.path === to.fullPath) {
      origins.delete(from.fullPath);
      pendingScroll = previous;
      void restoreScroll(false);
    } else if (pendingScroll?.path !== to.fullPath) pendingScroll = undefined;
  }));

  async function enter(target: RouteLocationRaw, originPath = route.fullPath) {
    const destination = router.resolve(target).fullPath;
    if (destination === route.fullPath) return;
    origins.set(destination, { path: originPath, scroll: window.scrollY });
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

  return { enter, exit, restoreScroll, clear: () => {
    origins.clear();
    pendingScroll = undefined;
  } };
}

const workNavigationKey = Symbol() as InjectionKey<ReturnType<typeof workNavigation>>;
export function provideWorkNavigation() {
  const navigation = workNavigation();
  provide(workNavigationKey, navigation);
  return navigation.clear;
}

export function useWorkRoute() {
  return inject(workNavigationKey, null) ?? workNavigation();
}

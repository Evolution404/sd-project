import { watch, type Ref } from "vue";
import { useRoute, useRouter, type LocationQueryRaw } from "vue-router";

type QueryState = Record<string, Ref<string | number | boolean | Record<string, string>>>;
// URL query holds view state only. Mutation forms remain local until saved.
export function useListRoute(state: QueryState, refresh: () => unknown) {
  const route = useRoute(), router = useRouter();
  const defaults = Object.fromEntries(Object.entries(state).map(([key, value]) => [key, value.value]));
  let restoring = false;
  function restore() {
    let changed = false;
    restoring = true;
    for (const [key, target] of Object.entries(state)) {
      const raw = route.query[key], fallback = defaults[key];
      let value = fallback;
      if (typeof raw === "string") {
        if (typeof fallback === "number") value = /^\d+$/.test(raw) && Number(raw) > 0 && Number.isSafeInteger(Number(raw)) ? Number(raw) : fallback;
        else if (typeof fallback === "boolean") value = raw === "true";
        else if (typeof fallback === "object") {
          try {
            const parsed = JSON.parse(raw);
            if (parsed && !Array.isArray(parsed) && typeof parsed === "object"
              && Object.values(parsed).every(item => typeof item === "string")) value = parsed;
          } catch { /* Invalid view preferences fall back to the initial state. */ }
        } else value = raw;
      }
      if (JSON.stringify(target.value) !== JSON.stringify(value)) {
        target.value = value;
        changed = true;
      }
    }
    restoring = false;
    return changed;
  }
  restore();
  watch(() => route.query, () => { if (restore()) void refresh(); }, { flush: "sync" });
  watch(Object.values(state), () => {
    if (restoring) return;
    const query: LocationQueryRaw = { ...route.query };
    for (const [key, value] of Object.entries(state)) {
      const serialized = typeof value.value === "object" ? JSON.stringify(value.value) : String(value.value);
      if (serialized === (typeof defaults[key] === "object" ? JSON.stringify(defaults[key]) : String(defaults[key]))) delete query[key];
      else query[key] = serialized;
    }
    void router.replace({ query });
  }, { deep: true, flush: "sync" });
}

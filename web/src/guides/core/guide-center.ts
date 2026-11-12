import type { InjectionKey } from "vue";

/** Context-provided read-only help opener; no global events or business actions. */
export const guideCenterKey: InjectionKey<() => void> = Symbol("guide-center");

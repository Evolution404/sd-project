import type { Component, InjectionKey } from "vue";
export const referenceSelectorsKey: InjectionKey<
  Readonly<Record<string, Component>>
> = Symbol("reference-selectors");

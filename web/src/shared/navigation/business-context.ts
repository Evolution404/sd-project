import type { RouteLocationNormalizedLoaded, RouteLocationRaw, Router } from "vue-router";

/** Shared URL protocol for cross-module business context; no second state store. */
export type ProjectSection = "overview" | "scope" | "approval" | "finance" | "history";
export type BusinessFocus = "demand" | "funding" | "cost" | "settlement" | "reconciliation";

export function projectFinanceContext(projectId: string, returnTo: string, focus?: { kind: BusinessFocus; id: string }): RouteLocationRaw {
  return { name: "projects", params: { projectId, work: "finance", recordId: "", recordAction: "" },
    query: { returnTo, ...(focus ? { focus: focus.kind, record: focus.id } : {}) } };
}

export function projectContext(
  projectId: string, section: ProjectSection = "overview",
  target?: { focus: BusinessFocus; record: string },
): RouteLocationRaw {
  return {
    name: "projects",
    query: {
      project: projectId, tab: section,
      ...(target ? { focus: target.focus, record: target.record } : {}),
    },
  };
}
export function demandContext(demandId: string): RouteLocationRaw {
  return { name: "demands", query: { demand: demandId } };
}
export function fundContext(kind: "frameworks" | "agreements", recordId: string): RouteLocationRaw {
  return { name: kind, query: { record: recordId } };
}
export function createProjectForDemand(demandId: string): RouteLocationRaw {
  return { name: "projects", query: { action: "create", demand: demandId } };
}

/** Resume the originating task without inventing separate navigation protocols. */
export function setupContext(route: Pick<RouteLocationNormalizedLoaded, "fullPath">,
  target: "operations" | "objects" | "units" | "physical"): RouteLocationRaw {
  if (target === "units")
    return { name: "dictionaries", params: { kind: "units" },
      query: { returnTo: route.fullPath } };
  if (target === "physical")
    return { name: "ledger", params: { kind: "physical" },
      query: { returnTo: route.fullPath } };
  return { name: "standards", params: { kind: target },
    query: { returnTo: route.fullPath } };
}
export function resumeTask(router: Router, original: string): void {
  const resolved = router.resolve(original);
  if (!resolved.matched.length) return;
  void router.push({ name: resolved.name || undefined,
    params: resolved.params, query: { ...resolved.query, resume: "demand" } });
}

/** Transient, tab-local task handoff, never stored in business database or localStorage. */
export interface DemandDraftHandoff {
  form: Record<string, unknown>;
  lineIds: Array<string | null>;
}
let parked: DemandDraftHandoff | null = null;
export function parkDemandDraft(draft: DemandDraftHandoff) {
  parked = structuredClone(draft);
}
export function takeDemandDraft(): DemandDraftHandoff | null {
  const current = parked;
  parked = null;
  return current;
}

/** The same native query field is reused for each supported history list. */
export const historyScopeGuideIds = [
 "demands.show-deleted","projects.show-deleted","ledger.show-deleted",
 "finance.show-deleted","finance.reconcile-show-deleted","materials.show-deleted",
 "pricing.show-deleted","standards.show-deleted","frameworks.show-deleted","agreements.show-deleted",
] as const;
export type HistoryScopeGuideId=typeof historyScopeGuideIds[number];

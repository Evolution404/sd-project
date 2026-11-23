import type { FinanceSummary } from "../../../../../server/shared/types/finance-api";

/** UI read projections: derived from Schema113 formal facts, never persisted. */
export interface ProjectApprovedSnapshot {
  version_no: number;
  approved_budget_fen: number;
}
export interface ProjectOverviewFacts {
  id: string;
  status: string;
  deleted: boolean;
  framework_id: string;
  agreement_id: string | null;
  scopes: Array<{ binding: unknown }>;
  approval: ProjectApprovedSnapshot | null;
  planned_end_on: string | null;
  planned_start_on: string | null;
  category_name: string | null;
  managing_unit_name: string | null;
  owner_username: string | null;
  manager_username: string | null;
  preliminary_estimate_fen: number | null;
}
export interface ProjectClosePositionFact {
  project_scope_id: string;
  demand_id: string;
  demand_no: string;
  location_item_no: number;
  demand_location_id: string;
  location_name: string;
  approved_quantity_scaled: number;
  resolved_quantity_scaled: number;
  remaining_quantity_scaled: number;
  demand_remaining_quantity_scaled: number;
}
export type ProjectFinanceSnapshot = FinanceSummary & {
  /** Only supplied by formal closure preview, not ordinary finance summary. */
  locations?: ProjectClosePositionFact[];
};
export type ProjectCloseDemandFact = FinanceSummary["demands"][number];
export interface ProjectReference { id: string; name: string }

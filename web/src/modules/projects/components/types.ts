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
export interface ProjectCloseDemandFact {
  demand_no: string;
  approved_quantity_scaled: number;
  resolved_quantity_scaled: number;
  remaining_quantity_scaled: number;
  excess_quantity_scaled: number;
}
export interface ProjectFinanceSnapshot {
  actual_cost_fen: number;
  settlement_fen: number;
  unreconciled_cost_fen: number;
  budget_difference_fen: number | null;
  demands: ProjectCloseDemandFact[];
}
export interface ProjectReference { id: string; name: string }

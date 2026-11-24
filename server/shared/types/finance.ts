export type FinanceListKind = "costs" | "settlements" | "reconciliations";
/** Read-only cross-project finance detail projection (business fields only). */
export interface FinanceSettlementLine {
  amount_fen: number | null;
  quantity_scaled: number | null;
  evidence: string | null;
}
export interface FinanceRecordDetail {
  version_no?: number | null;
  evidence?: string | null;
  reconciled_cost_fen?: number | null;
  review?: { action: string } | null;
  items?: FinanceSettlementLine[];
  resolutions?: { resolved_quantity_scaled: number; evidence: string }[];
}

export interface FinanceListItem {
  id: string;
  project_id: string;
  project_name: string;
  project_code: string;
  label: string;
  amount_fen: number | null;
  effective_amount_fen?: number | null;
  is_final?: number;
  occurred_on: string | null;
  status: string;
  version_no: number | null;
  deleted: boolean;
}

export type FundingKind = "frameworks" | "agreements";
export interface FundingRecord {
  id: string;
  code: string;
  name: string;
  fiscal_year?: number;
  framework_id?: string;
  framework_id_label?: string;
  version_no: number;
  limit_fen: number;
  status: "active" | "inactive";
  contract_number?: string | null;
  counterparty_name?: string | null;
  signed_on?: string | null;
  effective_from?: string | null;
  effective_to?: string | null;
  created_at: string;
  deleted: number | boolean;
  label?: string;
}
export interface FundingProject {
  id: string;
  code: string;
  name: string;
  status: string;
  framework_id: string;
  agreement_id: string | null;
  approved_budget_fen: number | null;
  actual_cost_fen: number;
  settlement_fen: number;
}
export interface FundingVersion {
  id: string;
  version_no: number;
  name: string;
  status: string;
  limit_fen: number;
  [field: string]: unknown;
}

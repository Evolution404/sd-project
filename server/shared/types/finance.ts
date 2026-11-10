export type FinanceListKind = "costs" | "settlements" | "reconciliations";
export interface FinanceListItem {
  id: string;
  project_id: string;
  project_name: string;
  project_code: string;
  label: string;
  amount_fen: number | null;
  occurred_on: string | null;
  status: string;
  version_no: number | null;
  deleted: boolean;
}

/** Explicit finance business facts and commands; amounts are integer fen and quantities 1e4-fixed. */
export type CostStatus = "active" | "voided";
export type SettlementReviewAction = "approve" | "return" | "reject";
export type ReconciliationStatus = "active" | "voided";
export interface CostNodeCurrent {
  id: string;
  project_id: string;
  current_version_id: string;
  version_no: number;
  parent_id: string | null;
  name: string;
  status: "active" | "inactive";
  deleted?: boolean;
}
export interface CostNodeInput {
  name: string;
  parent_id?: string | null;
  status?: "active" | "inactive";
  expected_version?: number;
  reason?: string;
}
export interface ActualCostInput {
  expected_version?: number;
  cost_node_id?: string;
  status?: CostStatus;
  title: string;
  occurred_on: string;
  amount_fen: number;
  invoice_number?: string | null;
  evidence: string;
  request_key?: string;
  reason?: string;
}
export interface ActualCostVersion {
  id: string;
  entry_id: string;
  version_no: number;
  cost_node_version_id: string;
  funding_version_id: string | null;
  status: CostStatus;
  title: string;
  occurred_on: string;
  amount_fen: number;
  invoice_number: string | null;
  evidence: string;
  confirmed_by: string;
  confirmed_at: string;
  request_key: string;
  reason: string;
}
export interface CostEntry {
  id: string;
  project_id: string;
  cost_node_id: string;
  created_by: string;
  created_at: string;
}
export interface SettlementItemInput {
  cost_node_id: string;
  project_scope_id?: string | null;
  quantity_scaled?: number;
  amount_fen: number;
  unit_price_fen?: number | null;
  work_mode?: string | null;
  evidence?: string;
}
export interface SettlementResolutionInput {
  project_scope_id: string;
  resolved_quantity_scaled: number;
  evidence?: string;
}
export interface SettlementDraftInput {
  approval_version_id?: string;
  funding_version_id?: string | null;
  number?: string;
  project_id?: string;
  expected_version?: number;
  expected_edit_version?: number;
  change_type?: "void" | "initial" | "revision";
  basis?: string;
  reason?: string;
  settlement_on?: string | null;
  items?: SettlementItemInput[];
  resolutions?: SettlementResolutionInput[];
}
export interface NormalizedSettlementDraft extends Omit<SettlementDraftInput, "items" | "resolutions"> {
  items: SettlementItemInput[];
  resolutions: SettlementResolutionInput[];
  approval_version_id: string;
  funding_version_id: string | null;
}
export interface SettlementRoot {
  id: string;
  project_id: string;
  number: string;
  created_by: string;
  created_at: string;
}
export interface SettlementVersion {
  id: string;
  settlement_id: string;
  version_no: number;
  previous_version_id: string | null;
  approval_version_id: string;
  funding_version_id: string | null;
  change_type: "void" | "initial" | "revision";
  reason: string;
  basis: string;
  settlement_on: string | null;
  created_by: string;
  recorded_at: string;
}
export interface SettlementDraftRow {
  settlement_id: string;
  based_on_version_id: string | null;
  draft_json: string;
  edit_version: number;
  updated_by: string;
  updated_at: string;
}
export interface SettlementReviewEvent {
  id: string;
  settlement_version_id: string;
  event_seq: number;
  action: "submit" | "approve" | "return" | "reject";
  actor_id: string;
  recorded_at: string;
  effective_on?: string | null;
  reason?: string;
}
export interface SettlementWorkflow {
  id: string;
  project_id: string;
  number: string;
  version: SettlementVersion | null;
  draft: (SettlementDraftRow & { document: NormalizedSettlementDraft }) | null;
  review: SettlementReviewEvent | null;
  items: object[];
  resolutions: object[];
}
export interface SettlementSubmitInput {
  expected_version: number;
  expected_edit_version: number;
}
export interface SettlementResubmitInput {
  expected_version: number;
  expected_event_seq: number;
}
export interface SettlementReviewInput {
  expected_version: number;
  expected_event_seq: number;
  action: SettlementReviewAction;
  effective_on?: string | null;
  reason?: string;
}
export interface ReconciliationInput {
  record_id?: string;
  expected_version?: number;
  status?: ReconciliationStatus;
  settlement_item_version_id?: string;
  cost_version_id?: string;
  reconciled_cost_fen?: number;
  reconciled_settlement_fen?: number;
  is_final?: boolean;
  evidence?: string;
  request_key?: string;
}
export interface ReconciliationVersion {
  id: string;
  record_id: string;
  version_no: number;
  status: ReconciliationStatus;
  cost_version_id: string;
  settlement_item_id: string;
  settlement_item_version_id: string;
  reconciled_cost_fen: number;
  reconciled_settlement_fen: number;
  is_final: number;
  evidence: string;
  actor_id: string;
  created_at: string;
  request_key: string;
}

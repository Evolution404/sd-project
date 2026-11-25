/** Project lifecycle contracts are business facts, not generic database rows. */
export type ProjectStage = "reserve" | "stocked" | "approved" | "closed";
export type ProjectApprovalStatus = "draft" | "approved" | "withdrawn";
export interface ProjectIdentity {
  id: string;
  code: string;
  framework_id: string;
  status: ProjectStage;
  version: number;
  created_by: string;
  created_at: string;
}
export interface ProjectProfileVersion {
  id: string;
  project_id: string;
  version_no: number;
  name: string;
  /** Formal snapshot for reserve-stage framework changes. */
  framework_id: string | null;
  category_id: string | null;
  category_version: number | null;
  owner_id: string | null;
  manager_id: string | null;
  managing_unit_id: string | null;
  managing_unit_version_id: string | null;
  planned_start_on: string | null;
  planned_end_on: string | null;
  preliminary_estimate_fen: number | null;
  preliminary_estimate_basis: string | null;
  reason: string;
  actor_id: string;
  recorded_at: string;
}
export interface ProjectFundingVersion {
  id: string;
  project_id: string;
  version_no: number;
  agreement_id: string | null;
  reason: string;
  actor_id: string;
  recorded_at: string;
}
export interface ProjectApprovalVersion {
  id: string;
  project_id: string;
  version_no: number;
  change_order_id: string | null;
  snapshot_json: string;
  approved_budget_fen: number;
  status: ProjectApprovalStatus;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}
export interface ProjectManagementInput {
  name?: string;
  framework_id?: string;
  /** Optional agreement: null deliberately leaves the project unassigned. */
  agreement_id?: string | null;
  expected_funding_version?: number;
  expected_version?: number;
  category_id?: string | null;
  managing_unit_id?: string | null;
  owner_id?: string | null;
  manager_id?: string | null;
  planned_start_on?: string | null;
  planned_end_on?: string | null;
  preliminary_estimate_fen?: number | null;
  preliminary_estimate_basis?: string | null;
  reason?: string;
}
export const MAX_PROJECT_PROFILE_BATCH = 100;
export interface ProjectProfileBatchRow {
  ref: string;
  id?: string;
  values: ProjectManagementInput;
}
export interface ProjectProfileBatchIssue {
  ref: string;
  field?: string;
  message: string;
}
export interface ProjectProfileBatchPreview {
  count: number;
  issues: ProjectProfileBatchIssue[];
  fingerprint?: string;
}

export interface ProjectFromDemandInput extends ProjectManagementInput {
  demand_id: string;
  expected_demand_version: number;
}
export interface ProjectApprovedLocationInput {
  location_item_no: number;
  approved_quantity_scaled: number;
}
export interface ProjectApprovedMaterialInput {
  material_id: string;
  quantity_scaled: number;
}
export interface ProjectApprovalScopeInput {
  project_scope_id?: string;
  demand_id?: string;
  demand_version: number;
  expected_material_versions?: Record<string, string>;
  approved_amount_fen?: number | null;
  locations: ProjectApprovedLocationInput[];
  materials?: ProjectApprovedMaterialInput[];
}
export interface ProjectApprovalInput {
  expected_version: number;
  expected_approval_version_id?: string | null;
  approved_budget_fen: number;
  scopes: ProjectApprovalScopeInput[];
  confirm_changes?: boolean;
  basis?: string;
  reason?: string;
}
export interface ProjectVersionAction {
  expected_version: number;
  reason?: string;
}
export interface ProjectLinkInput {
  demand_id: string;
  expected_version: number;
  reason?: string;
}
export interface ProjectLinkBatchInput {
  links: ProjectLinkInput[];
}
export interface ProjectReleaseInput {
  expected_event_seq: number;
  reason?: string;
}
export interface ProjectFundingInput extends ProjectVersionAction {
  agreement_id?: string | null;
}
export interface ProjectAgreementUsage {
  projects: number;
  approved_budget_fen: number;
}
export interface ProjectAgreementOption {
  id: string;
  code: string;
  name: string;
  framework_id: string;
  status: string;
  counterparty_name?: string | null;
  contract_number?: string | null;
  effective_from: string | null;
  effective_to: string | null;
  deleted: boolean;
  eligible: boolean;
  limit_fen: number;
  linked_projects_count: number;
  linked_approved_budget_fen: number;
  budget_difference_fen: number;
}

export interface ProjectApprovalCandidateProposal extends ProjectApprovalScopeInput {
  demand_id: string;
  expected_material_versions: Record<string, string>;
  snapshot: import("./demands.js").DemandRecord;
}

/** List projection contains the current ownership identity without full event history. */
export interface ProjectScopeListItem {
  id: string;
  project_id: string;
  demand_id: string;
  demand_no: string;
  demand_status: string;
  binding: {project_scope_id:string; project_id:string; demand_id:string} | null;
}

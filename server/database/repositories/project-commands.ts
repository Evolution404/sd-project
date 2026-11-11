import type { Store } from "./store.js";
import type { ProjectIdentity, ProjectProfileVersion, ProjectFundingVersion,
  ProjectApprovalVersion } from "../../shared/types/projects.js";
import type { ProjectScopeMaterialLink } from "./projects.js";

export interface ProjectStageEventWrite {
  id: string; project_id: string; stage: "stocked" | "approved" | "closed";
  project_version: number; actor_id: string; created_at: string;
  reason?: string;
}
export interface ChangeOrderWrite {
  id: string; project_id: string; code: string;
  base_approval_version_id: string; proposal_json: string;
  created_by: string; created_at: string; reason: string;
}
export interface ApprovalScopeWrite {
  id: string; approval_version_id: string; project_scope_id: string;
  demand_id: string; demand_version: number; quantity_scaled: number;
  approved_amount_fen: number | null; snapshot_json: string; created_at: string;
}
export interface ApprovalPositionWrite {
  approval_scope_version_id: string; demand_id: string; demand_version: number;
  location_item_no: number; approved_quantity_scaled: number;
}
export interface ApprovalMaterialWrite {
  id: string; approval_version_id: string; project_scope_id: string;
  project_material_id: string; material_version_id: string; item_no: number;
  material_code_snapshot: string; material_name: string; material_model: string;
  specification: string; approved_quantity_scaled: number; unit_id: string;
  unit_version: number; unit_snapshot: string;
}
export interface DemandScopeWrite {
  id: string; project_id: string; demand_id: string; demand_version: number;
  proposed_quantity_scaled: number; created_by: string; created_at: string;
  updated_at: string; demand_snapshot_json: string;
}
export interface DemandLinkEventWrite {
  id: string; project_scope_id: string; event_seq: number;
  action: "linked" | "released"; actor_id: string; recorded_at: string; reason: string;
}
export interface ApprovalDecisionWrite {
  status: "approved" | "withdrawn";
  approved_by?: string; approved_at?: string;
}
export interface ChangeDecisionWrite {
  status: "approved" | "rejected";
  decided_by: string; decided_at: string; decision_reason: string;
}

/** Project-only named writes. The application no longer performs generic table mutations. */
export function projectCommandRepository(store: Store) {
  return {
    createProject(row: Pick<ProjectIdentity,
      "id" | "code" | "framework_id" | "created_by" | "created_at">): void {
      store.insert("projects",row);
    },
    appendProfile(row: ProjectProfileVersion): void {
      store.insert("project_management_versions",row);
    },
    appendStage(row: ProjectStageEventWrite): void {
      store.insert("project_stage_events",row);
    },
    proposeChange(row: ChangeOrderWrite): void {
      store.insert("project_change_orders",row);
    },
    createApproval(row: Pick<ProjectApprovalVersion,
      "id" | "project_id" | "version_no" | "change_order_id" |
      "snapshot_json" | "approved_budget_fen" | "created_at">): void {
      store.insert("project_approval_versions",row);
    },
    appendApprovalScope(row: ApprovalScopeWrite): void {
      store.insert("project_approval_scope_versions",row);
    },
    appendApprovalPosition(row: ApprovalPositionWrite): void {
      store.insert("project_approval_work_locations",row);
    },
    createProjectMaterial(row: ProjectScopeMaterialLink): void {
      store.insert("project_scope_materials",row);
    },
    appendApprovedMaterial(row: ApprovalMaterialWrite): void {
      store.insert("project_approval_material_items",row);
    },
    createDemandScope(row: DemandScopeWrite): void {
      store.insert("project_demand_scopes",row);
    },
    appendDemandLink(row: DemandLinkEventWrite): void {
      store.insert("project_demand_link_events",row);
    },
    appendFunding(row: Pick<ProjectFundingVersion,
      "id" | "project_id" | "version_no" | "agreement_id" |
      "actor_id" | "recorded_at" | "reason">): void {
      store.insert("project_funding_versions",row);
    },
    decideChange(id: string, decision: ChangeDecisionWrite): void {
      store.update("project_change_orders","id",id,decision);
    },
    decideApproval(id: string, decision: ApprovalDecisionWrite): void {
      store.update("project_approval_versions","id",id,decision);
    },
  };
}
export type ProjectCommandRepository = ReturnType<typeof projectCommandRepository>;

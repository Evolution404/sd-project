import type { createStore } from "./store.js";
import type { ProjectIdentity, ProjectProfileVersion, ProjectFundingVersion,
  ProjectApprovalVersion } from "../../shared/types/projects.js";

type Store = Pick<ReturnType<typeof createStore>, "query" | "get">;

export interface CurrentProjectBinding {
  project_scope_id: string;
  project_id: string;
  demand_id: string;
  link_event_id: string;
  linked_by: string;
  linked_at: string;
}
export interface ProjectScopeProjection {
  id: string;
  project_id: string;
  demand_id: string;
  demand_version: number;
  proposed_quantity_scaled: number;
  proposed_amount_fen: number | null;
  note: string;
  created_at: string;
  demand_no: string;
  demand_status: string;
  binding: CurrentProjectBinding | null;
}

export interface ProjectScopeMaterialLink {
  id: string;
  project_scope_id: string;
  material_id: string;
  created_at: string;
}
interface ScopeRow extends Omit<ProjectScopeProjection, "binding"> {
  binding_json: string | null;
}
export interface ApprovedMaterialSnapshot {
  id: string;
  approval_version_id: string;
  project_scope_id: string;
  material_id: string;
  material_version_id: string;
  project_material_id: string;
  approved_quantity_scaled: number;
  item_no: number;
  unit_id: string;
  unit_version: number;
  unit_snapshot: string;
}
export interface ApprovedLocationSnapshot {
  approval_scope_version_id: string;
  location_item_no: number;
  approved_quantity_scaled: number;
}
interface ApprovedScopeRow {
  id: string;
  approval_version_id: string;
  project_scope_id: string;
  demand_id: string;
  demand_version: number;
  quantity_scaled: number;
  approved_amount_fen: number | null;
  demand_no: string;
}
export interface ApprovedScope extends ApprovedScopeRow {
  materials: ApprovedMaterialSnapshot[];
  locations: ApprovedLocationSnapshot[];
}
export interface ProjectApprovalHistory extends ProjectApprovalVersion {
  scopes: ApprovedScope[];
}
export interface ProjectCostNode {
  id: string;
  project_id: string;
  parent_id: string | null;
  current_version_id: string;
  version_no: number;
  name: string;
  status: "active" | "inactive";
  deleted: boolean;
}

export interface ApprovalCandidate {
  project_scope_id: string;
  id: string;
  current_version: number;
  demand_no: string;
  status: string;
  work_locations: Array<{
    location_snapshot_json: {
      location_label?: string; physical_code?: string; tower_no?: string
    };
    quantity_scaled: number;
    span_id?: string | null;
    [field: string]: unknown;
  }>;
}
interface ApprovalCandidateRow {
  project_scope_id: string;
  id: string;
  current_version: number;
  demand_no: string;
  status: string;
  full_definition_json: string;
}
export interface ProjectDashboardBase {
  id: string;
  code: string;
  name: string;
  status: string;
  framework_id: string;
  planned_end_on: string | null;
  approval_version_id: string | null;
  approved_budget_fen: number | null;
}

export interface ProjectChangeOrderRow {
  id:string; project_id:string; code:string; base_approval_version_id:string;
  proposal_json:string; created_by:string; created_at:string; reason:string;
  status:string; decided_by:string|null; decided_at:string|null; decision_reason:string;
}
export interface ProjectAccountRow {
  id:string; username:string; status:string; deleted:number;
}
export interface OrganizationVersionRow {
  id:string; unit_id:string; version_no:number; name:string;
  parent_unit_id:string|null; status:string;
}
export interface AgreementUsageTotals {
  agreement_id:string; projects:number; approved_budget_fen:number;
}
export function projectReadRepository(store: Store) {
  return {
    /** One read for all existing scope-material identities in a new approval. */
    projectIdentity(id:string):ProjectIdentity|undefined {
      return store.get<ProjectIdentity>("SELECT * FROM projects WHERE id=?",id);
    },
    projectDeleted(id:string):boolean {
      return Boolean(store.get("SELECT 1 FROM audit_events WHERE entity='projects' AND entity_id=? AND action='delete' LIMIT 1",id));
    },
    deletedProjectIds():Set<string> {
      return new Set(store.query<{entity_id:string}>(
        "SELECT entity_id FROM audit_events WHERE entity='projects' AND action='delete'").map(row=>row.entity_id));
    },
    latestProjectProfile(projectId:string):ProjectProfileVersion|undefined {
      return store.get<ProjectProfileVersion>(
        "SELECT * FROM project_management_versions WHERE project_id=? ORDER BY version_no DESC LIMIT 1",projectId);
    },
    latestApprovedProject(projectId:string):ProjectApprovalVersion|undefined {
      return store.get<ProjectApprovalVersion>(
        "SELECT * FROM project_approval_versions WHERE project_id=? AND status='approved' ORDER BY version_no DESC LIMIT 1",projectId);
    },
    categoryVersionName(itemId:string,version:number):string|null {
      return store.get<{name:string}>(
        "SELECT name FROM dictionary_item_versions WHERE item_id=? AND version=?",itemId,version)?.name??null;
    },
    projectOrganizationVersion(id:string):OrganizationVersionRow|undefined {
      return store.get<OrganizationVersionRow>("SELECT * FROM organizational_unit_versions WHERE id=?",id);
    },
    projectAccount(id:string):ProjectAccountRow|undefined {
      return store.get<ProjectAccountRow>(`SELECT u.id,u.username,u.status,
        EXISTS(SELECT 1 FROM audit_events a WHERE a.entity='users' AND a.entity_id=u.id AND a.action='delete') AS deleted
        FROM users u WHERE u.id=?`,id);
    },
    latestProjectFunding(projectId:string):ProjectFundingVersion|undefined {
      return store.get<ProjectFundingVersion>(
        "SELECT * FROM project_funding_versions WHERE project_id=? ORDER BY version_no DESC LIMIT 1",projectId);
    },
    projectChanges(projectId:string):ProjectChangeOrderRow[] {
      return store.query<ProjectChangeOrderRow>(
        "SELECT * FROM project_change_orders WHERE project_id=? ORDER BY created_at,id",projectId);
    },
    latestDemandLinkEvent(scopeId:string):{event_seq:number}|undefined {
      return store.get<{event_seq:number}>(
        "SELECT event_seq FROM project_demand_link_events WHERE project_scope_id=? ORDER BY event_seq DESC LIMIT 1",scopeId);
    },
    agreementUsageTotals():AgreementUsageTotals[] {
      return store.query<AgreementUsageTotals>(`SELECT funding.agreement_id,
        COUNT(*) AS projects,COALESCE(SUM(approval.approved_budget_fen),0) AS approved_budget_fen
        FROM v_project_funding_current funding
        JOIN projects project ON project.id=funding.project_id
        LEFT JOIN v_project_current_approval approval ON approval.project_id=project.id
        WHERE funding.agreement_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM audit_events audit WHERE audit.entity='projects'
            AND audit.entity_id=project.id AND audit.action='delete'
        )
        GROUP BY funding.agreement_id`);
    },

    projectScopeMaterialLinks(scopeIds: readonly string[]): Map<string, ProjectScopeMaterialLink> {
      if (!scopeIds.length) return new Map();
      const links = store.query(`SELECT id,project_scope_id,material_id,created_at
        FROM project_scope_materials
        WHERE project_scope_id IN (SELECT value FROM json_each(?))`,
        JSON.stringify([...new Set(scopeIds)])) as ProjectScopeMaterialLink[];
      return new Map(links.map(link => [link.project_scope_id + ':' + link.material_id, link]));
    },
    projectScopes(projectId: string): ProjectScopeProjection[] {
      const rows = store.query(`SELECT sc.*, d.demand_no,
        COALESCE(dc.status, 'pending') AS demand_status,
        CASE WHEN b.project_scope_id IS NULL THEN NULL ELSE json_object(
          'project_scope_id', b.project_scope_id,
          'project_id', b.project_id,
          'demand_id', b.demand_id,
          'link_event_id', b.link_event_id,
          'linked_by', b.linked_by,
          'linked_at', b.linked_at) END AS binding_json
        FROM project_demand_scopes sc
        JOIN demands d ON d.id=sc.demand_id
        LEFT JOIN v_demand_current dc ON dc.id=sc.demand_id
        LEFT JOIN v_project_demand_binding_current b ON b.project_scope_id=sc.id
        WHERE sc.project_id=? ORDER BY sc.rowid`, projectId) as ScopeRow[];
      return rows.map(({ binding_json, ...scope }) => ({
        ...scope,
        binding: binding_json ? JSON.parse(binding_json) as CurrentProjectBinding : null,
      }));
    },
    projectApprovalHistory(projectId: string, currentOnly = false): ProjectApprovalHistory[] {
      // Only the current approval and pending draft are needed for live
      // actions. Historical approved versions load on explicit request.
      const current = currentOnly
        ? ` AND (ap.status='draft' OR (ap.status='approved' AND ap.version_no=(
            SELECT MAX(v.version_no) FROM project_approval_versions v
            WHERE v.project_id=ap.project_id AND v.status='approved')))`
        : "";
      const approvals = store.query(`SELECT ap.* FROM project_approval_versions ap
        WHERE ap.project_id=? AND ap.status<>'withdrawn' ${current} ORDER BY ap.version_no`, projectId) as
        ProjectApprovalVersion[];
      if (!approvals.length) return [];
      const scopes = store.query(`SELECT sc.*, d.demand_no FROM project_approval_scope_versions sc
        JOIN project_approval_versions ap ON ap.id=sc.approval_version_id
        JOIN demands d ON d.id=sc.demand_id
        WHERE ap.project_id=? AND ap.status<>'withdrawn' ${current} ORDER BY ap.version_no,sc.rowid`, projectId) as ApprovedScopeRow[];
      const materials = store.query(`SELECT item.*, pm.material_id FROM project_approval_material_items item
        JOIN project_approval_versions ap ON ap.id=item.approval_version_id
        JOIN project_scope_materials pm ON pm.id=item.project_material_id
        WHERE ap.project_id=? AND ap.status<>'withdrawn' ${current}
        ORDER BY ap.version_no,item.item_no`, projectId) as ApprovedMaterialSnapshot[];
      const locations = store.query(`SELECT loc.* FROM project_approval_work_locations loc
        JOIN project_approval_scope_versions sc ON sc.id=loc.approval_scope_version_id
        JOIN project_approval_versions ap ON ap.id=sc.approval_version_id
        WHERE ap.project_id=? AND ap.status<>'withdrawn' ${current}
        ORDER BY ap.version_no,loc.location_item_no`, projectId) as ApprovedLocationSnapshot[];
      const materialGroups = new Map<string, ApprovedMaterialSnapshot[]>();
      for (const item of materials) {
        const key = `${item.approval_version_id}:${item.project_scope_id}`;
        const group = materialGroups.get(key) || [];
        group.push(item);
        materialGroups.set(key, group);
      }
      const locationGroups = new Map<string, ApprovedLocationSnapshot[]>();
      for (const loc of locations) {
        const group = locationGroups.get(loc.approval_scope_version_id) || [];
        group.push(loc);
        locationGroups.set(loc.approval_scope_version_id, group);
      }
      const scopeGroups = new Map<string, ApprovedScope[]>();
      for (const scope of scopes) {
        const group = scopeGroups.get(scope.approval_version_id) || [];
        group.push({
          ...scope,
          materials: materialGroups.get(`${scope.approval_version_id}:${scope.project_scope_id}`) || [],
          locations: locationGroups.get(scope.id) || [],
        });
        scopeGroups.set(scope.approval_version_id, group);
      }
      return approvals.map(approval => ({
        ...approval,
        scopes: scopeGroups.get(approval.id) || [],
      }));
    },
    /** Batch approval editor candidates from current formal demand versions. */
    projectApprovalCandidates(projectId: string): ApprovalCandidate[] {
      const rows = store.query(`SELECT scope.id AS project_scope_id, d.id,
        current.current_version, d.demand_no, current.status, current.full_definition_json
        FROM project_demand_scopes scope
        JOIN v_project_demand_binding_current bind
          ON bind.project_scope_id=scope.id
        JOIN demands d ON d.id=scope.demand_id
        JOIN v_demand_current current ON current.id=d.id
        WHERE scope.project_id=?
        ORDER BY scope.created_at,scope.id`, projectId) as ApprovalCandidateRow[];
      return rows.map(({ full_definition_json, ...row }) => {
        const definition = JSON.parse(full_definition_json) as {
          work_locations: ApprovalCandidate["work_locations"];
        };
        return { ...row, work_locations: definition.work_locations };
      });
    },
    projectDashboardPortfolio(): ProjectDashboardBase[] {
      return store.query(`SELECT p.id,p.code,m.name,p.status,p.framework_id,
        m.planned_end_on,approved.approval_version_id,approved.approved_budget_fen
        FROM projects p
        JOIN v_project_management_current m ON m.project_id=p.id
        LEFT JOIN v_project_current_approval approved ON approved.project_id=p.id
        WHERE NOT EXISTS(SELECT 1 FROM audit_events a
          WHERE a.entity='projects' AND a.entity_id=p.id AND a.action='delete')
        ORDER BY p.created_at,p.id`) as ProjectDashboardBase[];
    },
    projectSummaryBasis(projectId: string) {
      return store.query(`SELECT p.id,ap.approval_version_id,ap.approved_budget_fen
        FROM projects p LEFT JOIN v_project_current_approval ap ON ap.project_id=p.id
        WHERE p.id=? AND NOT EXISTS(
          SELECT 1 FROM audit_events a WHERE a.entity='projects'
          AND a.entity_id=p.id AND a.action='delete')`, projectId)[0] as
        { id: string; approval_version_id: string | null;
          approved_budget_fen: number | null } | undefined;
    },
    projectCostNodes(projectId: string): ProjectCostNode[] {
      const rows = store.query(`SELECT n.*, EXISTS(
        SELECT 1 FROM audit_events a
        WHERE a.entity='cost_nodes' AND a.entity_id=n.id AND a.action='delete'
      ) AS deleted FROM v_project_cost_node_current n WHERE n.project_id=?`, projectId) as
        (Omit<ProjectCostNode, "deleted"> & { deleted: number })[];
      return rows.map(node => ({ ...node, deleted: Boolean(node.deleted) }));
    },
  };
}
export type ProjectReadRepository = ReturnType<typeof projectReadRepository>;

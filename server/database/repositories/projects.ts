import type { createStore } from "./store.mjs";

type Store = Pick<ReturnType<typeof createStore>, "query">;

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
  demand_no: string;
  demand_status: string;
  binding: CurrentProjectBinding | null;
  [key: string]: unknown;
}
interface ScopeRow extends Record<string, unknown> {
  id: string;
  binding_json: string | null;
  demand_no: string;
  demand_status: string;
}
export interface ApprovedMaterialSnapshot extends Record<string, unknown> {
  approval_version_id: string;
  project_scope_id: string;
  material_id: string;
}
export interface ApprovedLocationSnapshot extends Record<string, unknown> {
  approval_scope_version_id: string;
}
interface ApprovedScopeRow extends Record<string, unknown> {
  id: string;
  approval_version_id: string;
  project_scope_id: string;
  demand_no: string;
}
export interface ApprovedScope extends ApprovedScopeRow {
  materials: ApprovedMaterialSnapshot[];
  locations: ApprovedLocationSnapshot[];
}
export interface ProjectApprovalHistory extends Record<string, unknown> {
  id: string;
  version_no: number;
  status: string;
  scopes: ApprovedScope[];
}
export interface ProjectCostNode extends Record<string, unknown> {
  id: string;
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

export function projectReadRepository(store: Store) {
  return {
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
        { id: string; version_no: number; status: string; [key: string]: unknown }[];
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
        { id: string; deleted: number; [key: string]: unknown }[];
      return rows.map(node => ({ ...node, deleted: Boolean(node.deleted) }));
    },
  };
}
export type ProjectReadRepository = ReturnType<typeof projectReadRepository>;

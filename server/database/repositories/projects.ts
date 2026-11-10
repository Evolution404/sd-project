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
    projectApprovalHistory(projectId: string): ProjectApprovalHistory[] {
      const approvals = store.query(`SELECT * FROM project_approval_versions
        WHERE project_id=? AND status<>'withdrawn' ORDER BY version_no`, projectId) as
        { id: string; version_no: number; status: string; [key: string]: unknown }[];
      if (!approvals.length) return [];
      const scopes = store.query(`SELECT sc.*, d.demand_no FROM project_approval_scope_versions sc
        JOIN project_approval_versions ap ON ap.id=sc.approval_version_id
        JOIN demands d ON d.id=sc.demand_id
        WHERE ap.project_id=? AND ap.status<>'withdrawn' ORDER BY ap.version_no,sc.rowid`, projectId) as ApprovedScopeRow[];
      const materials = store.query(`SELECT item.*, pm.material_id FROM project_approval_material_items item
        JOIN project_approval_versions ap ON ap.id=item.approval_version_id
        JOIN project_scope_materials pm ON pm.id=item.project_material_id
        WHERE ap.project_id=? AND ap.status<>'withdrawn'
        ORDER BY ap.version_no,item.item_no`, projectId) as ApprovedMaterialSnapshot[];
      const locations = store.query(`SELECT loc.* FROM project_approval_work_locations loc
        JOIN project_approval_scope_versions sc ON sc.id=loc.approval_scope_version_id
        JOIN project_approval_versions ap ON ap.id=sc.approval_version_id
        WHERE ap.project_id=? AND ap.status<>'withdrawn'
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

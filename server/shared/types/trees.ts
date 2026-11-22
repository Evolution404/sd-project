import type { ProjectDisplayStatus } from "../project-display-status.js";

export interface HierarchyNode {
  id: string;
  parent_id: string | null;
  name: string;
  status: string;
  deleted: boolean;
  version_no: number;
  recorded_at: string;
}
export interface CostCategoryNode extends HierarchyNode {
  project_id: string;
  current_version_id: string;
  direct_cost_fen: number;
  actual_cost_fen: number;
  settlement_fen: number;
  child_count: number;
  leaf_count: number;
  reference_count: number;
  selectable: boolean;
  can_add_child: boolean;
  disabled_reason: string;
}
export interface OrganizationNode extends HierarchyNode {
  unit_version_id: string;
  selectable: boolean;
  disabled_reason: string;
}
export interface AssociatedProject {
  id: string;
  code: string;
  name: string;
  status: string;
  display_status: ProjectDisplayStatus;
  adopted_name: string;
  adopted_version: number;
}
export interface TreeAudit {
  id: string;
  action: string;
  actor_name: string;
  created_at: string;
}
export interface NodeVersion {
  actor_name?: string;
  historical_path?: string;
  path_complete?: number;
  id: string;
  name: string;
  version_no: number;
  status: string;
  recorded_at: string;
  parent_unit_id?: string | null;
  parent_name?: string | null;
}
export interface CategoryCost {
  id: string;
  entry_id: string;
  cost_node_id: string;
  cost_node_name: string;
  cost_node_version_id: string;
  title: string;
  amount_fen: number;
  occurred_on: string;
  status: string;
  deleted: boolean;
  version_no: number;
}
export interface CostCategoryDetail {
  items: CategoryCost[];
  total: number;
  page: number;
  page_size: number;
  versions: NodeVersion[];
  audits: TreeAudit[];
}
export interface OrganizationDetail {
  projects: AssociatedProject[];
  versions: NodeVersion[];
  audits: TreeAudit[];
  references: {
    children: number;
    projects: number;
    historical_projects: number;
  };
}
export interface OrganizationMovePreview {
  expected_version: number;
  parent_id: string | null;
  before_path: string;
  after_path: string;
  descendants: number;
  projects: number;
  preview_hash: string;
}

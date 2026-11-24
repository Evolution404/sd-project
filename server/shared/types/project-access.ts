export const scopedProjectPermissions = [
  "write", "project.stock", "project.approve", "change.approve", "project.close", "settlement.approve", "cost.confirm",
] as const;

export type ScopedProjectPermission = typeof scopedProjectPermissions[number];
export type ProjectScopeMode = "all" | "self" | "department" | "department_and_children" | "custom";

export interface ProjectRoleScope {
  permission_code: ScopedProjectPermission;
  scope: ProjectScopeMode;
  organization_ids: string[];
}

export interface ProjectAccess {
  owner_id: string | null;
  organization_ids: string[];
}

export interface ProjectOwnership {
  owner_id: string | null;
  managing_unit_id: string | null;
}

import { requireValue } from "../../shared/errors/business-error.js";
import type { Actor } from "../../shared/types/contracts.js";
import type { ProjectOwnership } from "../../shared/types/project-access.js";
import { authorize } from "./service.js";

export function hasProjectScope(actor: Actor, permission: string, project: ProjectOwnership) {
  const access = actor.project_access?.[permission];
  return !access || (access.owner_id !== null && access.owner_id === project.owner_id) ||
    (project.managing_unit_id !== null && access.organization_ids.includes(project.managing_unit_id));
}

export function authorizeProject(actor: Actor, permission: string, project: ProjectOwnership) {
  authorize(actor, permission);
  requireValue(hasProjectScope(actor, permission, project), "该项目不在此操作的授权数据范围内", 403);
}

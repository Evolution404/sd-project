import type { ProjectStage, ProjectApprovalStatus } from "./types/projects.js";

/** Exactly one user-facing project state, derived from formal stage + live approval draft. */
export const projectDisplayStatuses = ["储备", "已入库", "立项中", "已批准", "变更中", "已结项"] as const;
export type ProjectDisplayStatus = (typeof projectDisplayStatuses)[number];

export function projectDisplayStatus(
  stage: ProjectStage,
  approvals: ReadonlyArray<{status: ProjectApprovalStatus}>,
): ProjectDisplayStatus {
  if (stage === "closed") return "已结项";
  if (stage === "reserve") return "储备";
  const hasDraft = approvals.some(approval => approval.status === "draft");
  if (stage === "stocked") return hasDraft ? "立项中" : "已入库";
  return hasDraft ? "变更中" : "已批准";
}

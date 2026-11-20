import type { ProjectService } from "../../modules/projects/service.js";

export type { ProjectAction } from "../../modules/projects/actions.js";
export type { ApprovedScope, ApprovalCandidate, ProjectScopeProjection, ProjectApprovalHistory } from "../../database/repositories/projects.js";
export type ProjectDetail = ReturnType<ProjectService["get"]>;
export type ProjectListItem = ReturnType<ProjectService["search"]>["items"][number];
export type ProjectHistory = ReturnType<ProjectService["history"]>;
export type ProjectDeletionImpact = ReturnType<ProjectService["previewDeletion"]>;

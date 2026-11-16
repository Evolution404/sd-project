import type { ProjectStage } from "./types/projects.js";

export interface ProjectLifecycleFacts {
  status: ProjectStage | string;
  deleted?: boolean;
  display_status?: string;
  approvals?: ReadonlyArray<{ status: string }>;
}
export function ordinaryLinkReason(project: ProjectLifecycleFacts): string {
  if (project.deleted) return "项目已删除，不能关联需求";
  if (project.status === "closed") return "项目已结项，不能关联需求";
  if (project.status === "approved") return "已批准项目须在正式变更草稿中新增需求，批准时统一关联";
  if (project.approvals?.some(approval => approval.status === "draft") || project.display_status === "立项中")
    return "项目存在批准草稿，请先撤回草稿后调整普通需求关联";
  return "";
}
export function approvalDraftReason(project: ProjectLifecycleFacts): string {
  if (project.deleted) return "项目已删除，不能编制批准草稿";
  if (project.status === "reserve") return "储备项目须先确认入库，再编制立项草稿";
  if (project.status === "closed") return "项目已结项，不能编制批准草稿";
  if (project.approvals?.some(approval => approval.status === "draft"))
    return "已有批准草稿，请先处理";
  return "";
}
export function closedWriteReason(project: Pick<ProjectLifecycleFacts, "status">): string {
  return project.status === "closed" ? "项目已结项，普通费用、科目、结算及核对写入已冻结" : "";
}

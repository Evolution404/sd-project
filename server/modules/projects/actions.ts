import { ordinaryLinkReason } from "../../shared/project-lifecycle.js";
import type { Actor } from "../../shared/types/contracts.js";
import type { ProjectOwnership } from "../../shared/types/project-access.js";
import { hasProjectScope } from "../../platform/auth/project-access.js";

/** Read-only operation hints. Mutations always recheck authoritative project rules. */
interface ProjectActionFacts extends ProjectOwnership {
  id: string;
  status: string;
  deleted: boolean;
  scopes: Array<{ binding: unknown; demand_status: string }>;
  approvals: Array<{ id: string; status: string; version_no: number }>;
}
export type ProjectActionKey = "link" | "stock" | "approval" | "approve" | "finance" | "close" | "history";
export type ProjectAction = {
  key: ProjectActionKey;
  label: string;
  section: "overview" | "scope" | "approval" | "finance" | "history";
  enabled: boolean;
  reason?: string;
  approval_id?: string;
  settlement_blockers?: Array<{ id: string; number: string; status: string }>;
};
function offer(actor: Actor, project: ProjectOwnership, key: ProjectActionKey, label: string,
  section: ProjectAction["section"], permission: string, approval_id?: string): ProjectAction {
  const allowed = actor.permissions.includes(permission);
  const enabled = allowed && hasProjectScope(actor, permission, project);
  return {
    key, label, section, enabled,
    ...(!enabled ? { reason: allowed ? "该项目不在此操作的授权数据范围内" : "当前账号没有执行该正式操作的权限" } : {}),
    ...(approval_id ? { approval_id } : {}),
  };
}
export function projectActionHints(actor: Actor, project: ProjectActionFacts, closeBlockReason = "",
  settlementBlockers: NonNullable<ProjectAction["settlement_blockers"]> = [], approvalBlockReason = ""): ProjectAction[] {
  if (project.deleted || project.status === "closed")
    return [{ key: "history", label: "查看正式历史", section: "history", enabled: true }];
  const activeScopes = project.scopes.filter(s => s.binding && s.demand_status === "active");
  const draft = project.approvals.find(approval => approval.status === "draft");
  if (ordinaryLinkReason(project) && draft) return [
    {
      ...offer(actor, project, "approve", draft.version_no === 1 ? "正式批准立项" : "正式批准变更", "approval",
        draft.version_no === 1 ? "project.approve" : "change.approve", draft.id),
      ...(approvalBlockReason && hasProjectScope(actor, draft.version_no === 1 ? "project.approve" : "change.approve", project)
        ? { enabled: false, reason: approvalBlockReason } : {}),
    },
    offer(actor, project, "approval", "核对批准草稿", "approval", "write"),
  ];
  if (project.status === "reserve")
    return project.scopes.some(s => s.binding)
      ? [
        offer(actor, project, "stock", "确认入库", "overview", "project.stock"),
        offer(actor, project, "link", "关联需求", "scope", "write"),
      ]
      : [offer(actor, project, "link", "关联专业需求", "scope", "write"),
        offer(actor, project, "stock", "确认入库", "overview", "project.stock")];
  if (project.status === "stocked")
    return activeScopes.length
      ? [offer(actor, project, "approval", "编制立项范围及预算", "approval", "write"),
        offer(actor, project, "link", "关联需求", "scope", "write")]
      : [offer(actor, project, "link", "关联需求", "scope", "write")];
  return [
    offer(actor, project, "finance", "办理费用与结算", "finance", "read"),
    offer(actor, project, "approval", "编制正式变更", "approval", "write"),
    { ...offer(actor, project, "close", "审核结项", "overview", "project.close"),
      ...(closeBlockReason && hasProjectScope(actor, "project.close", project) ? {enabled:false, reason:closeBlockReason, settlement_blockers: settlementBlockers} : {}) },
  ];
}

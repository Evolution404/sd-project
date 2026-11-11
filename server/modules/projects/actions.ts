import type { Actor } from "../../shared/types/contracts.js";

/** Read-only operation hints. Mutations always recheck authoritative project rules. */
interface ProjectActionFacts {
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
};
function allowed(actor: Actor, permission: string) {
  return actor.permissions.includes(permission);
}
function offer(actor: Actor, key: ProjectActionKey, label: string,
  section: ProjectAction["section"], permission: string, approval_id?: string): ProjectAction {
  const enabled = allowed(actor, permission);
  return {
    key, label, section, enabled,
    ...(!enabled ? { reason: "当前账号没有执行该正式操作的权限" } : {}),
    ...(approval_id ? { approval_id } : {}),
  };
}
export function projectActionHints(actor: Actor, project: ProjectActionFacts): ProjectAction[] {
  if (project.deleted || project.status === "closed")
    return [{ key: "history", label: "查看正式历史", section: "history", enabled: true }];
  const activeScopes = project.scopes.filter(s => s.binding && s.demand_status === "active");
  const draft = project.approvals.find(approval => approval.status === "draft");
  if (project.status === "reserve")
    return project.scopes.some(s => s.binding)
      ? [
        offer(actor, "stock", "确认入库", "overview", "project.stock"),
        offer(actor, "link", "关联需求", "scope", "write"),
      ]
      : [offer(actor, "link", "关联专业需求", "scope", "write"),
        offer(actor, "stock", "确认入库", "overview", "project.stock")];
  if (draft) return [
    offer(actor, "approve", draft.version_no === 1 ? "正式批准立项" : "正式批准变更",
      "approval", draft.version_no === 1 ? "project.approve" : "change.approve", draft.id),
    offer(actor, "approval", "核对批准草稿", "approval", "write"),
  ];
  if (project.status === "stocked")
    return activeScopes.length
      ? [offer(actor, "approval", "编制立项范围及预算", "approval", "write"),
        offer(actor, "link", "关联需求", "scope", "write")]
      : [offer(actor, "link", "关联需求", "scope", "write")];
  return [
    offer(actor, "finance", "办理费用与结算", "finance", "read"),
    offer(actor, "approval", "编制正式变更", "approval", "write"),
    offer(actor, "close", "审核结项", "overview", "project.close"),
  ];
}

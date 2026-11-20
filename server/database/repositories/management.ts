import { auditActions, auditObjects } from "../../shared/audit-display.js";
import type { createStore } from "./store.js";
import { searchPage } from "../queries/business-lists.js";
import type { ListQuery } from "../../shared/types/contracts.js";
import type { AuditRecord } from "../../shared/types/contracts.js";

type Store = Pick<ReturnType<typeof createStore>,
  "query" | "get" | "list" | "insert" | "update" | "remove" | "run">;

export interface IpPermission {
  id: string;
  ip: string;
  note: string;
  created_by: string;
  created_at: string;
}
export interface AccessPolicy {
  ip_restriction_enabled: boolean;
  version: number;
  updated_by: string | null;
  updated_at: string | null;
}
interface AccessPolicyRow extends Omit<AccessPolicy, "ip_restriction_enabled"> {
  ip_restriction_enabled: 0 | 1;
}

function labelCases(fallback: string, labels: Readonly<Record<string, string>>) {
  return ` ${Object.entries(labels).map(([key, value]) => `WHEN '${key}' THEN '${value}'`).join(" ")} ELSE '${fallback}' END`;
}

export function managementRepository(store: Store) {
  return {
    deletedUserIds(): Set<string> {
      const rows = store.query(
        "SELECT entity_id FROM audit_events WHERE entity='users' AND action='delete'",
      ) as { entity_id: string }[];
      return new Set(rows.map(row => row.entity_id));
    },
    isUserDeleted(key: string): boolean {
      return Boolean(store.get(
        "SELECT 1 FROM audit_events WHERE entity='users' AND entity_id=? AND action='delete' LIMIT 1",
        key,
      ));
    },
    accessPolicy():AccessPolicy {
      const row=store.get<AccessPolicyRow>(
        "SELECT ip_restriction_enabled,version,updated_by,updated_at FROM access_policy WHERE id=1");
      if(!row)throw Error("访问控制配置不存在");
      return {...row,ip_restriction_enabled:row.ip_restriction_enabled===1};
    },
    updateAccessPolicy(expectedVersion:number,enabled:boolean,actorId:string,changedAt:string):boolean {
      const result=store.run(
        `UPDATE access_policy SET ip_restriction_enabled=?,version=version+1,
         updated_by=?,updated_at=? WHERE id=1 AND version=?`,
        Number(enabled),actorId,changedAt,expectedVersion);
      return result.changes===1;
    },
    allowedIps(): IpPermission[] {
      return store.query("SELECT * FROM allowed_ips ORDER BY created_at,id") as IpPermission[];
    },
    allowedIp(key: string): IpPermission | undefined {
      return store.get("SELECT * FROM allowed_ips WHERE id=?", key) as IpPermission | undefined;
    },
    insertIp(record: IpPermission): void { store.insert("allowed_ips", record); },
    updateIp(key: string, values: Pick<IpPermission, "ip" | "note">): void {
      store.update("allowed_ips", "id", key, values);
    },
    removeIp(key: string): void { store.remove("allowed_ips", "id", key); },
    auditRecord(key: string): AuditRecord | undefined {
      return store.get("SELECT * FROM audit_events WHERE id=?", key) as AuditRecord | undefined;
    },
    searchAuditEvents(query: ListQuery) {
      return searchPage<AuditRecord & { actor_username: string; entity_label: string; action_label: string }>(store, "audit", {
        sql: `SELECT a.*, COALESCE(u.username,'历史账户') AS actor_username,
          CASE a.entity${labelCases("业务记录", auditObjects)} AS entity_label,
          CASE a.action${labelCases("其他操作", auditActions)} AS action_label
          FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id`,
        columns: ["id", "created_at", "actor_username", "entity", "entity_id", "action", "entity_label", "action_label"],
        search: ["actor_username", "entity_label", "action_label", "entity", "entity_id", "action", "before_json", "after_json"],
      }, query);
    },
    auditEvents(includeDeleted: boolean): (AuditRecord & { actor_username: string })[] {
      return store.query(`SELECT a.*, COALESCE(u.username,'历史账户') AS actor_username
        FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id
        WHERE (? OR NOT EXISTS(
          SELECT 1 FROM audit_events hidden
          WHERE hidden.entity='audit' AND hidden.entity_id=a.id
          AND hidden.action='delete'))
        ORDER BY a.created_at,a.id`, Number(includeDeleted)) as
        (AuditRecord & { actor_username: string })[];
    },
    permissionCatalog(): { definitions: Record<string, unknown>[]; grants: Record<string, unknown>[] } {
      return {
        definitions: store.list("permission_definitions") as Record<string, unknown>[],
        grants: store.list("role_permissions") as Record<string, unknown>[],
      };
    },
  };
}
export type ManagementRepository = ReturnType<typeof managementRepository>;

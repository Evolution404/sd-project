import type { createStore } from "./store.js";
import type { AuditRecord } from "../../shared/types/contracts.js";

type Store = Pick<ReturnType<typeof createStore>,
  "query" | "get" | "list" | "insert" | "update" | "remove">;

export interface IpPermission {
  id: string;
  ip: string;
  note: string;
  created_by: string;
  created_at: string;
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

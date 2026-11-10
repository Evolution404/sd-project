import type { createStore } from "./store.mjs";
import type { AuditRecord } from "../../shared/types/contracts.js";
export function auditRepository(store: ReturnType<typeof createStore>) {
  return {
    append: (record: AuditRecord): void => {
      store.insert("audit_events", record);
    },
    history: (entity: string, id: string): AuditRecord[] =>
      store.query(
        "SELECT * FROM audit_events WHERE entity=? AND entity_id=? ORDER BY created_at,id",
        entity,
        id,
      ) as AuditRecord[],
  };
}

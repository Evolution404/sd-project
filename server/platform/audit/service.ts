import type { Actor } from "../../shared/types/contracts.js";
import type { auditRepository } from "../../database/repositories/audit.js";
import { id, now } from "../auth/service.js";
export function createAudit(repository: ReturnType<typeof auditRepository>) {
  return {
    record(
      actor: Actor,
      entity: string,
      entityId: string,
      action: string,
      before: unknown,
      after: unknown,
      recordedAt = now(),
    ): void {
      repository.append({
        id: id(),
        actor_id: actor.id,
        entity,
        entity_id: entityId,
        action,
        before_json: before == null ? null : JSON.stringify(before),
        after_json: after == null ? null : JSON.stringify(after),
        created_at: recordedAt,
      });
    },
    history: repository.history,
  };
}
export type AuditService = ReturnType<typeof createAudit>;

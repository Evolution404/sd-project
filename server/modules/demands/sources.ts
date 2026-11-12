import { authorize, id, now } from "../../platform/auth/service.js";
import { requireValue, text } from "../../shared/errors/business-error.js";
import type { Actor } from "../../shared/types/contracts.js";
import type { Database } from "../../database/connection.js";
import type { DemandRepository } from "../../database/repositories/demands.js";
import type { SourceRow } from "../../shared/types/demands.js";

const editable = ["description", "discovered_on", "proposed_by"] as const;
export interface SourceInput {
  description?: string;
  discovered_on?: string | null;
  proposed_by?: string | null;
}
interface SourceAuditor {
  audit(actor: Actor, entity: string, key: string, action: string, before: unknown, after: unknown): void;
}

/** A source correction is a replacement record linked to all affected demands.
 * Existing audit and source identities remain queryable.
 */
export function currentSources(repository: DemandRepository, demandId: string, includeHistorical = false): SourceRow[] {
  return repository.sources(demandId, includeHistorical);
}
export function reviseSource(
  repository: DemandRepository,
  auditor: SourceAuditor,
  actor: Actor,
  key: string,
  input: SourceInput
): SourceRow {
  authorize(actor, "write");
  const original = repository.source(key);
  requireValue(original, "来源不存在", 404);
  requireValue(
    !repository.sourceDecisions(key).some(event => ["delete", "correct"].includes(event.action)),
    "该来源已删除或已有更正版，请刷新", 409
  );
  const changed = editable.some(field => input[field] !== undefined && input[field] !== original[field]);
  if (!changed) return original;
  const replacement: SourceRow = { ...original, id: id(), created_by: actor.id, created_at: now() };
  for (const field of editable) {
    if (input[field] !== undefined) {
      // The input's optional fields are the only editable source facts.
      if (field === "description") replacement.description = input.description ?? "";
      if (field === "discovered_on") replacement.discovered_on = input.discovered_on ?? null;
      if (field === "proposed_by") replacement.proposed_by = input.proposed_by ?? null;
    }
  }
  replacement.description = text(replacement.description, "来源说明");
  // Derived read-model properties are never source_records columns.
  const { deleted: _deleted, superseded: _superseded, ...persisted } = replacement;
  repository.createSource(persisted);
  for (const link of repository.sourceLinks(key)) repository.linkSource(link.demand_id, replacement.id);
  auditor.audit(actor, "sources", key, "correct", original, { replacement_source_id: replacement.id });
  return replacement;
}
export function createSources(
  repository: DemandRepository,
  auditor: SourceAuditor,
  database: Pick<Database, "transaction">
) {
  return {
    revise(actor: Actor, key: string, input: SourceInput) {
      return database.transaction(() => reviseSource(repository, auditor, actor, key, input));
    },
    remove(actor: Actor, key: string) {
      return database.transaction(() => removeSource(repository, auditor, actor, key));
    },
    history(key: string) {
      const original = repository.source(key);
      requireValue(original, "来源不存在", 404);
      return { original, decisions: repository.sourceDecisions(key) };
    }
  };
}

export function removeSource(repository: DemandRepository, auditor: SourceAuditor, actor: Actor, key: string) {
  authorize(actor, "admin");
  const original = repository.source(key);
  requireValue(original, "来源不存在", 404);
  requireValue(!repository.sourceDecisions(key).some(event => ["delete", "correct"].includes(event.action)),
    "该来源已有后续处理，请刷新", 409);
  auditor.audit(actor, "sources", key, "delete", original, { logical: true });
  return { deleted: true };
}

import type { createStore } from "./store.js";
import type { ExchangeBatch } from "../../shared/types/exchange.js";
import type { OperationVersion } from "../../shared/types/work-standards.js";
import type { DictionaryVersion } from "../../shared/types/master-data.js";
import { requireValue } from "../../shared/errors/business-error.js";

/**
 * Excel session persistence and frozen reference lookups. Formal demand,
 * equipment and settlement mutations remain in their own domain services.
 * Application code never supplies SQL table or column identifiers.
 */
type Store = Pick<ReturnType<typeof createStore>, "get" | "run" | "query">;

export interface ExchangeBatchDraft {
  id: string;
  draft_json: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}
export interface ExchangeBatchSubmission {
  draft_json: string;
  updated_at: string;
  idempotency_key: string;
  payload_sha256: string;
}

export function exchangePersistenceRepository(store: Store) {
  return {
    demandNumberExists(number: string): boolean {
      return Boolean(store.get("SELECT 1 AS value FROM demands WHERE demand_no=? LIMIT 1", number));
    },
    settlementNumberExists(projectId: string | null | undefined, number: string): boolean {
      return Boolean(store.get(
        "SELECT 1 AS value FROM settlements WHERE project_id IS ? AND number=? LIMIT 1",
        projectId ?? null, number));
    },
    sourceExists(sourceId: string): boolean {
      return Boolean(store.get("SELECT 1 AS value FROM source_records WHERE id=? LIMIT 1", sourceId));
    },
    sourceHasSupersedingAudit(sourceId: string): boolean {
      return Boolean(store.get(
        "SELECT 1 AS value FROM audit_events WHERE entity='sources' AND entity_id=? AND action IN ('delete','correct') LIMIT 1",
        sourceId));
    },
    operationAdoptedVersion(operationId: string, version: number): OperationVersion | undefined {
      return store.get<OperationVersion>(
        "SELECT * FROM operation_versions WHERE operation_id=? AND version=?", operationId, version);
    },
    factorAdoptedVersion(factorId: string, version: number): DictionaryVersion | undefined {
      return store.get<DictionaryVersion>(
        "SELECT * FROM dictionary_item_versions WHERE item_id=? AND version=?", factorId, version);
    },
    factorIdentityAtVersion(code: string, version: number): { id: string; name: string } | undefined {
      return store.get<{ id: string; name: string }>(
        `SELECT d.id,v.name FROM dictionary_items d
        JOIN dictionary_item_versions v ON v.item_id=d.id
        WHERE d.type_id='price_factor' AND d.code=? AND v.version=?`,
        code, version);
    },
    scopeDemandId(scopeId: string): string | undefined {
      return store.get<{demand_id:string}>(
        "SELECT demand_id FROM project_demand_scopes WHERE id=?", scopeId)?.demand_id;
    },
    settlementItemsAtVersion(versionId: string): Record<string,unknown>[] {
      return store.query(
        "SELECT * FROM settlement_item_versions WHERE settlement_version_id=? ORDER BY rowid",
        versionId);
    },
    createBatch(draft: ExchangeBatchDraft): void {
      store.run(`INSERT INTO demand_batches
        (id,draft_json,created_by,created_at,updated_at) VALUES (?,?,?,?,?)`,
        draft.id, draft.draft_json, draft.created_by, draft.created_at, draft.updated_at);
    },
    batch(token: string): ExchangeBatch | undefined {
      return store.get<ExchangeBatch>("SELECT * FROM demand_batches WHERE id=?", token);
    },
    submitBatch(token: string, expectedVersion: number, submission: ExchangeBatchSubmission): void {
      const changed = store.run(`UPDATE demand_batches
        SET status='submitted',draft_json=?,version=version+1,updated_at=?,
          idempotency_key=?,payload_sha256=?
        WHERE id=? AND version=? AND status='draft'`,
        submission.draft_json,submission.updated_at,submission.idempotency_key,
        submission.payload_sha256,token,expectedVersion);
      requireValue(changed.changes === 1,"预检批次已变更，请刷新后重试",409);
    },
  };
}

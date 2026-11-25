import { digest } from "./auth/service.js";
import type { Actor } from "../shared/types/contracts.js";
import { BusinessError, requireValue } from "../shared/errors/business-error.js";

type Transaction = <T>(operation: () => T) => T;

export function catalogBatchFingerprint(actor: Actor, kind: string, rows: unknown) {
  return digest(JSON.stringify([actor.id, kind, rows]));
}

export function verifyCatalogBatch(actor: Actor, kind: string, rows: unknown, fingerprint: unknown) {
  if (fingerprint !== undefined)
    requireValue(fingerprint === catalogBatchFingerprint(actor, kind, rows), "批量维护内容已变化，请重新预检", 409);
}

export function previewCatalogBatch<T>(actor: Actor, kind: string, rows: unknown, transaction: Transaction, apply: () => T) {
  const discard = new Error("rollback catalog batch preview");
  let result: T;
  try {
    transaction(() => {
      result = apply();
      throw discard;
    });
    throw Error("预检事务未执行");
  } catch (cause) {
    if (cause !== discard) throw cause;
  }
  return { result: result!, fingerprint: catalogBatchFingerprint(actor, kind, rows) };
}

export function locateCatalogBatchRow<T>(id: string, operation: () => T): T {
  try { return operation(); }
  catch (cause) {
    if (!(cause instanceof BusinessError)) throw cause;
    const field = Object.keys(cause.fields)[0] || "";
    throw new BusinessError(cause.message, cause.status, { ...cause.fields, batch_id: id, batch_field: field }, cause.code);
  }
}

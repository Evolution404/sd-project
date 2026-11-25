import { authorize } from "./auth/service.js";
import { isObject, type Actor } from "../shared/types/contracts.js";
import { MAX_VERSIONED_ENTRY_ROWS, type VersionedEntryRow, type VersionedEntryResult } from "../shared/types/versioned-entry.js";
import { requireValue } from "../shared/errors/business-error.js";
import { locateCatalogBatchRow, previewCatalogBatch, verifyCatalogBatch } from "./catalog-batch-preview.js";

type Transaction = <T>(operation: () => T) => T;
export function versionedEntryBatch(actor: Actor, kind: string, input: Record<string, unknown>, options: {
  permission: string;
  transaction: Transaction;
  createFields?: readonly string[];
  updateFields?: readonly string[];
  revisionGuard?: (values: Record<string, unknown>) => boolean;
  save: (row: VersionedEntryRow) => string;
}, commit: boolean): VersionedEntryResult {
  authorize(actor, options.permission);
  const rows = input.rows;
  requireValue(Array.isArray(rows) && rows.length > 0 && rows.length <= MAX_VERSIONED_ENTRY_ROWS,
    "单批须提供 1 至 " + MAX_VERSIONED_ENTRY_ROWS + " 条有效记录");
  const refs = new Set<string>(), ids = new Set<string>();
  const table = rows.map((raw: unknown): VersionedEntryRow => {
    requireValue(isObject(raw) && typeof raw.ref === "string" && /^[1-9][0-9]{0,5}$/.test(raw.ref) && !refs.has(raw.ref),
      "工作表行号无效或重复");
    const ref = raw.ref;
    refs.add(ref);
    return locateCatalogBatchRow(ref, () => {
      const id = raw.id;
      requireValue(id === undefined || (typeof id === "string" && id.length > 0 && id.length <= 128 && !ids.has(id)),
        "正式记录身份无效或重复");
      if (id) ids.add(id);
      const permitted = id ? options.updateFields : options.createFields;
      requireValue(permitted, id ? "此业务不支持批量修订" : "此业务不支持批量创建", 405);
      requireValue(isObject(raw.values) && Object.keys(raw.values).every(key => permitted.includes(key)),
        "工作表包含不允许写入的业务字段");
      if (id) requireValue(options.revisionGuard ? options.revisionGuard(raw.values)
        : Number.isSafeInteger(raw.values.expected_version) && Number(raw.values.expected_version) > 0, "批量修订须带正式版本或记录快照");
      return { ref, id, values: raw.values };
    });
  });
  const apply = () => table.map(row => locateCatalogBatchRow(row.ref, () => options.save(row)));
  if (!commit) {
    const proof = previewCatalogBatch(actor, kind, rows, options.transaction, apply);
    return { count: table.length, fingerprint: proof.fingerprint };
  }
  requireValue(typeof input.fingerprint === "string", "请先完成工作表预检");
  verifyCatalogBatch(actor, kind, rows, input.fingerprint);
  return { count: table.length, ids: options.transaction(apply) };
}

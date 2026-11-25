import { BusinessError, requireValue } from "../../shared/errors/business-error.js";
import type { Actor } from "../../shared/types/contracts.js";
import type { FinanceEntryBatch, FinanceEntryBatchIssue } from "../../shared/types/finance-workflows.js";
import { authorize, digest } from "../../platform/auth/service.js";

import { MAX_FINANCE_ENTRY_BATCH } from "../../shared/types/finance-workflows.js";

type Transaction = <T>(operation: () => T) => T;
type ExecuteRow = (row: FinanceEntryBatch["rows"][number]) => string;

export function financeEntryBatch(
  actor: Actor, projectId: string, batch: FinanceEntryBatch, transaction: Transaction, executeRow: ExecuteRow,
  fingerprint?: string,
) {
  authorize(actor, batch.kind === "nodes" ? "write" : "cost.confirm");
  requireValue(batch.rows.length > 0 && batch.rows.length <= MAX_FINANCE_ENTRY_BATCH &&
    batch.rows.every(row => row.kind === batch.kind), "批量费用行数或业务类型无效");
  const digestInput = digest(JSON.stringify([actor.id, projectId, batch]));
  const preview = fingerprint === undefined;
  if (!preview) requireValue(fingerprint === digestInput, "批量费用内容已变化，请重新预检", 409);
  const issues: FinanceEntryBatchIssue[] = [];
  const results: { ref: string; id: string }[] = [];
  const rollbackPreview = new Error("rollback finance batch preview");
  try {
    transaction(() => {
      for (const row of batch.rows) {
        try {
          results.push({ ref: row.ref, id: executeRow(row) });
        } catch (cause) {
          if (!(cause instanceof BusinessError)) throw cause;
          issues.push({ ref: row.ref, field: Object.keys(cause.fields)[0], message: cause.message });
        }
      }
      if (preview) throw rollbackPreview;
      requireValue(!issues.length, "批量费用校验失败，全部未写入", 422, Object.fromEntries(issues.map(issue =>
        ["rows." + issue.ref + (issue.field ? "." + issue.field : ""), issue.message])));
    });
  } catch (cause) {
    if (cause !== rollbackPreview) throw cause;
  }
  return {
    count: batch.rows.length, issues,
    fingerprint: preview && !issues.length ? digestInput : undefined,
    results: preview ? undefined : results,
  };
}

import type { Store } from "./store.js";
import { financeReadRepository } from "./finance.js";
import { projectCommandRepository } from "./project-commands.js";

interface ProjectClosureWrite {
  id: string;
  project_id: string;
  approval_version_id: string;
  reason: string;
  close_snapshot_json: string;
  closed_by: string;
  closed_at: string;
}

export function projectClosureRepository(store: Store) {
  const finance = financeReadRepository(store);
  return {
    transaction: store.transaction,
    unfinishedSettlements: finance.unfinishedSettlements,
    closeApprovalBlockers: finance.closeApprovalBlockers,
    closeFinanceVersions: finance.closeFinanceVersions,
    appendStage: projectCommandRepository(store).appendStage,
    createClosure(row: ProjectClosureWrite) {
      store.insert("project_closures", row);
    },
  };
}

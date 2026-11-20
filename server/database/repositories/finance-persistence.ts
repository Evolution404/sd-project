import type { Store } from "./store.js";
import type { Database } from "../connection.js";
import { businessLists } from "../queries/business-lists.js";
import { financeReadRepository } from "./finance.js";
import { financeListRepository } from "./finance-lists.js";
import { financeCommandRepository } from "./finance-commands.js";
import { projectReadRepository } from "./projects.js";

/** Finance-only read/write port plus explicitly named project close/cost cross-domain facts. */
export function financePersistenceRepository(store: Store, database: Pick<Database, "transaction">) {
  return {
    ...financeReadRepository(store),
    ...financeListRepository(store),
    ...financeCommandRepository(store),
    projectCostNodes: projectReadRepository(store).projectCostNodes,
    searchFinance: businessLists(store).finance,
    transaction: database.transaction,
  };
}
export type FinancePersistenceRepository = ReturnType<typeof financePersistenceRepository>;

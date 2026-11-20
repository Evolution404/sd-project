import { nextBusinessNumber } from "./business-numbers.js";
import type { Store } from "./store.js";
import type { Database } from "../connection.js";
import { businessLists } from "../queries/business-lists.js";
import { projectReadRepository } from "./projects.js";
import { projectCommandRepository } from "./project-commands.js";
import { projectHistoryRepository } from "./project-history.js";

/** One project-only persistence port; never exposes arbitrary SQL or table CRUD. */
export function projectPersistenceRepository(store: Store, database: Pick<Database, "transaction">) {
  return {
    nextProjectNumber: () => nextBusinessNumber(store, "projects"),
    nextChangeNumber: () => nextBusinessNumber(store, "changes"),
    ...projectReadRepository(store),
    ...projectCommandRepository(store),
    ...projectHistoryRepository(store),
    selectedProjects: businessLists(store).selectedProjects,
    searchProjects: businessLists(store).projects,
    transaction: database.transaction,
  };
}
export type ProjectPersistenceRepository = ReturnType<typeof projectPersistenceRepository>;

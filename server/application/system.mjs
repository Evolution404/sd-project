import { openDatabase } from "../database/connection.mjs";
import { createStore } from "../database/repositories/store.mjs";
import { businessRepository } from "../database/repositories/business.mjs";
import { identityRepository } from "../database/repositories/identity.mjs";
import { createAuth, authorize, digest, id, now } from "./auth.mjs";
import { createCatalog } from "./catalog.mjs";
import { createDemands } from "./demands.mjs";
import { createPricing } from "./pricing.mjs";
import { createProjects } from "./projects.mjs";
import { createSources } from "./sources.mjs";
import { createReporting } from "./reporting.mjs";
import { createManagement } from "./management.mjs";
import { createFinance } from "./finance.mjs";
import { requireValue } from "../domain/errors.mjs";
export function createSystem(dataDir) {
  const database = openDatabase(dataDir),
    store = createStore(database),
    repo = businessRepository(store),
    identity = identityRepository(store);
  const auth = createAuth(identity, store),
    catalog = createCatalog(repo),
    demands = createDemands(repo, catalog),
    pricing = createPricing(repo, catalog, demands),
    projects = createProjects(repo, catalog, demands, pricing),
    finance = createFinance(repo, catalog, projects);
  const reporting = createReporting(repo, catalog, demands, projects, finance);
  return {
    database,
    repo,
    identity,
    auth,
    catalog,
    demands,
    pricing,
    projects,
    finance,
    management: createManagement({ repo, identity, auth, catalog }),
    sources: createSources(repo, catalog),
    idempotent(actor, key, payload, action) {
      requireValue(
        typeof key === "string" && key.length >= 8 && key.length <= 200,
        "请提供8至200位幂等请求标识",
      );
      return repo.transaction(() => {
        const hash = digest(JSON.stringify(payload)),
          previous = repo.find("ledger_requests", "request_key", key);
        if (previous) {
          requireValue(
            previous.actor_id === actor.id && previous.request_hash === hash,
            "幂等标识已由不同用户或不同请求使用",
            409,
          );
          return JSON.parse(previous.result_json);
        }
        const result = action();
        repo.insert("ledger_requests", {
          request_key: key,
          actor_id: actor.id,
          request_hash: hash,
          result_json: JSON.stringify(result),
          created_at: now(),
        });
        return result;
      });
    },
    dashboard: reporting.dashboard,

    close() {
      database.close();
    },
  };
}

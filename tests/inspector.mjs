/** Test-only database access. The production System exposes typed domain ports,
 * not a generic table repository. This helper never ships in the Windows package.
 */
import { createStore } from "../dist/server/database/repositories/store.js";
import { demandRepository } from "../dist/server/database/repositories/demands.js";
const instances = new WeakMap();
export function inspect(system) {
  if (instances.has(system)) return instances.get(system);
  const store=createStore(system.database);
  const demand=demandRepository(store);
  const repo={
    ...store,
    isDeleted(entity,id) {
      return Boolean(store.get("SELECT 1 FROM audit_events WHERE entity=? AND entity_id=? AND action='delete' LIMIT 1", entity,id));
    },
    auditFor(entity,id) {
      return store.query("SELECT * FROM audit_events WHERE entity=? AND entity_id=? ORDER BY created_at,id",entity,id);
    },
    demandDuplicates: demand.duplicates,
    integrity() {
      return {
        integrity:store.query("PRAGMA integrity_check"),
        foreignKeys:store.query("PRAGMA foreign_key_check"),
      };
    },
  };
  instances.set(system,repo);
  return repo;
}

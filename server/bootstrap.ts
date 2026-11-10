import { priceRuleRepository } from "./database/repositories/price-rules.js";
import { createPriceRules } from "./modules/pricing/rules.js";
import { priceFactorRepository } from "./database/repositories/price-factors.js";
import { workStandardRepository } from "./database/repositories/work-standards.js";
import { createPriceFactors } from "./modules/pricing/factors.js";
import { createWorkStandards } from "./modules/work-standards/service.js";
import { dictionaryRepository } from "./database/repositories/dictionaries.js";
import { materialRepository } from "./database/repositories/materials.js";
import { createDictionaries } from "./modules/dictionaries/service.js";
import { createMaterials } from "./modules/materials/service.js";
import { equipmentRepository } from "./database/repositories/equipment.js";
import { auditRepository } from "./database/repositories/audit.js";
import { createAudit } from "./platform/audit/service.js";
import { createEquipment } from "./modules/equipment/service.js";
import { hierarchyRepository } from "./database/repositories/hierarchies.js";
import { createOrganizations } from "./modules/organizations/service.js";
import { openDatabase } from "./database/connection.js";
import { createStore } from "./database/repositories/store.mjs";
import { businessRepository } from "./database/repositories/business.mjs";
import { identityRepository } from "./database/repositories/identity.js";
import { createAuth, digest, now } from "./platform/auth/service.js";
import { createCatalog } from "./modules/catalog/service.mjs";
import { createDemands } from "./modules/demands/service.mjs";
import { createPricing } from "./modules/pricing/service.js";
import { pricingRepository } from "./database/repositories/pricing.js";
import { createProjects } from "./modules/projects/service.mjs";
import { createSources } from "./modules/demands/sources.mjs";
import { createReporting } from "./modules/reporting/service.mjs";
import { createManagement } from "./modules/management/service.mjs";
import { createFinance } from "./modules/finance/service.mjs";
import { requireValue } from "./shared/errors/business-error.js";
import type { Actor } from "./shared/types/contracts.js";

export function createSystem(dataDir?: string) {
  const database = openDatabase(dataDir);
  const store = createStore(database);
  const repo = businessRepository(store);
  const identity = identityRepository(store);
  const auth = createAuth(identity, database);
  const audit = createAudit(auditRepository(store));
  const equipment = createEquipment(equipmentRepository(store), database, audit);
  const dictionaries = createDictionaries(dictionaryRepository(store),database,audit);
  const materials = createMaterials(materialRepository(store),dictionaries,database,audit);
  const factors = createPriceFactors(priceFactorRepository(store),dictionaries,database,audit);
  const standards = createWorkStandards(workStandardRepository(store),dictionaries,factors,database,audit);
  const priceRules = createPriceRules(priceRuleRepository(store),standards,equipment,database,audit);
  const catalog = createCatalog(repo, equipment, audit, dictionaries, materials, factors, standards, priceRules);
  const demands = createDemands(repo, catalog);
  const pricing = createPricing(pricingRepository(store), priceRules, standards, database, audit);
  const projects = createProjects(repo, catalog, demands, pricing);
  const hierarchies = hierarchyRepository(store);
  const finance = createFinance(repo, catalog, projects, pricing, hierarchies);
  const organizations = createOrganizations(hierarchies, dictionaries, database);
  const reporting = createReporting(repo, catalog, demands, projects, finance);

  return {
    database, repo, identity, auth, audit, equipment, dictionaries, materials, factors, standards, priceRules, catalog, demands, pricing, projects, finance, organizations,
    management: createManagement({ repo, identity, auth, catalog }),
    sources: createSources(repo, catalog),
    idempotent<T>(actor: Actor, key: unknown, payload: unknown, action: () => T): T {
      requireValue(typeof key === "string" && key.length >= 8 && key.length <= 200,
        "请提供8至200位幂等请求标识");
      return database.transaction(() => {
        const hash = digest(JSON.stringify(payload));
        const previous = identity.requestReceipt(key);
        if (previous) {
          requireValue(previous.actor_id === actor.id && previous.request_hash === hash,
            "幂等标识已由不同用户或不同请求使用", 409);
          return JSON.parse(previous.result_json) as T;
        }
        const result = action();
        identity.recordRequest(actor, key, hash, result, now());
        return result;
      });
    },
    dashboard: reporting.dashboard,
    close() { database.close(); },
  };
}
export type System = ReturnType<typeof createSystem>;

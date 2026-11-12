import { priceRuleRepository } from "./database/repositories/price-rules.js";
import { createPriceRules } from "./modules/pricing/rules.js";
import { workStandardRepository } from "./database/repositories/work-standards.js";
import { createWorkStandards } from "./modules/work-standards/service.js";
import { dictionaryRepository } from "./database/repositories/dictionaries.js";
import { quantityUnitRepository } from "./database/repositories/quantity-units.js";
import { materialRepository } from "./database/repositories/materials.js";
import { createDictionaries } from "./modules/dictionaries/service.js";
import { createMaterials } from "./modules/materials/service.js";
import { equipmentRepository } from "./database/repositories/equipment.js";
import { auditRepository } from "./database/repositories/audit.js";
import { evidenceRepository } from "./database/repositories/evidence.js";
import { createAudit } from "./platform/audit/service.js";
import { createEquipment } from "./modules/equipment/service.js";
import { hierarchyRepository } from "./database/repositories/hierarchies.js";
import { createOrganizations } from "./modules/organizations/service.js";
import { openDatabase } from "./database/connection.js";
import { createStore } from "./database/repositories/store.js";
import { projectPersistenceRepository } from "./database/repositories/project-persistence.js";
import { financePersistenceRepository } from "./database/repositories/finance-persistence.js";
import { exchangeReferenceRepository } from "./database/repositories/exchange.js";
import { exchangePersistenceRepository } from "./database/repositories/exchange-persistence.js";
import { demandRepository } from "./database/repositories/demands.js";
import { identityRepository } from "./database/repositories/identity.js";
import { createAuth, digest, now } from "./platform/auth/service.js";
import { createCatalog } from "./modules/catalog/service.js";
import { catalogLabelRepository } from "./database/repositories/catalog-labels.js";
import { fundingRepository } from "./database/repositories/funding.js";
import { createFunding } from "./modules/funding/service.js";
import { createDemands } from "./modules/demands/service.js";
import { createPricing } from "./modules/pricing/service.js";
import { pricingRepository } from "./database/repositories/pricing.js";
import { createProjects } from "./modules/projects/service.js";
import { createSources } from "./modules/demands/sources.js";
import { createReporting } from "./modules/reporting/service.js";
import { reportingReadRepository } from "./database/repositories/reporting.js";
import { createManagement } from "./modules/management/service.js";
import { managementRepository } from "./database/repositories/management.js";
import { createFinance } from "./modules/finance/service.js";
import { requireValue } from "./shared/errors/business-error.js";
import { trainingRepository } from "./database/repositories/training.js";
import { createTrainingService } from "./modules/training/service.js";
import type { Actor } from "./shared/types/contracts.js";

export function createSystem(dataDir?: string) {
  const database = openDatabase(dataDir);
  const store = createStore(database);
  const projectPort = projectPersistenceRepository(store,database);
  const financePort = financePersistenceRepository(store,database);
  const exchangeReferences = exchangeReferenceRepository(store);
  const exchangePersistence = exchangePersistenceRepository(store);
  const quantityUnits = quantityUnitRepository(store);
  const identity = identityRepository(store);
  const auth = createAuth(identity, database);
  const audit = createAudit(auditRepository(store));
  const evidenceStore = evidenceRepository(store);
  const dictionaries = createDictionaries(dictionaryRepository(store),database,audit);
  const equipment = createEquipment(equipmentRepository(store), database, audit, dictionaries);
  const materials = createMaterials(materialRepository(store),dictionaries,database,audit);
  const seededAuth = {
    ...auth,
    initialize(username:string,password:string){
      const created=auth.initialize(username,password);
      dictionaries.seedTowerDefaults({
        id:created.id,username:created.username,role:"admin",permissions:["admin"],
      });
      return created;
    },
  };
  const standards = createWorkStandards(workStandardRepository(store),dictionaries,database,audit);
  const priceRules = createPriceRules(priceRuleRepository(store),standards,equipment,database,audit);
  const funding = createFunding(fundingRepository(store), database, audit);
  const catalog = createCatalog(catalogLabelRepository(store), equipment, audit, dictionaries, materials, standards, priceRules, funding);
  const demandRecords = demandRepository(store);
  const demands = createDemands(demandRecords, catalog, database);
  const pricing = createPricing(pricingRepository(store), priceRules, standards, database, audit);
  const projects = createProjects(projectPort, catalog, demands, pricing, quantityUnits, funding);
  const hierarchies = hierarchyRepository(store);
  const finance = createFinance(financePort, catalog, projects, pricing, hierarchies, quantityUnits);
  const organizations = createOrganizations(hierarchies, dictionaries, database);
  const reporting = createReporting(reportingReadRepository(store), projects, finance);

  return {
    database, projectPort, financePort, exchangeReferences, exchangePersistence, identity, auth:seededAuth, audit, evidenceStore, equipment, dictionaries, materials, standards, priceRules, catalog, funding, demands, pricing, projects, finance, organizations,
    training: createTrainingService(trainingRepository(store), database.directory),
    management: createManagement({ repository: managementRepository(store), identity, auth:seededAuth, audit, database }),
    sources: createSources(demandRecords, catalog, database),
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

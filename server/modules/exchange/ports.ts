import type { exchangePersistenceRepository } from "../../database/repositories/exchange-persistence.js";
import type { ExchangeReferenceRepository } from "../../database/repositories/exchange.js";
import type { Actor } from "../../shared/types/contracts.js";
import type { CatalogService } from "../catalog/service.js";
import type { createDemands } from "../demands/service.js";
import type { DictionaryService } from "../dictionaries/service.js";
import type { EquipmentService } from "../equipment/service.js";
import type { createFinance } from "../finance/service.js";
import type { MaterialService } from "../materials/service.js";
import type { createTrainingService } from "../training/service.js";
import type { ProjectService } from "../projects/service.js";
import type { WorkStandardService } from "../work-standards/service.js";

export interface ExchangePorts {
  exchangePersistence: ReturnType<typeof exchangePersistenceRepository>;
  exchangeReferences: ExchangeReferenceRepository;
  catalog: CatalogService;
  demands: Pick<ReturnType<typeof createDemands>, "get" | "search" | "normalize" | "findDuplicates" | "save">;
  finance: Pick<ReturnType<typeof createFinance>, "settlement" | "validateDraft" | "saveDraft" |
    "searchSettlements" | "selectedSettlements" | "effectiveSettlementReport" | "summariesForPortfolio">;
  projects: Pick<ProjectService, "get" | "dashboardPortfolio" | "projectReportRows">;
  dictionaries: Pick<DictionaryService, "list">;
  equipment: Pick<EquipmentService, "get" | "list" | "search">;
  materials: Pick<MaterialService, "list">;
  standards: Pick<WorkStandardService, "operations" | "operationAttributes">;
  training: Pick<ReturnType<typeof createTrainingService>, "record">;
  idempotent<T>(actor: Actor, key: unknown, payload: unknown, action: () => T): T;
}

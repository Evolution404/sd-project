import { isFoundationKind, type DictionaryService } from "../dictionaries/service.js";
import { isEquipmentKind, type EquipmentService } from "../equipment/service.js";
import type { MaterialService } from "../materials/service.js";
import type { PriceRuleService } from "../pricing/rules.js";
import type { WorkStandardService } from "../work-standards/service.js";
import type { FundingService } from "../funding/service.js";
import type { CatalogLabelRepository } from "../../database/repositories/catalog-labels.js";
import type { AuditService } from "../../platform/audit/service.js";
import type { Actor } from "../../shared/types/contracts.js";
import type { EquipmentCatalogKind, EquipmentRecord, EquipmentSearchOptions } from "../../shared/types/equipment.js";
import type { DictionaryItem, OrganizationDefinition, MaterialRecord } from "../../shared/types/master-data.js";
import type { PriceRuleRecord } from "../../shared/types/price-rules.js";
import type { OperationRecord, WorkObjectRecord } from "../../shared/types/work-standards.js";
import type { FundingRecord } from "../../shared/types/funding.js";
import { BusinessError } from "../../shared/errors/business-error.js";
import { catalogDefinitions } from "./definitions.js";
export { catalogDefinitions } from "./definitions.js";

export type CatalogRecord = EquipmentRecord | DictionaryItem | OrganizationDefinition |
  MaterialRecord | OperationRecord | WorkObjectRecord |
  PriceRuleRecord | FundingRecord;
type Input = Record<string, unknown>;

function unknownCatalog(): never {
  throw new BusinessError("未知业务目录", 404);
}

/** Only a typed delegation facade, not an application CRUD engine. */
export function createCatalog(
  labels: CatalogLabelRepository,
  equipment: EquipmentService,
  auditor: AuditService,
  dictionaries: DictionaryService,
  materials: MaterialService,
  standards: WorkStandardService,
  priceRules: PriceRuleService,
  funding: FundingService,
) {
  function list(kind: "tower_natures" | "tower_materials", includeDeleted?: boolean): DictionaryItem[];
  function list(kind: string, includeDeleted?: boolean): CatalogRecord[];
  function list(kind: string, includeDeleted = false) {
    if (kind === "frameworks" || kind === "agreements") return funding.list(kind, includeDeleted);
    if (kind === "prices") return priceRules.list(includeDeleted);
    if (kind === "objects") return standards.objects(includeDeleted);
    if (kind === "operations") return standards.operations(includeDeleted);
    if (isFoundationKind(kind)) return dictionaries.list(kind, includeDeleted);
    if (kind === "materials") return materials.list(includeDeleted);
    if (isEquipmentKind(kind)) return equipment.list(kind, includeDeleted);
    return unknownCatalog();
  }
  function get(kind: "operations", key: string, includeDeleted?: boolean): OperationRecord;
  function get(kind: "objects", key: string, includeDeleted?: boolean): WorkObjectRecord;
  function get(kind: "units" | "priorities" | "categories" | "tower_natures" | "tower_materials", key: string, includeDeleted?: boolean): DictionaryItem;
  function get(kind: "organizations", key: string, includeDeleted?: boolean): OrganizationDefinition;
  function get(kind: "materials", key: string, includeDeleted?: boolean): MaterialRecord;
  function get(kind: EquipmentCatalogKind, key: string, includeDeleted?: boolean): EquipmentRecord;
  function get(kind: "prices", key: string, includeDeleted?: boolean): PriceRuleRecord;
  function get(kind: "frameworks" | "agreements", key: string, includeDeleted?: boolean): FundingRecord;
  function get(kind: string, key: string, includeDeleted?: boolean): CatalogRecord;
  function get(kind: string, key: string, includeDeleted = false): CatalogRecord {
    if (kind === "frameworks" || kind === "agreements") return funding.get(kind, key, includeDeleted);
    if (kind === "prices") return priceRules.get(key, includeDeleted);
    if (kind === "objects") return standards.getObject(key, includeDeleted);
    if (kind === "operations") return standards.getOperation(key, includeDeleted);
    if (isFoundationKind(kind)) return dictionaries.get(kind, key, includeDeleted);
    if (kind === "materials") return materials.get(key, includeDeleted);
    if (isEquipmentKind(kind)) return equipment.get(kind, key, includeDeleted);
    return unknownCatalog();
  }
  function save(actor: Actor, kind: string, input: Input, key?: string) {
    if (kind === "frameworks" || kind === "agreements") return funding.save(actor, kind, input, key);
    if (kind === "prices") return priceRules.save(actor, input, key);
    if (kind === "objects") return standards.saveObject(actor, input, key);
    if (kind === "operations") return standards.saveOperation(actor, input, key);
    if (isFoundationKind(kind)) return dictionaries.save(actor, kind, input, key);
    if (kind === "materials") return materials.save(actor, input, key);
    if (isEquipmentKind(kind)) return equipment.save(actor, kind, input, key);
    return unknownCatalog();
  }
  function history(kind: string, key: string) {
    if (kind === "frameworks" || kind === "agreements") return funding.history(kind, key);
    if (kind === "prices") return priceRules.history(key);
    if (kind === "objects") return standards.objectHistory(key);
    if (kind === "operations") return standards.operationHistory(key);
    if (isFoundationKind(kind)) return dictionaries.history(kind, key);
    if (kind === "materials") return materials.history(key);
    if (isEquipmentKind(kind)) return equipment.history(kind, key);
    return unknownCatalog();
  }
  function remove(actor: Actor, kind: string, key: string, version: unknown) {
    if (kind === "frameworks" || kind === "agreements") return funding.remove(actor, kind, key, version);
    if (kind === "prices") return priceRules.remove(actor, key, version);
    if (kind === "objects") return standards.removeObject(actor, key, version);
    if (kind === "operations") return standards.removeOperation(actor, key, version);
    if (isFoundationKind(kind)) return dictionaries.remove(actor, kind, key, version);
    if (kind === "materials") return materials.remove(actor, key, version);
    if (isEquipmentKind(kind)) return equipment.remove(actor, kind, key, version);
    return unknownCatalog();
  }
  return {
    definitions: catalogDefinitions,
    audit: auditor.record,
    operationAttributes: standards.operationAttributes,
    previewPrice: priceRules.preview,
    search(kind: string, options: EquipmentSearchOptions = {}) {
      if (!isEquipmentKind(kind) || kind === "voltages") return unknownCatalog();
      return equipment.search(kind, options);
    },
    list, get, save, history, remove,
    replacementPreview: equipment.replacementPreview,
    replacePhysical: equipment.replacePhysical,
    displayLabels: labels.displayLabels,
  };
}
export type CatalogService = ReturnType<typeof createCatalog>;

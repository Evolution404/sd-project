import { handleWorkStandards } from "../../modules/work-standards/http.js";
import { handlePriceCatalog } from "../../modules/pricing/catalog-http.js";
import { handleDictionaries } from "../../modules/dictionaries/http.js";
import { isFoundationKind } from "../../modules/dictionaries/service.js";
import { handleMaterials } from "../../modules/materials/http.js";
import { handleEquipment } from "../../modules/equipment/http.js";
import { isEquipmentKind } from "../../modules/equipment/service.js";
import { handleOrganizations } from "../../modules/organizations/http.js";
import type { RouteContext, RouteHandler } from "./context.js";
import { handleFunding } from '../../modules/funding/http.js';
import { handleCatalog } from '../../modules/catalog/http.js';
import { handleReporting } from '../../modules/reporting/http.js';
import { handleDemands } from '../../modules/demands/http.js';
import { handleProjects } from '../../modules/projects/http.js';
import { handleFinance } from '../../modules/finance/http.js';
import { handlePricing } from '../../modules/pricing/http.js';
import { handleExchange } from '../../modules/exchange/http.js';
import { handleManagement } from '../../modules/management/http.js';
import { handleFiles } from '../files/http.js';
import { requireValue } from '../../shared/errors/business-error.js';

const routes: Record<string, RouteHandler> = {
  'actors': handleCatalog,
  'display-labels': handleCatalog,
  'catalogs': handleCatalog,
  'catalog': handleCatalog,
  'funding': handleFunding,
  'organizations': handleOrganizations,
  'dashboard': handleReporting,
  'demands': handleDemands,
  'sources': handleDemands,
  'projects': handleProjects,
  'finance': handleFinance,
  'settlements': handleFinance,
  'reconciliations': handleFinance,
  'charges': handlePricing,
  'exchange': handleExchange,
  'users': handleManagement,
  'ips': handleManagement,
  'audit': handleManagement,
  'permissions': handleManagement,
  'evidence': handleFiles,
};

export function dispatchRoute(context: RouteContext) {
  requireValue(Object.hasOwn(routes, context.resource), '接口不存在', 404);
  if (context.resource === "catalog" && ["frameworks", "agreements"].includes(context.key)) return handleFunding(context);
  if (context.resource === "catalog" && ["objects","operations"].includes(context.key)) return handleWorkStandards(context);
  if (context.resource === "catalog" && ["prices","factors"].includes(context.key)) return handlePriceCatalog(context);
  if (context.resource === "catalog" && isEquipmentKind(context.key)) return handleEquipment(context);
  if (context.resource === "catalog" && isFoundationKind(context.key)) return handleDictionaries(context);
  if (context.resource === "catalog" && context.key === "materials") return handleMaterials(context);
  return routes[context.resource](context);
}

import type { RouteContext, RouteHandler } from "./context.js";
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
  return routes[context.resource](context);
}

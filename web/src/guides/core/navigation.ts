import type { GuideModuleId } from "./types";
import { guideModules } from "../registry/modules";
export const routeNames:Record<GuideModuleId,readonly string[]> = {
  dashboard:["Dashboard"],demands:["Demands","DemandEditor"],projects:["Projects","ProjectApproval"],
  frameworks:["Frameworks"],agreements:["Agreements"],
  finance:["Finance","SettlementCreate","SettlementEdit","SettlementVoid","SettlementReview"],
  ledger:["Ledger"],materials:["Materials"],standards:["Operations"],pricing:["Pricing"],
  dictionaries:["Dictionaries"],system:["System","Users","Audit","Access","Profile"],
};
export function guideRouteKey(name:unknown){
  return Object.entries(routeNames).find(([,routes])=>routes.includes(String(name)))?.[0]??"";
}
export const navigationItems=guideModules.map(module=>({key:module.id,title:module.title,
  names:module.id==="system"?["System","Users","Audit","Access","Profile"]:routeNames[module.id].slice(0,1)}));

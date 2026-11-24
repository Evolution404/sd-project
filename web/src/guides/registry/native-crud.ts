/** Upstream CRUD actions are bound by stable business context and action key, never by row index or button text. */
const mappings:Record<string,Record<string,string>>={
  demands:{"export-selection":"demands.export-selection","batch-confirm":"demands.batch-confirm",create:"demands.create","excel-import":"excel.import","excel-report":"excel.export-filtered",detail:"demands.detail",confirm:"demands.confirm"},
  projects:{"export-selection":"projects.export-selection","batch-stock":"projects.batch-stock",create:"projects.create",detail:"projects.detail",edit:"projects.edit-project"},
  "funding:frameworks":{create:"frameworks.create",view:"frameworks.detail",edit:"frameworks.edit",details:"frameworks.projects",history:"frameworks.history",delete:"frameworks.delete"},
  "funding:agreements":{create:"agreements.create",view:"agreements.detail",edit:"agreements.edit",details:"agreements.projects",history:"agreements.history",delete:"agreements.delete"},
  materials:{create:"materials.create",bulk:"materials.batch-edit",view:"materials.detail",edit:"materials.edit",delete:"materials.disable",history:"materials.history"},
  prices:{"create-rule":"pricing.create","view-rule":"pricing.detail","edit-rule":"pricing.edit",history:"pricing.history"},
  settlements:{create:"finance.settlement-draft",exchange:"excel.import",detail:"finance.settlement-detail","edit-draft":"finance.edit-draft"},
  "finance:costs":{register:"finance.cost",history:"finance.history",reconcile:"finance.reconcile",revise:"finance.cost-revise",void:"finance.cost-void",remove:"finance.cost-delete"},
  "finance:reconciliations":{history:"finance.history",edit:"finance.reconcile-revise",void:"finance.reconcile-void",remove:"finance.reconcile-delete"},
  "finance:portfolio":{trace:"finance.history"},
  "equipment:lines":{create:"ledger.line"}, "equipment:physical":{create:"ledger.physical"},
  "equipment:towers":{create:"ledger.logical"}, "equipment:spans":{create:"ledger.span"},
  "equipment:voltages":{create:"dictionaries.voltage"},
  equipment:{bulk:"ledger.bulk",detail:"ledger.detail",edit:"ledger.edit",exchange:"excel.import"},
  "dictionaries:units":{create:"dictionaries.unit"},
  "dictionaries:priorities":{create:"dictionaries.category"},
  "dictionaries:categories":{create:"dictionaries.category"},
  "dictionaries:tower_natures":{create:"dictionaries.tower-nature"},
  "dictionaries:tower_materials":{create:"dictionaries.tower-material"},
  dictionaries:{view:"dictionaries.detail",edit:"dictionaries.edit",history:"dictionaries.history",delete:"dictionaries.delete"},
  standards:{create:"standards.object","create-operation":"standards.operation",view:"standards.detail",edit:"standards.edit",history:"standards.version","view-operation":"standards.detail","edit-operation":"standards.edit"},
  users:{create:"system.user",view:"system.user-detail",edit:"system.user-edit",delete:"system.user-disable"},
  audit:{details:"system.audit"},
  "access:ips":{edit:"system.ip-edit",delete:"system.ip-remove"},
  "access:logs":{export:"system.access-export",detail:"system.access-detail"},
};
export const nativeCrudGuideIds=[...new Set(Object.values(mappings).flatMap(x=>Object.values(x)))];
export function crudGuideAction(stateKey:string|undefined,actionKey:string):string|undefined{
  if(!stateKey)return;
  const segments=stateKey.split(":");
  for(let n=segments.length;n>0;n--){
    const match=mappings[segments.slice(0,n).join(":")]?.[actionKey];
    if(match)return match;
  }
}

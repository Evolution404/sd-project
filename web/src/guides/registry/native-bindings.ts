/** Shared native form and evidence action bindings, used by production and its coverage gate. */
import {historyScopeGuideIds} from "./history-scope.ts";
const saves:Readonly<Record<string,string>>={
  "funding:frameworks":"frameworks.save","funding:agreements":"agreements.save",
  materials:"materials.save",equipment:"ledger.save",dictionaries:"dictionaries.save",
  standards:"standards.save",projects:"projects.save",users:"system.user-save",
};
export function formSaveGuide(stateKey:string|undefined){
  const key=stateKey??"";
  return saves[key]??saves[key.split(":")[0]];
}
const evidenceActions=["add","filter","download","revise","delete"] as const;
export function evidenceGuide(kind:string,action:typeof evidenceActions[number]){
  return (kind==="demand_id"||kind==="source_id"?"demands":"finance")+".evidence-"+action;
}
export const nativeDynamicGuideIds=["demands.location-remove-bulk","demands.location-select-confirm","demands.material-add-confirm","demands.material-remove","demands.source-remove","materials.undo","materials.redo",...historyScopeGuideIds,...Object.values(saves),...["demand_id","cost_version_id"].flatMap(kind=>evidenceActions.map(action=>evidenceGuide(kind,action)))];

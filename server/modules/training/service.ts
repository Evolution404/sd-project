import type { Actor } from "../../shared/types/contracts.js";
import { isObject } from "../../shared/types/contracts.js";
import type { TrainingScenario, ScenarioStep } from "../../shared/types/training.js";
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { resolve, join } from "node:path";
import type { trainingRepository } from "../../database/repositories/training.js";

export const TRAINING_COURSES = [
  "L01","L02","L03","L04","L05","L06","L07","L08","L09","L10","L11","L12",
] as const;
export type TrainingCourseId = typeof TRAINING_COURSES[number];
export type TrainingEvent = "excel_invalid_preview"|"excel_valid_preview"|"excel_commit"|"forbidden";
type Evidence = {
  invalidPreview:boolean;
  correctedBatchId:string|null;
  committed:boolean;
  forbidden:boolean;
};
type Recorded = { version: 2; byActor: Record<string,Evidence> };
const emptyEvidence = ():Evidence => ({
  invalidPreview:false,correctedBatchId:null,committed:false,forbidden:false,
});
const markerFile = "TRAINING-INSTANCE.json";
const eventsFile = "TRAINING-EVIDENCE.json";

function validId(value:unknown):value is string {
  return typeof value==="string" && /^[a-f0-9]{32}$/.test(value);
}

/** No HTTP request values can promote a normal production server to training. */
function readInstance(directory:string) {
  if (!validId(process.env.SD_TRAINING_INSTANCE_ID)) return null;
  if (!process.env.SD_TRAINING_DATA_DIR ||
      resolve(directory)!==resolve(process.env.SD_TRAINING_DATA_DIR)) return null;
  try {
    const markerPath=join(directory,markerFile);
    if (!existsSync(markerPath)) return null;
    const marker:unknown=JSON.parse(readFileSync(markerPath,"utf8"));
    return isObject(marker) && marker.purpose==="sd-project-isolated-training" &&
      marker.id===process.env.SD_TRAINING_INSTANCE_ID ? marker : null;
  } catch { return null; }
}
export function trustedTrainingInstance(directory:string): boolean {
  return readInstance(directory)!==null;
}
function readEvents(directory:string):Recorded {
  try {
    const parsed:unknown=JSON.parse(readFileSync(join(directory,eventsFile),"utf8"));
    if(typeof parsed!=="object"||parsed===null) return {version:2,byActor:{}};
    const data=parsed as Recorded;
    if(data.version!==2 || typeof data.byActor!=="object" || data.byActor===null)
      return {version:2,byActor:{}};
    return data;
  } catch {return {version:2,byActor:{}};}
}
export function createTrainingService(repository:ReturnType<typeof trainingRepository>,directory:string,
  readFinance:(id:string)=>{actual_cost_fen:number;settlement_fen:number;settlement_progress_percent:number|null}) {
  const instance=readInstance(directory);
  const enabled=instance!==null;
  // Record only course-evidence categories and authenticated technical actor id.
  // There are no credentials, business records, uploaded files, or arbitrary paths.
  function record(actorId:string,event:TrainingEvent,batchId?:string) {
    if(!enabled || !/^[a-f0-9-]{20,50}$/i.test(actorId)) return;
    const state=readEvents(directory);
    const evidence=state.byActor[actorId]??emptyEvidence();
    if(event==="excel_invalid_preview"){
      evidence.invalidPreview=true;
      evidence.correctedBatchId=null;
      evidence.committed=false;
    }else if(event==="excel_valid_preview"){
      // Only a corrected, actually validated batch can progress the course.
      if(evidence.invalidPreview && typeof batchId==="string" &&
          /^[a-f0-9-]{32,36}$/i.test(batchId))
        evidence.correctedBatchId=batchId;
    }else if(event==="excel_commit"){
      // A successful commit MUST refer to the exact corrected preview batch.
      if(evidence.correctedBatchId && batchId===evidence.correctedBatchId)
        evidence.committed=true;
    }else if(event==="forbidden"){
      evidence.forbidden=true;
    }
    state.byActor[actorId]=evidence;
    const target=join(directory,eventsFile);
    const temporary=target+".pending";
    writeFileSync(temporary,JSON.stringify(state),{encoding:"utf8",mode:0o600});
    renameSync(temporary,target);
  }
  function checkpoints(actorId:string) {
    if(!enabled)
      return { training:false, courses:[] as Array<{id:TrainingCourseId;completed:boolean;details:string}> };
    const facts=repository.facts();
    const events=readEvents(directory).byActor[actorId]??emptyEvidence();
    // Each completed flag is a fresh query of persisted business facts. Client
    // reading, tour steps, and draft edits have no influence on these statuses.
    const actual:ReadonlyArray<readonly [TrainingCourseId,boolean,string]>=[
      ["L01",facts.unitVersions>0&&facts.workObjects>0,"有效计量单位与作业对象正式定义"],
      ["L02",facts.topologyConnected>0&&facts.materials>0,"线路、实体/逻辑杆塔、档距及物资"],
      ["L03",facts.operations>0&&facts.priceRules>0,"已采用作业对象版本的操作类型与有效参考价"],
      ["L04",facts.multiLocationDemands>0&&facts.demandVersions>0,"包含两处以上真实位置的正式需求版本"],
      ["L05",facts.activeDemands>0,"至少一项正式确认的有效需求及生命周期事件"],
      ["L06",facts.frameworks>0&&facts.agreements>0&&facts.fundedLinkedDemands>0,"框架、执行协议及唯一当前需求承接"],
      ["L07",facts.approvedProjects>0&&facts.approvedChanges>0,"项目正式批准和至少一次正式变更"],
      ["L08",facts.actualCosts>0,"至少一条已核定的正式实际费用"],
      ["L09",facts.multiSettlementProjects>0,"同一项目两份不同稳定身份的已审核正式结算"],
      ["L10",facts.closedReconciledProjects>0,"正式费用核对和带差异快照的结项"],
      ["L11",events.invalidPreview&&Boolean(events.correctedBatchId)&&events.committed&&facts.importedDemands>0,
        "同一账号：错误预检→纠正后有效预检→按该批次实际提交，留存正式批次需求"],
      ["L12",events.forbidden&&facts.auditEvents>0,
        "真实账号无权写入获得403，正式业务审计记录存在"],
    ];
    return {
      training:true,
      courses:actual.map(([id,completed,details])=>({id,completed,details})),
    };
  }

  function journey(actor: Actor): TrainingScenario | null {
    const seed = isObject(instance?.scenario) ? instance.scenario : null;
    const operationId = seed?.operationId;
    const frameworkId = seed?.frameworkId;
    if (typeof operationId !== "string" || typeof frameworkId !== "string") return null;
    const data = repository.scenarioFacts({operationId,frameworkId});
    const totals = data?.projectId ? readFinance(data.projectId) : null;
    const facts = data ? { ...data, actualCost:totals?.actual_cost_fen ?? 0, approvedAmount:totals?.settlement_fen ?? 0 } : null;
    const checks: [ScenarioStep, boolean][] = [
      ["register",Boolean(facts)],
      ["return-demand",Boolean(facts?.returnedDemand)],
      ["revise-demand",Boolean(facts?.correctedAfterReturn && facts.demandStatus==="active")],
      ["link",Boolean(facts?.projectId)],
      ["approve",Boolean(facts?.firstApproval)],
      ["change",Boolean(facts?.changedApproval)],
      ["cost",Boolean(facts?.actualCost && facts.actualCost>0)],
      ["review",Boolean(facts?.totalBillReturned && facts.totalBillResubmitted && facts.totalBillStatus==="approve")],
      ["itemized",Boolean(facts?.itemizedApproved)],
      ["close",Boolean(facts?.closed)],
    ];
    let completed = true;
    const steps = checks.map(([id, verified]) => ({id, completed:completed &&= verified}));
    return { steps,facts,canProceed:actor.role==="admin",
      progressPercent:totals?.settlement_progress_percent ?? null };
  }
  return {enabled,record,checkpoints,journey};
}

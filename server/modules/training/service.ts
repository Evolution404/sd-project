import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { resolve, join } from "node:path";
import type { trainingRepository } from "../../database/repositories/training.js";

export const TRAINING_COURSES = [
  "L01","L02","L03","L04","L05","L06","L07","L08","L09","L10","L11","L12",
] as const;
export type TrainingCourseId = typeof TRAINING_COURSES[number];
export type TrainingEvent = "excel_preview"|"excel_commit"|"forbidden";
type Counters = Record<TrainingEvent,number>;
type Recorded = { version: 1; byActor: Record<string,Partial<Counters>> };
const markerFile = "TRAINING-INSTANCE.json";
const eventsFile = "TRAINING-EVIDENCE.json";

function validId(value:unknown):value is string {
  return typeof value==="string" && /^[a-f0-9]{32}$/.test(value);
}

/** No HTTP request values can promote a normal production server to training. */
export function trustedTrainingInstance(directory:string): boolean {
  if (!validId(process.env.SD_TRAINING_INSTANCE_ID)) return false;
  if (!process.env.SD_TRAINING_DATA_DIR ||
      resolve(directory)!==resolve(process.env.SD_TRAINING_DATA_DIR)) return false;
  try {
    const markerPath=join(directory,markerFile);
    if (!existsSync(markerPath)) return false;
    const marker:unknown=JSON.parse(readFileSync(markerPath,"utf8"));
    if (typeof marker!=="object" || marker===null) return false;
    const data=marker as {purpose?:unknown;id?:unknown};
    return data.purpose==="sd-project-isolated-training" &&
      data.id===process.env.SD_TRAINING_INSTANCE_ID;
  } catch { return false; }
}
function readEvents(directory:string):Recorded {
  try {
    const parsed:unknown=JSON.parse(readFileSync(join(directory,eventsFile),"utf8"));
    if(typeof parsed!=="object"||parsed===null) return {version:1,byActor:{}};
    const data=parsed as Recorded;
    if(data.version!==1 || typeof data.byActor!=="object" || data.byActor===null)
      return {version:1,byActor:{}};
    return data;
  } catch {return {version:1,byActor:{}};}
}
export function createTrainingService(repository:ReturnType<typeof trainingRepository>,directory:string) {
  const enabled=trustedTrainingInstance(directory);
  // Record only course-evidence categories and authenticated technical actor id.
  // There are no credentials, business records, uploaded files, or arbitrary paths.
  function record(actorId:string,event:TrainingEvent) {
    if(!enabled || !/^[a-f0-9-]{20,50}$/i.test(actorId)) return;
    const state=readEvents(directory);
    const events=state.byActor[actorId]??{};
    events[event]=Math.min((events[event]??0)+1,100000);
    state.byActor[actorId]=events;
    const target=join(directory,eventsFile);
    const temporary=target+".pending";
    writeFileSync(temporary,JSON.stringify(state),{encoding:"utf8",mode:0o600});
    renameSync(temporary,target);
  }
  function checkpoints(actorId:string) {
    if(!enabled)
      return { training:false, courses:[] as Array<{id:TrainingCourseId;completed:boolean;details:string}> };
    const facts=repository.facts();
    const events=readEvents(directory).byActor[actorId]??{};
    // Each completed flag is a fresh query of persisted business facts. Client
    // reading, tour steps, and draft edits have no influence on these statuses.
    const actual:ReadonlyArray<readonly [TrainingCourseId,boolean,string]>=[
      ["L01",facts.unitVersions>0&&facts.workObjects>0,"有效计量单位与作业对象正式定义"],
      ["L02",facts.lines>0&&facts.physicalTowers>0&&facts.logicalTowers>0&&facts.spans>0&&facts.materials>0,"线路、实体/逻辑杆塔、档距及物资"],
      ["L03",facts.operations>0&&facts.priceRules>0,"已采用作业对象版本的操作类型与有效参考价"],
      ["L04",facts.multiLocationDemands>0&&facts.demandVersions>0,"包含两处以上真实位置的正式需求版本"],
      ["L05",facts.activeDemands>0,"至少一项正式确认的有效需求及生命周期事件"],
      ["L06",facts.frameworks>0&&facts.agreements>0&&facts.linkedDemands>0,"框架、执行协议及唯一当前需求承接"],
      ["L07",facts.approvedProjects>0&&facts.approvedChanges>0,"项目正式批准和至少一次正式变更"],
      ["L08",facts.actualCosts>0,"至少一条已核定的正式实际费用"],
      ["L09",facts.multiSettlementProjects>0,"同一项目两份不同稳定身份的已审核正式结算"],
      ["L10",facts.reconciliations>0&&facts.closures>0,"正式费用核对和带差异快照的结项"],
      ["L11",Boolean(events.excel_preview)&&Boolean(events.excel_commit)&&facts.importedDemands>0,
        "先由Excel真实预检，再正式提交，存在带批次的需求"],
      ["L12",Boolean(events.forbidden)&&facts.auditEvents>0,
        "真实账号无权写入获得403，正式业务审计记录存在"],
    ];
    return {
      training:true,
      courses:actual.map(([id,completed,details])=>({id,completed,details})),
    };
  }
  return {enabled,record,checkpoints};
}

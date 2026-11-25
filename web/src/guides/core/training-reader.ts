import type { TrainingScenario } from "../../../../server/shared/types/training";
export interface TrainingChecks { training:boolean; courses:{id:string;completed:boolean;details:string}[] }
async function read<T>(path:"/api/training/checkpoints"|"/api/training/journey"):Promise<T>{
  const response=await fetch(path,{credentials:"same-origin",method:"GET",cache:"no-store"});
  if(!response.ok)throw Error("无法读取训练状态（"+response.status+"）");
  return response.json() as Promise<T>;
}
export function readTrainingChecks(){return read<TrainingChecks>("/api/training/checkpoints")}
export function readTrainingJourney(){return read<{scenario:TrainingScenario|null}>("/api/training/journey")}

export const GUIDE_COURSE_VERSION = 1;
export type LearningState = "reading" | "read";
export interface LearningProgress {
  courseId: string;
  version: number;
  state: LearningState;
  stepIndex: number;
}
const prefix = "sd-project-guides-v1:";
function key(actorId: string) { return prefix + encodeURIComponent(actorId); }
export function readProgress(actorId: string): Readonly<Record<string, LearningProgress>> {
  try {
    const raw = localStorage.getItem(key(actorId));
    if (!raw || raw.length > 20000) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: Record<string,LearningProgress> = {};
    for (const [id,value] of Object.entries(parsed)) {
      if (!/^L(0[1-9]|1[0-2])$/.test(id) || !value || typeof value !== "object") continue;
      const candidate = value as Partial<LearningProgress>;
      if (candidate.version !== GUIDE_COURSE_VERSION) continue;
      if (candidate.state !== "read" && candidate.state !== "reading") continue;
      if (!Number.isInteger(candidate.stepIndex) || candidate.stepIndex === undefined ||
          candidate.stepIndex < 0 || candidate.stepIndex > 20) continue;
      result[id]={courseId:id,version:GUIDE_COURSE_VERSION,
        state:candidate.state,stepIndex:candidate.stepIndex};
    }
    return result;
  } catch { return {}; }
}
export function writeProgress(actorId:string, progress:Readonly<Record<string,LearningProgress>>) {
  localStorage.setItem(key(actorId), JSON.stringify(progress));
}
export function clearProgress(actorId:string) { localStorage.removeItem(key(actorId)); }

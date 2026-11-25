export type GuideModuleId =
  | "dashboard" | "demands" | "projects" | "frameworks" | "agreements" | "finance"
  | "ledger" | "materials" | "standards" | "pricing" | "dictionaries" | "system";
export type GuideRole = "admin" | "editor" | "verifier" | "viewer";
export interface GuideAction {
  id: string;
  module: GuideModuleId | "excel";
  title: string;
  aliases: readonly string[];
  purpose: string;
  prerequisite: string;
  result: string;
  risk: string;
  roles: readonly GuideRole[];
  states: readonly string[];
  target: string;
  courseIds: readonly string[];
}
export interface GuideStep {
  id: string;
  title: string;
  description: string;
  target: string;
  actionId?: string;
}
export interface GuideModule {
  id: GuideModuleId;
  title: string;
  summary: string;
  routeName: string;
  steps: readonly GuideStep[];
}
export interface GuideCourse {
  id: string;
  title: string;
  roles: readonly GuideRole[];
  routeName: GuideModuleId | "excel";
  purpose: string;
  checkpoint: string;
  instructions: readonly string[];
}

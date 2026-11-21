export interface TrainingScenarioSetup {
  operationId: string;
  frameworkId: string;
}

export interface TrainingScenarioFacts {
  demandId: string;
  demandNumber: string;
  demandStatus: "pending" | "returned" | "active";
  demandVersion: number;
  correctedAfterReturn: boolean;
  returnedDemand: boolean;
  projectId: string | null;
  projectNumber: string | null;
  projectStage: "reserve" | "stocked" | "approved" | "closed" | null;
  firstApproval: number;
  changedApproval: number;
  actualCost: number;
  approvedAmount: number;
  totalBillId: string | null;
  totalBillStatus: "draft" | "submit" | "return" | "reject" | "approve" | null;
  totalBillReturned: boolean;
  totalBillResubmitted: boolean;
  itemizedApproved: boolean;
  closed: boolean;
}
export type ScenarioStep = "register" | "return-demand" | "revise-demand" | "link" | "approve"
  | "change" | "cost" | "review" | "itemized" | "close";
export interface TrainingScenario {
  steps: { id: ScenarioStep; completed: boolean }[];
  facts: TrainingScenarioFacts | null;
  canProceed: boolean;
  progressPercent: number | null;
}

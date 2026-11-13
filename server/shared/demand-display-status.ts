import type { DemandDisplayStatus, DemandStatus } from "./types/demands.js";

/** Human-facing demand state; derived from formal lifecycle plus current project binding. */
export function demandDisplayStatus(status: DemandStatus, bound = false): DemandDisplayStatus {
  if (status === "active") return bound ? "已承接" : "待承接";
  if (status === "pending") return "待确认";
  if (status === "returned") return "已退回";
  return "已取消";
}

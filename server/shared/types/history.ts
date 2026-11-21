import type { CatalogKind } from "./catalog.js";

export type HistoryKind = CatalogKind | "organizations" | "demands" | "projects" |
  "costs" | "cost_nodes" | "settlements" | "reconciliations" | "audit";
export type HistoryValue = string | number | {
  format: "money" | "quantity" | "metres" | "percent" | "time";
  value: number | string;
  unit?: string;
} | null;

export interface HistoryFact {
  label: string;
  value: HistoryValue;
}

export interface HistoryChange {
  label: string;
  before: HistoryValue;
  after: HistoryValue;
}

export interface HistoryTable {
  title: string;
  columns: string[];
  rows: HistoryValue[][];
  /** Stable member identity used only to match rows during version comparison. */
  memberKeys?: string[];
}

export interface HistoryTarget {
  kind: HistoryKind;
  id: string;
  project?: string;
  entry?: string;
}

export interface HistoryLink {
  label: string;
  target: HistoryTarget;
}

export interface HistoryAttachment {
  id: string;
  name: string;
  time: string;
  removed: boolean;
}

export type HistoryCategory = "办理" | "版本" | "关联" | "金额" | "资料";
export type HistoryTone = "info" | "success" | "warning" | "danger";

export interface HistoryItem {
  id: string;
  title: string;
  time: string | null;
  actor?: string;
  summary?: string;
  badge?: string;
  category: HistoryCategory;
  tone?: HistoryTone;
  version?: number;
  versionGroup?: string;
}

export interface HistoryEntry extends HistoryItem {
  reason?: string;
  facts?: HistoryFact[];
  changes?: HistoryChange[];
  tables?: HistoryTable[];
  links?: HistoryLink[];
  files?: HistoryAttachment[];
}

export interface HistoryPage {
  name: string;
  status?: string;
  context?: HistoryFact[];
  categories: HistoryCategory[];
  items: HistoryItem[];
  total: number;
  page: number;
  selected: HistoryEntry | null;
  versions: Pick<HistoryItem, "id" | "version" | "versionGroup" | "badge" | "title">[];
}

export interface HistoryQuery {
  page: number;
  category?: string;
  actor?: string;
  entry?: string;
  start?: string;
  end?: string;
}

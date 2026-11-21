import { isObject } from "./types/contracts.js";
import type { HistoryFact, HistoryTable, HistoryValue } from "./types/history.js";

export type ReadRow = Record<string, unknown>;
export const record = (value: unknown): ReadRow => isObject(value) ? value : {};
export const rows = (value: unknown): ReadRow[] => Array.isArray(value) ? value.filter(isObject) : [];
export const string = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;
export const number = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

export function json(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value) as unknown; }
  catch { return undefined; }
}

export const document = (value: unknown) => record(json(value));
export const text = (value: unknown): HistoryValue => string(value) ?? number(value) ?? null;
export const money = (value: unknown): HistoryValue =>
  number(value) === undefined ? null : { format: "money", value: number(value)! };
export const quantity = (value: unknown, unit?: string): HistoryValue =>
  number(value) === undefined ? null : { format: "quantity", value: number(value)!, unit };
export const metres = (value: unknown, unit = "米"): HistoryValue =>
  number(value) === undefined ? null : { format: "metres", value: number(value)!, unit };
export const percent = (value: unknown): HistoryValue =>
  number(value) === undefined ? null : { format: "percent", value: number(value)! };

export function label(value: unknown, labels: Readonly<Record<string, string>>): HistoryValue {
  const key = string(value);
  return key ? (Object.hasOwn(labels, key) ? labels[key]! : "原记录未注明含义") : null;
}

export const lifecycle = { active: "有效", inactive: "已停用", retired: "已退役", draft: "草稿", voided: "已作废" };
export const methods = { outage: "停电", non_outage: "不停电", unspecified: "未明确", both: "不限作业方式" };
export function feeName(value: unknown, index: number, userDefinedName = false) {
  const names = {
    labor: "人工费", materials: "材料费", machinery: "机械费",
    transport: "运输费", main: "主要费用", mobilization: "进场费",
  };
  const key = string(value);
  if (!key) return `费用分项 ${index + 1}`;
  if (Object.hasOwn(names, key)) return names[key as keyof typeof names];
  return userDefinedName || /[\u3400-\u9fff]/.test(key) ? key : `费用分项 ${index + 1}`;
}

export const pricingModels = {
  fixed: "固定金额", per_unit: "数量乘单价", base_plus_unit: "基础费加单价",
  quantity_bracket: "整批数量阶梯", progressive_bracket: "累进阶梯", group: "按组计价", rate: "比例计价", composite: "组合费用",
};

export function facts(...entries: [string, HistoryValue | undefined][]): HistoryFact[] {
  return entries.map(([label, value]) => ({ label, value: value ?? null }));
}

export function table(title: string, columns: string[], rows: HistoryValue[][], memberKeys?: string[]): HistoryTable[] {
  return rows.length ? [{ title, columns, rows, memberKeys }] : [];
}

import { statusText } from "../api/client";

export function filterOptions(labels: Readonly<Record<string, string>>) {
  return Object.entries(labels).map(([value, label]) => ({ value, label }));
}

export function statusOptions(...values: string[]) {
  return values.map(value => ({ value, label: statusText[value] || value }));
}

export const activeOptions = statusOptions("active", "inactive");
export const costStatusOptions = filterOptions({ active: "有效", voided: "已作废" });
export const reconciliationStatusOptions = filterOptions({ active: "有效", stale: "待重新核对", voided: "已撤销" });

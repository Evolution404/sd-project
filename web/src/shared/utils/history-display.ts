import type { HistoryChange, HistoryEntry, HistoryTable, HistoryValue } from "../../../../server/shared/types/history";
import { money, quantity } from "../api/client";
import { formatBeijingDateTime, formatVisibleDateTime } from "./datetime";

export function historyValue(value?: HistoryValue): string {
  if (value === null || value === undefined || value === "") return "未记载";
  if (typeof value !== "object") return String(formatVisibleDateTime(value));
  if (value.format === "time") return formatBeijingDateTime(value.value);
  if (typeof value.value !== "number") return "未记载";
  switch (value.format) {
    case "money": return `¥${money(value.value)}`;
    case "quantity": return [quantity(value.value), value.unit].filter(Boolean).join(" ");
    case "metres": return `${value.value / 1000} ${value.unit ?? "米"}`;
    case "percent": return `${value.value}%`;
  }
}

function compareFacts(before: HistoryEntry, after: HistoryEntry): HistoryChange[] {
  const from = new Map(before.facts?.map(({ label, value }) => [label, value]));
  const to = new Map(after.facts?.map(({ label, value }) => [label, value]));
  return [...new Set([...from.keys(), ...to.keys()])].flatMap(label => {
    const previous = from.get(label) ?? null;
    const current = to.get(label) ?? null;
    return JSON.stringify(previous) === JSON.stringify(current) ? [] : [{ label, before: previous, after: current }];
  });
}

export function compareHistory(before: HistoryEntry, after: HistoryEntry) {
  const from = new Map(before.tables?.filter(table => table.compare !== false).map(table => [table.title, table]));
  const to = new Map(after.tables?.filter(table => table.compare !== false).map(table => [table.title, table]));
  const changes: HistoryTable[] = [];
  for (const title of new Set([...from.keys(), ...to.keys()])) {
    const oldTable = from.get(title);
    const newTable = to.get(title);
    const keys = (table?: HistoryTable) => new Map(table?.rows.map((row, index) => [
      table.memberKeys?.[index] ?? String(index), row,
    ]));
    const oldRows = keys(oldTable), newRows = keys(newTable);
    const rows = [...new Set([...oldRows.keys(), ...newRows.keys()])].flatMap(key => {
      const oldRow = oldRows.get(key);
      const newRow = newRows.get(key);
      if (JSON.stringify(oldRow) === JSON.stringify(newRow)) return [];
      const format = (row?: HistoryValue[]) => row?.map(value => historyValue(value)).join(" · ") ?? null;
      return [[oldRow ? newRow ? "修改" : "移除" : "新增", format(oldRow), format(newRow)]];
    });
    if (rows.length) changes.push({ title, columns: ["变化", "原内容", "新内容"], rows });
  }
  return { fields: compareFacts(before, after), tables: changes };
}

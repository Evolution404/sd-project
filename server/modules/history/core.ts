import { string, number, type ReadRow } from "../../shared/business-history-values.js";
import type { HistoryChange, HistoryEntry, HistoryFact, HistoryItem, HistoryPage, HistoryQuery } from "../../shared/types/history.js";

export { record, rows, string, number, json, document, text, money, quantity, metres, percent, label,
  lifecycle, methods, feeName, pricingModels, facts, table, type ReadRow } from "../../shared/business-history-values.js";

export function differences(before: HistoryFact[], after: HistoryFact[]): HistoryChange[] {
  const beforeByLabel = new Map(before.map(field => [field.label, field.value]));
  const afterByLabel = new Map(after.map(field => [field.label, field.value]));
  return [...new Set([...beforeByLabel.keys(), ...afterByLabel.keys()])].flatMap(label => {
    const before = beforeByLabel.get(label) ?? null;
    const after = afterByLabel.get(label) ?? null;
    return JSON.stringify(before) === JSON.stringify(after) ? [] : [{ label, before, after }];
  });
}

export function event(id: string, title: string, category: HistoryEntry["category"], row: ReadRow, extra: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id, title, category,
    time: string(row.recorded_at ?? row.changed_at ?? row.created_at) ?? null,
    actor: string(row.actor_id ?? row.actor_name ?? row.recorded_by ?? row.changed_by ?? row.created_by),
    reason: string(row.reason ?? row.change_reason),
    ...extra,
  };
}

export function readVersions(
  versions: readonly ReadRow[], group: string, fieldValues: (row: ReadRow) => HistoryFact[],
  build: (row: ReadRow, before: ReadRow | undefined, index: number) => Partial<HistoryEntry> = () => ({}),
): HistoryEntry[] {
  return versions.map((row, index) => {
    const version = number(row.version_no ?? row.version) ?? index + 1;
    const before = versions[index - 1];
    const current = fieldValues(row);
    return event(`${group}/${version}`, index ? `修订${group}` : `建立${group}`, "版本", row, {
      version, versionGroup: group, facts: current,
      changes: before ? differences(fieldValues(before), current) : [],
      ...build(row, before, index),
    });
  });
}

export interface HistoryRecord {
  name: string;
  status?: string;
  context?: HistoryFact[];
  entries: HistoryEntry[];
}

export type { HistoryQuery } from "../../shared/types/history.js";
export const HISTORY_PAGE_SIZE = 10;

function item({ id, title, time, actor, summary, badge, category, tone, version, versionGroup }: HistoryEntry): HistoryItem {
  return { id, title, time, actor, summary, badge, category, tone, version, versionGroup };
}

export function historyPage(
  { name, status, context, entries }: HistoryRecord,
  query: HistoryQuery,
  actorNames: (ids: string[]) => Map<string, string>,
): HistoryPage {
  const names = actorNames([...new Set(entries.flatMap(row => row.actor ? [row.actor] : []))]);
  const sorted = entries.map(row => ({
    ...row,
    actor: row.actor ? names.get(row.actor) ?? "历史账户（名称未记载）" : undefined,
  })).reverse().sort((a, b) => (b.time ?? "").localeCompare(a.time ?? ""));
  const categories = [...new Set(sorted.map(row => row.category))];
  const filtered = sorted.filter(row => {
    if (query.category && row.category !== query.category) return false;
    if (query.actor && !row.actor?.toLocaleLowerCase().includes(query.actor.toLocaleLowerCase())) return false;
    if (query.start || query.end) {
      const timestamp = row.time ? Date.parse(row.time) : NaN;
      if (!Number.isFinite(timestamp)) return false;
      const day = new Date(timestamp + 8 * 3600_000).toISOString().slice(0, 10);
      if ((query.start && day < query.start) || (query.end && day > query.end)) return false;
    }
    return true;
  });
  const pageSize = HISTORY_PAGE_SIZE;
  const selectedPosition = query.entry ? filtered.findIndex(row => row.id === query.entry) : -1;
  const page = selectedPosition >= 0 ? Math.floor(selectedPosition / pageSize) + 1
    : Math.max(1, Math.min(query.page, Math.ceil(filtered.length / pageSize)));
  const slice = filtered.slice((page - 1) * pageSize, page * pageSize);
  const defaultItem = query.category || page > 1 ? slice[0] : slice.find(row => row.category !== "资料") ?? slice[0];
  return {
    name, status, context, categories, items: slice.map(item), total: filtered.length, page,
    selected: selectedPosition >= 0 ? filtered[selectedPosition]! : defaultItem ?? null,
    versions: sorted.filter(row => row.version !== undefined && row.versionGroup).map(
      ({ id, title, version, versionGroup, badge }) => ({ id, title, version, versionGroup, badge }),
    ),
  };
}

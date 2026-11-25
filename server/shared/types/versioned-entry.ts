export const MAX_VERSIONED_ENTRY_ROWS = 100;

export interface VersionedEntryRow {
  ref: string;
  id?: string;
  values: Record<string, unknown>;
}
export interface VersionedEntryResult {
  count: number;
  fingerprint?: string;
  ids?: string[];
}

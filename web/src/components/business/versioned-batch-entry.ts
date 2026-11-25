import type { WorksheetColumn } from "@/components/BusinessWorksheet/univer-engine";
import type { VersionedEntryRow, VersionedEntryResult } from "../../../../server/shared/types/versioned-entry";

export interface VersionedEntryChoice {
  id: string;
  name: string;
  code?: string;
  version?: number;
  snapshot?: string;
  context?: string;
  fields: Record<string, string>;
}
export interface VersionedBatchEntryConfig {
  title: string;
  columns: WorksheetColumn[];
  createReady?: boolean;
  initial: () => Record<string, string>;
  choices: (keyword: string, page: number) => Promise<{ items: VersionedEntryChoice[]; total: number }>;
  values: (fields: Readonly<Record<string, string>>, record?: VersionedEntryChoice) => Record<string, unknown>;
  endpoint: string;
}
export async function submitVersionedBatch(endpoint: string, rows: VersionedEntryRow[], proof?: { fingerprint: string; key: string }) {
  const response = await fetch(endpoint + (proof ? "/commit" : "/preview"), {
    method: "POST", credentials: "same-origin", headers: {
      "Content-Type": "application/json", ...(proof ? { "Idempotency-Key": proof.key } : {}),
    }, body: JSON.stringify({ rows, fingerprint: proof?.fingerprint }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(Error(payload.message || "批量请求失败"), { fields: payload.fields });
  return payload as VersionedEntryResult;
}

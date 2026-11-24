import { randomRequestId } from "@/utils/business/request-id";

export type EvidenceOwner = "demand_id" | "cost_version_id" | "settlement_version_id" | "source_id";
export interface EvidenceRecord {
  id: string;
  filename: string;
  bytes: number;
  linked_at: string;
  note: string;
  deleted: boolean;
}

async function request<T>(suffix: string, method = "GET", input?: unknown): Promise<T> {
  const response = await fetch("/api/evidence" + suffix, {
    method, credentials: "same-origin",
    ...(method === "GET" ? {} : {
      headers: { "Content-Type": "application/json", "Idempotency-Key": randomRequestId() },
      body: JSON.stringify(input ?? {}),
    }),
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.message || "附件办理失败");
  return data as T;
}

export const listEvidence = (kind: EvidenceOwner, owner: string, deleted: boolean) =>
  request<EvidenceRecord[]>("?" + new URLSearchParams({ owner_kind: kind, owner_id: owner, deleted: String(deleted) }));
export const evidenceUrl = (id: string) => "/api/evidence/" + encodeURIComponent(id);
export const updateEvidenceNote = (id: string, note: string) =>
  request("/" + encodeURIComponent(id), "POST", { note });
export const removeEvidence = (id: string) => request("/" + encodeURIComponent(id), "DELETE");
export async function uploadEvidence(kind: EvidenceOwner, owner: string, file: File) {
  if (!file.size || file.size > 10 * 1024 * 1024) throw Error("请选择 10 MB 以内的非空附件");
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] || "");
    reader.onerror = () => reject(Error("读取附件失败"));
    reader.readAsDataURL(file);
  });
  return request("", "POST", { owner_kind: kind, owner_id: owner, filename: file.name, mime: file.type, base64 });
}

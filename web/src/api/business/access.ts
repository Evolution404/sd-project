import { randomRequestId } from "@/utils/business/request-id";

export interface AccessPolicy {
  ip_restriction_enabled: boolean;
  version: number;
}
export interface IpGrant {
  id: string;
  ip: string;
  note: string;
  created_at: string;
}
export interface AccessRecord {
  request_id: string;
  time: string;
  ip: string;
  username: string;
  method: string;
  path: string;
  status: number;
  duration_ms: number;
  outcome: string;
  error_type: string;
  error_summary: string;
}
interface Page<T> { items: T[]; total: number }
interface AccessPage extends Page<AccessRecord> {
  diagnostic: string;
  retention_days: number;
  max_file_bytes: number;
}

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch("/api/" + path, {
    method, credentials: "same-origin",
    ...(method === "GET" ? {} : {
      headers: { "Content-Type": "application/json", "Idempotency-Key": randomRequestId() },
      body: JSON.stringify(body ?? {}),
    }),
  });
  const payload = await response.json();
  if (!response.ok) throw Error(payload.message || "访问控制请求失败");
  return payload as T;
}
export const readAccessPolicy = () => request<AccessPolicy>("access-policy");
export const setAccessPolicy = (enabled: boolean, version: number) =>
  request<AccessPolicy>("access-policy", "POST", { ip_restriction_enabled: enabled, expected_version: version });
export const listIpGrants = (query: URLSearchParams) => request<Page<IpGrant>>("ips?" + query);
export const saveIpGrant = (ip: string, note: string, id?: string) =>
  request("ips" + (id ? "/" + encodeURIComponent(id) : ""), "POST", { ip, note });
export const deleteIpGrant = (id: string) => request("ips/" + encodeURIComponent(id), "DELETE");
export const listAccessRecords = (query: URLSearchParams) => request<AccessPage>("access-logs?" + query);

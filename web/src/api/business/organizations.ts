import type { OrganizationDetail, OrganizationMovePreview, OrganizationNode } from "../../../../server/shared/types/trees";
import { randomRequestId } from "@/utils/business/request-id";

export type { OrganizationDetail, OrganizationMovePreview, OrganizationNode };
export interface OrganizationForm {
  name: string;
  status: "active" | "inactive";
  version_no?: number;
  parent_id?: string | null;
  reason?: string;
}

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch("/api" + path, {
    method, credentials: "same-origin",
    ...(body ? { headers: { "Content-Type": "application/json", "Idempotency-Key": randomRequestId() },
      body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.message || "组织资料读取失败");
  return result as T;
}

export const organizationTree = () => request<OrganizationNode[]>("/organizations");
const recordPath = (id: string) => "/organizations/" + encodeURIComponent(id);
const catalogPath = (id?: string) => "/catalog/organizations" + (id ? "/" + encodeURIComponent(id) : "");

export const readOrganization = (id: string) => request<OrganizationDetail>(recordPath(id));
export function saveOrganization(form: OrganizationForm, id?: string) {
  return request<OrganizationNode>(catalogPath(id), "POST", {
    name: form.name.trim(), status: form.status, reason: form.reason || "",
    ...(id ? { expected_version: form.version_no } : { parent_unit_id: form.parent_id || null }),
  });
}
export function previewOrganizationMove(id: string, parentId: string | null) {
  return request<OrganizationMovePreview>(recordPath(id) + "/move-preview?" + new URLSearchParams({ parent_id: parentId || "" }));
}
export function moveOrganization(id: string, preview: OrganizationMovePreview) {
  return request<OrganizationNode>(recordPath(id) + "/parent", "POST", {
    parent_id: preview.parent_id, expected_version: preview.expected_version,
    preview_hash: preview.preview_hash, confirm_move: true,
  });
}
export function deleteOrganization(node: OrganizationNode, impact: OrganizationDetail["references"]) {
  return request(catalogPath(node.id), "DELETE", {
    expected_version: node.version_no, expected_children: impact.children, expected_references: impact.historical_projects,
  });
}

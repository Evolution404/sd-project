import type { AuditRecord } from "./contracts.js";
export type DictionaryKind = "units" | "priorities" | "categories";
export type FoundationKind = DictionaryKind | "organizations";
export type DefinitionStatus = "active" | "inactive";
export interface DictionaryItem {
  id: string;
  item_id: string;
  type_id: string;
  code: string;
  current_version_id: string;
  version: number;
  name: string;
  status: DefinitionStatus;
  sort_order: number;
  fields_json: string;
  changed_by: string;
  /** Read projection; exact rule is persisted in versioned fields_json. */
  quantity_precision?: number;
  changed_at: string;
  updated_at: string;
  created_at: string;
  reason: string;
  label: string;
  deleted: boolean;
}
export interface DictionaryVersion {
  id: string;
  item_id: string;
  version: number;
  name: string;
  status: DefinitionStatus;
  sort_order: number;
  fields_json: string;
  reason: string;
  quantity_precision?: number;
  changed_by: string;
  changed_at: string;
}
export interface OrganizationDefinition {
  id: string;
  code: string;
  unit_id: string;
  unit_version_id: string;
  version_no: number;
  name: string;
  status: DefinitionStatus;
  parent_unit_id: string | null;
  parent_unit_id_label?: string | null;
  actor_id: string;
  recorded_at: string;
  reason: string;
  label: string;
  deleted: boolean;
}
export interface OrganizationVersion {
  id: string;
  unit_id: string;
  version_no: number;
  name: string;
  status: DefinitionStatus;
  parent_unit_id: string | null;
  actor_id: string;
  recorded_at: string;
  reason: string;
}
export interface MaterialRecord {
  id: string;
  material_id: string;
  material_version_id: string;
  code: string;
  unit_id: string;
  unit_id_label: string;
  created_by: string | null;
  created_at: string;
  version_no: number;
  name: string;
  model: string;
  specification: string;
  category_id: string | null;
  status: DefinitionStatus;
  note: string;
  reason: string;
  changed_by: string;
  recorded_at: string;
  updated_at: string;
  label: string;
  deleted: boolean;
}
export interface MaterialVersion {
  id: string;
  material_id: string;
  version_no: number;
  name: string;
  model: string;
  specification: string;
  category_id: string | null;
  status: DefinitionStatus;
  note: string;
  reason: string;
  changed_by: string;
  recorded_at: string;
}

export interface DefinitionDetail<T, V> {
  item: T;
  versions: V[];
  audits: AuditRecord[];
}
export type DictionaryDetail = DefinitionDetail<
  DictionaryItem,
  DictionaryVersion
>;
export type MaterialDetail = DefinitionDetail<MaterialRecord, MaterialVersion>;

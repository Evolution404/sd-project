import type {
  DefinitionStatus,
} from "./master-data.js";
import type { AuditRecord } from "./contracts.js";
export type ObjectPosition = "body" | "corridor";
export type AttributionUnit = "physical_tower" | "logical_tower";
export interface WorkObjectVersion {
  id: string;
  work_object_id: string;
  version_no: number;
  name: string;
  object_position: ObjectPosition;
  attribution_unit: AttributionUnit;
  status: DefinitionStatus;
  sort_order: number;
  reason: string;
  changed_by: string;
  recorded_at: string;
}
export interface WorkObjectRecord extends Omit<WorkObjectVersion, "id"> {
  id: string;
  code: string;
  created_at: string;
  current_version_id: string;
  label: string;
  deleted: boolean;
}
export interface OperationVersion {
  id: string;
  operation_id: string;
  version: number;
  name: string;
  status: DefinitionStatus;
  sort_order: number;
  work_object_id: string;
  work_object_version_no: number;
  default_unit_id: string;
  default_unit_version: number;
  default_quantity_scaled: number | null;
  completion_standard: string | null;
  attributes_schema_json: string;
  default_target_object: string;
  entry_hint: string;
  reason: string;
  changed_by: string;
  changed_at: string;
}
export interface OperationRecord extends Omit<OperationVersion, "id"> {
  /** Read-only projection from the operation's adopted immutable object version. */
  object_position: ObjectPosition;
  attribution_unit: AttributionUnit;
  id: string;
  code: string;
  created_at: string;
  current_version_id: string;
  updated_at: string;
  default_unit_id_label: string;
  work_object_id_label: string;
  label: string;
  deleted: boolean;
}
export interface OperationAdoptions {
  demands: { id: string; demand_no: string; demand_version: number; operation_version: number }[];
  prices: { id: string; title: string; version_no: number; operation_version: number }[];
}
export interface OperationDetail {
  item: OperationRecord;
  versions: OperationVersion[];
  audits: AuditRecord[];
  adoptions: OperationAdoptions;
}

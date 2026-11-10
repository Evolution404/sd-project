import type { AuditRecord, JsonValue, ListQuery } from "./contracts.js";

export type EquipmentKind = "lines" | "physical" | "towers" | "spans";
export type EquipmentCatalogKind = EquipmentKind | "voltages";
export type EquipmentStatus = "active" | "inactive" | "retired" | "draft";
export interface PhysicalBinding {
  physical_tower_id: string;
  logical_tower_id: string;
  tower_no: string;
  logical_status: EquipmentStatus;
  logical_deleted: boolean;
  line_id: string;
  line_name: string;
  line_status: EquipmentStatus;
  voltage_name: string | null;
}
export interface EquipmentRecord {
  id: string;
  status: EquipmentStatus;
  version: number;
  deleted: boolean;
  label: string;
  code?: string;
  name?: string;
  line_code?: string;
  tower_code?: string;
  logical_code?: string;
  voltage_level_id?: string;
  voltage_level_name?: string;
  voltage_level_id_label?: string;
  line_kind?: "main" | "branch";
  parent_line_id?: string | null;
  parent_line_name?: string | null;
  parent_line_id_label?: string | null;
  junction_tower_id?: string | null;
  junction_tower_no?: string | null;
  junction_tower_id_label?: string | null;
  setup_status?: "draft" | "ready";
  asset_no?: string | null;
  tower_type?: string | null;
  tower_nature?: "straight" | "tension" | null;
  model?: string;
  height_scaled?: number | null;
  purpose?: string;
  longitude?: number | null;
  latitude?: number | null;
  commissioned_on?: string | null;
  line_id?: string;
  line_name?: string;
  line_id_label?: string;
  physical_tower_id?: string | null;
  physical_tower_id_label?: string;
  tower_no?: string;
  display_name?: string | null;
  sort_rank?: number;
  circuit_position?: string | null;
  operations_team?: string;
  management_department?: string;
  start_tower_id?: string;
  start_tower_no?: string;
  start_tower_id_label?: string;
  end_tower_id?: string;
  end_tower_no?: string;
  end_tower_id_label?: string;
  transmission_center_length_mm?: number | null;
  current_circuits?: number;
  related_lines?: string;
  related_towers?: string;
  bindings?: PhysicalBinding[];
  identity_decisions?: AuditRecord[];
  replacements?: AuditRecord[];
  created_at?: string;
  created_by?: string;
  updated_at?: string | null;
  updated_by?: string | null;
  change_reason?: string;
}
export interface EquipmentSearchOptions
  extends Partial<Omit<ListQuery, "filters">> {
  filters?: Record<string, string> | string | null;
  page?: number;
  page_size?: number;
  lineId?: string | null;
  lineKind?: string | null;
  excludeId?: string | null;
}
export type EquipmentFieldValue = string | number | null;
export type EquipmentFields = Partial<
  Record<keyof EquipmentRecord, EquipmentFieldValue>
>;
export type EquipmentHistory = Record<string, JsonValue>;
export interface ReplacementBinding {
  id: string;
  version: number;
}
export interface ReplacementPreview {
  physical: EquipmentRecord;
  bindings: EquipmentRecord[];
}

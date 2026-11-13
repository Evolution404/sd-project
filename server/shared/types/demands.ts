import type { ObjectPosition, AttributionUnit } from "./work-standards.js";
import type { AttributeValues } from "./operation-attributes.js";
import type { Actor, ListQuery, Page } from "./contracts.js";
import type { OperationRecord } from "./work-standards.js";
import type { WorkObjectRecord } from "./work-standards.js";
import type { DictionaryItem, MaterialRecord } from "./master-data.js";
import type { EquipmentRecord, EquipmentCatalogKind } from "./equipment.js";

export type DemandStatus = "pending" | "active" | "returned" | "cancelled";
export interface DemandCurrentRow {
  id: string;
  demand_no: string;
  current_version: number;
  full_definition_json: string;
  status: DemandStatus;
  deleted?: number | boolean;
  binding_json?: string | null;
}
export interface DemandMaterialRow {
  demand_id: string;
  demand_version: number;
  material_id: string;
  material_version_id: string;
  item_no: number;
  quantity_scaled: number;
  unit_id: string;
  unit_snapshot: string;
  note: string;
  material_name: string;
  model: string;
  specification: string;
}
export interface SourceRow {
  id: string;
  description: string;
  discovered_on: string | null;
  proposed_by: string | null;
  source_system: "manual" | "excel" | "other";
  created_by: string;
  created_at: string;
  deleted?: boolean;
  superseded?: boolean;
  [field: string]: unknown;
}
export interface DemandLocationKey {
  logical_tower_id?: string | null;
  physical_tower_id?: string | null;
  span_id?: string | null;
}

export type DemandLocationKind = "logical_tower" | "physical_tower" | "span";
export type DemandWorkMode = "outage" | "non_outage" | "unspecified";
export interface DemandLocationSnapshot {
  physical_tower_id: string | null;
  line_name: string;
  line_id: string | null;
  voltage_level_id: string | null;
  voltage_code: string | null;
  specification: string;
  tower_no: string;
  asset_no: string | null;
  physical_code: string;
  tower_material: string | null;
  tower_nature: string | null;
  span: EquipmentRecord | null;
  location_label: string;
}
export interface DemandLocationInput {
  location_kind: DemandLocationKind;
  logical_tower_id?: string | null;
  physical_tower_id?: string | null;
  span_id?: string | null;
  span_version?: number | null;
  adopt_current_definition?: boolean;
  context_line_id?: string | null;
  quantity_scaled: number;
  work_mode?: DemandWorkMode;
  attributes?: AttributeValues;
  location_snapshot_json?: Partial<DemandLocationSnapshot>;
  specification?: string;
}
export interface DemandLocation extends Omit<DemandLocationInput, "attributes" | "location_snapshot_json"> {
  item_no: number;
  work_mode: DemandWorkMode;
  attributes: AttributeValues;
  location_snapshot_json: DemandLocationSnapshot;
}
export interface DemandMaterialInput {
  material_id: string;
  quantity_scaled: number;
  note?: string;
}
export interface DemandMaterial extends DemandMaterialInput {
  note: string;
  item_no: number;
}
export interface DemandSourceInput {
  action?: "upsert" | "delete";
  id?: string;
  description?: string;
  discovered_on?: string | null;
  proposed_by?: string | null;
  external_record_id?: string | null;
}
export interface DemandWriteInput {
  expected_version?: number;
  operation_id?: string;
  operation_version?: number;
  work_object_id?: string;
  unit_id?: string;
  work_locations?: DemandLocationInput[];
  materials?: DemandMaterialInput[];
  sources?: DemandSourceInput[];
  target_object?: string;
  problem_description?: string;
  completion_standard?: string;
  attributes?: AttributeValues;
  priority_id?: string | null;
  expected_on?: string | null;
  duplicate_decision?: "separate";
  duplicate_matches?: string[];
  duplicate_review_tokens?: Record<string, string>;
  duplicate_reason?: string;
  reason?: string;
}
export interface NormalizedDemand {
  operation_id: string;
  operation_version: number;
  operation_snapshot: string;
  work_object_id: string;
  work_object_snapshot: string;
  object_position: ObjectPosition;
  attribution_unit: AttributionUnit;
  unit_id: string;
  unit_version: number;
  unit_snapshot: string;
  quantity_scaled: number;
  target_object: string;
  problem_description: string;
  completion_standard: string;
  priority_id: string | null;
  priority_snapshot: string | null;
  expected_on: string | null;
  logical_tower_id: string | null;
  physical_tower_id: string | null;
  span_id: string | null;
  span_version: number | null;
  span_snapshot_json: string | null;
  observed_physical_tower_id: string | null;
  context_line_id: string | null;
  line_name_snapshot: string;
  tower_no_snapshot: string;
  physical_code_snapshot: string;
  attributes: AttributeValues;
  work_locations: DemandLocation[];
  materials: DemandMaterial[];
}
export interface DemandRecord extends Omit<NormalizedDemand, "materials">, DemandCurrentRow {
  deleted: boolean;
  materials: DemandMaterialRow[];
  sources: SourceRow[];
  binding: { project_id: string; project_scope_id: string; demand_id: string } | null;
}
export type DemandDisplayStatus = "待确认" | "已退回" | "待承接" | "已承接" | "已取消";
export interface DemandListItem extends DemandCurrentRow, Omit<NormalizedDemand, "materials"> {
  /** Derived at query time, never stored separately from lifecycle and project binding. */
  display_status: DemandDisplayStatus;
  line_summary?: string;
  project_name?: string | null;
  last_handled_at?: string;
  location_count?: number;
  deleted: boolean;
  binding: DemandRecord["binding"];
}
export interface DemandService {
  get(id: string, includeDeleted?: boolean): DemandRecord;
  normalize(input: unknown, previous?: DemandRecord | null): NormalizedDemand;
  findDuplicates(operationId: string, locations: DemandLocationKey[], exceptId?: string): {id:string;demand_no:string}[];
  save(actor: Actor, input: unknown, key?: string, context?: { batchId?: string }): DemandRecord;
  search(query: ListQuery): Page<DemandListItem>;
  list(includeDeleted?: boolean): DemandListItem[];
  transition(actor: Actor, key: string, input: unknown): DemandRecord;
  history(key: string): unknown;
  remove(actor: Actor, key: string, input: unknown): { deleted: true };
}
export interface DemandCatalog {
  get(kind: "operations", key: string, includeDeleted?: boolean): OperationRecord;
  get(kind: "objects", key: string, includeDeleted?: boolean): WorkObjectRecord;
  get(kind: "units" | "priorities", key: string, includeDeleted?: boolean): DictionaryItem;
  get(kind: "materials", key: string, includeDeleted?: boolean): MaterialRecord;
  get(kind: EquipmentCatalogKind, key: string, includeDeleted?: boolean): EquipmentRecord;
  audit(actor: Actor, entity: string, id: string, action: string, before: unknown, after: unknown): void;
}

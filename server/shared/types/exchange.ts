import type { OperationAttribute } from "./operation-attributes.js";
/** Excel exchange contracts: user-visible fields and server-owned identities are distinct. */
export type WorkbookKind = "assets" | "demands" | "settlements";
export type WorkbookReportKind = WorkbookKind | "exchange";
export type WorkbookRowAction = "upsert" | "delete";
export type WorkbookPrimitive = string | number | boolean | null;

/** A workbook row's declared fields are typed; unrecognized custom field cells stay unknown. */
export interface WorkbookRow extends Record<string, unknown> {
  _sheet?: string;
  _row?: number;
  document_row?: number | null;
  id?: string | null;
  number?: string | null;
  demand_no?: string | null;
  import_ref?: string | null;
  location_ref?: string | null;
  primary_source?: string | null;
  primary_source_id?: string | null;
  expected_version?: number | null;
  expected_edit_version?: number | null;
  action?: WorkbookRowAction | null;
  name?: string | null;
  status?: string | null;
  line_kind?: "main" | "branch" | null;
  line_id?: string | null;
  line_name?: string | null;
  parent_line_id?: string | null;
  parent_line_name?: string | null;
  voltage_level_id?: string | null;
  voltage_name?: string | null;
  parent_voltage_name?: string | null;
  start_voltage_name?: string | null;
  end_voltage_name?: string | null;
  physical_tower_id?: string | null;
  logical_tower_id?: string | null;
  span_id?: string | null;
  asset_no?: string | null;
  tower_no?: string | null;
  tower_code?: string | null;
  tower_type?: string | null;
  tower_nature?: string | null;
  physical_properties?: Record<string,unknown>;
  model?: string | null;
  specification?: string | null;
  commissioned_on?: string | null;
  longitude?: string | number | null;
  latitude?: string | number | null;
  purpose?: string | null;
  height_scaled?: number | null;
  transmission_center_length_mm?: number | null;
  start_tower_no?: string | null;
  end_tower_no?: string | null;
  start_tower_id?: string | null;
  end_tower_id?: string | null;
  start_line_name?: string | null;
  end_line_name?: string | null;
  sharing_line_name?: string | null;
  sharing_tower_no?: string | null;
  sharing_voltage_name?: string | null;
  junction_tower_id?: string | null;
  junction_tower_no?: string | null;
  quantity_scaled?: number | null;
  resolved_quantity_scaled?: number | null;
  amount_fen?: number | null;
  unit_price_fen?: number | null;
  operation_id?: string | null;
  operation_name?: string | null;
  priority_id?: string | null;
  priority_name?: string | null;
  target_object?: string | null;
  problem_description?: string | null;
  completion_standard?: string | null;
  expected_on?: string | null;
  work_mode?: "outage" | "non_outage" | "unspecified" | null;
  location_kind?: "physical_tower" | "logical_tower" | "span" | null;
  material_id?: string | null;
  material_name?: string | null;
  material_model?: string | null;
  material_specification?: string | null;
  project_id?: string | null;
  project_name?: string | null;
  project_scope_id?: string | null;
  approval_version_id?: string | null;
  funding_version_id?: string | null;
  cost_node_id?: string | null;
  cost_node_path?: string | null;
  demand_description?: string | null;
  settlement_on?: string | null;
  evidence?: string | null;
  basis?: string | null;
  note?: string | null;
  description?: string | null;
  discovered_on?: string | null;
  field_key?: string | null;
  field_name?: string | null;
  factor_id?: string | null;
  factor_name?: string | null;
  value?: unknown;
}
export interface WorkbookIssue {
  import_ref?: string;
  demand_no?: string;
  location_ref?: string;
  sheet: string;
  row: number;
  field: string;
  raw_value: unknown;
  reason: string;
  suggestion: string;
}
export interface ParsedWorkbookRow extends WorkbookRow {
  _sheet: string;
  _row: number;
}
export interface WorkbookRows extends Record<string, ParsedWorkbookRow[]> {
  documents: ParsedWorkbookRow[];
}
export interface ParsedWorkbook {
  rows: WorkbookRows;
  issues: WorkbookIssue[];
}
export interface WorkbookSheetDefinition {
  name: string;
  key: string;
  columns: string[];
}
export type WorkbookLayouts = Record<WorkbookKind, WorkbookSheetDefinition[]>;
export interface WorkbookOptions {
  report?: boolean;
  lookups?: Record<string, unknown>[];
  attributes?: OperationAttribute[];
}
export type AssetExchangeKind = "lines" | "physical" | "towers" | "spans";
export type ExchangeMode = "create" | "update" | "mixed";
export interface AssetPreviewChange {
  field:string;
  before:unknown;
  after:unknown;
}
export interface AssetPreviewDocument {
  kind:AssetExchangeKind;
  payload:WorkbookRow;
  id:string|null;
  number:string;
  action:"create"|"update"|"unchanged";
  sheet:string;
  row:number;
  changes:AssetPreviewChange[];
}
export interface AssetPrepareResult {
  documents:AssetPreviewDocument[];
  issues:WorkbookIssue[];
  document_count:number;
  invalid_document_count:number;
}
export interface ExchangePreviewOptions {
  mode?:ExchangeMode;
  projectId?:string;
}
export interface ExchangeExportOptions {
  ids?:string[];
  query?:string;
  report?:boolean;
  projectId?:string;
}
export interface ExchangePreviewDocument {
  number:string;
  id:string|null;
  action:"create"|"update"|"unchanged";
  payload:Record<string,unknown>;
  changes:Array<{field:string;before:unknown;after:unknown}>;
  sheet:string;
  row:number;
}
export interface ExchangePrepareResult {
  documents:ExchangePreviewDocument[];
  document_count:number;
  invalid_document_count:number;
  issues:WorkbookIssue[];
  timings_ms:{preparation:number;code_matching:number;validation:number};
}
export interface ExchangeCommitInput {
  request_key:string;
  atomic:boolean;
}
export interface ExchangeCommitResult {
  results:Array<{import_ref?:string;number:string;id:string;action:"create"|"update"|"unchanged"}>;
  issues:WorkbookIssue[];
  timings_ms:{revalidation:number;business_writes:number};
  submitted_at:string;
  kind:WorkbookKind;
}
export interface ExchangeBatch {
  id:string;
  draft_json:string;
  created_by:string;
  created_at:string;
  updated_at:string;
  status:"draft"|"submitted";
  version:number;
}

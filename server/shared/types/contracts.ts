export type Role = "admin" | "editor" | "verifier" | "viewer";

export interface Actor {
  id: string;
  username: string;
  role: Role;
  permissions: string[];
}

export type FieldErrors = Record<string, string | string[]>;

export interface ErrorResponse {
  code: string;
  message: string;
  fields: FieldErrors;
}

export type FacetValue = string | null;
export type GridSelectionRule = { checked: boolean } & (
  { value: FacetValue } | { term: string; outside?: boolean }
);
export interface GridSelection {
  all: boolean;
  rules: GridSelectionRule[];
  term: string;
}
export type GridFilter = FacetValue[] | GridSelection;
export type GridFilters = Record<string, GridFilter>;
export interface FacetPage {
  items: { value: FacetValue; count: number; checked: boolean }[];
  total: number;
  checked: number;
  checkedRows: number;
  offset: number;
  limit: number;
}

export interface ListQuery {
  page: number;
  page_size: number;
  q: string;
  sort: string;
  direction: "asc" | "desc";
  filters: Record<string, string>;
  /** Exact selections or compact candidate-selection rules, evaluated over the full server list. */
  grid_filters?: GridFilters;
  deleted: boolean;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export interface AuditRecord {
  id: string;
  actor_id: string;
  entity: string;
  entity_id: string;
  action: string;
  before_json: string | null;
  after_json: string | null;
  created_at: string;
}

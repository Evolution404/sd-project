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

export interface ListQuery {
  page: number;
  page_size: number;
  q: string;
  sort: string;
  direction: "asc" | "desc";
  filters: Record<string, string>;
  /** Excel-style selected distinct values, where null represents empty or missing. */
  grid_filters?: Record<string, (string | null)[]>;
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

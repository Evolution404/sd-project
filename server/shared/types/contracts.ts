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

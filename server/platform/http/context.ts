import type { IncomingMessage, ServerResponse } from "node:http";
import type { System } from "../../bootstrap.js";
import type { Actor, Page } from "../../shared/types/contracts.js";

export type RouteServices = Pick<System, "auth" | "catalog" | "dashboard" | "demands" |
  "dictionaries" | "equipment" | "finance" | "funding" | "management" | "materials" |
  "organizations" | "priceRules" | "pricing" | "projectClosure" | "projects" | "sources" | "standards">;
export type HttpServices = RouteServices & Pick<System, "dataDirectory" | "evidence" | "exchange" | "training" | "idempotent">;

export interface RouteContext {
  system: RouteServices;
  actor: Actor;
  resource: string;
  key: string;
  sub: string;
  subKey: string;
  action: string;
  method: string;
  read: boolean;
  deleted: boolean;
  input: unknown;
  url: URL;
  req: IncomingMessage;
  res: ServerResponse;
  evidence: HttpServices["evidence"];
  exchange: HttpServices["exchange"];
  mutate<T>(permission: string, action: () => T): T;
  workbook(response: ServerResponse, promise: Promise<unknown>, filename: string): Promise<void>;
  page<T extends object>(rows: T[], search: URLSearchParams): Page<T>;
}
export type RouteHandler = (context: RouteContext) => Promise<{ result: unknown } | undefined>;

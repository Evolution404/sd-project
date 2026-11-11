import type { IncomingMessage, ServerResponse } from "node:http";
import type { System } from "../../bootstrap.js";
import type { Actor, Page } from "../../shared/types/contracts.js";
import type { createEvidence } from "../files/service.js";
import type { createExchange } from "../../modules/exchange/service.mjs";

export interface RouteContext {
  system: System;
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
  evidence: ReturnType<typeof createEvidence>;
  exchange: ReturnType<typeof createExchange>;
  mutate<T>(permission: string, action: () => T): T;
  workbook(response: ServerResponse, promise: Promise<unknown>, filename: string): Promise<void>;
  page<T extends object>(rows: T[], search: URLSearchParams): Page<T>;
}
export type RouteHandler = (context: RouteContext) => Promise<{ result: unknown } | undefined>;

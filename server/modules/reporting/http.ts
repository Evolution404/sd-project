import type { RouteContext } from "../../platform/http/context.js";
import { requireValue } from '../../shared/errors/business-error.js';

export async function handleReporting(context: RouteContext): Promise<{ result: unknown } | undefined> {
  const { resource, system, actor, read } = context;
  let result: unknown;
  switch (resource) {
case "dashboard":
          requireValue(read, "请求方法无效", 405);
          result = system.dashboard(actor);
          break;
  }
  return { result };
}

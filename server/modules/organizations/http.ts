import type { RouteContext } from "../../platform/http/context.js";
import { requireValue } from "../../shared/errors/business-error.js";
import { isObject } from "../../shared/types/contracts.js";
export async function handleOrganizations(context: RouteContext) {
  const { system, actor, key, sub, read, input, url, mutate } = context;
  requireValue(isObject(input), "请求正文必须为JSON对象", 400);
  if (read) {
    if (!key) return { result: system.organizations.tree(actor) };
    if (sub === "move-preview")
      return {
        result: system.organizations.preview(
          actor,
          key,
          url.searchParams.get("parent_id") || null,
        ),
      };
    return { result: system.organizations.detail(actor, key) };
  }
  requireValue(sub === "parent", "组织操作不存在", 404);
  return {
    result: mutate("admin", () => system.organizations.move(actor, key, input)),
  };
}

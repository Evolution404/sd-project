import { isObject } from "../../shared/types/contracts.js";
import type { RouteContext } from "../../platform/http/context.js";
import { requireValue } from '../../shared/errors/business-error.js';
export async function handleCatalog(context: RouteContext): Promise<{
    result: unknown;
} | undefined> {
    const { resource, system, actor, read, key, sub, subKey, method, input, deleted, url, mutate, page } = context;
    requireValue(isObject(input), "请求正文必须为JSON对象", 400);
    let result: unknown;
    switch (resource) {
        case "actors":
            requireValue(read, "请求方法无效", 405);
            result = system.management.actors(actor, url.searchParams.get("history") === "true");
            break;
        case "display-labels":
            requireValue(read, "请求方法无效", 405);
            result = system.catalog.displayLabels();
            break;
        case "catalogs":
            requireValue(read, "请求方法无效", 405);
            result = system.catalog.definitions;
            break;
        case "catalog":
            if (key === "operations" && subKey === "pricing-definitions") {
                requireValue(read, "价格特征定义只允许查询", 405);
                const adoptedVersion = Number(url.searchParams.get("version")) || undefined;
                result = system.catalog.operationPriceFeatures(sub, adoptedVersion);
                break;
            }
            if (key === "prices" && sub === "preview") {
                requireValue(method === "POST", "仅支持规则预检查", 405);
                result = system.catalog.previewPrice(actor, input);
                break;
            }
            if (read)
                result =
                    sub === "history"
                        ? system.catalog.history(key, subKey)
                        : sub
                            ? system.catalog.get(key, sub, deleted)
                            : page(system.catalog.list(key, deleted), url.searchParams);
            else if (method === "DELETE")
                result = mutate("admin", () => key === "organizations" ? system.organizations.remove(actor, sub, input) : system.catalog.remove(actor, key, sub, input.expected_version));
            else
                result = mutate(["frameworks", "agreements"].includes(key) ? "write" : "admin", () => system.catalog.save(actor, key, input, sub));
            break;
    }
    return { result };
}

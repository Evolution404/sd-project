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
            if (key === "physical" && subKey === "replacement") {
                result = read
                    ? system.catalog.replacementPreview(sub)
                    : mutate("admin", () => system.catalog.replacePhysical(actor, sub, input));
                break;
            }
            if (read)
                result =
                    sub === "history"
                        ? system.catalog.history(key, subKey)
                        : sub
                            ? system.catalog.get(key, sub, deleted)
                            : ["lines", "physical", "towers", "spans"].includes(key)
                                ? system.catalog.search(key, {
                                    page: url.searchParams.get("page"),
                                    page_size: url.searchParams.get("page_size"),
                                    q: url.searchParams.get("q"),
                                    sort: url.searchParams.get("sort"),
                                    direction: url.searchParams.get("direction"),
                                    filters: url.searchParams.get("filters"),
                                    lineId: url.searchParams.get("line_id"),
                                    lineKind: url.searchParams.get("line_kind"),
                                    excludeId: url.searchParams.get("exclude_id"),
                                    deleted,
                                })
                                : page(system.catalog.list(key, deleted), url.searchParams);
            else if (method === "DELETE")
                result = mutate("admin", () => system.catalog.remove(actor, key, sub, input.expected_version));
            else
                result = mutate(["frameworks", "agreements"].includes(key) ? "write" : "admin", () => system.catalog.save(actor, key, input, sub));
            break;
    }
    return { result };
}

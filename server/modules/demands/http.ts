import { parseHandlingTargets } from "../../platform/http/handling-batch.js";
import { isObject } from "../../shared/types/contracts.js";
import type { RouteContext } from "../../platform/http/context.js";
import { parseListQuery } from "../../platform/http/list-query.js";
import { requireValue } from '../../shared/errors/business-error.js';
export async function handleDemands(context: RouteContext): Promise<{
    result: unknown;
} | undefined> {
    const { resource, system, actor, read, key, sub, method, input, deleted, url, mutate } = context;
    requireValue(isObject(input), "请求正文必须为JSON对象", 400);
    let result: unknown;
    switch (resource) {
        case "demands":
            if (key === "confirm-batch") {
                requireValue(!read && method === "POST" && (!sub || sub === "preview"), "仅支持批量确认或预检", 405);
                const targets = parseHandlingTargets(input.items);
                result = sub === "preview"
                    ? system.demands.previewConfirmation(actor, targets)
                    : mutate("demand.activate", () => system.demands.confirmMany(actor, targets));
                break;
            }
            if (read)
                result = !key
                    ? system.demands.search(parseListQuery(url.searchParams))
                    : key === "candidates"
                        ? system.demands.searchCandidates(
                            parseListQuery(url.searchParams),
                            url.searchParams.get("include_pending") === "true",
                          )
                    : sub === "history"
                        ? system.demands.history(key)
                        : system.demands.review(key, deleted);
            else if (method === "DELETE")
                result = mutate("admin", () => system.demands.remove(actor, key, input));
            else if (sub === "status")
                result = mutate("demand.activate", () => system.demands.transition(actor, key, input));
            else if (sub === "quote") {
                if (input.confirm)
                    requireValue(typeof input.preview_hash === "string" &&
                        /^[a-f0-9]{64}$/.test(input.preview_hash), "正式报价必须先试算并提交有效的预览凭据", 422);
                result = input.confirm
                    ? mutate("write", () => system.pricing.quote(actor, key, input))
                    : system.pricing.quote(actor, key, input);
            }
            else
                result = mutate("write", () => system.demands.save(actor, input, key));
            break;
        case "sources":
            if (read)
                result = system.sources.history(key);
            else if (method === "DELETE")
                result = mutate("admin", () => system.sources.remove(actor, key));
            else
                result = mutate("write", () => system.sources.revise(actor, key, input));
            break;
    }
    return { result };
}

import { parseListQuery } from "../../platform/http/list-query.js";
import { isObject } from "../../shared/types/contracts.js";
import type { RouteContext } from "../../platform/http/context.js";
import { requireValue } from '../../shared/errors/business-error.js';
export async function handleFinance(context: RouteContext): Promise<{
    result: unknown;
} | undefined> {
    const { resource, system, actor, read, key, sub, method, input, deleted, url, mutate, page } = context;
    requireValue(isObject(input), "请求正文必须为JSON对象", 400);
    let result: unknown;
    switch (resource) {
        case "finance":
            requireValue(read, "仅允许查询财务记录", 405);
            requireValue(["costs", "settlements", "reconciliations"].includes(key), "费用查询类型不存在", 404);
            result = system.finance.search(key, parseListQuery(url.searchParams));
            break;
        case "settlements":
            if (read)
                result = !key
                    ? page(system.finance.allSettlements(deleted), url.searchParams)
                    : sub === "history"
                        ? system.finance.history(key)
                        : system.finance.settlement(key);
            else if (method === "DELETE" && !sub)
                result = mutate("admin", () => system.finance.removeSettlement(actor, key, input));
            else if (sub === "submit")
                result = mutate("write", () => system.finance.submit(actor, key, input));
            else if (sub === "review")
                result = mutate("settlement.approve", () => system.finance.review(actor, key, input));
            else if (sub === "draft" && method === "DELETE")
                result = mutate("write", () => system.finance.discardDraft(actor, key, input));
            else
                requireValue(false, "结算动作不存在", 404);
            break;
        case "reconciliations":
            if (read)
                result = key
                    ? system.finance.reconciliationHistory(key)
                    : page(system.finance.reconciliations(url.searchParams.get("project_id"), deleted), url.searchParams);
            else if (method === "DELETE")
                result = mutate("cost.confirm", () => system.finance.removeReconciliation(actor, key, input));
            else
                result = mutate("cost.confirm", () => system.finance.reconciliation(actor, input));
            break;
    }
    return { result };
}

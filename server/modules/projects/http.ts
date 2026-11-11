import { isObject } from "../../shared/types/contracts.js";
import { projectActionHints } from "./actions.js";
import { requireValue } from "../../shared/errors/business-error.js";
import type { RouteContext } from "../../platform/http/context.js";
import { parseListQuery } from "../../platform/http/list-query.js";
export async function handleProjects(context: RouteContext): Promise<{
    result: unknown;
} | undefined> {
    const { resource, system, actor, read, key, sub, subKey, action, method, input, deleted, url, mutate, page } = context;
    requireValue(isObject(input), "请求正文必须为JSON对象", 400);
    let result: unknown;
    switch (resource) {
        case "projects":
            if (key === "from-demand") {
                requireValue(!read && method === "POST", "仅支持建立并承接子项目", 405);
                result = mutate("write", () => system.projects.createFromDemand(actor, input));
                break;
            }
            if (sub === "cost-tree") {
                requireValue(read, "费用科目树只允许查询", 405);
                result = subKey ? system.finance.categoryDetail(actor, key, subKey, parseListQuery(url.searchParams).page) : system.finance.costTree(actor, key);
                break;
            }
            if (read)
                result = !key
                    ? system.projects.search(parseListQuery(url.searchParams))
                    : sub === "actions"
                        ? projectActionHints(actor, system.projects.workspace(key, deleted))
                    : sub === "history"
                        ? system.projects.history(key)
                        : sub === "approval-candidates"
                            ? system.projects.approvalCandidates(key)
                    : sub === "approval-history"
                            ? system.projects.approvalHistory(key)
                        : sub === "agreements"
                            ? system.projects.agreementOptions(key)
                            : sub === "summary"
                                ? system.finance.summary(key)
                                : sub === "costs" && subKey
                                    ? system.finance.costHistory(key, subKey)
                                    : sub === "costs"
                                        ? page(system.finance.costs(key, deleted), url.searchParams)
                                        : sub === "settlements" && subKey
                                            ? system.finance.settlementForProject(key, subKey)
                                        : sub === "reconciliations" && subKey
                                            ? system.finance.reconciliationHistoryForProject(key, subKey)
                                        : sub === "settlements"
                                            ? page(system.finance.settlements(key), url.searchParams)
                                            : system.projects.workspace(key, deleted);
            else if (method === "DELETE" && !sub)
                result = mutate("admin", () => system.projects.remove(actor, key, input));
            else if (sub === "stock")
                result = mutate("project.stock", () => system.projects.stock(actor, key, input));
            else if (sub === "link")
                result = mutate("write", () => system.projects.link(actor, key, input));
            else if (sub === "release")
                result = mutate("write", () => system.projects.release(actor, key, subKey, input));
            else if (sub === "funding")
                result = mutate("write", () => system.projects.fund(actor, key, input));
            else if (sub === "approvals" && method === "DELETE")
                result = mutate("write", () => system.projects.discardApproval(actor, key, subKey));
            else if (sub === "approvals" && action === "approve")
                result = mutate(system.projects.get(key).approval
                    ? "change.approve"
                    : "project.approve", () => system.projects.approve(actor, key, subKey, input));
            else if (sub === "approvals")
                result = mutate("write", () => system.projects.approvalDraft(actor, key, input));
            else if (sub === "nodes" && method === "DELETE")
                result = mutate("admin", () => system.finance.removeNode(actor, key, subKey, input));
            else if (sub === "costs" && method === "DELETE")
                result = mutate("admin", () => system.finance.removeCost(actor, key, subKey, input));
            else if (sub === "nodes")
                result = mutate("write", () => system.finance.node(actor, key, input, subKey));
            else if (sub === "costs")
                result = mutate("cost.confirm", () => system.finance.cost(actor, key, input, subKey));
            else if (sub === "settlements")
                result = mutate("write", () => system.finance.saveDraft(actor, key, input, subKey));
            else if (sub === "close")
                result = mutate("project.close", () => system.finance.close(actor, key, input));
            else
                result = mutate("write", () => system.projects.save(actor, input, key));
            break;
    }
    return { result };
}

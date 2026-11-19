import { parseHandlingTargets } from "../../platform/http/handling-batch.js";
import { isObject } from "../../shared/types/contracts.js";
import { projectActionHints } from "./actions.js";
import { parseProjectFromDemand, parseProjectVersion, parseProjectLink, parseProjectLinkBatch, parseProjectRelease,
  parseProjectFunding, parseProjectApproval, parseProjectManagement } from "./requests.js";
import { requireValue } from "../../shared/errors/business-error.js";
import type { RouteContext } from "../../platform/http/context.js";
import { parseListQuery } from "../../platform/http/list-query.js";
import { financeDeleteNode, financeVersion, financeCostNode,
  financeActualCost, financeSettlementDraft } from "../finance/requests.js";
export async function handleProjects(context: RouteContext): Promise<{
    result: unknown;
} | undefined> {
    const { resource, system, actor, read, key, sub, subKey, action, method, input, deleted, url, mutate } = context;
    requireValue(isObject(input), "请求正文必须为JSON对象", 400);
    let result: unknown;
    switch (resource) {
        case "projects":
            if (key === "stock-batch") {
                requireValue(!read && method === "POST" && (!sub || sub === "preview"), "仅支持批量入库或预检", 405);
                const targets = parseHandlingTargets(input.items);
                result = sub === "preview"
                    ? system.projects.previewStock(actor, targets)
                    : mutate("project.stock", () => system.projects.stockMany(actor, targets));
                break;
            }
            if (sub === "link-batch" && subKey === "preview") {
                requireValue(!read && method === "POST", "仅支持预检批量关联", 405);
                result = system.projects.previewLinkMany(actor, key, parseProjectLinkBatch(input));
                break;
            }
            if (key === "from-demand") {
                requireValue(!read && method === "POST", "仅支持建立并承接子项目", 405);
                result = mutate("write", () => system.projects.createFromDemand(actor, parseProjectFromDemand(input)));
                break;
            }
            if (sub === "cost-tree") {
                requireValue(read, "费用科目树只允许查询", 405);
                result = subKey ? system.finance.categoryDetail(actor, key, subKey, parseListQuery(url.searchParams).page) : system.finance.costTree(actor, key);
                break;
            }
            if (read)
                result = key === "eligible-agreements"
                    ? system.projects.availableAgreements(
                        url.searchParams.get("framework_id") || "",
                        url.searchParams.get("selected_id"),
                      )
                    : !key
                    ? system.projects.search(parseListQuery(url.searchParams))
                    : sub === "actions"
                        ? projectActionHints(actor, system.projects.workspace(key, deleted), system.finance.closeBlockReason(key), system.finance.closeSettlementBlockers(key))
                    : sub === "deletion-preview"
                        ? system.projects.previewDeletion(actor, key)
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
                                        ? system.finance.searchProjectCosts(key, parseListQuery(url.searchParams))
                                        : sub === "settlements" && subKey
                                            ? system.finance.settlementForProject(key, subKey)
                                        : sub === "reconciliations" && subKey
                                            ? system.finance.reconciliationHistoryForProject(key, subKey)
                                        : sub === "settlements"
                                            ? system.finance.searchSettlements(key, parseListQuery(url.searchParams))
                                            : system.projects.workspace(key, deleted);
            else if (method === "DELETE" && !sub)
                result = mutate("admin", () => system.projects.remove(actor, key, parseProjectVersion(input)));
            else if (sub === "stock")
                result = mutate("project.stock", () => system.projects.stock(actor, key, parseProjectVersion(input)));
            else if (sub === "link-batch")
                result = mutate("write", () => system.projects.linkMany(actor, key, parseProjectLinkBatch(input)));
            else if (sub === "link")
                result = mutate("write", () => system.projects.link(actor, key, parseProjectLink(input)));
            else if (sub === "release")
                result = mutate("write", () => system.projects.release(actor, key, subKey, parseProjectRelease(input)));
            else if (sub === "funding")
                result = mutate("write", () => system.projects.fund(actor, key, parseProjectFunding(input)));
            else if (sub === "approvals" && method === "DELETE")
                result = mutate("write", () => system.projects.discardApproval(actor, key, subKey));
            else if (sub === "approvals" && action === "approve")
                result = mutate(system.projects.get(key).approval
                    ? "change.approve"
                    : "project.approve", () => system.projects.approve(actor, key, subKey, parseProjectVersion(input)));
            else if (sub === "approvals")
                result = mutate("write", () => system.projects.approvalDraft(actor, key, parseProjectApproval(input)));
            else if (sub === "nodes" && method === "DELETE")
                result = mutate("admin", () => system.finance.removeNode(actor, key, subKey, financeDeleteNode(input)));
            else if (sub === "costs" && method === "DELETE")
                result = mutate("admin", () => system.finance.removeCost(actor, key, subKey, financeVersion(input)));
            else if (sub === "nodes")
                result = mutate("write", () => system.finance.node(actor, key, financeCostNode(input), subKey));
            else if (sub === "costs")
                result = mutate("cost.confirm", () => system.finance.cost(actor, key, financeActualCost(input), subKey));
            else if (sub === "settlements")
                result = mutate("write", () => system.finance.saveDraft(actor, key, financeSettlementDraft(input), subKey));
            else if (sub === "close")
                result = mutate("project.close", () => system.finance.close(actor, key, parseProjectVersion(input)));
            else
                result = mutate("write", () => system.projects.save(actor, parseProjectManagement(input), key));
            break;
    }
    return { result };
}

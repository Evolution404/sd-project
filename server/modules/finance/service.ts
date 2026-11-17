import { closedWriteReason } from "../../shared/project-lifecycle.js";
import { authorize, documentCode, id, now, today } from "../../platform/auth/service.js";
import {
  requireValue,
  expectedVersion,
  text,
  integer,
} from "../../shared/errors/business-error.js";
import { financialSummary } from "./summary.js";
import { assertQuantityPrecision } from "../../shared/quantity-precision.js";
import type { Actor, ListQuery } from "../../shared/types/contracts.js";
import type { FinanceListKind } from "../../shared/types/finance.js";
import type { CatalogService } from "../catalog/service.js";
import type { ProjectService } from "../projects/service.js";
import type { PricingService } from "../pricing/service.js";
import type { HierarchyRepository } from "../../database/repositories/hierarchies.js";
import type { FinancePersistenceRepository } from "../../database/repositories/finance-persistence.js";
import type { QuantityUnitRepository } from "../../database/repositories/quantity-units.js";
import type { ProjectDashboardBase } from "../../database/repositories/projects.js";
import type {
  CostNodeInput, ActualCostInput,
  SettlementDraftInput, NormalizedSettlementDraft,
  SettlementVersion, SettlementWorkflow,
  SettlementSubmitInput, SettlementReviewInput, SettlementResubmitInput,
  ReconciliationInput
} from "../../shared/types/finance-workflows.js";

export function createFinance(
  repo: FinancePersistenceRepository,
  catalog: CatalogService,
  projects: ProjectService,
  pricing: PricingService,
  hierarchies: HierarchyRepository,
  quantityUnits: QuantityUnitRepository,
) {
  function activeLeaf(project: ReturnType<ProjectService["get"]>, nodeId: string) {
    const node = project.cost_nodes.find((item) => item.id === nodeId);
    requireValue(
      node && !project.cost_nodes.some((child) => child.parent_id === nodeId),
      "请选择本项目末级费用科目",
    );
    let current: typeof node | undefined = node;
    while (current) {
      requireValue(
        current.status === "active" &&
          !current.deleted,
        "费用科目及全部上级必须启用且未删除",
      );
      const parentId: string | null = current.parent_id;
      current = parentId
        ? project.cost_nodes.find((parent) => parent.id === parentId)
        : undefined;
    }
    return node;
  }
  function node(actor: Actor, projectId: string, input: CostNodeInput, key?: string) {
    authorize(actor, "write");
    return repo.transaction(() => {
      requireValue(hierarchies.projectExists(projectId), "项目不存在", 404);
      const blocked = closedWriteReason({status:repo.projectStage(projectId) || ""});
      requireValue(!blocked, blocked, 409);
      const previous = key
        ? repo.currentCostNode(key)
        : null;
      requireValue(!key || previous, "费用科目不存在", 404);
      if (previous) {
        requireValue(
          input.parent_id === undefined || (input.parent_id || null) === previous.parent_id,
          "费用科目层级身份不可修改",
        );
        requireValue(typeof key === "string" && !repo.costNodeDeleted(key), "费用科目已删除");
        requireValue(previous.project_id === projectId, "科目不属于本项目");
        expectedVersion(previous.version_no, input.expected_version);
      }
      if (!previous && input.parent_id) {
        const parentNodes = new Map(
          repo.projectCostNodes(projectId).map(node => [node.id, node]),
        );
        let parent = parentNodes.get(input.parent_id);
        const seen = new Set();
        requireValue(parent, "上级费用科目必须属于本项目");
        while (parent) {
          requireValue(!seen.has(parent.id), "费用科目上级路径存在循环");
          seen.add(parent.id);
          requireValue(parent.status === "active" && !parent.deleted, "新费用子项的全部上级必须启用且未删除");
          requireValue(!parent.parent_id || parentNodes.has(parent.parent_id), "费用科目上级路径不完整");
          parent = parent.parent_id ? parentNodes.get(parent.parent_id) : undefined;
        }
      }
      const nodeId = key || id();
      if (!previous)
        repo.createCostNode({
          id: nodeId,
          project_id: projectId,
          parent_id: input.parent_id || null,
          created_by: actor.id,
          created_at: now(),
        });
      repo.appendCostNodeVersion({
        id: id(),
        node_id: nodeId,
        version_no: (previous?.version_no || 0) + 1,
        name: text(input.name, "费用科目名称"),
        status: input.status || "active",
        actor_id: actor.id,
        recorded_at: now(),
        reason: input.reason || "",
      });
      const result = repo.currentCostNode(nodeId);
      catalog.audit(actor, "cost_nodes", nodeId, previous ? "revise" : "create", previous, result);
      return result;
    });
  }
  function cost(actor: Actor, projectId: string, input: ActualCostInput, key?: string) {
    authorize(actor, "cost.confirm");
    return repo.transaction(() => {
      const project = projects.get(projectId),
        previous = key ? repo.latestCostVersion(key) : null;
      const blocked = closedWriteReason(project);
      requireValue(!blocked, blocked, 409);
      const existingEntry = key ? repo.costEntry(key) : undefined;
      if (previous) {
        requireValue(typeof key === "string" && !repo.actualCostDeleted(key), "费用已删除", 409);
        expectedVersion(previous.version_no, input.expected_version);
        requireValue(
          existingEntry?.project_id === projectId,
          "费用不属于本项目",
        );
      }
      const selectedNodeId = input.cost_node_id || existingEntry?.cost_node_id;
      requireValue(selectedNodeId, "请选择费用科目");
      const nodeRow = repo.currentCostNode(selectedNodeId);
      requireValue(
        nodeRow && nodeRow.project_id === projectId,
        "请选择本项目费用科目",
      );
      if ((input.status || "active") === "active")
        activeLeaf(project, nodeRow.id);
      const entryId = key || id();
      if (!previous)
        repo.createCostEntry({
          id: entryId,
          project_id: projectId,
          cost_node_id: nodeRow.id,
          created_by: actor.id,
          created_at: now(),
        });
      const value = {
        id: id(),
        entry_id: entryId,
        version_no: (previous?.version_no || 0) + 1,
        cost_node_version_id: nodeRow.current_version_id,
        funding_version_id: project.funding?.id || null,
        status: input.status || "active",
        title: text(input.title, "费用事项"),
        occurred_on: input.occurred_on,
        amount_fen: integer(input.amount_fen, "实际金额", 1),
        invoice_number: input.invoice_number || null,
        evidence: text(input.evidence, "费用凭据"),
        confirmed_by: actor.id,
        confirmed_at: now(),
        request_key: input.request_key || id(),
        reason: input.reason || "",
      };
      repo.appendActualCost(value);
      return value;
    });
  }
  function settlement(key: string): SettlementWorkflow {
    const root = repo.settlementRoot(key);
    requireValue(root, "结算单不存在", 404);
    const version = repo.latestSettlementVersion(key),
      draft = repo.settlementDraft(key);
    const items = version ? hierarchies.settlementItems(version.id) : [];
    const resolutions = version
      ? repo.settlementResults(version.id)
      : [];
    return {
      ...root,
      version: version || null,
      items,
      resolutions,
      draft: draft
        ? { ...draft, document: JSON.parse(draft.draft_json) as NormalizedSettlementDraft }
        : null,
      review: version
        ? repo.latestReview(version.id) || null
        : null,
    };
  }
  function validateDraft(projectId: string, input: SettlementDraftInput): NormalizedSettlementDraft {
    const project = projects.get(projectId),
      approval = project.approvals.find(
        (ap) => ap.id === (input.approval_version_id || project.approval?.id),
      );
    requireValue(
      project.status === "approved" && approval?.status === "approved",
      "结算须采用本项目正式批准版本",
    );
    if (input.change_type === "void")
      return { ...input, approval_version_id: approval.id,
        funding_version_id: input.funding_version_id || project.funding?.id || null,
        items: [], resolutions: [] };
    requireValue(
      Array.isArray(input.items) && input.items.length > 0,
      "至少一条费用明细",
    );
    requireValue(
      Array.isArray(input.resolutions) && input.resolutions.length > 0,
      "至少一条独立需求解决明细",
    );
    const scopes = new Set(approval.scopes.map((x) => x.project_scope_id));
    const scopeUnits = quantityUnits.approvedScopeUnits(approval.id);
    requireValue(scopeUnits.size === scopes.size, "批准需求的计量单位正式版本不完整", 404);
    const results = new Set();
    for (const [index, r] of input.resolutions.entries()) {
      requireValue(scopes.has(r.project_scope_id), "解决需求不属于本批准范围");
      requireValue(
        !results.has(r.project_scope_id),
        "同一需求不能重复累计解决数量",
      );
      results.add(r.project_scope_id);
      const rule = scopeUnits.get(r.project_scope_id);
      requireValue(rule, "解决需求采用的单位不存在", 404);
      assertQuantityPrecision(integer(r.resolved_quantity_scaled, "本次新增解决数量"),
        rule.fields_json, rule.name,
        `resolutions.${index}.resolved_quantity_scaled`);
    }
    const identities = new Set();
    for (const [index, item] of input.items.entries()) {
      activeLeaf(project, item.cost_node_id);
      requireValue(
        !item.project_scope_id || scopes.has(item.project_scope_id),
        "费用需求不属于本批准范围",
      );
      requireValue(
        !item.project_scope_id || results.has(item.project_scope_id),
        "费用对应需求缺少独立解决明细",
      );
      const identity = `${item.cost_node_id}/${item.project_scope_id || ""}`;
      requireValue(!identities.has(identity), "同一科目及需求的费用行重复");
      identities.add(identity);
      const itemQuantity = integer(item.quantity_scaled ?? 0, "费用计价数量");
      if (item.project_scope_id) {
        const rule = scopeUnits.get(item.project_scope_id);
        requireValue(rule, "费用需求采用的计量单位不存在", 404);
        assertQuantityPrecision(itemQuantity, rule.fields_json, rule.name,
          `items.${index}.quantity_scaled`);
      }
      integer(item.amount_fen, "本次结算金额");
      requireValue(
        item.amount_fen > 0 || (item.quantity_scaled ?? 0) > 0,
        "费用明细金额和数量不能同时为0",
      );
      requireValue(
        item.project_scope_id || !item.quantity_scaled,
        "无需求归属的共同费用计价数量须为0",
      );
      text(item.evidence, "结算依据");
    }
    return {
      ...input,
      approval_version_id: approval.id,
      funding_version_id:
        input.funding_version_id || project.funding?.id || null,
      items: input.items.map(item => ({
        ...item, quantity_scaled: item.quantity_scaled ?? 0,
        evidence: text(item.evidence, "结算依据"),
      })),
      resolutions: input.resolutions.map(item => ({ ...item, evidence: item.evidence || "" })),
    };
  }
  function saveDraft(actor: Actor, projectId: string, input: SettlementDraftInput, key?: string) {
    authorize(actor, "write");
    return repo.transaction(() => {
      const blocked = closedWriteReason({status:repo.projectStage(projectId) || ""});
      requireValue(!blocked, blocked, 409);
      const previous = key ? settlement(key) : null;
      if (key)
        requireValue(!repo.settlementDeleted(key), "结算单已删除");
      if (previous) {
        requireValue(previous.project_id === projectId, "结算单不属于本项目");
        requireValue(previous.review?.action !== "submit",
          "结算已经提交审核，审核完成前不得编制或修订草稿", 409);
        expectedVersion(
          previous.version?.version_no || 0,
          input.expected_version,
        );
        expectedVersion(
          previous.draft?.edit_version || 0,
          input.expected_edit_version,
        );
      }
      const normalized = validateDraft(projectId, input),
        settlementId = key || id(),
        timestamp = now();
      if (!previous)
        repo.createSettlement({
          id: settlementId,
          project_id: projectId,
          number: documentCode("JS", settlementId),
          created_by: actor.id,
          created_at: timestamp,
        });
      const row = {
        based_on_version_id: previous?.version?.id || null,
        draft_json: JSON.stringify(normalized),
        edit_version: Math.max(previous?.draft?.edit_version || 0,
          previous ? repo.withdrawnDraftEditVersion(settlementId) : 0) + 1,
        updated_by: actor.id,
        updated_at: timestamp,
      };
      if (previous?.draft)
        repo.replaceSettlementDraft({settlement_id:settlementId,...row});
      else
        repo.createSettlementDraft({
          settlement_id: settlementId,
          ...row,
        });
      return settlement(settlementId);
    });
  }
  function submit(actor: Actor, key: string, input: SettlementSubmitInput) {
    authorize(actor, "write");
    return repo.transaction(() => {
      const current = settlement(key);
      const blocked = closedWriteReason({status:repo.projectStage(current.project_id) || ""});
      requireValue(!blocked, blocked, 409);
      requireValue(!repo.settlementDeleted(key),
        "结算单已删除，不可再次提交", 409);
      requireValue(current.review?.action !== "submit",
        "结算正在审核，不能重复提交或覆盖正式版本", 409);
      expectedVersion(current.version?.version_no || 0, input.expected_version);
      requireValue(current.draft, "没有待提交草稿");
      expectedVersion(current.draft.edit_version, input.expected_edit_version);
      const draft = validateDraft(current.project_id, current.draft.document),
        versionId = id(),
        timestamp = now(),
        approval = repo.approvalReference(draft.approval_version_id);
      requireValue(approval && approval.project_id === current.project_id, "结算采用的批准版本不属于本项目", 404);
      const version: SettlementVersion = {
        id: versionId,
        settlement_id: key,
        version_no: (current.version?.version_no || 0) + 1,
        previous_version_id: current.version?.id || null,
        approval_version_id: approval.id,
        funding_version_id: draft.funding_version_id || null,
        change_type: current.version
          ? draft.change_type === "void"
            ? "void"
            : "revision"
          : "initial",
        reason: draft.reason || "",
        basis: draft.basis || "",
        settlement_on: draft.settlement_on || null,
        created_by: actor.id,
        recorded_at: timestamp,
      };
      repo.appendSettlementVersion(version);
      // One lookup per collection, independent of the number of settlement rows.
      // Created identities are added to the in-memory map to avoid duplicates.
      const existingRows = new Map(repo.settlementItems(key).map(item =>
        [item.cost_node_id + "|" + (item.project_scope_id || ""), item]));
      const approvedScopes = new Map(repo.approvalScopes(approval.id).map(item =>
        [item.project_scope_id, item]));
      const costNodes = new Map(repo.projectCostNodes(current.project_id).map(item =>
        [item.id, item]));
      if (version.change_type !== "void") {
        for (const item of draft.items) {
          const identityKey = item.cost_node_id + "|" + (item.project_scope_id || "");
          let identity = existingRows.get(identityKey);
          if (!identity) {
            identity = {
              id: id(),
              settlement_id: key,
              cost_node_id: item.cost_node_id,
              project_scope_id: item.project_scope_id || null,
              created_at: timestamp,
            };
            repo.createSettlementItem(identity);
            existingRows.set(identityKey, identity);
          }
          const scope = item.project_scope_id
            ? approvedScopes.get(item.project_scope_id) : null;
          requireValue(!item.project_scope_id || scope, "结算需求未包含在当前批准版本", 404);
          const nodeRow = costNodes.get(item.cost_node_id);
          requireValue(nodeRow, "结算费用科目不存在", 404);
          repo.appendSettlementItem({
            id: id(),
            settlement_version_id: versionId,
            settlement_item_id: identity.id,
            cost_node_version_id: nodeRow.current_version_id,
            approval_scope_version_id: scope?.id || null,
            quantity_scaled: item.quantity_scaled || 0,
            amount_fen: item.amount_fen,
            unit_price_fen: item.unit_price_fen ?? null,
            work_mode: item.work_mode || null,
            evidence: text(item.evidence, "结算依据"),
            scope_snapshot_json: JSON.stringify(scope || {}),
          });
        }
        for (const r of draft.resolutions) {
          const scope = approvedScopes.get(r.project_scope_id);
          requireValue(scope, "解决量关联批准范围不存在", 404);
          repo.appendResolvedScope({
            id: id(),
            settlement_version_id: versionId,
            project_scope_id: r.project_scope_id,
            approval_scope_version_id: scope.id,
            resolved_quantity_scaled: r.resolved_quantity_scaled,
            evidence: r.evidence || "",
          });
        }
      }
      repo.appendReview({
        id: id(),
        settlement_version_id: versionId,
        event_seq: 1,
        action: "submit",
        actor_id: actor.id,
        recorded_at: timestamp,
      });
      repo.deleteSettlementDraft(key);
      return settlement(key);
    });
  }
  function resubmit(actor: Actor, key: string, input: SettlementResubmitInput) {
    authorize(actor, "write");
    return repo.transaction(() => {
      const current = settlement(key);
      const blocked = closedWriteReason({status:repo.projectStage(current.project_id) || ""});
      requireValue(!blocked, blocked, 409);
      requireValue(!repo.settlementDeleted(key), "结算单已删除，不能重新提交", 409);
      requireValue(current.version && current.review?.action === "return",
        "只有审核退回且未重新修订的正式结算版本可原版重新提交", 409);
      requireValue(!current.draft, "已有修订草稿，请提交新版本而不是原版重提", 409);
      expectedVersion(current.version.version_no, input.expected_version);
      expectedVersion(current.review.event_seq, input.expected_event_seq);
      repo.appendReview({
        id: id(),
        settlement_version_id: current.version.id,
        event_seq: current.review.event_seq + 1,
        action: "submit",
        actor_id: actor.id,
        recorded_at: now(),
        reason: "退回后原版本重新提交，内容未变更",
      });
      return settlement(key);
    });
  }
  function summary(projectId: string) {
    const basis = projects.summaryBasis(projectId);
    return financialSummary(
      basis,
      repo.projectFinanceTotals(projectId),
      basis.approval_version_id ? repo.projectFinanceDemands(basis.approval_version_id) : [],
      basis.approval_version_id ? pricing.summary(basis.approval_version_id) : null,
    );
  }
  function closeBlockReason(projectId: string): string {
    const unfinished = repo.unfinishedSettlementDrafts(projectId);
    return unfinished.length
      ? "尚有未提交的结算草稿或修订草稿，请先提交审核或撤回：" + unfinished.map(row => row.number).join("、")
      : "";
  }
  function summariesForPortfolio(portfolio: ProjectDashboardBase[]) {
    if (!portfolio.length) return new Map();
    const ids = portfolio.map(project => project.id);
    const approvalIds = portfolio
      .map(project => project.approval_version_id).filter((id): id is string => typeof id === "string");
    const totals = new Map(repo.portfolioFinanceTotals(ids)
      .map(row => [row.project_id, row]));
    const demands = new Map();
    for (const row of repo.portfolioFinanceDemands(approvalIds)) {
      const group = demands.get(row.approval_version_id) || [];
      group.push(row);
      demands.set(row.approval_version_id, group);
    }
    const references = pricing.summariesForApprovals(approvalIds);
    return new Map(portfolio.map(project => [project.id, financialSummary(
      project,
      totals.get(project.id) || { actual_cost_fen: 0, settlement_fen: 0, reconciled_cost_fen: 0 },
      project.approval_version_id ? demands.get(project.approval_version_id) || [] : [],
      project.approval_version_id ? references.get(project.approval_version_id) || null : null,
    )]));
  }
  return {
    effectiveSettlementExport(key:string) {
      const version=repo.effectiveSettlement(key);
      if(!version||version.change_type==="void") return {items:[],resolutions:[]};
      return {items:repo.settlementVersionItems(version.id),
        resolutions:repo.settlementResults(version.id)};
    },
    search: (kind: FinanceListKind, query: ListQuery) => repo.searchFinance(kind, query),
    searchProjectCosts: (projectId: string, query: ListQuery) => repo.searchProjectCosts(projectId, query),
    searchSettlements: (projectId: string | undefined, query: ListQuery) => repo.searchSettlementWorkflows(projectId, query),
    searchReconciliations: (projectId: string | undefined, query: ListQuery) => repo.searchReconciliationVersions(projectId, query),
    summariesForPortfolio,
    node,
    cost,
    settlement,
    saveDraft,
    submit,
    resubmit,
    validateDraft,
    summary,
    closeBlockReason,
    costTree(actor: Actor, projectId: string) {
      authorize(actor, "read");
      requireValue(hierarchies.projectExists(projectId, true), "项目不存在", 404);
      return hierarchies.costTree(projectId);
    },
    categoryDetail(actor: Actor, projectId: string, nodeId: string, page = 1) {
      authorize(actor, "read");
      requireValue(hierarchies.projectExists(projectId, true), "项目不存在", 404);
      requireValue(hierarchies.costNodeExists(projectId, nodeId), "费用科目不存在", 404);
      return hierarchies.categoryDetail(projectId, nodeId, page);
    },
    costs: (projectId: string, includeDeleted = false) => hierarchies.costs(projectId, includeDeleted),
    settlements: (projectId: string) =>
      repo.projectSettlements(projectId)
        .filter((x) => !repo.settlementDeleted(x.id))
        .map((x) => settlement(x.id)),
    allSettlements: (includeDeleted = false) =>
      repo.settlements()
        .filter((x) => includeDeleted || !repo.settlementDeleted(x.id))
        .map((x) => ({
          ...settlement(x.id),
          deleted: repo.settlementDeleted(x.id),
        })),
    review(actor: Actor, key: string, input: SettlementReviewInput) {
      authorize(actor, "settlement.approve");
      return repo.transaction(() => {
        const current = settlement(key);
        const blocked = closedWriteReason({status:repo.projectStage(current.project_id) || ""});
        requireValue(!blocked, blocked, 409);
        requireValue(!repo.settlementDeleted(key),
          "结算单已删除，不可再次审核", 409);
        requireValue(current.version, "无正式版本");
        expectedVersion(current.version.version_no, input.expected_version);
        expectedVersion(
          current.review?.event_seq || 0,
          input.expected_event_seq,
        );
        requireValue(
          ["approve", "return", "reject"].includes(input.action),
          "审核动作无效",
        );
        if (input.action === "return")
          requireValue(typeof input.reason === "string" && input.reason.trim().length > 0,
            "退回结算必须填写退回原因", 422);
        repo.appendReview({
          id: id(),
          settlement_version_id: current.version.id,
          event_seq: (current.review?.event_seq || 0) + 1,
          action: input.action,
          actor_id: actor.id,
          recorded_at: now(),
          effective_on:
            input.action === "approve" ? input.effective_on || today() : null,
          reason: input.reason?.trim() || "",
        });
        return settlement(key);
      });
    },
    discardDraft(actor: Actor, key: string, input: SettlementSubmitInput) {
      authorize(actor, "write");
      return repo.transaction(() => {
        const current = settlement(key);
        const blocked = closedWriteReason({status:repo.projectStage(current.project_id) || ""});
        requireValue(!blocked, blocked, 409);
        requireValue(!repo.settlementDeleted(key),
          "结算单已删除，不可撤销草稿", 409);
        requireValue(current.draft, "当前没有可撤回的结算草稿，请刷新后重试", 409);
        expectedVersion(current.version?.version_no || 0, input.expected_version);
        expectedVersion(
          current.draft.edit_version,
          input.expected_edit_version,
        );
        catalog.audit(actor, "settlement_drafts", key, "withdraw", current.draft, {
          retained_version_id: current.version?.id || null,
        });
        repo.deleteSettlementDraft(key);
        if (!current.version)
          catalog.audit(actor, "settlements", key, "delete", current, {
            logical: true, reason: "首次结算草稿已撤回",
          });
        return settlement(key);
      });
    },
    reconciliation(actor: Actor, input: ReconciliationInput) {
      authorize(actor, "cost.confirm");
      return repo.transaction(() => {
        requireValue(
          !input.record_id ||
            !repo.reconciliationDeleted(input.record_id),
          "核对记录已删除",
          409,
        );
        const previous = input.record_id
          ? repo.latestReconciliationVersion(input.record_id)
          : null;
        expectedVersion(previous?.version_no || 0, input.expected_version);
        const source = input.status === "voided" ? previous : input;
        requireValue(source, "核对记录不存在");
        requireValue(typeof source.cost_version_id === "string", "请选择实际费用正式版本");
        requireValue(typeof source.settlement_item_version_id === "string", "请选择结算明细正式版本");
        const item = repo.settlementItemVersion(source.settlement_item_version_id);
        requireValue(item, "结算费用明细不存在");
        const ownership = repo.reconciliationOwnership(source.cost_version_id, item.id);
        requireValue(ownership && ownership.cost_project_id === ownership.settlement_project_id,
          "费用与结算不属于同一项目，禁止交叉核对", 422);
        const blocked = closedWriteReason({status:repo.projectStage(ownership.cost_project_id) || ""});
        requireValue(!blocked, blocked, 409);
        const row = {
          id: id(),
          record_id: previous?.record_id || id(),
          version_no: (previous?.version_no || 0) + 1,
          status: input.status || "active",
          cost_version_id: source.cost_version_id,
          settlement_item_id: item.settlement_item_id,
          settlement_item_version_id: item.id,
          reconciled_cost_fen: integer(source.reconciled_cost_fen, "核对实际费用"),
          reconciled_settlement_fen: integer(source.reconciled_settlement_fen, "核对结算金额"),
          is_final: input.status === "voided" ? 0 : input.is_final ? 1 : 0,
          evidence: input.evidence || "",
          actor_id: actor.id,
          created_at: now(),
          request_key: input.request_key || id(),
        };
        repo.appendReconciliation(row);
        return row;
      });
    },
    close(actor: Actor, key: string, input: {expected_version:number;reason?:string}) {
      authorize(actor, "project.close");
      return repo.transaction(() => {
        const project = projects.get(key);
        expectedVersion(project.version, input.expected_version);
        requireValue(project.approval, "缺少批准版本");
        const blocked = closeBlockReason(key);
        requireValue(!blocked, blocked, 409);
        repo.createClosure({
          id: id(),
          project_id: key,
          approval_version_id: project.approval.id,
          reason: input.reason || "",
          close_snapshot_json: JSON.stringify(summary(key)),
          closed_by: actor.id,
          closed_at: now(),
        });
        repo.appendStage({
          id: id(),
          project_id: key,
          stage: "closed",
          project_version: project.version + 1,
          actor_id: actor.id,
          created_at: now(),
          reason: input.reason || "",
        });
        return projects.get(key);
      });
    },
    reconciliations(projectId?: string, includeDeleted = false) {
      return repo.projectReconciliations(projectId, includeDeleted);
    },
    removeReconciliation(actor: Actor, key: string, input: {expected_version:number;evidence?:string}) {
      authorize(actor, "cost.confirm");
      return repo.transaction(() => {
        const current = repo.latestReconciliationVersion(key);
        requireValue(current, "核对记录不存在", 404);
        requireValue(!repo.reconciliationDeleted(key),
          "核对记录已删除，不能重复删除", 409);
        const cost = repo.costVersion(current.cost_version_id);
        const owner = cost && repo.costEntry(cost.entry_id);
        requireValue(owner, "核对费用所属项目不存在", 404);
        const blocked = closedWriteReason({status:repo.projectStage(owner.project_id) || ""});
        requireValue(!blocked, blocked, 409);
        expectedVersion(current.version_no, input.expected_version);
        if (current.status === "active")
          this.reconciliation(actor, {
            record_id: key,
            expected_version: current.version_no,
            status: "voided",
            evidence: input.evidence || "",
          });
        catalog.audit(actor, "reconciliations", key, "delete", current, {
          logical: true,
        });
        return { deleted: true };
      });
    },
    reconciliationHistory: (key: string) =>
      repo.reconciliationVersions(key),
    reconciliationHistoryForProject(projectId: string, key: string) {
      const history = repo.reconciliationVersions(key);
      requireValue(history.length > 0, "核对记录不存在", 404);
      // Immutable reconciliation history retains the original cost version.
      // Validate ownership before returning any historical version.
      const cost = repo.costVersion(history[0].cost_version_id);
      const entry = cost && repo.costEntry(cost.entry_id);
      requireValue(entry && entry.project_id === projectId,
        "核对记录不存在于当前项目", 404);
      return history;
    },
    settlementForProject(projectId: string, key: string) {
      const result = settlement(key);
      requireValue(result.project_id === projectId,
        "结算单不存在于当前项目", 404);
      return result;
    },
    removeNode(actor: Actor, projectId: string, key: string, input: {expected_version:number;expected_references?:number;expected_children?:number}) {
      authorize(actor, "admin");
      return repo.transaction(() => {
        const blocked = closedWriteReason({status:repo.projectStage(projectId) || ""});
        requireValue(!blocked, blocked, 409);
        const current = repo.currentCostNode(key);
        requireValue(
          current && current.project_id === projectId,
          "费用科目不存在",
          404,
        );
        requireValue(!repo.costNodeDeleted(key),
          "费用科目已删除，不能重复删除", 409);
        expectedVersion(current.version_no, input.expected_version);
        const impact = hierarchies.costTree(projectId).find(node => node.id === key);
        requireValue(impact, "费用科目删除影响不可用", 404);
        requireValue(input.expected_references === undefined || input.expected_references === impact.reference_count, "正式引用已变化，请重新核对删除影响", 409);
        requireValue(input.expected_children === undefined || input.expected_children === impact.child_count, "直属下级已变化，请重新核对删除影响", 409);
        if (current.status === "active")
          node(
            actor,
            projectId,
            {
              ...current,
              status: "inactive",
              expected_version: current.version_no,
            },
            key,
          );
        catalog.audit(actor, "cost_nodes", key, "delete", current, {
          logical: true,
          references: impact.reference_count,
          children: impact.child_count,
        });
        return { deleted: true };
      });
    },
    removeCost(actor: Actor, projectId: string, key: string, input: {expected_version:number}) {
      authorize(actor, "admin");
      return repo.transaction(() => {
        const blocked = closedWriteReason({status:repo.projectStage(projectId) || ""});
        requireValue(!blocked, blocked, 409);
        const current = repo.latestCostVersion(key);
        requireValue(current, "费用不存在", 404);
        requireValue(!repo.actualCostDeleted(key),
          "费用已删除，不能重复删除", 409);
        expectedVersion(current.version_no, input.expected_version);
        if (current.status === "active")
          cost(
            actor,
            projectId,
            {
              ...current,
              status: "voided",
              // Deletion is a new formal revision; the previous version's
              // unique idempotency receipt must never be copied forward.
              request_key: undefined,
              expected_version: current.version_no,
            },
            key,
          );
        catalog.audit(actor, "costs", key, "delete", current, {
          logical: true,
        });
        return { deleted: true };
      });
    },
    costHistory(projectId: string, key: string) {
      // The nested project route must not permit a different project's
      // cost record to be read by substituting an entry ID in the URL.
      const entry = repo.costEntry(key);
      requireValue(entry && entry.project_id === projectId, "费用不存在于当前项目", 404);
      return repo.costVersions(key);
    },
    removeSettlement(actor: Actor, key: string, input: {expected_version:number;expected_edit_version?:number}) {
      authorize(actor, "admin");
      return repo.transaction(() => {
        let current = settlement(key);
        const blocked = closedWriteReason({status:repo.projectStage(current.project_id) || ""});
          requireValue(!blocked, blocked, 409);
        requireValue(!repo.settlementDeleted(key),
          "结算单已删除，不能重复删除", 409);
        expectedVersion(
          current.version?.version_no || 0,
          input.expected_version,
        );
        expectedVersion(
          current.draft?.edit_version || 0,
          input.expected_edit_version,
        );
        const approved = repo.effectiveSettlement(key);
        if (approved && approved.change_type !== "void") {
          requireValue(current.version, "无法找到待撤销的正式结算版本", 409);
          current = saveDraft(
            actor,
            current.project_id,
            {
              number: current.number,
              approval_version_id: approved.approval_version_id,
              funding_version_id: approved.funding_version_id,
              change_type: "void",
              expected_version: current.version.version_no,
              expected_edit_version: current.draft?.edit_version || 0,
            },
            key,
          );
          requireValue(current.version && current.draft, "撤销结算缺少版本或待提交草稿", 409);
          current = submit(actor, key, {
            expected_version: current.version.version_no,
            expected_edit_version: current.draft.edit_version,
          });
          requireValue(current.version, "结算撤销未生成正式版本", 409);
          repo.appendReview({
            id: id(),
            settlement_version_id: current.version.id,
            event_seq: 2,
            action: "approve",
            actor_id: actor.id,
            recorded_at: now(),
            effective_on: today(),
          });
        } else if (!current.version) {
          requireValue(current.draft, "结算单缺少正式版本和草稿", 409);
          current = submit(actor, key, {
            expected_version: 0,
            expected_edit_version: current.draft.edit_version,
          });
          requireValue(current.version, "结算拒绝未生成正式版本", 409);
          repo.appendReview({
            id: id(),
            settlement_version_id: current.version.id,
            event_seq: 2,
            action: "reject",
            actor_id: actor.id,
            recorded_at: now(),
          });
        } else if (current.review && ["submit", "return"].includes(current.review.action)) {
          let sequence = current.review.event_seq;
          if (current.review.action === "return")
            repo.appendReview({
              id: id(),
              settlement_version_id: current.version.id,
              event_seq: ++sequence,
              action: "submit",
              actor_id: actor.id,
              recorded_at: now(),
            });
          repo.appendReview({
            id: id(),
            settlement_version_id: current.version.id,
            event_seq: sequence + 1,
            action: "reject",
            actor_id: actor.id,
            recorded_at: now(),
          });
        }
        repo.deleteSettlementDraft(key);
        catalog.audit(actor, "settlements", key, "delete", current, {
          logical: true,
        });
        return { deleted: true };
      });
    },
    history(key: string) {
      settlement(key);
      return repo.settlementHistory(key);
    },
  };
}

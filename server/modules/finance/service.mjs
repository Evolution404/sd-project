import { authorize, documentCode, id, now, today } from "../../platform/auth/service.js";
import {
  requireValue,
  expectedVersion,
  text,
  integer,
} from "../../shared/errors/business-error.js";
import { safeAmount } from "../pricing/calculation.js";
export function createFinance(repo, catalog, projects, pricing, hierarchies) {
  function activeLeaf(project, nodeId) {
    const node = project.cost_nodes.find((item) => item.id === nodeId);
    requireValue(
      node && !project.cost_nodes.some((child) => child.parent_id === nodeId),
      "请选择本项目末级费用科目",
    );
    let current = node;
    while (current) {
      requireValue(
        current.status === "active" &&
          !current.deleted,
        "费用科目及全部上级必须启用且未删除",
      );
      current = current.parent_id
        ? project.cost_nodes.find((parent) => parent.id === current.parent_id)
        : null;
    }
    return node;
  }
  function node(actor, projectId, input, key) {
    authorize(actor, "write");
    return repo.transaction(() => {
      requireValue(hierarchies.projectExists(projectId), "项目不存在", 404);
      const previous = key
        ? repo.find("v_project_cost_node_current", "id", key)
        : null;
      requireValue(!key || previous, "费用科目不存在", 404);
      if (previous) {
        requireValue(
          input.parent_id === undefined || (input.parent_id || null) === previous.parent_id,
          "费用科目层级身份不可修改",
        );
        requireValue(!repo.isDeleted("cost_nodes", key), "费用科目已删除");
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
          parent = parent.parent_id ? parentNodes.get(parent.parent_id) : null;
        }
      }
      const nodeId = key || id();
      if (!previous)
        repo.insert("project_cost_nodes", {
          id: nodeId,
          project_id: projectId,
          parent_id: input.parent_id || null,
          created_by: actor.id,
          created_at: now(),
        });
      repo.insert("project_cost_node_versions", {
        id: id(),
        node_id: nodeId,
        version_no: (previous?.version_no || 0) + 1,
        name: text(input.name, "费用科目名称"),
        status: input.status || "active",
        actor_id: actor.id,
        recorded_at: now(),
        reason: input.reason || "",
      });
      const result = repo.find("v_project_cost_node_current", "id", nodeId);
      catalog.audit(actor, "cost_nodes", nodeId, previous ? "revise" : "create", previous, result);
      return result;
    });
  }
  function cost(actor, projectId, input, key) {
    authorize(actor, "cost.confirm");
    return repo.transaction(() => {
      const project = projects.get(projectId),
        previous = key ? repo.latest("cost_versions", "entry_id", key) : null;
      if (previous) {
        requireValue(!repo.isDeleted("costs", key), "费用已删除", 409);
        expectedVersion(previous.version_no, input.expected_version);
        requireValue(
          repo.find("cost_entries", "id", key).project_id === projectId,
          "费用不属于本项目",
        );
      }
      const nodeRow = repo.find(
        "v_project_cost_node_current",
        "id",
        input.cost_node_id ||
          repo.find("cost_entries", "id", key)?.cost_node_id,
      );
      requireValue(
        nodeRow && nodeRow.project_id === projectId,
        "请选择本项目费用科目",
      );
      if ((input.status || "active") === "active")
        activeLeaf(project, nodeRow.id);
      const entryId = key || id();
      if (!previous)
        repo.insert("cost_entries", {
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
      repo.insert("cost_versions", value);
      return value;
    });
  }
  function settlement(key) {
    const root = repo.find("settlements", "id", key);
    requireValue(root, "结算单不存在", 404);
    const version = repo.latest("settlement_versions", "settlement_id", key),
      draft = repo.find("settlement_drafts", "settlement_id", key);
    const items = version ? hierarchies.settlementItems(version.id) : [];
    const resolutions = version
      ? repo.where("settlement_scope_results", {
          settlement_version_id: version.id,
        })
      : [];
    return {
      ...root,
      version: version || null,
      items,
      resolutions,
      draft: draft
        ? { ...draft, document: JSON.parse(draft.draft_json) }
        : null,
      review: version
        ? repo.latest(
            "settlement_review_events",
            "settlement_version_id",
            version.id,
            "event_seq",
          ) || null
        : null,
    };
  }
  function validateDraft(projectId, input) {
    const project = projects.get(projectId),
      approval = project.approvals.find(
        (ap) => ap.id === (input.approval_version_id || project.approval?.id),
      );
    requireValue(
      project.status === "approved" && approval?.status === "approved",
      "结算须采用本项目正式批准版本",
    );
    if (input.change_type === "void")
      return { ...input, items: [], resolutions: [] };
    requireValue(
      Array.isArray(input.items) && input.items.length > 0,
      "至少一条费用明细",
    );
    requireValue(
      Array.isArray(input.resolutions) && input.resolutions.length > 0,
      "至少一条独立需求解决明细",
    );
    const scopes = new Set(approval.scopes.map((x) => x.project_scope_id));
    const results = new Set();
    for (const r of input.resolutions) {
      requireValue(scopes.has(r.project_scope_id), "解决需求不属于本批准范围");
      requireValue(
        !results.has(r.project_scope_id),
        "同一需求不能重复累计解决数量",
      );
      results.add(r.project_scope_id);
      integer(r.resolved_quantity_scaled, "本次新增解决数量");
    }
    const identities = new Set();
    for (const item of input.items) {
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
      integer(item.quantity_scaled || 0, "费用计价数量");
      integer(item.amount_fen, "本次结算金额");
      requireValue(
        item.amount_fen > 0 || item.quantity_scaled > 0,
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
    };
  }
  function saveDraft(actor, projectId, input, key) {
    authorize(actor, "write");
    return repo.transaction(() => {
      const previous = key ? settlement(key) : null;
      if (key)
        requireValue(!repo.isDeleted("settlements", key), "结算单已删除");
      if (previous) {
        requireValue(previous.project_id === projectId, "结算单不属于本项目");
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
        repo.insert("settlements", {
          id: settlementId,
          project_id: projectId,
          number: documentCode("JS", settlementId),
          created_by: actor.id,
          created_at: timestamp,
        });
      const row = {
        based_on_version_id: previous?.version?.id || null,
        draft_json: JSON.stringify(normalized),
        edit_version: (previous?.draft?.edit_version || 0) + 1,
        updated_by: actor.id,
        updated_at: timestamp,
      };
      if (previous?.draft)
        repo.update("settlement_drafts", "settlement_id", settlementId, row);
      else
        repo.insert("settlement_drafts", {
          settlement_id: settlementId,
          ...row,
        });
      return settlement(settlementId);
    });
  }
  function submit(actor, key, input) {
    authorize(actor, "write");
    return repo.transaction(() => {
      const current = settlement(key);
      requireValue(!repo.isDeleted("settlements", key),
        "结算单已删除，不可再次提交", 409);
      expectedVersion(current.version?.version_no || 0, input.expected_version);
      requireValue(current.draft, "没有待提交草稿");
      expectedVersion(current.draft.edit_version, input.expected_edit_version);
      const draft = validateDraft(current.project_id, current.draft.document),
        versionId = id(),
        timestamp = now(),
        approval = repo.find(
          "project_approval_versions",
          "id",
          draft.approval_version_id,
        );
      const version = {
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
      repo.insert("settlement_versions", version);
      if (version.change_type !== "void") {
        for (const item of draft.items) {
          let identity = repo.where("settlement_items", {
            settlement_id: key,
            cost_node_id: item.cost_node_id,
            project_scope_id: item.project_scope_id || null,
          })[0];
          if (!identity) {
            identity = {
              id: id(),
              settlement_id: key,
              cost_node_id: item.cost_node_id,
              project_scope_id: item.project_scope_id || null,
              created_at: timestamp,
            };
            repo.insert("settlement_items", identity);
          }
          const scope = item.project_scope_id
            ? repo.where("project_approval_scope_versions", {
                approval_version_id: approval.id,
                project_scope_id: item.project_scope_id,
              })[0]
            : null;
          const nodeRow = repo.find(
            "v_project_cost_node_current",
            "id",
            item.cost_node_id,
          );
          repo.insert("settlement_item_versions", {
            id: id(),
            settlement_version_id: versionId,
            settlement_item_id: identity.id,
            cost_node_version_id: nodeRow.current_version_id,
            approval_scope_version_id: scope?.id || null,
            quantity_scaled: item.quantity_scaled || 0,
            amount_fen: item.amount_fen,
            unit_price_fen: item.unit_price_fen ?? null,
            work_mode: item.work_mode || null,
            evidence: item.evidence,
            scope_snapshot_json: JSON.stringify(scope || {}),
          });
        }
        for (const r of draft.resolutions) {
          const scope = repo.where("project_approval_scope_versions", {
            approval_version_id: approval.id,
            project_scope_id: r.project_scope_id,
          })[0];
          repo.insert("settlement_scope_results", {
            id: id(),
            settlement_version_id: versionId,
            project_scope_id: r.project_scope_id,
            approval_scope_version_id: scope.id,
            resolved_quantity_scaled: r.resolved_quantity_scaled,
            evidence: r.evidence || "",
          });
        }
      }
      repo.insert("settlement_review_events", {
        id: id(),
        settlement_version_id: versionId,
        event_seq: 1,
        action: "submit",
        actor_id: actor.id,
        recorded_at: timestamp,
      });
      repo.remove("settlement_drafts", "settlement_id", key);
      return settlement(key);
    });
  }
  function summary(projectId) {
    const basis = projects.summaryBasis(projectId);
    const raw = repo.projectFinanceTotals(projectId);
    const actual = safeAmount(BigInt(raw.actual_cost_fen));
    const settled = safeAmount(BigInt(raw.settlement_fen));
    const reconciled = safeAmount(BigInt(raw.reconciled_cost_fen));
    const approvalId = basis.approval_version_id;
    const budget = basis.approved_budget_fen;
    const reference = approvalId ? pricing.summary(approvalId) : null;
    const referenceTotal = reference?.total_fen ?? null;
    return {
      reference_total_fen: referenceTotal,
      reference_complete: reference?.complete || false,
      reference_subtotal_fen: reference?.subtotal_fen ?? null,
      reference_budget_difference_fen: referenceTotal !== null && budget !== null
        ? referenceTotal - budget : null,
      actual_reference_difference_fen: referenceTotal !== null
        ? actual - referenceTotal : null,
      approved_budget_fen: budget,
      actual_cost_fen: actual,
      settlement_fen: settled,
      reconciled_cost_fen: reconciled,
      unreconciled_cost_fen: actual - reconciled,
      budget_difference_fen: budget !== null ? actual - budget : null,
      demands: (approvalId ? repo.projectFinanceDemands(approvalId) : []).map(scope => {
        const solved = safeAmount(BigInt(scope.resolved_quantity_scaled));
        return {
          project_scope_id: scope.project_scope_id,
          demand_id: scope.demand_id,
          demand_no: scope.demand_no,
          approved_quantity_scaled: scope.approved_quantity_scaled,
          resolved_quantity_scaled: solved,
          remaining_quantity_scaled: Math.max(0, scope.approved_quantity_scaled - solved),
          excess_quantity_scaled: Math.max(0, solved - scope.approved_quantity_scaled),
        };
      }),
    };
  }
  return {
    search: (kind, query) => repo.searchFinance(kind, query),
    node,
    cost,
    settlement,
    saveDraft,
    submit,
    validateDraft,
    summary,
    costTree(actor, projectId) {
      authorize(actor, "read");
      requireValue(hierarchies.projectExists(projectId, true), "项目不存在", 404);
      return hierarchies.costTree(projectId);
    },
    categoryDetail(actor, projectId, nodeId, page = 1) {
      authorize(actor, "read");
      requireValue(hierarchies.projectExists(projectId, true), "项目不存在", 404);
      requireValue(hierarchies.costNodeExists(projectId, nodeId), "费用科目不存在", 404);
      return hierarchies.categoryDetail(projectId, nodeId, page);
    },
    costs: (projectId, includeDeleted = false) => hierarchies.costs(projectId, includeDeleted),
    settlements: (projectId) =>
      repo
        .where("settlements", { project_id: projectId })
        .filter((x) => !repo.isDeleted("settlements", x.id))
        .map((x) => settlement(x.id)),
    allSettlements: (includeDeleted = false) =>
      repo
        .list("settlements")
        .filter((x) => includeDeleted || !repo.isDeleted("settlements", x.id))
        .map((x) => ({
          ...settlement(x.id),
          deleted: repo.isDeleted("settlements", x.id),
        })),
    review(actor, key, input) {
      authorize(actor, "settlement.approve");
      return repo.transaction(() => {
        const current = settlement(key);
        requireValue(!repo.isDeleted("settlements", key),
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
        repo.insert("settlement_review_events", {
          id: id(),
          settlement_version_id: current.version.id,
          event_seq: (current.review?.event_seq || 0) + 1,
          action: input.action,
          actor_id: actor.id,
          recorded_at: now(),
          effective_on:
            input.action === "approve" ? input.effective_on || today() : null,
          reason: input.reason || "",
        });
        return settlement(key);
      });
    },
    discardDraft(actor, key, input) {
      authorize(actor, "write");
      return repo.transaction(() => {
        const current = settlement(key);
        requireValue(!repo.isDeleted("settlements", key),
          "结算单已删除，不可撤销草稿", 409);
        expectedVersion(
          current.draft?.edit_version || 0,
          input.expected_edit_version,
        );
        repo.remove("settlement_drafts", "settlement_id", key);
        return settlement(key);
      });
    },
    reconciliation(actor, input) {
      authorize(actor, "cost.confirm");
      return repo.transaction(() => {
        requireValue(
          !input.record_id ||
            !repo.isDeleted("reconciliations", input.record_id),
          "核对记录已删除",
          409,
        );
        const previous = input.record_id
          ? repo.latest(
              "cost_reconciliation_versions",
              "record_id",
              input.record_id,
            )
          : null;
        expectedVersion(previous?.version_no || 0, input.expected_version);
        const source = input.status === "voided" ? previous : input;
        requireValue(source, "核对记录不存在");
        const item = repo.find(
          "settlement_item_versions",
          "id",
          source.settlement_item_version_id,
        );
        requireValue(item, "结算费用明细不存在");
        const row = {
          id: id(),
          record_id: previous?.record_id || id(),
          version_no: (previous?.version_no || 0) + 1,
          status: input.status || "active",
          cost_version_id: source.cost_version_id,
          settlement_item_id: item.settlement_item_id,
          settlement_item_version_id: item.id,
          reconciled_cost_fen: source.reconciled_cost_fen,
          reconciled_settlement_fen: source.reconciled_settlement_fen,
          is_final: input.status === "voided" ? 0 : input.is_final ? 1 : 0,
          evidence: input.evidence || "",
          actor_id: actor.id,
          created_at: now(),
          request_key: input.request_key || id(),
        };
        repo.insert("cost_reconciliation_versions", row);
        return row;
      });
    },
    close(actor, key, input) {
      authorize(actor, "project.close");
      return repo.transaction(() => {
        const project = projects.get(key);
        expectedVersion(project.version, input.expected_version);
        requireValue(project.approval, "缺少批准版本");
        repo.insert("project_closures", {
          id: id(),
          project_id: key,
          approval_version_id: project.approval.id,
          reason: input.reason || "",
          close_snapshot_json: JSON.stringify(summary(key)),
          closed_by: actor.id,
          closed_at: now(),
        });
        repo.insert("project_stage_events", {
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
    reconciliations(projectId, includeDeleted = false) {
      return repo.projectReconciliations(projectId, includeDeleted);
    },
    removeReconciliation(actor, key, input) {
      authorize(actor, "cost.confirm");
      return repo.transaction(() => {
        const current = repo.latest(
          "cost_reconciliation_versions",
          "record_id",
          key,
        );
        requireValue(current, "核对记录不存在", 404);
        requireValue(!repo.isDeleted("reconciliations", key),
          "核对记录已删除，不能重复删除", 409);
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
    reconciliationHistory: (key) =>
      repo.where("cost_reconciliation_versions", { record_id: key }),
    removeNode(actor, projectId, key, input) {
      authorize(actor, "admin");
      return repo.transaction(() => {
        const current = repo.find("v_project_cost_node_current", "id", key);
        requireValue(
          current && current.project_id === projectId,
          "费用科目不存在",
          404,
        );
        requireValue(!repo.isDeleted("cost_nodes", key),
          "费用科目已删除，不能重复删除", 409);
        expectedVersion(current.version_no, input.expected_version);
        const impact = hierarchies.costTree(projectId).find(node => node.id === key);
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
    removeCost(actor, projectId, key, input) {
      authorize(actor, "admin");
      return repo.transaction(() => {
        const current = repo.latest("cost_versions", "entry_id", key);
        requireValue(current, "费用不存在", 404);
        requireValue(!repo.isDeleted("costs", key),
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
    costHistory(key) {
      requireValue(repo.find("cost_entries", "id", key), "费用不存在", 404);
      return repo.where("cost_versions", { entry_id: key });
    },
    removeSettlement(actor, key, input) {
      authorize(actor, "admin");
      return repo.transaction(() => {
        let current = settlement(key);
        requireValue(!repo.isDeleted("settlements", key),
          "结算单已删除，不能重复删除", 409);
        expectedVersion(
          current.version?.version_no || 0,
          input.expected_version,
        );
        expectedVersion(
          current.draft?.edit_version || 0,
          input.expected_edit_version,
        );
        const approved = repo.where("v_settlement_effective_versions", {
          settlement_id: key,
        })[0];
        if (approved && approved.change_type !== "void") {
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
          current = submit(actor, key, {
            expected_version: current.version.version_no,
            expected_edit_version: current.draft.edit_version,
          });
          repo.insert("settlement_review_events", {
            id: id(),
            settlement_version_id: current.version.id,
            event_seq: 2,
            action: "approve",
            actor_id: actor.id,
            recorded_at: now(),
            effective_on: today(),
          });
        } else if (!current.version) {
          current = submit(actor, key, {
            expected_version: 0,
            expected_edit_version: current.draft.edit_version,
          });
          repo.insert("settlement_review_events", {
            id: id(),
            settlement_version_id: current.version.id,
            event_seq: 2,
            action: "reject",
            actor_id: actor.id,
            recorded_at: now(),
          });
        } else if (["submit", "return"].includes(current.review?.action)) {
          let sequence = current.review.event_seq;
          if (current.review.action === "return")
            repo.insert("settlement_review_events", {
              id: id(),
              settlement_version_id: current.version.id,
              event_seq: ++sequence,
              action: "submit",
              actor_id: actor.id,
              recorded_at: now(),
            });
          repo.insert("settlement_review_events", {
            id: id(),
            settlement_version_id: current.version.id,
            event_seq: sequence + 1,
            action: "reject",
            actor_id: actor.id,
            recorded_at: now(),
          });
        }
        repo.remove("settlement_drafts", "settlement_id", key);
        catalog.audit(actor, "settlements", key, "delete", current, {
          logical: true,
        });
        return { deleted: true };
      });
    },
    history(key) {
      settlement(key);
      return repo.settlementHistory(key);
    },
  };
}

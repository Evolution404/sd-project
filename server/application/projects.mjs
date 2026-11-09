import { authorize, documentCode, id, now } from "./auth.mjs";
import {
  requireValue,
  expectedVersion,
  text,
  integer,
} from "../domain/errors.mjs";
export function createProjects(repo, catalog, demands, pricing) {
  function get(key, includeDeleted = false) {
    const root = repo.find("projects", "id", key);
    requireValue(
      root && (includeDeleted || !repo.isDeleted("projects", key)),
      "项目不存在或已删除",
      404,
    );
    const profile = repo.latest(
        "project_management_versions",
        "project_id",
        key,
      ),
      approval =
        repo
          .where("project_approval_versions", {
            project_id: key,
            status: "approved",
          })
          .sort((a, b) => b.version_no - a.version_no)[0] || null;
    const scopes = repo
      .where("project_demand_scopes", { project_id: key })
      .map((scope) => ({
        ...scope,
        demand_no: repo.find("demands", "id", scope.demand_id).demand_no,
        binding:
          repo.find(
            "v_project_demand_binding_current",
            "project_scope_id",
            scope.id,
          ) || null,
      }));
    return {
      ...profile,
      ...root,
      deleted: repo.isDeleted("projects", key),
      category_name: profile.category_id
        ? repo.where("dictionary_item_versions", {
            item_id: profile.category_id,
            version: profile.category_version,
          })[0]?.name
        : null,
      managing_unit_name: profile.managing_unit_version_id
        ? repo.find(
            "organizational_unit_versions",
            "id",
            profile.managing_unit_version_id,
          )?.name
        : null,
      owner_username: profile.owner_id
        ? repo.find("users", "id", profile.owner_id)?.username
        : null,
      manager_username: profile.manager_id
        ? repo.find("users", "id", profile.manager_id)?.username
        : null,
      profile_version: profile.version_no,
      funding:
        repo.latest("project_funding_versions", "project_id", key) || null,
      approval,
      scopes,
      approvals: repo
        .where("project_approval_versions", { project_id: key })
        .filter((approval) => approval.status !== "withdrawn")
        .map((ap) => ({
          ...ap,
          scopes: repo
            .where("project_approval_scope_versions", {
              approval_version_id: ap.id,
            })
            .map((sc) => ({
              ...sc,
              demand_no: repo.find("demands", "id", sc.demand_id).demand_no,
              materials: repo.where("project_approval_material_items", {
                approval_version_id: ap.id,
                project_scope_id: sc.project_scope_id,
              }),
              locations: repo.where("project_approval_work_locations", {
                approval_scope_version_id: sc.id,
              }),
            })),
          reference: pricing.summary(ap.id),
        })),
      cost_nodes: repo
        .where("v_project_cost_node_current", { project_id: key })
        .map((node) => ({
          ...node,
          deleted: repo.isDeleted("cost_nodes", node.id),
        })),
      changes: repo.where("project_change_orders", { project_id: key }),
    };
  }
  function save(actor, input, key) {
    authorize(actor, "write");
    return repo.transaction(() => {
      const previous = key ? get(key) : null;
      if (previous)
        expectedVersion(previous.profile_version, input.expected_version);
      const projectId = key || id(),
        timestamp = now();
      if (!previous) {
        const framework = catalog.get("frameworks", input.framework_id);
        requireValue(framework.status === "active", "框架已停用");
        repo.insert("projects", {
          id: projectId,
          code: documentCode("XM", projectId),
          framework_id: framework.id,
          created_by: actor.id,
          created_at: timestamp,
        });
      }
      for (const key of ["owner_id", "manager_id"])
        if (input[key] && input[key] !== previous?.[key]) {
          const user = repo.find("users", "id", input[key]);
          requireValue(
            user &&
              user.status === "active" &&
              !repo.isDeleted("users", user.id),
            "请选择有效责任人或管理人员",
          );
        }
      const category = input.category_id
          ? catalog.get("categories", input.category_id)
          : null,
        organization = input.managing_unit_id
          ? catalog.get("organizations", input.managing_unit_id)
          : null;
      repo.insert("project_management_versions", {
        id: id(),
        project_id: projectId,
        version_no: (previous?.profile_version || 0) + 1,
        name: text(input.name, "项目名称"),
        category_id: category?.id || null,
        category_version: category?.version || null,
        owner_id: input.owner_id || null,
        manager_id: input.manager_id || null,
        managing_unit_id: organization?.id || null,
        managing_unit_version_id: organization?.unit_version_id || null,
        planned_start_on: input.planned_start_on || null,
        planned_end_on: input.planned_end_on || null,
        preliminary_estimate_fen: input.preliminary_estimate_fen ?? null,
        preliminary_estimate_basis: input.preliminary_estimate_basis || null,
        actor_id: actor.id,
        recorded_at: timestamp,
        reason: input.reason || "",
      });
      catalog.audit(
        actor,
        "projects",
        projectId,
        previous ? "revise" : "create",
        previous,
        get(projectId),
      );
      return get(projectId);
    });
  }
  function stage(actor, key, stageName, permission, version) {
    authorize(actor, permission);
    const p = get(key);
    expectedVersion(p.version, version);
    repo.insert("project_stage_events", {
      id: id(),
      project_id: key,
      stage: stageName,
      project_version: p.version + 1,
      actor_id: actor.id,
      created_at: now(),
    });
    return get(key);
  }
  function approvalDraft(actor, key, input) {
    authorize(actor, "write");
    return repo.transaction(() => {
      const project = get(key);
      expectedVersion(project.version, input.expected_version);
      requireValue(
        !project.approvals.some((ap) => ap.status === "draft"),
        "已有批准草稿，请先处理",
      );
      requireValue(
        (input.expected_approval_version_id ?? null) ===
          (project.approval?.id ?? null),
        "项目批准基线已变化，请刷新后重新编制",
        409,
      );
      const previous = project.approval,
        approvalId = id(),
        version = project.approvals.length + 1,
        timestamp = now();
      let changeId = null;
      if (version > 1) {
        requireValue(previous, "缺少正式批准基线");
        changeId = id();
        repo.insert("project_change_orders", {
          id: changeId,
          project_id: key,
          code: input.change_code || `BG-${id()}`,
          base_approval_version_id: previous.id,
          proposal_json: JSON.stringify(input),
          created_by: actor.id,
          created_at: timestamp,
          reason: input.reason || "",
        });
      }
      repo.insert("project_approval_versions", {
        id: approvalId,
        project_id: key,
        version_no: version,
        change_order_id: changeId,
        snapshot_json: JSON.stringify({
          project_profile_version: project.profile_version,
          basis: input.basis || "",
        }),
        approved_budget_fen: integer(input.approved_budget_fen, "批准预算"),
        created_at: timestamp,
      });
      requireValue(
        Array.isArray(input.scopes) && input.scopes.length > 0,
        "请明确批准需求范围",
      );
      for (const selected of input.scopes) {
        const scope = project.scopes.find(
          (x) => x.id === selected.project_scope_id,
        );
        requireValue(scope?.binding, "需求未由本项目关联");
        const demand = demands.get(scope.demand_id);
        expectedVersion(demand.current_version, selected.demand_version);
        const locations = selected.locations;
        requireValue(
          Array.isArray(locations) && locations.length > 0,
          "请明确承接位置和数量",
        );
        const total = locations.reduce(
          (sum, loc) =>
            sum + integer(loc.approved_quantity_scaled, "批准位置数量", 1),
          0,
        );
        const scopeId = id();
        repo.insert("project_approval_scope_versions", {
          id: scopeId,
          approval_version_id: approvalId,
          project_scope_id: scope.id,
          demand_id: demand.id,
          demand_version: demand.current_version,
          quantity_scaled: total,
          approved_amount_fen: selected.approved_amount_fen ?? null,
          snapshot_json: JSON.stringify(demand),
          created_at: timestamp,
        });
        if (demand.work_locations.length > 1)
          for (const loc of locations)
            repo.insert("project_approval_work_locations", {
              approval_scope_version_id: scopeId,
              demand_id: demand.id,
              demand_version: demand.current_version,
              location_item_no: loc.location_item_no,
              approved_quantity_scaled: loc.approved_quantity_scaled,
            });
        else
          requireValue(
            locations.length === 1 && locations[0].location_item_no === 1,
            "批准位置无效",
          );
        // Material approval is explicit. No proportional derivation from demand quantities.
        for (const [index, item] of (selected.materials || []).entries()) {
          const master = catalog.get("materials", item.material_id),
            unit = catalog.get("units", master.unit_id);
          let identity = repo.where("project_scope_materials", {
            project_scope_id: scope.id,
            material_id: master.id,
          })[0];
          if (!identity) {
            identity = {
              id: id(),
              project_scope_id: scope.id,
              material_id: master.id,
              created_at: timestamp,
            };
            repo.insert("project_scope_materials", identity);
          }
          repo.insert("project_approval_material_items", {
            id: id(),
            approval_version_id: approvalId,
            project_scope_id: scope.id,
            project_material_id: identity.id,
            material_version_id: master.material_version_id,
            item_no: index + 1,
            material_code_snapshot: master.code,
            material_name: master.name,
            material_model: master.model,
            specification: master.specification,
            approved_quantity_scaled: item.quantity_scaled,
            unit_id: unit.id,
            unit_snapshot: unit.name,
          });
        }
      }
      return get(key);
    });
  }
  return {
    get,
    save,
    approvalDraft,
    list(includeDeleted = false) {
      const deleted = repo.deleted("projects");
      return repo
        .list("projects")
        .filter((x) => includeDeleted || !deleted.has(x.id))
        .map((x) => ({
          ...get(x.id, includeDeleted),
          deleted: deleted.has(x.id),
        }));
    },
    stock(actor, key, input) {
      return repo.transaction(() =>
        stage(actor, key, "stocked", "project.stock", input.expected_version),
      );
    },
    link(actor, key, input) {
      authorize(actor, "write");
      return repo.transaction(() => {
        const project = get(key);
        requireValue(project.status !== "closed", "已结项项目不能新增关联");
        const demand = demands.get(input.demand_id);
        expectedVersion(demand.current_version, input.expected_version);
        const existing = project.scopes.find((x) => x.demand_id === demand.id),
          timestamp = now();
        if (existing) {
          const last = repo.latest(
            "project_demand_link_events",
            "project_scope_id",
            existing.id,
            "event_seq",
          );
          repo.insert("project_demand_link_events", {
            id: id(),
            project_scope_id: existing.id,
            event_seq: last.event_seq + 1,
            action: "linked",
            actor_id: actor.id,
            recorded_at: timestamp,
            reason: input.reason || "",
          });
        } else
          repo.insert("project_demand_scopes", {
            id: id(),
            project_id: key,
            demand_id: demand.id,
            demand_version: demand.current_version,
            proposed_quantity_scaled:
              input.quantity_scaled || demand.quantity_scaled,
            created_by: actor.id,
            created_at: timestamp,
            updated_at: timestamp,
            demand_snapshot_json: JSON.stringify(demand),
          });
        return get(key);
      });
    },
    release(actor, key, scopeId, input) {
      authorize(actor, "write");
      return repo.transaction(() => {
        const project = get(key, true);
        if (project.deleted) authorize(actor, "admin");
        const scope = project.scopes.find((x) => x.id === scopeId);
        requireValue(scope, "关联不存在", 404);
        const last = repo.latest(
          "project_demand_link_events",
          "project_scope_id",
          scopeId,
          "event_seq",
        );
        expectedVersion(last.event_seq, input.expected_event_seq);
        repo.insert("project_demand_link_events", {
          id: id(),
          project_scope_id: scopeId,
          event_seq: last.event_seq + 1,
          action: "released",
          actor_id: actor.id,
          recorded_at: now(),
          reason: input.reason || "",
        });
        return get(key, true);
      });
    },
    fund(actor, key, input) {
      authorize(actor, "write");
      return repo.transaction(() => {
        const project = get(key);
        expectedVersion(
          project.funding?.version_no || 0,
          input.expected_version,
        );
        if (input.agreement_id) catalog.get("agreements", input.agreement_id);
        repo.insert("project_funding_versions", {
          id: id(),
          project_id: key,
          version_no: (project.funding?.version_no || 0) + 1,
          agreement_id: input.agreement_id || null,
          actor_id: actor.id,
          recorded_at: now(),
          reason: input.reason || "",
        });
        return get(key);
      });
    },
    approve(actor, key, approvalId, input) {
      return repo.transaction(() => {
        const project = get(key),
          approval = project.approvals.find((ap) => ap.id === approvalId);
        requireValue(approval, "批准版本不存在", 404);
        expectedVersion(project.version, input.expected_version);
        authorize(
          actor,
          approval.version_no === 1 ? "project.approve" : "change.approve",
        );
        if (approval.change_order_id)
          repo.update("project_change_orders", "id", approval.change_order_id, {
            status: "approved",
            decided_by: actor.id,
            decided_at: now(),
            decision_reason: input.reason || "",
          });
        repo.update("project_approval_versions", "id", approvalId, {
          status: "approved",
          approved_by: actor.id,
          approved_at: now(),
        });
        if (approval.version_no === 1)
          stage(actor, key, "approved", "project.approve", project.version);
        return get(key);
      });
    },
    discardApproval(actor, key, approvalId) {
      authorize(actor, "write");
      return repo.transaction(() => {
        const approval = get(key).approvals.find((x) => x.id === approvalId);
        requireValue(approval?.status === "draft", "只能删除未批准草稿");
        catalog.audit(
          actor,
          "approval_drafts",
          approvalId,
          "delete",
          approval,
          { status: "withdrawn" },
        );
        repo.update("project_approval_versions", "id", approvalId, {
          status: "withdrawn",
        });
        if (approval.change_order_id)
          repo.update("project_change_orders", "id", approval.change_order_id, {
            status: "rejected",
            decided_by: actor.id,
            decided_at: now(),
            decision_reason: "",
          });
        return get(key);
      });
    },
    remove(actor, key, input) {
      authorize(actor, "admin");
      return repo.transaction(() => {
        const project = get(key);
        expectedVersion(project.version, input.expected_version);
        requireValue(
          project.status === "closed" ||
            (["reserve", "stocked"].includes(project.status) &&
              !project.scopes.some((x) => x.binding)),
          "请先处理项目关联与正式结项",
        );
        catalog.audit(actor, "projects", key, "delete", project, {
          logical: true,
        });
        return { deleted: true };
      });
    },
    history(key) {
      get(key, true);
      return {
        approvals: repo
          .where("project_approval_versions", { project_id: key })
          .map((approval) => ({
            ...approval,
            scopes: repo.where("project_approval_scope_versions", {
              approval_version_id: approval.id,
            }),
          })),
        costs: repo.where("cost_entries", { project_id: key }).map((entry) => ({
          ...entry,
          versions: repo.where("cost_versions", { entry_id: entry.id }),
        })),
        settlements: repo
          .where("settlements", { project_id: key })
          .map((bill) => ({
            ...bill,
            versions: repo
              .where("settlement_versions", { settlement_id: bill.id })
              .map((version) => ({
                ...version,
                items: repo.where("settlement_item_versions", {
                  settlement_version_id: version.id,
                }),
                resolutions: repo.where("settlement_scope_results", {
                  settlement_version_id: version.id,
                }),
                events: repo.where("settlement_review_events", {
                  settlement_version_id: version.id,
                }),
              })),
          })),
        profiles: repo.where("project_management_versions", {
          project_id: key,
        }),
        funding: repo.where("project_funding_versions", { project_id: key }),
        stages: repo.where("project_stage_events", { project_id: key }),
        closures: repo.where("project_closures", { project_id: key }),
        cost_nodes: repo
          .where("project_cost_nodes", { project_id: key })
          .map((node) => ({
            ...node,
            versions: repo.where("project_cost_node_versions", {
              node_id: node.id,
            }),
          })),
      };
    },
  };
}

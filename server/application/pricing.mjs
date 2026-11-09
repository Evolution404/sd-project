import { authorize, id, now, today } from "./auth.mjs";
import { requireValue, expectedVersion } from "../domain/errors.mjs";
import {
  calculate,
  matches,
  explainMismatch,
  ENGINE_VERSION,
  safeAmount,
} from "../domain/pricing.mjs";
export function createPricing(repo, catalog, demands) {
  function quote(actor, key, input = {}, locked = false) {
    if (input.confirm && !locked)
      return repo.transaction(() => quote(actor, key, input, true));
    authorize(actor, input.confirm ? "write" : "read");
    let demand = demands.get(key);
    const scope = input.approval_scope_version_id
      ? repo.find(
          "project_approval_scope_versions",
          "id",
          input.approval_scope_version_id,
        )
      : null;
    if (input.approval_scope_version_id) {
      requireValue(
        scope && scope.demand_id === key,
        "批准范围与需求版本不匹配",
      );
      const version = repo.where("demand_versions", {
        demand_id: key,
        version: scope.demand_version,
      })[0];
      demand = {
        ...demand,
        ...JSON.parse(version.snapshot_json),
        current_version: version.version,
      };
    }
    expectedVersion(demand.current_version, input.expected_version);
    const locations = scope
      ? repo
          .where("project_approval_work_locations", {
            approval_scope_version_id: scope.id,
          })
          .map((loc) => ({
            ...demand.work_locations[loc.location_item_no - 1],
            quantity_scaled: loc.approved_quantity_scaled,
          }))
      : demand.work_locations;
    const date = input.pricing_date || today(),
      missing = [],
      lines = [];
    const catalogs = catalog.list("prices");
    const rules = catalogs
      .map(
        (c) =>
          repo
            .where("reference_price_versions", { catalog_id: c.id })
            .filter((v) => v.effective_on <= date)
            .sort((a, b) => b.version_no - a.version_no)[0],
      )
      .filter((rule) => rule && rule.pricing_scope === "work_location")
      .map((rule) => ({ ...rule, current_version_id: rule.id }));
    const diagnosticRules = catalogs
      .map((c) => repo.latest("reference_price_versions", "catalog_id", c.id, "version_no"))
      .filter((rule) => rule?.pricing_scope === "work_location");
    const factorLabels = catalog.displayLabels();
    const operation = repo.where("operation_versions", {
      operation_id: demand.operation_id,
      version: demand.operation_version,
    })[0];
    const declarations = JSON.parse(operation.pricing_features_json);
    for (const [index, location] of locations.entries()) {
      const itemNo = location.item_no || index + 1;
      const actual =
        typeof location.site_features_json === "string"
          ? JSON.parse(location.site_features_json)
          : location.site_features_json;
      const missingFeatures = declarations
        .filter((feature) => feature.required)
        .map((feature) => {
          const factor = repo.find("dictionary_items", "id", feature.factor_id);
          const version = repo.where("dictionary_item_versions", {
            item_id: factor.id, version: feature.factor_version,
          })[0];
          return {
            ...feature,
            code: factor.code,
            name: version?.name || factor.code,
            supplied: actual[factor.code]?.factor_version === feature.factor_version,
          };
        })
        .filter((feature) => !feature.supplied);
      if (missingFeatures.length) {
        missing.push({
          location_item_no: itemNo,
          reason: "缺少计价必需信息：" + missingFeatures.map((feature) => feature.name).join("、"),
          candidates: [],
        });
        continue;
      }
      const matched = rules.filter((rule) =>
        matches(rule, demand, location, date),
      );
      const chosen = input.selections?.[itemNo];
      let selected = matched;
      if (chosen) {
        requireValue(
          input.selection_basis?.[itemNo]?.trim(),
          "明确选价需填写选择依据",
        );
        selected = matched.filter((x) => x.current_version_id === chosen);
      }
      if (selected.length !== 1) {
        missing.push({
          location_item_no: itemNo,
          reason: selected.length
            ? "存在重叠规则，请明确选择并记录依据"
            : "无适用价格",
          diagnostics: selected.length ? [] : diagnosticRules
            .filter((rule) => rule.operation_id === demand.operation_id)
            .map((rule) => ({
              title: rule.title,
              reasons: explainMismatch(rule, demand, location, date).map((reason) =>
                reason.replace(/：([^：]+)$/, (_match, code) =>
                  "：" + (factorLabels[code] || "未识别的价格特征"))),
            }))
            .sort((a, b) => a.reasons.length - b.reasons.length)
            .slice(0, 5),
          candidates: matched.map((x) => ({
            id: x.current_version_id,
            title: x.title,
          })),
        });
        continue;
      }
      const rule = repo.find(
        "reference_price_versions",
        "id",
        selected[0].current_version_id,
      );
      let result;
      try {
        const basis = input.bases?.[itemNo] || {};
        const isRate =
          rule.pricing_mode === "rate" ||
          (rule.pricing_mode === "composite" &&
            JSON.parse(rule.fee_components_json).some(
              (component) => component.formula_mode === "rate",
            ));
        if (isRate)
          requireValue(basis.evidence?.trim(), "请提供计费基数及真实依据");
        result = calculate(rule, location.quantity_scaled, basis);
      } catch (error) {
        if (!error.status) throw error;
        missing.push({
          location_item_no: itemNo,
          reason: error.message,
          candidates: [],
          needs_basis:
            rule.pricing_mode === "rate" || rule.pricing_mode === "composite",
        });
        continue;
      }
      lines.push({
        location_item_no: itemNo,
        coverage_key: "main",
        reference_price_version_id: rule.id,
        rule_title: rule.title,
        rule_version_no: rule.version_no,
        pricing_mode: rule.pricing_mode,
        quantity_scaled: location.quantity_scaled,
        amount_fen: result.amount_fen,
        calculation_inputs_json: JSON.stringify({
          location,
          bases: input.bases?.[itemNo] || {},
          selection_basis: input.selection_basis?.[itemNo] || null,
        }),
        calculation_trace_json: JSON.stringify(result.trace),
      });
    }
    const subtotal = safeAmount(
      lines.reduce((sum, line) => sum + BigInt(line.amount_fen), 0n),
    );
    const result = {
      complete: missing.length === 0 && lines.length > 0,
      subtotal_fen: subtotal,
      total_fen: missing.length ? null : subtotal,
      missing,
      lines,
      engine_version: ENGINE_VERSION,
    };
    if (!input.confirm) return result;
    requireValue(result.complete, "未完整计价，不能确认完整参考报价", 422, {
      missing,
    });
    return repo.transaction(() => {
      const evaluationId = id(),
        timestamp = now();
      repo.insert("reference_price_evaluations", {
        id: evaluationId,
        demand_id: key,
        demand_version: demand.current_version,
        approval_scope_version_id: scope?.id || null,
        pricing_date: date,
        status: "draft",
        engine_version: ENGINE_VERSION,
        input_basis_json: JSON.stringify({
          scope: scope?.id || null,
          locations,
        }),
        created_by: actor.id,
        created_at: timestamp,
      });
      for (const line of lines) {
        // Presentation labels are derived from the immutable rule version,
        // never duplicated into formal calculation-line facts.
        const { rule_title, rule_version_no, pricing_mode, ...formalLine } = line;
        repo.insert("reference_price_evaluation_lines", {
          id: id(),
          evaluation_id: evaluationId,
          ...formalLine,
        });
      }
      repo.update("reference_price_evaluations", "id", evaluationId, {
        status: "final",
        finalized_by: actor.id,
        finalized_at: now(),
      });
      if (scope) {
        repo.remove(
          "project_approval_scope_prices",
          "approval_scope_version_id",
          scope.id,
        );
        repo.insert("project_approval_scope_prices", {
          approval_scope_version_id: scope.id,
          evaluation_id: evaluationId,
        });
      }
      return { ...result, id: evaluationId };
    });
  }
  return {
    quote,
    addCharge(actor, input) {
      authorize(actor, "write");
      return repo.transaction(() => {
        const approval = repo.find(
            "project_approval_versions",
            "id",
            input.approval_version_id,
          ),
          rule = repo.find(
            "reference_price_versions",
            "id",
            input.reference_price_version_id ||
              (input.reference_price_catalog_id
                ? catalog.get("prices", input.reference_price_catalog_id)
                    .current_version_id
                : ""),
          );
        requireValue(
          approval &&
            rule &&
            ["project", "work_batch"].includes(rule.pricing_scope),
          "独立费用规则或批准版本无效",
        );
        const pricingDate = input.pricing_date || today();
        requireValue(rule.effective_on <= pricingDate, "价格尚未生效");
        const scopes = repo.where("project_approval_scope_versions", {
          approval_version_id: approval.id,
        });
        const applicable = scopes.some((scope) => {
          const version = repo.where("demand_versions", {
            demand_id: scope.demand_id,
            version: scope.demand_version,
          })[0];
          return repo
            .where("project_approval_work_locations", {
              approval_scope_version_id: scope.id,
            })
            .some((selected) => {
              const location = repo.where("demand_version_work_locations", {
                demand_id: scope.demand_id,
                demand_version: scope.demand_version,
                item_no: selected.location_item_no,
              })[0];
              return matches(rule, version, location, pricingDate);
            });
        });
        requireValue(applicable, "独立费用规则不适用于本项目批准范围");
        const bases = { ...(input.bases || {}) };
        const parameters = JSON.parse(rule.calculation_params_json);
        if (parameters.rate_basis === "approved_subtotal") {
          const current = repo.where("project_approval_scope_versions", {
            approval_version_id: approval.id,
          });
          let total = 0n;
          for (const scope of current) {
            const chosen = repo.find(
              "project_approval_scope_prices",
              "approval_scope_version_id",
              scope.id,
            );
            requireValue(
              chosen,
              "批准范围参考报价尚未完整，不能采用其小计作为费率基数",
            );
            for (const line of repo.where("reference_price_evaluation_lines", {
              evaluation_id: chosen.evaluation_id,
            }))
              total += BigInt(line.amount_fen);
          }
          bases.approved_subtotal = safeAmount(total);
        }
        const result = calculate(rule, input.quantity_scaled, bases);
        const scopeKey =
          rule.pricing_scope === "project"
            ? `project/${rule.catalog_id}`
            : `batch/${input.charge_scope_key}/${rule.catalog_id}`;
        requireValue(
          rule.pricing_scope === "project" ||
            (typeof input.charge_scope_key === "string" &&
              input.charge_scope_key.trim()),
          "请明确批次身份",
        );
        const row = {
          id: id(),
          approval_version_id: approval.id,
          reference_price_version_id: rule.id,
          charge_scope_key: scopeKey,
          amount_fen: result.amount_fen,
          pricing_inputs_json: JSON.stringify({
            ...input,
            bases,
            pricing_date: pricingDate,
          }),
          calculation_trace_json: JSON.stringify(result.trace),
          created_by: actor.id,
          created_at: now(),
        };
        repo.insert("project_reference_price_charges", row);
        return row;
      });
    },
    removeCharge(actor, key) {
      authorize(actor, "write");
      return repo.transaction(() => {
        const charge = repo.find("project_reference_price_charges", "id", key);
        requireValue(charge, "该参考费用已发生变化，请刷新", 409);
        const approval = repo.find(
          "project_approval_versions",
          "id",
          charge.approval_version_id,
        );
        requireValue(
          approval.status === "draft",
          "正式批准后的参考费用须通过项目变更更正",
        );
        catalog.audit(actor, "reference_charges", key, "delete", charge, {
          logical: true,
        });
        repo.remove("project_reference_price_charges", "id", key);
        return { deleted: true };
      });
    },
    reviseCharge(actor, key, input) {
      authorize(actor, "write");
      return repo.transaction(() => {
        const charge = repo.find("project_reference_price_charges", "id", key);
        requireValue(charge, "该参考费用已发生变化，请刷新", 409);
        this.removeCharge(actor, key);
        const values = {
          ...JSON.parse(charge.pricing_inputs_json),
          ...input,
          approval_version_id: charge.approval_version_id,
        };
        if (input.reference_price_catalog_id)
          delete values.reference_price_version_id;
        const revised = this.addCharge(actor, values);
        catalog.audit(
          actor,
          "reference_charges",
          key,
          "revise",
          charge,
          revised,
        );
        return revised;
      });
    },
    summary(approvalId) {
      const scopes = repo.where("project_approval_scope_versions", {
        approval_version_id: approvalId,
      });
      const missing = [],
        evaluations = [];
      for (const scope of scopes) {
        const choice = repo.find(
          "project_approval_scope_prices",
          "approval_scope_version_id",
          scope.id,
        );
        if (!choice)
          missing.push({ demand_id: scope.demand_id, scope_id: scope.id });
        else evaluations.push(choice.evaluation_id);
      }
      const lines = repo
        .list("reference_price_evaluation_lines")
        .filter((x) => evaluations.includes(x.evaluation_id));
      const charges = repo.where("project_reference_price_charges", {
        approval_version_id: approvalId,
      });
      const subtotal = safeAmount(
        [...lines, ...charges].reduce(
          (sum, x) => sum + BigInt(x.amount_fen),
          0n,
        ),
      );
      return {
        complete: scopes.length > 0 && missing.length === 0,
        total_fen: scopes.length && missing.length === 0 ? subtotal : null,
        subtotal_fen: subtotal,
        missing,
        charges: charges.map((charge) => {
          const rule = repo.find(
            "reference_price_versions",
            "id",
            charge.reference_price_version_id,
          );
          return {
            ...charge,
            rule_title: rule.title,
            reference_price_catalog_id: rule.catalog_id,
          };
        }),
      };
    },
  };
}

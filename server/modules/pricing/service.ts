import { createHash } from "node:crypto";
import { authorize, id, now, today } from "../../platform/auth/service.js";
import {
  BusinessError,
  requireValue,
  expectedVersion,
  text,
} from "../../shared/errors/business-error.js";
import { isObject } from "../../shared/types/contracts.js";
import type { Actor } from "../../shared/types/contracts.js";
import type {
  QuoteLine,
  MissingPrice,
  QuoteResult,
  ReferenceCharge,
} from "../../shared/types/pricing.js";
import type { PricingRepository } from "../../database/repositories/pricing.js";
import type { Database } from "../../database/connection.js";
import type { AuditService } from "../../platform/audit/service.js";
import type { PriceRuleService } from "./rules.js";
import type { WorkStandardService } from "../work-standards/service.js";
import {
  calculate,
  matches,
  explainMismatch,
  ENGINE_VERSION,
  safeAmount,
} from "./calculation.js";
import type { FeeComponent } from "./model.js";

type CalculationBasis = Record<string, number | string>;
function record(value: unknown, label: string): Record<string, unknown> {
  if (value === undefined) return {};
  requireValue(isObject(value), label + "必须为对象");
  return value;
}
function bases(value: unknown): CalculationBasis {
  const result = record(value, "计费基数");
  for (const [key, fact] of Object.entries(result)) {
    requireValue(
      key === "evidence"
        ? typeof fact === "string"
        : typeof fact === "number" && Number.isSafeInteger(fact) && fact >= 0,
      "请填写有效的计费基数及真实依据",
    );
  }
  return result as CalculationBasis;
}
function calculateBases(value: CalculationBasis): Record<string, number> {
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number] => typeof entry[1] === "number",
    ),
  );
}
function pricingDate(value: unknown): string {
  const date = value === undefined ? today() : text(value, "计价日期");
  requireValue(
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      Number.isFinite(Date.parse(date)) &&
      new Date(date).toISOString().slice(0, 10) === date,
    "请填写有效的计价日期",
  );
  return date;
}
function summarize(
  scopes: ReturnType<PricingRepository["scopeQuotes"]>,
  charges: ReturnType<PricingRepository["charges"]>,
) {
  const missing = scopes.filter(scope => !scope.evaluation_id)
    .map(scope => ({ demand_id: scope.demand_id, scope_id: scope.scope_id }));
  const subtotal = safeAmount([
    ...scopes.flatMap(scope => JSON.parse(scope.amounts_json) as number[]),
    ...charges.map(charge => charge.amount_fen),
  ].reduce((sum, amount) => sum + BigInt(amount), 0n));
  return {
    complete: scopes.length > 0 && missing.length === 0,
    total_fen: scopes.length && missing.length === 0 ? subtotal : null,
    subtotal_fen: subtotal, missing, charges,
  };
}
type ApprovalScopeQuote = ReturnType<PricingRepository["projectScopeQuotes"]>[number];
type ApprovalCharge = ReturnType<PricingRepository["projectCharges"]>[number];

function summarizeGrouped(
  ids: string[],
  scopes: ApprovalScopeQuote[],
  charges: ApprovalCharge[],
): Map<string, ReturnType<typeof summarize>> {
  const scopeGroups = new Map<string, ApprovalScopeQuote[]>();
  const chargeGroups = new Map<string, ApprovalCharge[]>();
  for (const scope of scopes) {
    const group = scopeGroups.get(scope.approval_version_id) || [];
    group.push(scope);
    scopeGroups.set(scope.approval_version_id, group);
  }
  for (const charge of charges) {
    const group = chargeGroups.get(charge.approval_version_id) || [];
    group.push(charge);
    chargeGroups.set(charge.approval_version_id, group);
  }
  const summaries = new Map<string, ReturnType<typeof summarize>>();
  for (const key of ids)
    summaries.set(key, summarize(scopeGroups.get(key) || [], chargeGroups.get(key) || []));
  return summaries;
}
export function createPricing(
  repository: PricingRepository,
  rules: PriceRuleService,
  standards: WorkStandardService,
  database: Pick<Database, "transaction">,
  audit: AuditService,
) {
  function quote(
    actor: Actor,
    key: string,
    input: Record<string, unknown> = {},
    locked = false,
  ): QuoteResult {
    requireValue(
      input.confirm === undefined || typeof input.confirm === "boolean",
      "请明确是否确认参考报价",
    );
    if (input.confirm && !locked)
      return database.transaction(() => quote(actor, key, input, true));
    authorize(actor, input.confirm ? "write" : "read");
    let demand = repository.currentDemand(key);
    requireValue(demand, "需求不存在或已删除", 404);
    const scope = input.approval_scope_version_id
      ? repository.scope(text(input.approval_scope_version_id, "批准范围"))
      : null;
    if (input.approval_scope_version_id) {
      requireValue(
        scope && scope.demand_id === key,
        "批准范围与需求版本不匹配",
      );
      demand = repository.demandVersion(key, scope.demand_version);
      requireValue(demand, "批准范围采用的需求版本不存在", 409);
    }
    expectedVersion(demand.current_version, input.expected_version);
    const definition = demand;
    const locations = scope
      ? repository.selectedLocations(scope.id).map((location) => {
          const original =
            definition.work_locations[location.location_item_no - 1];
          requireValue(original, "批准作业位置与需求版本不匹配", 409);
          return {
            ...original,
            quantity_scaled: location.approved_quantity_scaled,
          };
        })
      : demand.work_locations;
    const date = pricingDate(input.pricing_date),
      missing: MissingPrice[] = [],
      lines: QuoteLine[] = [];
    const effectiveRules = rules.effectiveLocationRules(date),
      diagnosticRules = rules.latestLocationRules();
    const features = standards.operationAttributes(
      demand.operation_id,
      demand.operation_version,
    ).items;
    demand.attribute_schema = features;
    const labels = Object.fromEntries(
      features.map((feature) => [feature.key, feature.label]),
    );
    const selections = record(input.selections, "选择规则"),
      selectionBasis = record(input.selection_basis, "选价依据"),
      locationBases = record(input.bases, "逐位置计费基数");
    for (const [index, location] of locations.entries()) {
      const itemNo = location.item_no || index + 1;
      const actual = { ...demand.attributes, ...(typeof location.attributes === "string" ? JSON.parse(location.attributes) : location.attributes) };
      const missingFeatures = features.filter((field) => field.enabled && field.requirement === "pricing" &&
        (actual[field.key] === undefined || actual[field.key] === null || actual[field.key] === ""));
      if (missingFeatures.length) {
        missing.push({
          location_item_no: itemNo,
          reason:
            "缺少计价必需信息：" +
            missingFeatures.map((feature) => feature.label).join("、"),
          candidates: [],
        });
        continue;
      }
      const matched = effectiveRules.filter((rule) =>
          matches(rule, demand, location, date),
        ),
        chosen = selections[itemNo];
      let selected = matched;
      if (chosen) {
        text(selectionBasis[itemNo], "明确选价的选择依据");
        selected = matched.filter((rule) => rule.id === chosen);
      }
      if (selected.length !== 1) {
        missing.push({
          location_item_no: itemNo,
          reason: selected.length
            ? "存在重叠规则，请明确选择并记录依据"
            : "无适用价格",
          diagnostics: selected.length
            ? []
            : diagnosticRules
                .filter((rule) => rule.operation_id === demand.operation_id)
                .map((rule) => ({
                  title: rule.title,
                  reasons: explainMismatch(rule, demand, location, date).map(
                    (reason) =>
                      reason.replace(
                        /：([^：]+)$/,
                        (_match, code: string) =>
                          "：" + (labels[code] || "未识别的价格特征"),
                      ),
                  ),
                }))
                .sort((a, b) => a.reasons.length - b.reasons.length)
                .slice(0, 5),
          candidates: matched.map((rule) => ({
            id: rule.id,
            title: rule.title,
          })),
        });
        continue;
      }
      const rule = selected[0];
      let result;
      try {
        const basis = bases(locationBases[itemNo]);
        const components: FeeComponent[] = JSON.parse(rule.fee_components_json);
        if (
          rule.pricing_mode === "rate" ||
          (rule.pricing_mode === "composite" &&
            components.some((component) => component.formula_mode === "rate"))
        )
          text(basis.evidence, "计费基数及真实依据");
        result = calculate(
          rule,
          location.quantity_scaled,
          calculateBases(basis),
        );
      } catch (error) {
        if (!(error instanceof BusinessError)) throw error;
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
          demand_attributes: demand.attributes,
          operation_id: demand.operation_id,
          operation_version: demand.operation_version,
          bases: locationBases[itemNo] || {},
          selection_basis: selectionBasis[itemNo] || null,
        }),
        calculation_trace_json: JSON.stringify(result.trace),
      });
    }
    const subtotal = safeAmount(
      lines.reduce((sum, line) => sum + BigInt(line.amount_fen), 0n),
    );
    const result: QuoteResult = {
      complete: missing.length === 0 && lines.length > 0,
      subtotal_fen: subtotal,
      total_fen: missing.length ? null : subtotal,
      missing,
      lines,
      engine_version: ENGINE_VERSION,
      preview_hash: "",
    };
    result.preview_hash = createHash("sha256")
      .update(
        JSON.stringify({
          demand_id: key,
          demand_version: demand.current_version,
          scope_id: scope?.id || null,
          pricing_date: date,
          complete: result.complete,
          total_fen: result.total_fen,
          missing: result.missing,
          lines: result.lines,
          selections: input.selections || {},
          selection_basis: input.selection_basis || {},
          bases: input.bases || {},
        }),
      )
      .digest("hex");
    if (!input.confirm) return result;
    requireValue(result.complete, "未完整计价，不能确认完整参考报价", 422, {
      missing: missing.map((item) => item.reason),
    });
    if (input.preview_hash != null)
      requireValue(
        input.preview_hash === result.preview_hash,
        "价格条件或计价结果已发生变化，请重新试算后确认",
        409,
      );
    const evaluationId = id(),
      timestamp = now();
    repository.appendEvaluation({
      id: evaluationId,
      demand_id: key,
      demand_version: demand.current_version,
      approval_scope_version_id: scope?.id || null,
      pricing_date: date,
      status: "draft",
      engine_version: ENGINE_VERSION,
      input_basis_json: JSON.stringify({ scope: scope?.id || null, locations,
        demand_attributes: demand.attributes, operation_id: demand.operation_id,
        operation_version: demand.operation_version }),
      created_by: actor.id,
      created_at: timestamp,
    });
    for (const line of lines) {
      const { rule_title, rule_version_no, pricing_mode, ...formalLine } = line;
      repository.appendEvaluationLine({
        id: id(),
        evaluation_id: evaluationId,
        ...formalLine,
      });
    }
    repository.finalizeEvaluation(evaluationId, actor.id, now());
    if (scope) repository.selectScopeEvaluation(scope.id, evaluationId);
    return { ...result, id: evaluationId };
  }
  function addCharge(
    actor: Actor,
    input: Record<string, unknown>,
  ): ReferenceCharge {
    authorize(actor, "write");
    return database.transaction(() => {
      const approval = repository.approval(
        text(input.approval_version_id, "批准版本"),
      );
      const ruleId =
        input.reference_price_version_id ||
        (input.reference_price_catalog_id
          ? rules.get(text(input.reference_price_catalog_id, "价格规则"))
              .current_version_id
          : "");
      const rule = repository.ruleVersion(text(ruleId, "独立费用规则"));
      requireValue(
        approval &&
          rule &&
          ["project", "work_batch"].includes(rule.pricing_scope),
        "独立费用规则或批准版本无效",
      );
      const date = pricingDate(input.pricing_date);
      requireValue(rule.effective_on <= date, "价格尚未生效");
      requireValue(
        repository
          .applicableLocations(approval.id)
          .some((location) => matches(rule, location, location, date)),
        "独立费用规则不适用于本项目批准范围",
      );
      const basis = bases(input.bases),
        parameters = JSON.parse(rule.calculation_params_json);
      if (parameters.rate_basis === "approved_subtotal") {
        const quotes = repository.scopeQuotes(approval.id);
        requireValue(
          quotes.every((scope) => scope.evaluation_id),
          "批准范围参考报价尚未完整，不能采用其小计作为费率基数",
        );
        basis.approved_subtotal = safeAmount(
          quotes
            .flatMap((scope) => JSON.parse(scope.amounts_json) as number[])
            .reduce((sum, amount) => sum + BigInt(amount), 0n),
        );
      }
      requireValue(
        typeof input.quantity_scaled === "number",
        "请填写有效工作量",
      );
      const result = calculate(
        rule,
        input.quantity_scaled,
        calculateBases(basis),
      );
      const scopeKey =
        rule.pricing_scope === "project"
          ? `project/${rule.catalog_id}`
          : `batch/${text(input.charge_scope_key, "批次身份")}/${rule.catalog_id}`;
      const row: ReferenceCharge = {
        id: id(),
        approval_version_id: approval.id,
        reference_price_version_id: rule.id,
        charge_scope_key: scopeKey,
        amount_fen: result.amount_fen,
        pricing_inputs_json: JSON.stringify({
          ...input,
          bases: basis,
          pricing_date: date,
        }),
        calculation_trace_json: JSON.stringify(result.trace),
        created_by: actor.id,
        created_at: now(),
      };
      repository.appendCharge(row);
      return row;
    });
  }
  function removeCharge(actor: Actor, key: string) {
    authorize(actor, "write");
    return database.transaction(() => {
      const charge = repository.charge(key);
      requireValue(charge, "该参考费用已发生变化，请刷新", 409);
      const approval = repository.approval(charge.approval_version_id);
      requireValue(
        approval?.status === "draft",
        "正式批准后的参考费用须通过项目变更更正",
      );
      audit.record(actor, "reference_charges", key, "delete", charge, {
        logical: true,
      });
      repository.deleteCharge(key);
      return { deleted: true };
    });
  }
  return {
    quote,
    addCharge,
    removeCharge,
    reviseCharge(actor: Actor, key: string, input: Record<string, unknown>) {
      authorize(actor, "write");
      return database.transaction(() => {
        const charge = repository.charge(key);
        requireValue(charge, "该参考费用已发生变化，请刷新", 409);
        removeCharge(actor, key);
        const values: Record<string, unknown> = {
          ...JSON.parse(charge.pricing_inputs_json),
          ...input,
          approval_version_id: charge.approval_version_id,
        };
        if (input.reference_price_catalog_id)
          delete values.reference_price_version_id;
        const revised = addCharge(actor, values);
        audit.record(
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
    summary(approvalId: string) {
      return summarize(repository.scopeQuotes(approvalId), repository.charges(approvalId));
    },
    projectSummaries(projectId: string, approvalIds: string[]) {
      return summarizeGrouped(
        approvalIds, repository.projectScopeQuotes(projectId),
        repository.projectCharges(projectId),
      );
    },
    summariesForApprovals(approvalIds: string[]) {
      return summarizeGrouped(
        approvalIds, repository.scopeQuotesForApprovals(approvalIds),
        repository.chargesForApprovals(approvalIds),
      );
    },
  };
}
export type PricingService = ReturnType<typeof createPricing>;

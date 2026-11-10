import type { createStore } from "./store.mjs";
import type { PriceRuleVersion } from "../../shared/types/price-rules.js";
import type {
  PricingDemand,
  PricingScope,
  ApprovedPricingLocation,
  ReferenceCharge,
  EvaluationIdentity,
  EvaluationLine,
  PricingWorkLocation,
} from "../../shared/types/pricing.js";
import type { OperationPricingIdentity } from "../../modules/pricing/model.js";

export function pricingRepository(store: ReturnType<typeof createStore>) {
  return {
    currentDemand(key: string): PricingDemand | undefined {
      const row = store.get(
        `SELECT c.id,c.current_version,c.operation_id,c.operation_version,c.unit_id,c.unit_version,c.full_definition_json
        FROM v_demand_current c WHERE c.id=? AND NOT EXISTS
        (SELECT 1 FROM audit_events a WHERE a.entity='demands' AND a.entity_id=c.id AND a.action='delete')`,
        key,
      ) as (PricingDemand & { full_definition_json: string }) | undefined;
      if (!row) return;
      return { ...JSON.parse(row.full_definition_json), ...row };
    },
    demandVersion(key: string, version: number): PricingDemand | undefined {
      const row = store.get(
        `SELECT demand_id AS id,version AS current_version,operation_id,operation_version,unit_id,unit_version,snapshot_json
        FROM demand_versions WHERE demand_id=? AND version=?`,
        key,
        version,
      ) as (PricingDemand & { snapshot_json: string }) | undefined;
      if (!row) return;
      return { ...JSON.parse(row.snapshot_json), ...row };
    },
    scope: (key: string) =>
      store.find("project_approval_scope_versions", "id", key) as
        | PricingScope
        | undefined,
    selectedLocations: (key: string) =>
      store.where("project_approval_work_locations", {
        approval_scope_version_id: key,
      }) as ApprovedPricingLocation[],
    approval: (key: string) =>
      store.find("project_approval_versions", "id", key) as
        | { id: string; status: string }
        | undefined,
    ruleVersion: (key: string) =>
      store.find("reference_price_versions", "id", key) as
        | PriceRuleVersion
        | undefined,
    appendEvaluation: (evaluation: EvaluationIdentity): void => {
      store.insert("reference_price_evaluations", evaluation);
    },
    appendEvaluationLine: (
      line: EvaluationLine & { id: string; evaluation_id: string },
    ): void => {
      store.insert("reference_price_evaluation_lines", line);
    },
    finalizeEvaluation: (
      key: string,
      actorId: string,
      timestamp: string,
    ): void => {
      store.update("reference_price_evaluations", "id", key, {
        status: "final",
        finalized_by: actorId,
        finalized_at: timestamp,
      });
    },
    selectScopeEvaluation: (key: string, evaluationId: string): void => {
      store.remove(
        "project_approval_scope_prices",
        "approval_scope_version_id",
        key,
      );
      store.insert("project_approval_scope_prices", {
        approval_scope_version_id: key,
        evaluation_id: evaluationId,
      });
    },
    applicableLocations(approvalId: string) {
      return store.query(
        `SELECT d.operation_id,d.operation_version,d.unit_id,d.unit_version,
        l.work_mode,l.location_snapshot_json,l.site_features_json,l.quantity_scaled
        FROM project_approval_scope_versions s
        JOIN demand_versions d ON d.demand_id=s.demand_id AND d.version=s.demand_version
        JOIN project_approval_work_locations selected ON selected.approval_scope_version_id=s.id
        JOIN demand_version_work_locations l ON l.demand_id=s.demand_id AND l.demand_version=s.demand_version AND l.item_no=selected.location_item_no
        WHERE s.approval_version_id=?`,
        approvalId,
      ) as (OperationPricingIdentity & PricingWorkLocation)[];
    },
    scopeQuotes(approvalId: string) {
      return store.query(
        `SELECT s.id AS scope_id,s.demand_id,p.evaluation_id,
        (SELECT json_group_array(l.amount_fen) FROM reference_price_evaluation_lines l WHERE l.evaluation_id=p.evaluation_id) AS amounts_json
        FROM project_approval_scope_versions s LEFT JOIN project_approval_scope_prices p ON p.approval_scope_version_id=s.id
        WHERE s.approval_version_id=?`,
        approvalId,
      ) as {
        scope_id: string;
        demand_id: string;
        evaluation_id: string | null;
        amounts_json: string;
      }[];
    },
    charges(approvalId: string) {
      return store.query(
        `SELECT c.*,r.title AS rule_title,r.catalog_id AS reference_price_catalog_id
        FROM project_reference_price_charges c JOIN reference_price_versions r ON r.id=c.reference_price_version_id
        WHERE c.approval_version_id=?`,
        approvalId,
      ) as (ReferenceCharge & {
        rule_title: string;
        reference_price_catalog_id: string;
      })[];
    },
    charge: (key: string) =>
      store.find("project_reference_price_charges", "id", key) as
        | ReferenceCharge
        | undefined,
    appendCharge: (charge: ReferenceCharge): void => {
      store.insert("project_reference_price_charges", charge);
    },
    deleteCharge: (key: string): void => {
      store.remove("project_reference_price_charges", "id", key);
    },
  };
}
export type PricingRepository = ReturnType<typeof pricingRepository>;

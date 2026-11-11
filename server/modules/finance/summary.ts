import { safeAmount } from "../pricing/calculation.js";
import type { PricingService } from "../pricing/service.js";
import type {
  FinanceTotals,
  FinanceDemandTotal,
} from "../../database/repositories/finance.js";

export interface FinancialBasis {
  id: string;
  approval_version_id: string | null;
  approved_budget_fen: number | null;
}
type Reference = ReturnType<PricingService["summary"]>;

export function financialSummary(
  basis: FinancialBasis,
  raw: FinanceTotals,
  scopes: FinanceDemandTotal[],
  reference: Reference | null,
) {
  const actual = safeAmount(BigInt(raw.actual_cost_fen));
  const settled = safeAmount(BigInt(raw.settlement_fen));
  const reconciled = safeAmount(BigInt(raw.reconciled_cost_fen));
  const budget = basis.approved_budget_fen;
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
    demands: scopes.map(scope => {
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
export type FinanceSummary = ReturnType<typeof financialSummary>;

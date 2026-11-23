function percent(amount: bigint, basis: bigint): number | null {
  return basis > 0n ? Number((amount * 20000n + basis) / (basis * 2n)) / 100 : null;
}

export const noSettlementBudgetText = "无可用批准预算";

export function settlementProgress(approvedBudget: number | null, approvedSettlement: number) {
  return {
    settlement_progress_basis: "approved_budget" as const,
    settlement_progress_percent: percent(BigInt(approvedSettlement), BigInt(approvedBudget ?? 0)),
    settlement_budget_difference_fen: approvedBudget === null ? null : approvedSettlement - approvedBudget,
  };
}

export function portfolioSettlementProgress(projects: ReadonlyArray<{
  approved_budget_fen: number | null;
  settlement_fen: number;
}>) {
  const withBasis = projects.filter(project => (project.approved_budget_fen ?? 0) > 0);
  const numerator = withBasis.reduce((sum, project) => sum + BigInt(project.settlement_fen), 0n);
  const denominator = withBasis.reduce((sum, project) => sum + BigInt(project.approved_budget_fen ?? 0), 0n);
  return {
    projects_without_budget_basis: projects.length - withBasis.length,
    settlement_progress_percent: percent(numerator, denominator),
  };
}

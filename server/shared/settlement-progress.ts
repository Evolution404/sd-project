function percent(amount: bigint, basis: bigint): number | null {
  return basis > 0n ? Number((amount * 20000n + basis) / (basis * 2n)) / 100 : null;
}

export function settlementProgress(actualCost: number, approvedSettlement: number) {
  const difference = actualCost - approvedSettlement;
  return {
    settlement_progress_percent: percent(BigInt(approvedSettlement), BigInt(actualCost)),
    unsettled_cost_fen: actualCost > 0 ? Math.max(0, difference) : null,
    excess_settlement_fen: actualCost > 0 ? Math.max(0, -difference) : null,
  };
}


export function portfolioSettlementProgress(projects: ReadonlyArray<{ actual_cost_fen: number; settlement_fen: number }>) {
  const withBasis = projects.filter(project => project.actual_cost_fen > 0);
  const numerator = withBasis.reduce((sum, project) => sum + BigInt(project.settlement_fen), 0n);
  const denominator = withBasis.reduce((sum, project) => sum + BigInt(project.actual_cost_fen), 0n);
  return {
    projects_without_cost_basis: projects.length - withBasis.length,
    settlement_progress_percent: percent(numerator, denominator),
  };
}

export function settlementProgressText(value: number | null | undefined, budget?: number | null): string {
  if (value != null) return value + "%";
  if (budget === null) return "尚未批准预算";
  return budget === 0 ? "批准预算为零" : "无可用批准预算";
}

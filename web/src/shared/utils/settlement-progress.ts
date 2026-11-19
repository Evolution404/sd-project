export function settlementProgressText(value: number | null | undefined): string {
  return value == null ? "待核定费用基数" : value + "%";
}

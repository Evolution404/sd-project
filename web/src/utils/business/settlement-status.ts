const settlementStatuses: Record<string, string> = {
  draft: "草稿",
  submit: "审核中",
  approve: "已审核",
  return: "已退回",
  reject: "已驳回",
  voided: "已作废",
};

export function settlementStatusText(status: string) {
  return settlementStatuses[status] ?? status;
}

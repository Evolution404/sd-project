export const workPage = page => page.locator(".business-work-surface:visible");
export const activeEditor = page => page.locator(
  ".business-work-surface:visible, .el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible",
);

export async function confirmProjectApproval(page) {
  await workPage(page).getByRole("button", { name: "确认正式批准", exact: true }).click();
  await workPage(page).waitFor({ state: "hidden" });
}

export async function submitSettlement(page, row) {
  await row.getByRole("button", { name: "复核并提交", exact: true }).click();
  const review = page.getByRole("region", { name: "复核并提交结算", exact: true });
  await review.getByRole("button", { name: "确认提交审核", exact: true }).click();
  await review.waitFor({ state: "hidden" });
}

export async function approveSettlement(page, row) {
  await row.getByRole("button", { name: "审核结算", exact: true }).click();
  const review = page.getByRole("region", { name: "审核结算", exact: true });
  await review.getByRole("button", { name: "确认批准结算", exact: true }).click();
  await review.waitFor({ state: "hidden" });
}

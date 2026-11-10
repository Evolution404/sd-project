export async function selectFormChoice(page, label, name, scope = page) {
  const control = scope
    .getByLabel(label, { exact: true })
    .and(scope.locator("input"));
  await control.locator('xpath=ancestor::div[contains(@class, "el-select__wrapper")][1]').click();
  const popupId = await control.getAttribute("aria-controls");
  if (!popupId) throw new Error("选择器缺少关联弹层 " + label);
  const popup = page.locator('[id="' + popupId + '"]');
  await popup.waitFor({ state: "visible" });
  if (await popup.locator(".el-tree").count()) {
    if (await control.isEditable()) await control.fill(name);
    await popup
      .locator(".el-tree-node__content")
      .filter({ has: page.getByText(name, { exact: true }) })
      .last()
      .click();
  } else {
    await popup.getByRole("option", { name, exact: true }).last().click();
  }
}

export async function selectFormChoice(page, label, name, scope = page) {
  const labelled = scope.getByLabel(label, { exact: true });
  // Element Plus uses an accessible role=group for its form item when its
  // child is a composite select; other inputs are labelled directly.
  const directInput = labelled.and(scope.locator("input"));
  const control = await directInput.count()
    ? directInput.first()
    : labelled.locator('input[role="combobox"]').first();
  const wrapper = await directInput.count()
    ? control.locator('xpath=ancestor::div[contains(@class, "el-select__wrapper")][1]')
    : labelled.locator(".el-select__wrapper").first();
  await wrapper.click();
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

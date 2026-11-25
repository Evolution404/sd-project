/**
 * Settlement worksheet browser interaction. Uses the actual Tabulator editor,
 * not API shims; row selection is by immutable business position labels.
 */
export async function worksheetRows(editor) {
  const grid=editor.locator('[data-grid-key="finance:settlement-work"]');
  await grid.locator(".tabulator-row").first().waitFor({timeout:10000});
  return grid.locator(".tabulator-row");
}
export async function fillSettlementPosition(editor,{demandNo,locationLabel,quantity,evidence}) {
  await worksheetRows(editor);
  // Playwright :text-is scopes to the precise frozen location cell; broad
  // hasText("19") could otherwise pick an unrelated row with quantity 19.
  const name=value=>JSON.stringify(String(value));
  let selector=".tabulator-row";
  if(demandNo) selector+=`:has(.tabulator-cell[tabulator-field="demand_no"]:text-is(${name(demandNo)}))`;
  if(locationLabel) selector+=`:has(.tabulator-cell[tabulator-field="location_label"]:text-is(${name(locationLabel)}))`;
  const row=editor.locator('[data-grid-key="finance:settlement-work"] '+selector).first();
  await row.waitFor({timeout:10000});
  const quantityCell=row.locator('.tabulator-cell[tabulator-field="quantity_text"]');
  await quantityCell.dblclick();
  if(!await quantityCell.locator("input").count()) {
    // Tabulator range selection can consume the first double-click while
    // it moves focus from a long scrolling list into the editor.
    await quantityCell.dblclick();
  }
  if(!await quantityCell.locator("input").count()) {
    // User-facing keyboard editing is a first-class fallback for range mode.
    await quantityCell.click();
    await quantityCell.press("Enter");
  }
  if(!await quantityCell.locator("input").count()) {
    const status=await row.locator('.tabulator-cell[tabulator-field="status"]').textContent();
    const label=await row.innerText();
    const column=await quantityCell.getAttribute("class");
    throw Error("位置不可编辑："+JSON.stringify({demandNo,locationLabel,status,label,column}));
  }
  await quantityCell.locator("input").fill(String(quantity));
  await quantityCell.locator("input").press("Enter");
  if(evidence!==undefined) {
    const evidenceCell=row.locator('.tabulator-cell[tabulator-field="evidence"]');
    await evidenceCell.dblclick();
    if(!await evidenceCell.locator("input").count()) {
      await evidenceCell.click();
      await evidenceCell.press("Enter");
    }
    await evidenceCell.locator("input").waitFor({timeout:1500});
    await evidenceCell.locator("input").fill(String(evidence));
    await evidenceCell.locator("input").press("Enter");
  }
  return row;
}

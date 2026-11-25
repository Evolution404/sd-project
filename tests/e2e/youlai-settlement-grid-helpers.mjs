const widths = [107, 137, 132, 105, 126, 174, 123, 105, 112, 300];
const rowHeaderWidth = 36;
const headerHeight = 63;
const rowHeight = 34;

export async function settlementCanvas(editor) {
  const grid = editor.getByRole("region", { name: "结算工作表", exact: true });
  await grid.locator('canvas[id^="univer-sheet-main-canvas"]').waitFor({ timeout: 20000 });
  await editor.getByRole("button", { name: "保存草稿", exact: true })
    .locator("xpath=self::*[not(@disabled)]").waitFor();
  return grid.locator('canvas[id^="univer-sheet-main-canvas"]');
}

export async function selectSettlementCell(canvas, row, column = 4) {
  const x = rowHeaderWidth + widths.slice(0, column).reduce((sum, value) => sum + value, 0) + 30;
  const y = headerHeight + (row - 0.5) * rowHeight;
  // A repeated click on the same native canvas cell can enter edit mode.
  // Use a distinct cell first; tests requesting a selection must not accidentally type into the editor.
  await canvas.page().keyboard.press("Escape");
  await canvas.click({ position: { x: column === 0 ? rowHeaderWidth + widths[0] + 30 : rowHeaderWidth + 30, y } });
  await canvas.click({ position: { x, y } });
}

export async function enterSettlementQuantity(page, canvas, row, quantity) {
  await selectSettlementCell(canvas, row);
  const text = String(quantity);
  await page.keyboard.press(text[0]);
  if (text.length > 1) await page.keyboard.type(text.slice(1));
  await page.keyboard.press("Enter");
}

export async function pasteSettlementCells(page, text) {
  await page.evaluate(value => navigator.clipboard.writeText(value), text);
  await page.keyboard.press("ControlOrMeta+V");
}

export async function copySettlementSelection(page) {
  const sentinel = "待复制工作表-"+Date.now()+"-"+Math.random();
  await page.bringToFront();
  await page.evaluate(value => navigator.clipboard.writeText(value), sentinel);
  await page.keyboard.press("ControlOrMeta+C");
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const actual = await page.evaluate(() => navigator.clipboard.readText());
    if (actual !== sentinel) return actual;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw Error("工作表复制超时：剪贴板未更新");
}

export async function copySettlementColumn(page, canvas, column, size) {
  await selectSettlementCell(canvas, 1, column);
  for (let row = 1; row < size; row++) await page.keyboard.press("Shift+ArrowDown");
  const text = (await copySettlementSelection(page)).replace(/\r/g, "");
  await page.keyboard.press("Escape");
  return text.replace(/\n$/, "").split("\n");
}

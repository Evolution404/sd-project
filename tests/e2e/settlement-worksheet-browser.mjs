import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { approvedFixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";
import { fillSettlementPosition,worksheetRows } from "./settlement-worksheet-helper.mjs";

const cleanup=[];
const f=approvedFixture({after:fn=>cleanup.push(fn)});
const server=httpServer(f.s);
await new Promise(done=>server.listen(0,"127.0.0.1",done));
const base="http://127.0.0.1:"+server.address().port;
const browser=await chromium.launch(existsSync(chromium.executablePath())
  ? {headless:true}:{headless:true,channel:"chrome"});
const page=await browser.newPage({viewport:{width:1440,height:1024}});
const out=join(process.cwd(),"test-results/schema113/settlement-worksheet");
mkdirSync(out,{recursive:true});
const errors=[];
page.on("pageerror",error=>errors.push(error.message));
try {
  await page.goto(base+"/#/projects/"+f.project.id+"/finance");
  await page.getByLabel("用户名",{exact:true}).fill("admin");
  await page.getByLabel("密码",{exact:true}).fill("Schema113-test-password");
  await page.getByRole("button",{name:"登录",exact:true}).click();
  const detail=page.locator(".business-detail-page:visible");
  await detail.getByRole("tab",{name:"结算单",exact:true}).click();
  await detail.getByRole("button",{name:"新增结算",exact:true}).click();
  const editor=page.getByRole("region",{name:"编制结算草稿",exact:true});
  const rows=await worksheetRows(editor);
  assert.equal(await rows.count(),3,"all approved positions must be visible without adding cards");
  assert.deepEqual(await rows.locator('[tabulator-field="quantity_text"]').allTextContents(),
    ["0","0","0"],"zero is the displayed default");
  assert.equal(await editor.getByRole("button",{name:"添加解决需求"}).count(),0);
  assert.equal(await editor.locator('.tabulator-col[tabulator-field="location_label"] .tabulator-header-filter input').count(),1);
  assert.equal(await editor.getByRole("button",{name:"撤销",exact:true}).isDisabled(),true);

  await fillSettlementPosition(editor,{locationLabel:"T15",quantity:"1",evidence:"现场完成15"});
  await fillSettlementPosition(editor,{locationLabel:"T16",quantity:"2",evidence:"现场完成16"});
  await fillSettlementPosition(editor,{locationLabel:"T17",quantity:"0.0",evidence:"零值仍有查勘依据"});
  const grid=editor.locator('[data-grid-key="finance:settlement-work"]');
  assert.deepEqual(await grid.locator('.tabulator-cell[tabulator-field="quantity_text"]').allTextContents(),
    ["1","2","0.0"]);
  await editor.locator(".el-checkbox").filter({hasText:"只看已填写"}).click();
  assert.equal(await (await worksheetRows(editor)).count(),3);
  await editor.locator(".el-checkbox").filter({hasText:"只看已填写"}).click();
  await editor.screenshot({path:join(out,"1440-light-worksheet.png")});
  await page.getByRole("button",{name:"切换为深色",exact:true}).click();
  await grid.screenshot({path:join(out,"1440-dark-worksheet.png")});
  await page.getByRole("button",{name:"切换为浅色",exact:true}).click();
  for (const width of [1280,960,760]) {
    await page.setViewportSize({width,height:900});
    for(const dark of [false,true]) {
      if(dark) await page.getByRole("button",{name:"切换为深色",exact:true}).click();
      else if(width!==1280) await page.getByRole("button",{name:"切换为浅色",exact:true}).click();
      await page.waitForTimeout(260);
      assert.equal(await (await worksheetRows(editor)).count(),3);
      const tabulatorScroll=await grid.locator(".tabulator-tableholder").first().evaluate(node=>({
        client:node.clientWidth,scroll:node.scrollWidth,
      }));
      assert.ok(tabulatorScroll.scroll>=tabulatorScroll.client,
        "narrow worksheet must keep horizontal overflow inside Tabulator "+width);
      await editor.screenshot({path:join(out,`worksheet-${width}-${dark?"dark":"light"}.png`)});
    }
  }
  await page.setViewportSize({width:1440,height:1024});
  await page.getByRole("button",{name:"切换为浅色",exact:true}).click();

  // Three location cells are one clipboard action and therefore one undo.
  const first=grid.locator(".tabulator-row").first().locator('.tabulator-cell[tabulator-field="quantity_text"]');
  await first.click();
  await page.context().grantPermissions(["clipboard-read","clipboard-write"],{origin:base});
  await page.evaluate(async()=>navigator.clipboard.writeText("2\n1\n3"));
  await page.keyboard.press("ControlOrMeta+V");
  await page.waitForTimeout(160);
  assert.deepEqual(await grid.locator('.tabulator-cell[tabulator-field="quantity_text"]').allTextContents(),["2","1","3"]);
  await first.click();
  await page.keyboard.press("Meta+z");
  await page.waitForTimeout(120);
  assert.deepEqual(await grid.locator('.tabulator-cell[tabulator-field="quantity_text"]').allTextContents(),
    ["1","2","0.0"],"one undo reverses the entire 3-row paste");
  await page.keyboard.press("Meta+Shift+z");
  await page.waitForTimeout(120);
  assert.deepEqual(await grid.locator('.tabulator-cell[tabulator-field="quantity_text"]').allTextContents(),["2","1","3"]);
  await first.click();
  await page.evaluate(async()=>navigator.clipboard.writeText("0.5\n1.5"));
  await page.keyboard.press("ControlOrMeta+V");
  await page.getByText(/冻结单位|整数|小数精度/).last().waitFor();
  assert.deepEqual(await grid.locator('.tabulator-cell[tabulator-field="quantity_text"]').allTextContents(),["2","1","3"],
    "fractional paste into integer unit is rejected atomically");
  // Preserve a positive, integer-resolution third row and user evidence.
  await editor.getByLabel("本次金额（元）",{exact:true}).fill("800");
  await editor.getByLabel("结算依据",{exact:true}).fill("全量位置编辑和粘贴验收");
  await editor.getByRole("button",{name:"保存草稿",exact:true}).click();
  await editor.waitFor({state:"hidden"});
  const bill=f.s.finance.allSettlements().find(item=>item.draft?.document.basis==="全量位置编辑和粘贴验收");
  assert.ok(bill,"draft must be saved by unchanged existing settlement command");
  assert.equal(bill.draft.document.amount_fen,80000);
  assert.equal(bill.draft.document.resolutions.length,3);
  assert.deepEqual(bill.draft.document.resolutions.map(row=>row.resolved_quantity_scaled),[20000,10000,30000]);
  assert.equal(bill.draft.document.resolutions[2].evidence,"零值仍有查勘依据");
  assert.equal(f.s.finance.summary(f.project.id).settlement_fen,0,
    "a saved draft cannot affect formal settlement facts");
  await page.screenshot({path:join(out,"1440-after-save.png"),fullPage:true});
  assert.deepEqual(errors,[],"no uncaught browser errors");
  console.log("SETTLEMENT_WORKSHEET_BROWSER_OK 3 positions, zero default, evidence, Excel paste atomic precision, undo/redo, themes, persistence");
} catch(error) {
  await page.screenshot({path:join(out,"failure.png"),fullPage:true});
  throw error;
} finally {
  await browser.close();
  await new Promise(done=>server.close(done));
  for(const fn of cleanup.reverse())await fn();
}

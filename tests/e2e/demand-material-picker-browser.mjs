import assert from "node:assert/strict";
import {existsSync, mkdirSync} from "node:fs";
import {join} from "node:path";
import {chromium} from "playwright";
import {fixture} from "../helpers.mjs";
import {httpServer} from "../../dist/server/platform/http/server.js";

const callbacks=[];
const {s,user,save,unit,demandInput}=fixture({after:fn=>callbacks.push(fn)});
const demand=s.demands.save(user,demandInput);
for(let index=1;index<=65;index++) {
  const code=String(index).padStart(3,"0");
  save("materials",{name:"物资测试"+code,unit_id:unit.id,model:"型号"+code,
    specification:"规格"+String(index%5),status:"active"});
}
save("materials",{name:"禁用测试物资",unit_id:unit.id,status:"inactive"});
const server=httpServer(s);
await new Promise(done=>server.listen(0,"127.0.0.1",done));
const browser=await chromium.launch(existsSync(chromium.executablePath())
  ? {headless:true} : {headless:true,channel:"chrome"});
const page=await browser.newPage({viewport:{width:1440,height:950}});
const exceptions=[];
page.on("pageerror",err=>exceptions.push(err.message));
const output=join(process.cwd(),"test-results/schema113/demand-material-picker");
mkdirSync(output,{recursive:true});
const base="http://127.0.0.1:"+server.address().port;
const editor=page.getByRole("region",{name:"修订需求",exact:true});
const picker=page.getByRole("dialog",{name:"添加预计物资",exact:true});
function selectedTab(name) {
  return editor.getByRole("tab",{name,exact:true}).getAttribute("aria-selected");
}
async function pick(name) {
  const input=picker.getByRole("checkbox",{name,exact:true});
  await input.locator("xpath=ancestor::label[1]").click();
}
try {
  await page.goto(base+"/#/demands?demand="+demand.id);
  await page.getByLabel("用户名",{exact:true}).fill("admin");
  await page.getByLabel("密码",{exact:true}).fill("Schema113-test-password");
  await page.getByRole("button",{name:"登录",exact:true}).click();
  const detail=page.locator(".business-detail-dialog:visible");
  await detail.getByText(demand.demand_no).waitFor();
  await detail.getByRole("button",{name:"修订需求",exact:true}).click();
  await editor.getByRole("tab",{name:"基本信息"}).waitFor();
  const content=editor.locator(".editor-content");
  await content.evaluate(root => {root.scrollTop = root.scrollHeight;});
  await page.waitForFunction(() => Array.from(document.querySelectorAll('[role="tab"]'))
    .some(tab => tab.textContent?.includes("来源及其他信息") && tab.getAttribute("aria-selected")==="true"),null,{timeout:8000});
  assert.equal(await selectedTab("来源及其他信息"),"true","manual scrolling must activate the visible section");
  for (const width of [1280, 960, 760, 1440]) {
    await page.setViewportSize({width,height:950});
    await content.evaluate(root => {root.scrollTop = root.scrollHeight;});
    await page.waitForFunction(() => Array.from(document.querySelectorAll('[role="tab"][aria-selected="true"]')).some(tab => tab.textContent?.includes("来源及其他信息")));
    assert.equal(await selectedTab("来源及其他信息"),"true");
  }
  await editor.getByRole("tab",{name:"基本信息"}).click();
  await page.waitForFunction(() => Array.from(document.querySelectorAll('[role="tab"]'))
    .some(tab => tab.textContent?.includes("基本信息") && tab.getAttribute("aria-selected")==="true"),null,{timeout:8000});
  await editor.getByRole("tab",{name:"预计物资"}).click();
  await editor.getByRole("button",{name:"添加预计物资",exact:true}).click();
  await picker.getByText("当前条件下共 65 项可用物资").waitFor();
  assert.equal(await picker.getByRole("columnheader",{name:/物资名称/}).isVisible(),true);
  await pick("选择物资：物资测试001 型号001");
  await picker.getByRole("button",{name:"下一页"}).click();
  await picker.getByText("物资测试031").waitFor();
  await pick("选择物资：物资测试031 型号031");
  await picker.getByPlaceholder("按物资名称、型号、规格或计量单位搜索").fill("物资测试065");
  await picker.getByRole("button",{name:"查询",exact:true}).click();
  await picker.getByText("当前条件下共 1 项可用物资").waitFor();
  await pick("选择物资：物资测试065 型号065");
  await picker.getByText("已选 3 种物资").waitFor();
  assert.equal(await picker.getByRole("button",{name:"添加已选物资（3）"}).isEnabled(),true);
  await page.screenshot({path:join(output,"material-picker-search-and-selection.png"),fullPage:true});
  await picker.getByRole("button",{name:"添加已选物资（3）"}).click();
  await picker.waitFor({state:"hidden"});
  await editor.locator(".editor-content").getByText("物资测试001").waitFor();
  await editor.locator(".editor-content").getByText("物资测试031").waitFor();
  await editor.locator(".editor-content").getByText("物资测试065").waitFor();
  await page.screenshot({path:join(output,"demand-added-materials.png"),fullPage:true});
  const materialList = editor.getByRole("list", {name:"预计物资清单"});
  assert.equal(await materialList.getByRole("listitem").count(),3,
    "material detail must default to the ordinary list");
  assert.equal(await editor.locator(".business-draft-grid").count(),0);
  assert.equal(await editor.locator(".business-draft-grid .tabulator-range").count(),0,
    "view mode must not display an Excel selection");
  assert.equal(await editor.getByRole("button",{name:"撤销",exact:true}).count(),0);
  await editor.getByRole("button",{name:"批量编辑",exact:true}).click();
  await editor.locator(".business-draft-grid.is-editing").waitFor();
  assert.equal(await editor.getByRole("button",{name:"完成编辑",exact:true}).count(),1);
  const edited=editor.locator(".business-draft-grid .tabulator-row").filter({ hasText:"物资测试031" })
    .locator(".tabulator-cell[tabulator-field='quantity_text']");
  await edited.dblclick();
  await edited.locator("input").fill("2");
  await edited.locator("input").press("Enter");
  await page.waitForTimeout(200);
  assert.equal((await edited.textContent())?.trim(),"2");
  // Clipboard paste must update all three material draft rows before a formal Save.
  const first = editor.locator(".business-draft-grid .tabulator-row").first()
    .locator(".tabulator-cell[tabulator-field='quantity_text']");
  await first.click();
  assert.equal(await editor.locator(".tabulator-range").count(),1,"single-cell range is active");
  const draftGrid = editor.locator(".business-draft-grid");
  const selectionAppearance = () => draftGrid.evaluate(root => {
    const activeTitle = root.querySelector(".tabulator-col.tabulator-range-highlight");
    const otherTitle = root.querySelector(".tabulator-col:not(.tabulator-range-highlight)");
    const rowHeader = root.querySelector(".tabulator-row.tabulator-range-highlight .tabulator-range-row-header");
    const range = root.querySelector(".tabulator-range");
    return {
      titleMatches: getComputedStyle(activeTitle).backgroundColor === getComputedStyle(otherTitle).backgroundColor,
      rowHeader: getComputedStyle(rowHeader).backgroundColor,
      border: getComputedStyle(range).borderBottomWidth,
    };
  });
  const expectedSelection = {titleMatches:true,rowHeader:"rgba(0, 0, 0, 0)",border:"2px"};
  assert.deepEqual(await selectionAppearance(), expectedSelection);
  await draftGrid.screenshot({path:join(output,"active-quantity-light.png")});
  await page.getByRole("button",{name:"切换为深色",exact:true}).click();
  await first.click();
  assert.deepEqual(await selectionAppearance(), expectedSelection);
  await draftGrid.screenshot({path:join(output,"active-quantity-dark.png")});
  await page.getByRole("button",{name:"切换为浅色",exact:true}).click();
  await first.click();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
  await page.evaluate(async () => navigator.clipboard.writeText("2\n3\n4"));
  await page.keyboard.press("ControlOrMeta+V");
  await page.waitForTimeout(400);
  assert.deepEqual(await editor.locator(".business-draft-grid .tabulator-cell[tabulator-field='quantity_text']").allTextContents(),["2","3","4"]);
  await first.click();
  await page.keyboard.press("Meta+z");
  await page.waitForTimeout(120);
  assert.deepEqual(await editor.locator(".business-draft-grid .tabulator-cell[tabulator-field='quantity_text']").allTextContents(),["1","2","1"],
    "one Command+Z must undo all rows in the quantity paste and restore the demand draft");
  await page.keyboard.press("Meta+Shift+z");
  await page.waitForTimeout(120);
  assert.deepEqual(await editor.locator(".business-draft-grid .tabulator-cell[tabulator-field='quantity_text']").allTextContents(),["2","3","4"],
    "Command+Shift+Z must restore all pasted quantity rows");
  await page.screenshot({path:join(output,"demand-materials-batch-redo.png"),fullPage:true});
  await page.evaluate(async () => navigator.clipboard.writeText("9\t非法单位"));
  await page.keyboard.press("ControlOrMeta+V");
  await page.getByText(/粘贴范围包含只读字段或超出已有明细/).waitFor();
  assert.deepEqual(await editor.locator(".business-draft-grid .tabulator-cell[tabulator-field='quantity_text']").allTextContents(),["2","3","4"],
    "paste crossing a readonly business column must be rejected atomically");
  const last=editor.locator(".business-draft-grid .tabulator-row").last()
    .locator(".tabulator-cell[tabulator-field='quantity_text']");
  await last.dblclick();
  await last.locator("input").fill("1.5");
  await last.locator("input").press("Enter");
  await editor.getByText("只能填写整数数量").waitFor();
  await editor.getByRole("button",{name:"保存需求版本",exact:true}).click();
  await editor.getByRole("button",{name:"保存需求版本",exact:true}).waitFor();
  assert.equal(s.demands.get(demand.id).current_version,1,"invalid fractional quantity must never save");
  await last.dblclick();
  await last.locator("input").fill("4");
  await last.locator("input").press("Enter");
  await editor.getByText("只能填写整数数量").waitFor({state:"hidden"});
  await last.dblclick();
  await last.locator("input").fill("5");
  await last.locator("input").press("Enter");
  await editor.getByRole("button",{name:"撤销",exact:true}).click();
  await page.waitForTimeout(100);
  assert.equal((await last.textContent())?.trim(),"4","single-cell editing supports undo");
  await editor.getByRole("button",{name:"完成编辑",exact:true}).click();
  await materialList.getByRole("listitem").first().waitFor();
  assert.equal(await editor.locator(".business-draft-grid").count(),0);
  assert.deepEqual((await materialList.locator(".material-quantity > span:last-child").allTextContents())
    .map(label => label.split(" ")[0]),["2","3","4"]);
  await page.screenshot({path:join(output,"demand-materials-readonly-mode.png"),fullPage:true});
  await editor.getByRole("button",{name:"保存需求版本",exact:true}).click();
  await editor.waitFor({state:"hidden"});
  const saved=s.demands.get(demand.id);
  assert.equal(saved.materials.length,3);
  assert.deepEqual(saved.materials.map(item=>item.quantity_scaled),[20000,30000,40000]);
  assert.deepEqual(exceptions,[]);
  console.log("DEMAND_MATERIAL_PICKER_OK scroll-sync, server-search, 65-material pagination, cross-page selection, active-only, precision, formal revision");
} catch(error) {
  console.error("DEMAND_MATERIAL_PICKER_ERRORS",exceptions);
  await page.screenshot({path:join(output,"failure.png"),fullPage:true});
  throw error;
} finally {
  await browser.close();
  await new Promise(done=>server.close(done));
  for(const callback of callbacks.reverse()) await callback();
}

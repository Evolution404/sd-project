import assert from "node:assert/strict";
import {mkdirSync,existsSync} from "node:fs";
import {resolve,join} from "node:path";
import {chromium} from "playwright";
import {fixture} from "../helpers.mjs";
import {httpServer} from "../../dist/server/platform/http/server.js";
import {worksheetCanvas,selectWorksheetCell,waitForWorksheetFullscreen} from "./youlai-business-worksheet-helpers.mjs";
import {copySettlementSelection,pasteSettlementCells} from "./youlai-settlement-grid-helpers.mjs";

const cleanup=[],f=fixture({after:fn=>cleanup.push(fn)});
const v35=f.save("voltages",{name:"35kV"}),v110=f.save("voltages",{name:"110kV"}),v220=f.save("voltages",{name:"220kV"});
const lineA=f.save("lines",{name:"筛选线路甲",voltage_level_id:v220.id});
const lineB=f.save("lines",{name:"筛选线路乙",voltage_level_id:v35.id});
const junction=f.save("towers",{line_id:lineA.id,tower_no:"T1"});
const lineC=f.save("lines",{name:"筛选线路丙",voltage_level_id:v110.id,line_kind:"branch",parent_line_id:lineA.id,junction_tower_id:junction.id});
const server=httpServer(f.s,{staticDirectory:resolve(process.env.SD_BROWSER_STATIC_DIRECTORY||"dist/web")});
await new Promise(ok=>server.listen(0,"127.0.0.1",ok));
const origin="http://127.0.0.1:"+server.address().port,out=resolve("test-results/youlai-worksheet-choices");mkdirSync(out,{recursive:true});
let browser,page;
try{
 browser=await chromium.launch(existsSync(chromium.executablePath())?{headless:true}:{headless:true,channel:"chrome"});
 const context=await browser.newContext({viewport:{ width: 1920, height: 1080 }});
 page=await context.newPage();await context.grantPermissions(["clipboard-read","clipboard-write"],{origin});
 const errors=[];page.on("pageerror",e=>errors.push(e.message));
 await page.goto(origin+"/#/login");
 await page.getByPlaceholder("用户名").fill("admin");await page.getByPlaceholder("密码").fill("Schema113-test-password");
 await page.getByRole("button",{name:"登录",exact:true}).click();await page.waitForURL(/#\/dashboard/);
 await page.goto(origin+"/#/assets/ledger");await page.getByRole("tab",{name:"输电线路",exact:true}).click();
 await page.getByRole("row").filter({hasText:lineA.name}).getByText("主线",{exact:true}).waitFor();
 await page.getByRole("row").filter({hasText:lineC.name}).getByText("支线",{exact:true}).waitFor();
 await page.getByRole("button",{name:"进入批量编辑",exact:true}).click();
 const region=page.getByRole("region",{name:"设备资料",exact:true});
 const canvas=await worksheetCanvas(region);
 const widths=[145,170,170,110,110,110];
 const header=async column=>canvas.click({position:{x:36+widths.slice(0,column+1).reduce((a,b)=>a+b,0)-12,y:44}});
 const copy=async(row,column)=>{await selectWorksheetCell(canvas,row,column,widths);return (await copySettlementSelection(page)).trim()};
 await header(2);
 await page.getByText("升序",{exact:true}).waitFor({timeout:8000});
 await page.screenshot({path:join(out,"native-filter-sort.png")});
 await page.getByText("升序",{exact:true}).click();
 await region.getByText(/已按 电压等级 升序 排列/).waitFor({timeout:10000});
 assert.equal(await copy(1,0),lineB.line_code);
 assert.equal(await copy(2,0),lineC.line_code);
 assert.equal(await copy(3,0),lineA.line_code);

 await header(2);
 await page.getByText("升序",{exact:true}).waitFor();
 await page.screenshot({path:join(out,"filter-after-sort.png")});
 // Select only the 35kV row using the original value filter UI.
 await page.getByRole("checkbox").nth(1).locator("..").click();
 await page.getByRole("checkbox").nth(2).locator("..").click();
 await page.screenshot({path:join(out,"filter-checked.png")});
 await page.getByRole("button",{name:"确认",exact:true}).last().click();
 await region.getByText("显示 1 行",{exact:true}).waitFor({timeout:8000});
 await region.getByRole("button",{name:"清除筛选",exact:true}).click();
 await region.getByText("显示 3 行",{exact:true}).waitFor();
 // The dropdown must behave like a normal cell when copied, pasted or filled.
 const select=async(row,column=2)=>{
   await page.keyboard.press("Escape");
   await selectWorksheetCell(canvas,row,0,widths);
   await selectWorksheetCell(canvas,row,column,widths);
   await page.keyboard.press("Escape");
 };
 const read=async(row,column=2)=>{await select(row,column);return (await copySettlementSelection(page)).trim()};
 const count=async(n)=>page.getByRole("button",{name:"保存 "+n+" 条修改",exact:true}).waitFor({timeout:8000});
 const undo=async(n)=>{await region.getByRole("button",{name:"撤销",exact:true}).click();await count(n)};
 const redo=async(n)=>{await region.getByRole("button",{name:"重做",exact:true}).click();await count(n)};
 await select(1);
 await pasteSettlementCells(page,"220kV\n35kV\n110kV");
 await count(3);
 assert.deepEqual([await read(1),await read(2),await read(3)],["220kV","35kV","110kV"]);
 await undo(0);await redo(3);await undo(0);console.log("CHOICE_MIXED_PASTE_UNDO_REDO_OK");
 // Native copy from a dropdown cell into a multi-row selected range.
 await select(1);
 assert.equal(await copySettlementSelection(page),"35kV");
 await select(2);await page.keyboard.press("Shift+ArrowDown");
 await page.keyboard.press("ControlOrMeta+V");await count(2);
 assert.equal(await read(2),"35kV");assert.equal(await read(3),"35kV");
 await undo(0);
 console.log("CHOICE_RANGE_COPY_OK");
 // Native drag handle fills the selected dictionary value without changing its rule.
 await select(1);
 const bounds=await canvas.boundingBox();
 const x=bounds.x+36+widths.slice(0,3).reduce((a,b)=>a+b,0)-1,y=bounds.y+63+34-1;
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+68,{steps:8});await page.mouse.up();
 await count(2);
 assert.equal(await read(2),"35kV");assert.equal(await read(3),"35kV");
 await undo(0);
 console.log("CHOICE_DRAG_COPY_OK");
 // Keep invalid raw text, allow later cells to paste, block entire save.
 await select(1);
 await pasteSettlementCells(page,"不存在的电压\n220kV\n110kV");
 await count(3);
 await page.getByRole("button",{name:"保存 3 条修改",exact:true}).click();
 await region.getByText("请修正 1 个单元格后保存").waitFor();
 assert.equal(f.s.equipment.get("lines",lineB.id).version,lineB.version);
 assert.equal(await read(1),"不存在的电压");
 assert.equal(await read(3),"110kV");
 await undo(0);
 console.log("CHOICE_INVALID_SAVE_BLOCKED_OK");
 // Cross-column value paste must not move the source dropdown to a text field.
 await select(1,1);await pasteSettlementCells(page,"220kV");await count(1);
 await select(1,1);assert.equal(await copySettlementSelection(page),"220kV");
 await select(2);await page.keyboard.press("ControlOrMeta+V");await count(2);
 // Open the target's native dropdown BEFORE undoing the paste, proving it survived.
 await select(2);
 await canvas.click({position:{x:36+widths.slice(0,3).reduce((a,b)=>a+b,0)-17,y:114}});
 await page.getByText("110kV",{exact:true}).filter({visible:true}).waitFor({timeout:5000});
 await select(2,1);
 await undo(1);await undo(0);
 console.log("CHOICE_TARGET_RULE_PRESERVED_OK");
 // Filtered multi-row paste must not change hidden records.
 await header(2);
 await page.getByText("升序",{exact:true}).waitFor();
 await page.getByRole("checkbox").nth(1).locator("..").click();
 await page.getByRole("checkbox").nth(2).locator("..").click();
 await page.getByRole("button",{name:"确认",exact:true}).last().click();
 await region.getByText("显示 1 行",{exact:true}).waitFor();
 await select(1);await pasteSettlementCells(page,"220kV\n220kV");
 await region.getByText(/筛选后仅允许单行粘贴/).waitFor();
 await count(0);
 await region.getByRole("button",{name:"清除筛选",exact:true}).click();
 await region.getByText("显示 3 行",{exact:true}).waitFor();
 console.log("CHOICE_BULK_VALUES_OK mixed paste, repeated fill, drag fill, undo redo, invalid raw text, filtered protection");
 // The data validation arrow is an actual Univer cell dropdown, not a Vue select.
 await region.getByRole("button",{name:"全屏编辑",exact:true}).click();
 await waitForWorksheetFullscreen(page);
 await selectWorksheetCell(canvas,1,2,widths);
 await canvas.click({position:{x:36+widths.slice(0,3).reduce((a,b)=>a+b,0)-17,y:80}});
 await page.getByText("220kV",{exact:true}).last().waitFor({timeout:8000});
 await page.screenshot({path:join(out,"native-voltage-dropdown.png")});
 await page.getByText("220kV",{exact:true}).last().click();
 await page.getByRole("button",{name:"保存 1 条修改",exact:true}).waitFor();
 await region.getByRole("button",{name:"退出全屏",exact:true}).click();
 // Sort by current draft values, then replay the same edit at its new row.
 await header(2);
 await page.getByText("降序",{exact:true}).click();
 await region.getByText(/已按 电压等级 降序 排列/).waitFor();
 const rowAfterSort = ([
   await read(1,0), await read(2,0), await read(3,0),
 ]).indexOf(lineB.line_code) + 1;
 assert.ok(rowAfterSort === 1 || rowAfterSort === 2);
 assert.equal(await read(rowAfterSort),"220kV");
 await undo(0);
 assert.equal(await read(rowAfterSort),"35kV");
 await redo(1);
 assert.equal(await read(rowAfterSort),"220kV");

 await page.getByRole("button",{name:"保存 1 条修改",exact:true}).click();
 await page.getByRole("button",{name:"确认保存",exact:true}).click();
 await region.waitFor({state:"hidden"});
 assert.equal(f.s.equipment.get("lines",lineB.id).voltage_level_id,v220.id);
 assert.equal(f.s.equipment.get("lines",lineB.id).version,lineB.version+1);
 assert.equal(f.s.equipment.get("lines",lineA.id).version,lineA.version);
 assert.equal(f.s.equipment.get("lines",lineC.id).version,lineC.version);
 assert.deepEqual(errors,[]);
 console.log("YOULAI_WORKSHEET_CHOICES_OK Chinese enums, native header filter/sort, numeric voltage order, native dropdown, stable identity and formal version");
}catch(error){await page?.screenshot({path:join(out,"failure.png"),fullPage:true});throw error}
finally{await browser?.close();await new Promise(ok=>server.close(ok));for(const action of cleanup.reverse())await action()}

import assert from "node:assert/strict";
import {existsSync,mkdirSync} from "node:fs";
import {join} from "node:path";
import {chromium, expect} from "playwright/test";
import {fixture} from "../helpers.mjs";
import {httpServer} from "../../dist/server/platform/http/server.js";

const cleanup=[];
const {s,user,unit}=fixture({after:callback=>cleanup.push(callback)});
for(let i=1;i<=4;i++) s.materials.save(user,{
  name:"批量模式验收"+i,unit_id:unit.id,model:"型-"+i,specification:"原规格",note:"",status:"active"
});
const server=httpServer(s);
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const base="http://127.0.0.1:"+server.address().port;
const browser=await chromium.launch(existsSync(chromium.executablePath())?
  {headless:true}:{headless:true,channel:"chrome"});
const page=await browser.newPage({viewport:{width:1360,height:850}});
const output=join(process.cwd(),"test-results/schema113/material-bulk-mode");
mkdirSync(output,{recursive:true});
const errors=[];page.on("pageerror",error=>errors.push(error.message));
try{
  await page.goto(base+"/#/materials");
  await page.getByLabel("用户名",{exact:true}).fill("admin");
  await page.getByLabel("密码",{exact:true}).fill("Schema113-test-password");
  await page.getByRole("button",{name:"登录",exact:true}).click();
  await page.locator(".business-tabulator .tabulator-row").first().waitFor();
  assert.equal(await page.locator(".business-tabulator .tabulator-range").count(),0);
  const list=page.locator(".business-tabulator .tabulator-row");
  const firstName=await list.nth(0).locator('.tabulator-cell[tabulator-field="name"]').textContent();
  const secondName=await list.nth(1).locator('.tabulator-cell[tabulator-field="name"]').textContent();
  const firstId=s.materials.list().find(row=>row.name===firstName)?.id;
  const secondId=s.materials.list().find(row=>row.name===secondName)?.id;
  assert.ok(firstId&&secondId);
  await page.screenshot({path:join(output,"normal-view.png")});
  for(const width of [960,760]){
    await page.setViewportSize({width,height:850});
    assert.equal(await page.locator(".tabulator-range").count(),0);
    await page.screenshot({path:join(output,"normal-view-"+width+".png")});
  }
  await page.setViewportSize({width:1360,height:850});
  await page.locator("html").evaluate(root=>root.classList.add("dark"));
  await page.screenshot({path:join(output,"normal-view-dark.png")});
  await page.locator("html").evaluate(root=>root.classList.remove("dark"));
  await page.getByRole("button",{name:"批量编辑",exact:true}).click();
  const draft=page.locator(".business-draft-grid.is-editing");
  await draft.locator(".tabulator-row").first().waitFor();
  assert.equal(await page.locator(".business-tabulator").count(),0);
  assert.equal(await page.getByRole("button",{name:"保存批量修改"}).isDisabled(),true);
  const model=draft.locator(".tabulator-row").first().locator('.tabulator-cell[tabulator-field="model"]');
  await model.dblclick();
  await model.locator("input").fill("临时型号");
  await model.locator("input").press("Enter");
  await page.getByText("待保存 1 条").waitFor();
  await model.click();
  await page.keyboard.press("Meta+z");
  await expect(model).toHaveText(s.materials.get(firstId).model);
  await page.keyboard.press("Meta+Shift+z");
  await expect(model).toHaveText("临时型号");
  const name = draft.locator(".tabulator-row").first().locator('.tabulator-cell[tabulator-field="name"]');
  const edit = async (cell, value) => {
    await cell.dblclick();
    await cell.locator("input").fill(value);
    await cell.locator("input").press("Enter");
  };
  await edit(name, "临时名称");
  await page.getByRole("button", {name:"取消编辑", exact:true}).focus();
  await page.keyboard.press("Meta+z");
  await expect(name).toHaveText("临时名称");
  await name.dblclick();
  await name.locator("input").press("Meta+z");
  await expect(name.locator("input")).toHaveCount(1);
  await name.locator("input").press("Escape");
  await expect(name).toHaveText("临时名称");
  await page.getByRole("button", {name:"撤销", exact:true}).click();
  await expect(name).toHaveText(firstName);
  await expect(model).toHaveText("临时型号");
  await page.getByRole("button", {name:"撤销", exact:true}).click();
  await expect(model).toHaveText(s.materials.get(firstId).model);
  await page.getByRole("button", {name:"重做", exact:true}).click();
  await page.getByRole("button", {name:"重做", exact:true}).click();
  await expect(name).toHaveText("临时名称");
  await expect(model).toHaveText("临时型号");
  await page.getByRole("button", {name:"撤销", exact:true}).click();
  await edit(name, "撤销后新名称");
  await expect(page.getByRole("button", {name:"重做", exact:true})).toBeDisabled();
  assert.equal(s.materials.get(firstId).version_no, 1);
  await page.getByRole("button",{name:"取消编辑",exact:true}).click();
  await page.getByRole("dialog",{name:"放弃批量修改"}).getByRole("button",{name:"确定"}).click();
  await page.locator(".business-tabulator .tabulator-row").first().waitFor();
  assert.notEqual(s.materials.get(firstId).model,"临时型号","cancelling a draft must never save");
  assert.equal(s.materials.get(firstId).version_no, 1);

  await page.getByRole("button",{name:"批量编辑",exact:true}).click();
  await draft.locator(".tabulator-row").first().waitFor();
  const first=draft.locator(".tabulator-row").first().locator('.tabulator-cell[tabulator-field="name"]');
  await first.click();
  const selectionBorders = await draft.evaluate(root => {
    const active = root.querySelector(".tabulator-range-cell-active");
    const range = root.querySelector(".tabulator-range");
    const cell = root.querySelector(".tabulator-range-only-cell-selected");
    return {
      active: getComputedStyle(active).borderBottomWidth,
      range: getComputedStyle(range).borderBottomWidth,
      cell: getComputedStyle(cell).outlineStyle,
    };
  });
  assert.deepEqual(selectionBorders,{active:"0px",range:"2px",cell:"none"});
  await draft.screenshot({path:join(output,"single-selection.png")});
  await page.context().grantPermissions(["clipboard-read","clipboard-write"],{origin:base});
  await page.evaluate(async()=>navigator.clipboard.writeText("批量新名称A\t批量新型号A\n批量新名称B\t批量新型号B"));
  await page.keyboard.press("ControlOrMeta+V");
  await page.getByText("待保存 2 条").waitFor();
  assert.deepEqual((await draft.locator('.tabulator-cell[tabulator-field="name"]').allTextContents()).slice(0,2),
    ["批量新名称A","批量新名称B"]);
  await first.click();
  await page.keyboard.press("Meta+z");
  await page.waitForTimeout(200);
  assert.deepEqual((await draft.locator('.tabulator-cell[tabulator-field="name"]').allTextContents()).slice(0,2),
    [firstName,secondName], "one Command+Z must undo all rows and columns of one paste");
  await page.keyboard.press("Meta+Shift+z");
  await page.waitForTimeout(200);
  assert.deepEqual((await draft.locator('.tabulator-cell[tabulator-field="name"]').allTextContents()).slice(0,2),
    ["批量新名称A","批量新名称B"], "one Command+Shift+Z must redo the whole paste");
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(200);
  assert.deepEqual((await draft.locator('.tabulator-cell[tabulator-field="name"]').allTextContents()).slice(0,2),
    [firstName,secondName], "Windows Control+Z must work");
  await page.keyboard.press("Control+y");
  await page.waitForTimeout(200);
  assert.deepEqual((await draft.locator('.tabulator-cell[tabulator-field="name"]').allTextContents()).slice(0,2),
    ["批量新名称A","批量新名称B"], "Windows Control+Y must work");
  await first.click();
  await page.keyboard.press("ControlOrMeta+c");
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()), "批量新名称A");
  const pasteAt = async (cell, text) => {
    await cell.click();
    await page.evaluate(value=>navigator.clipboard.writeText(value), text);
    await page.keyboard.press("ControlOrMeta+v");
  };
  const firstRow = draft.locator(".tabulator-row").first();
  const note = firstRow.locator('.tabulator-cell[tabulator-field="note"]');
  await pasteAt(note, '不可改备注\t不可改单位');
  await page.getByText(/粘贴范围包含只读字段或超出已有明细/).waitFor();
  await expect(note).toHaveText("");
  await expect(firstRow.locator('.tabulator-cell[tabulator-field="unit_id_label"]')).toHaveText(unit.name);
  const last = draft.locator(".tabulator-row").last().locator('.tabulator-cell[tabulator-field="model"]');
  await pasteAt(last, "首行\n多余一行");
  await expect(last).not.toHaveText("首行");
  await pasteAt(note, '"含\t制表符和\r\n""引号"""');
  await expect(note).toHaveJSProperty("textContent", '含\t制表符和\n"引号"');
  await page.keyboard.press("ControlOrMeta+c");
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()), '"含\t制表符和\n""引号"""');
  await page.keyboard.press("Meta+z");
  await expect(note).toHaveText("");
  await page.keyboard.press("Meta+z");
  await expect(first).toHaveText(firstName);
  await page.keyboard.press("Control+Shift+z");
  await expect(first).toHaveText("批量新名称A");
  await page.keyboard.press("Meta+Shift+z");
  await expect(note).toHaveJSProperty("textContent", '含\t制表符和\n"引号"');
  await page.keyboard.press("Meta+z");
  await expect(note).toHaveText("");
  await expect(firstRow.locator('.tabulator-cell[tabulator-field="specification"]')).toHaveText("原规格");
  assert.equal(s.materials.get(firstId).version_no, 1);
  assert.equal(s.materials.get(secondId).version_no, 1);
  await page.screenshot({path:join(output,"batch-edit-mode.png")});

  await page.getByRole("button",{name:"保存批量修改"}).click();
  await page.getByRole("dialog",{name:"确认批量保存"}).getByRole("button",{name:"确定"}).click();
  await page.locator(".business-tabulator .tabulator-row").first().waitFor();
  assert.equal(s.materials.get(firstId).name,"批量新名称A");
  assert.equal(s.materials.get(firstId).model,"批量新型号A");
  assert.equal(s.materials.get(firstId).version_no,2);
  assert.equal(s.materials.get(secondId).name,"批量新名称B");
  assert.equal(s.materials.get(secondId).version_no,2);
  assert.equal(await page.locator(".business-tabulator .tabulator-range").count(),0);
  // An out-of-date version anywhere in a batch rolls the entire batch back.
  const oldName=s.materials.get(firstId).name;
  const oldModel=s.materials.get(secondId).model;
  const firstVersion=s.materials.get(firstId).version_no;
  assert.throws(()=>s.materials.saveBatch(user,[
    {id:firstId,expected_version:firstVersion,changes:{name:"不应保存的名称"}},
    {id:secondId,expected_version:1,changes:{model:"过期版本改写"}},
  ]),/版本|冲突|已变化|expected/i);
  assert.equal(s.materials.get(firstId).name,oldName,
    "first row and its audit must roll back when later row conflicts");
  assert.equal(s.materials.get(firstId).version_no,firstVersion);
  assert.equal(s.materials.get(secondId).model,oldModel);
  assert.throws(()=>s.materials.saveBatch(user,[
    {id:firstId,expected_version:firstVersion,changes:{unit_id:"非法改挂"}},
  ]),/只允许|字段/);
  assert.deepEqual(errors,[]);
  console.log("MATERIALS_BULK_MODE_BROWSER_OK normal view, explicit edit, cancel, TSV paste, atomic commit/rollback, immutable identity, versioned save");
}catch(failure){
  await page.screenshot({path:join(output,"failure.png"),fullPage:true});
  console.error("MATERIAL_BULK_ERRORS",errors);
  throw failure;
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
  for(const callback of cleanup.reverse()) await callback();
}

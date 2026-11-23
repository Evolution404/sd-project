import assert from "node:assert/strict";
import {existsSync,mkdirSync} from "node:fs";
import {join} from "node:path";
import {chromium} from "playwright";
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
  await page.waitForTimeout(150);
  assert.equal((await model.textContent())?.trim(),s.materials.get(firstId).model,
    "Command+Z must undo a single cell edit");
  await page.keyboard.press("Meta+Shift+z");
  await page.waitForTimeout(150);
  assert.equal((await model.textContent())?.trim(),"临时型号",
    "Command+Shift+Z must redo a single cell edit");
  await page.getByRole("button",{name:"取消编辑",exact:true}).click();
  await page.getByRole("dialog",{name:"放弃批量修改"}).getByRole("button",{name:"确定"}).click();
  await page.locator(".business-tabulator .tabulator-row").first().waitFor();
  assert.notEqual(s.materials.get(firstId).model,"临时型号","cancelling a draft must never save");

  await page.getByRole("button",{name:"批量编辑",exact:true}).click();
  await draft.locator(".tabulator-row").first().waitFor();
  const first=draft.locator(".tabulator-row").first().locator('.tabulator-cell[tabulator-field="name"]');
  await first.click();
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

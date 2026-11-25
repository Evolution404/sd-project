import assert from "node:assert/strict";
import {mkdirSync,existsSync} from "node:fs";
import {join,resolve} from "node:path";
import {chromium} from "playwright";
import {fixture} from "../helpers.mjs";
import {httpServer} from "../../dist/server/platform/http/server.js";

const clean=[];
const f=fixture({after:fn=>clean.push(fn)});
const prior=f.s.materials.save(f.user,{
  unit_id:f.unit.id,name:"绝缘子串",model:"XP-70",specification:"标准型",
  note:"首版记录",status:"active",
});
const backend=httpServer(f.s,{staticDirectory:resolve(process.env.SD_BROWSER_STATIC_DIRECTORY || "dist/web")});
await new Promise(resolve=>backend.listen(0,"127.0.0.1",resolve));
const port=backend.address().port;
const root=process.cwd();
const shots=join(root,"test-results","youlai-y3");
mkdirSync(shots,{recursive:true});
let browser,page;
try{
  browser=await chromium.launch(existsSync(chromium.executablePath())?
    {headless:true}:{headless:true,channel:"chrome"});
  page=await browser.newPage({viewport:{ width: 1920, height: 1080 }});
  const errors=[];page.on("pageerror",err=>errors.push(err.message));
  const base=`http://127.0.0.1:${port}/`;
  await page.goto(base+"#/login");
  await page.getByPlaceholder("用户名").fill("admin");
  await page.getByPlaceholder("密码").fill("Schema113-test-password");
  await page.getByRole("button",{name:"登录",exact:true}).click();
  await page.waitForURL(url=>url.hash.startsWith("#/dashboard"),{timeout:14000});
  await page.goto(base+"#/assets/materials");
  await page.getByText("绝缘子串",{exact:true}).first().waitFor({timeout:14000});
  await page.screenshot({path:join(shots,"material-crud-list-1920.png"),fullPage:true});
  const table=page.locator(".el-table").first();
  assert.ok(await table.getByText("XP-70").count());
  await page.getByRole("button",{name:"新增物资",exact:true}).click();
  const dialog=page.getByRole("dialog").last();
  await dialog.getByRole("textbox",{name:"物资名称"}).fill("新型防鸟罩");
  await dialog.getByRole("textbox",{name:"型号"}).fill("F-900");
  await dialog.getByRole("textbox",{name:"规格"}).fill("通用型");
  const unitItem=dialog.locator(".el-form-item").filter({hasText:"计量单位"});
  await unitItem.locator(".el-select").click();
  await page.getByRole("option",{name:"套",exact:true}).last().click();
  await dialog.getByRole("button",{name:"确定"}).click();
  await page.getByText("新型防鸟罩",{exact:true}).first().waitFor({timeout:16000});
  const row=f.s.materials.list().find(x=>x.name==="新型防鸟罩");
  assert.ok(row,"new formal material must exist");
  assert.equal(row.version_no,1);
  const rowEl=page.getByRole("row").filter({hasText:"新型防鸟罩"}).first();
  await rowEl.getByRole("button",{name:"编辑"}).click();
  const editing=page.getByRole("dialog").last();
  await editing.getByRole("textbox",{name:"型号"}).fill("F-900B");
  await editing.getByRole("button",{name:"确定"}).click();
  await page.getByText("F-900B",{exact:true}).first().waitFor({timeout:14000});
  const changed=f.s.materials.get(row.id);
  assert.equal(changed.version_no,2);
  assert.equal(changed.model,"F-900B");
  await page.getByRole("row").filter({hasText:"新型防鸟罩"}).first()
    .getByRole("button",{name:"更多操作"}).click();
  await page.getByRole("menuitem",{name:"版本历史"}).click();
  const history=page.getByRole("dialog",{name:"物资正式版本历史"});
  await history.getByRole("heading",{name:"物资正式版本历史"}).waitFor({timeout:12000});
  const versions=history.locator(".el-timeline-item");
  await versions.filter({has:page.getByText("V1",{exact:true})}).getByText("型号：F-900",{exact:true}).waitFor();
  await versions.filter({has:page.getByText("V2",{exact:true})}).getByText("型号：F-900B",{exact:true}).waitFor();
  await page.screenshot({path:join(shots,"material-history-1920.png"),fullPage:true});
  await page.locator(".el-drawer__close-btn:visible").last().click();
  await page.getByRole("row").filter({hasText:"新型防鸟罩"}).first().locator("label.el-checkbox").click();
  await page.getByRole("button",{name:"进入批量编辑"}).click();
  await page.getByText("物资批量编辑",{exact:true}).waitFor({timeout:13000});
  await page.screenshot({path:join(shots,"material-bulk-editor-1920.png"),fullPage:true});
  const {worksheetCanvas, typeWorksheetCell, materialWidths}=await import("./youlai-business-worksheet-helpers.mjs");
  const materialSheet=page.getByRole("region",{name:"物资资料",exact:true});
  const materialCanvas=await worksheetCanvas(materialSheet);
  await typeWorksheetCell(page,materialCanvas,1,2,materialWidths,"F-900C");
  await page.getByRole("button",{name:/保存 1 条修改/}).waitFor({timeout:9000});
  await page.getByRole("button",{name:"撤销",exact:true}).click();
  await page.getByRole("button",{name:/保存 1 条修改/}).waitFor({state:"hidden",timeout:9000});
  await page.getByRole("button",{name:"重做",exact:true}).click();
  await page.getByRole("button",{name:/保存 1 条修改/}).click();
  await page.getByRole("button",{name:"确认保存"}).click();
  await page.getByText("新型防鸟罩",{exact:true}).first().waitFor({timeout:14000});
  const batchResult=f.s.materials.get(row.id);
  assert.equal(batchResult.version_no,3,"batch update must append formal material V3");
  assert.equal(batchResult.model,"F-900C");
  await page.screenshot({path:join(shots,"material-bulk-saved-1920.png"),fullPage:true});
  console.log("YOULAI_Y3_MATERIAL_BULK_OK edit, native history undo/redo, atomic formal version");
  assert.deepEqual(errors,[]);
  console.log("YOULAI_Y3_MATERIAL_CRUD_OK native CrudPage, formal create/version revision/history");
}catch(e){
  await page?.screenshot({path:join(shots,"material-crud-failure.png"),fullPage:true}).catch(()=>{});
  throw e;
}finally{
  await browser?.close();

  await new Promise(ok=>backend.close(ok));
  for(const action of clean.reverse())await action();
}

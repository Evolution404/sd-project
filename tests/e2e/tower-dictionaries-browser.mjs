import assert from "node:assert/strict";
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

const cleanup=[];
const {s}=fixture({after:fn=>cleanup.push(fn)});
const server=httpServer(s);
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const browser=await chromium.launch(existsSync(chromium.executablePath())?
  {headless:true}:{headless:true,channel:"chrome"});
const page=await browser.newPage({viewport:{width:1440,height:970}});
const errors=[];
page.on("pageerror",error=>errors.push(error.message));
const dir=join(process.cwd(),"test-results/schema113/tower-dictionaries");
mkdirSync(dir,{recursive:true});
const base="http://127.0.0.1:"+server.address().port;
const modal=()=>page.locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible").last();

async function selectRef(label,option){
  const control=modal().getByLabel(label,{exact:true});
  await control.click();
  await page.getByRole("option",{name:option,exact:true}).last().click();
}
async function saveModal(){
  await modal().getByRole("button",{name:"保存",exact:true}).click();
  await page.locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible").waitFor({state:"hidden"});
}
try{
  await page.goto(base+"/#/dictionaries/tower_natures");
  await page.getByLabel("用户名",{exact:true}).fill("admin");
  await page.getByLabel("密码",{exact:true}).fill("Schema113-test-password");
  await page.getByRole("button",{name:"登录",exact:true}).click();
  await page.getByRole("tab",{name:"杆塔性质",exact:true}).waitFor();
  await page.getByRole("cell",{name:"耐张",exact:true}).waitFor();
  await page.getByRole("cell",{name:"直线",exact:true}).waitFor();
  await page.getByRole("tab",{name:"杆塔材质",exact:true}).click();
  await page.getByRole("cell",{name:"角钢塔",exact:true}).waitFor();
  await page.getByRole("cell",{name:"钢管杆",exact:true}).waitFor();

  await page.getByRole("button",{name:"新增杆塔材质",exact:true}).click();
  await modal().getByLabel("名称",{exact:true}).fill("混凝土杆");
  await saveModal();
  await page.getByRole("cell",{name:"混凝土杆",exact:true}).waitFor();
  const custom=s.catalog.list("tower_materials").find(m=>m.name==="混凝土杆");
  assert.ok(custom?.id && custom.status==="active");

  await page.goto(base+"/#/ledger/physical");
  await page.getByRole("tab",{name:"物理杆塔",exact:true}).waitFor();
  await page.getByRole("columnheader",{name:/杆塔材质/}).waitFor();
  assert.equal(await page.getByRole("columnheader",{name:/塔型/}).count(),0);
  await page.getByRole("button",{name:"新增物理杆塔",exact:true}).click();
  await selectRef("杆塔性质","耐张");
  await selectRef("杆塔材质","混凝土杆");
  await saveModal();
  await page.getByRole("cell",{name:"混凝土杆",exact:true}).waitFor();
  await page.getByRole("cell",{name:"耐张",exact:true}).waitFor();
  const physical=s.catalog.list("physical").find(row=>row.tower_material===custom.id);
  assert.ok(physical);
  assert.equal(physical.tower_nature,"tension");
  await page.screenshot({path:join(dir,"physical-custom-material-1440.png"),fullPage:true});

  await page.goto(base+"/#/dictionaries/tower_materials");
  await page.getByRole("row").filter({hasText:"混凝土杆"}).getByRole("button",{name:"查看",exact:true}).click();
  await page.getByRole("button",{name:"编辑",exact:true}).click();
  await modal().getByLabel("名称",{exact:true}).fill("混凝土杆（维护版）");
  await saveModal();
  assert.equal(s.catalog.get("tower_materials",custom.id).version,2);
  await page.goto(base+"/#/ledger/physical");
  await page.getByRole("cell",{name:"混凝土杆（维护版）",exact:true}).waitFor();
  assert.equal(s.catalog.get("physical",physical.id).tower_material,custom.id);
  assert.deepEqual(errors,[]);
  console.log("TOWER_DICTIONARIES_BROWSER_OK 2 seeded dictionaries, custom version, physical reference, live label, no tower type");
}catch(e){
  console.error("TOWER_DICTIONARIES_BROWSER_FAILURE",e,errors);
  await page.screenshot({path:join(dir,"failure.png"),fullPage:true});
  throw e;
}finally{
  await browser.close();
  await new Promise(r=>server.close(r));
  for(const fn of cleanup)fn();
}

import assert from "node:assert/strict";
import { mkdirSync, existsSync } from "node:fs";
import { join,resolve } from "node:path";
import { chromium } from "playwright";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

const tasks=[];
const {s}=fixture({after:f=>tasks.push(f)});
const server=httpServer(s,{staticDirectory:resolve(process.env.SD_BROWSER_STATIC_DIRECTORY || "dist/web")});
await new Promise(ok=>server.listen(0,"127.0.0.1",ok));
const port=server.address().port;
const root=process.cwd();
const output=join(root,"test-results","youlai-y4");
mkdirSync(output,{recursive:true});
let browser,page;
try {
  browser=await chromium.launch(existsSync(chromium.executablePath())?
    {headless:true}:{headless:true,channel:"chrome"});
  page=await browser.newPage({viewport:{ width: 1920, height: 1080 }});
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  const base=`http://127.0.0.1:${port}/`;
  await page.goto(base+"#/login");
  await page.getByPlaceholder("用户名").fill("admin");
  await page.getByPlaceholder("密码").fill("Schema113-test-password");
  await page.getByRole("button",{name:"登录",exact:true}).click();
  await page.waitForURL(url=>url.hash.startsWith("#/dashboard"),{timeout:15000});
  await page.goto(base+"#/funding/frameworks");
  await page.getByRole("button",{name:"新增年度框架"}).waitFor({timeout:15000});
  await page.getByRole("button",{name:"新增年度框架"}).click();
  let dialog=page.getByRole("dialog").last();
  await dialog.getByRole("textbox",{name:"年度框架名称"}).fill("2027年输电运维计划框架");
  await dialog.getByRole("spinbutton",{name:"年度"}).fill("2027");
  await dialog.getByRole("textbox",{name:"额度（元）"}).fill("450123.47");
  await dialog.getByRole("button",{name:"确定"}).click();
  await page.getByText("2027年输电运维计划框架",{exact:true}).first().waitFor({timeout:15000});
  const fw=s.funding.list("frameworks").find(x=>x.name==="2027年输电运维计划框架");
  assert.ok(fw,"framework must persist through real UI");
  assert.equal(fw.limit_fen,45012347);
  assert.equal(fw.fiscal_year,2027);
  await page.screenshot({path:join(output,"framework-list-1920.png"),fullPage:true});

  const line=page.getByRole("row").filter({hasText:"2027年输电运维计划框架"}).first();
  await line.getByRole("button",{name:"修订"}).click();
  dialog=page.getByRole("dialog").last();
  await dialog.getByRole("textbox",{name:"额度（元）"}).fill("450222.01");
  await dialog.getByRole("button",{name:"确定"}).click();
  await page.getByText("¥450222.01",{exact:true}).first().waitFor({timeout:15000});
  const after=s.funding.get("frameworks",fw.id);
  assert.equal(after.limit_fen,45022201);
  assert.equal(after.version_no,2);
  await line.getByRole("button",{name:"更多操作"}).click();
  await page.getByRole("menuitem",{name:"历史",exact:true}).click();
  await page.getByText("V2").first().waitFor({timeout:12000});
  await page.getByText("V1").first().waitFor({timeout:12000});
  await page.screenshot({path:join(output,"framework-history-1920.png"),fullPage:true});
  await page.locator(".el-drawer:visible .el-drawer__close-btn").click();

  await page.goto(base+"#/funding/agreements");
  await page.getByRole("button",{name:"新增执行协议"}).waitFor({timeout:15000});
  await page.getByRole("button",{name:"新增执行协议"}).click();
  dialog=page.getByRole("dialog").last();
  await dialog.getByRole("textbox",{name:"执行协议名称"}).fill("2027年度导线维修协议");
  await dialog.getByRole("combobox",{name:"所属年度框架"}).click();
  await page.getByRole("option",{name:/2027年输电运维计划框架/}).last().click();
  await dialog.getByRole("textbox",{name:"额度（元）"}).fill("100000.25");
  await dialog.getByRole("textbox",{name:"合同编号"}).fill("X-2027-001");
  await dialog.getByRole("button",{name:"确定"}).click();
  await page.getByText("2027年度导线维修协议",{exact:true}).first().waitFor({timeout:15000});
  const agreement=s.funding.list("agreements").find(x=>x.name==="2027年度导线维修协议");
  assert.ok(agreement,"agreement must persist through actual original CRUD");
  assert.equal(agreement.framework_id,fw.id);
  assert.equal(agreement.limit_fen,10000025);
  assert.equal(agreement.contract_number,"X-2027-001");
  await page.screenshot({path:join(output,"agreement-list-1920.png"),fullPage:true});
  await page.goto(base+"#/business/projects");
  for(const name of ["年度框架直归项目","执行协议归属项目"]) {
    await page.getByRole("button",{name:"新增子项目",exact:true}).click();
    const projectForm=page.getByRole("dialog",{name:"新增子项目"});
    await projectForm.getByRole("textbox",{name:"项目名称"}).fill(name);
    await projectForm.getByRole("combobox",{name:"年度框架"}).click();
    await page.getByRole("option",{name:/2027年输电运维计划框架/}).last().click();
    if(name==="执行协议归属项目") {
      await projectForm.locator(".el-form-item").filter({has:page.getByText("执行协议",{exact:true})})
        .locator(".el-select").click();
      await page.getByRole("option",{name:"2027年度导线维修协议",exact:true}).click();
    }
    await projectForm.getByRole("button",{name:"确定"}).click();
    await projectForm.waitFor({state:"hidden"});
  }
  const frameworkDetails=s.funding.details("frameworks",fw.id);
  const agreementDetails=s.funding.details("agreements",agreement.id);
  assert.deepEqual(frameworkDetails.projects.map(row=>row.name).sort(),["年度框架直归项目","执行协议归属项目"].sort());
  assert.deepEqual(agreementDetails.projects.map(row=>row.name),["执行协议归属项目"]);
  await page.goto(base+"#/funding/frameworks?funding="+fw.id);
  const frameworkDrawer=page.getByRole("dialog",{name:"年度框架资金与项目归属"});
  await frameworkDrawer.getByRole("button",{name:"年度框架直归项目",exact:true}).waitFor();
  await frameworkDrawer.getByRole("button",{name:"2027年度导线维修协议",exact:true}).click();
  const agreementDrawer=page.getByRole("dialog",{name:"执行协议资金与项目归属"});
  await agreementDrawer.getByRole("button",{name:"执行协议归属项目",exact:true}).click();
  await page.getByRole("button",{name:"返回资金归属",exact:true}).waitFor();
  assert.equal(s.projects.get(agreementDetails.projects[0].id).funding.agreement_id,agreement.id);
  await page.getByRole("button",{name:"返回资金归属",exact:true}).click();
  await agreementDrawer.getByRole("button",{name:"执行协议归属项目",exact:true}).waitFor();
  await agreementDrawer.getByRole("button",{name:"查看所属年度框架",exact:true}).click();
  await frameworkDrawer.getByRole("button",{name:"年度框架直归项目",exact:true}).waitFor();
  await page.screenshot({path:join(output,"framework-agreement-project-trace-1920.png")});
  assert.deepEqual(errors,[]);
  console.log("YOULAI_Y4_FUNDING_OK framework and agreement versions, separate ownership and linked project round trip");
} catch(error){
  if(page)await page.screenshot({path:join(output,"funding-failure.png"),fullPage:true}).catch(()=>{});
  throw error;
} finally {
  await browser?.close();

  await new Promise(ok=>server.close(ok));
  for(const cleanup of tasks.reverse())await cleanup();
}

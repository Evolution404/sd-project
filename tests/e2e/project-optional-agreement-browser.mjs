import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { fixture } from "../helpers.mjs";
import { selectFormChoice } from "./field-helper.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

const cleanup=[];
const {s,user,save}=fixture({after:fn=>cleanup.push(fn)});
const f1=save("frameworks",{name:"2026业务框架",fiscal_year:2026,limit_fen:10000000});
const f2=save("frameworks",{name:"2027业务框架",fiscal_year:2027,limit_fen:10000000});
const a1=save("agreements",{name:"2026甲执行协议",framework_id:f1.id,limit_fen:300000});
const a2=save("agreements",{name:"2027乙执行协议",framework_id:f2.id,limit_fen:350000});
save("agreements",{name:"2027停用协议",framework_id:f2.id,limit_fen:100000,status:"inactive"});
const server=httpServer(s);
await new Promise(done=>server.listen(0,"127.0.0.1",done));
const browser=await chromium.launch(existsSync(chromium.executablePath())
  ? {headless:true}:{headless:true,channel:"chrome"});
const page=await browser.newPage({viewport:{width:1370,height:980}});
const exceptions=[];
page.on("pageerror",err=>exceptions.push(err.message));
const base="http://127.0.0.1:"+server.address().port;
const out=join(process.cwd(),"test-results/schema113/project-optional-agreement");
mkdirSync(out,{recursive:true});
const editor=page.locator(".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible");
const detail=page.locator(".business-detail-dialog:visible");
async function chooseFramework(text) { await selectFormChoice(page,"年度框架",text); }
async function chooseAgreement(name) {
  await editor.getByLabel("执行协议（选填）",{exact:true}).click();
  await page.getByRole("option",{name:new RegExp(name)}).click();
}
async function editProfile() {
  await detail.getByRole("button",{name:"更多管理操作"}).click();
  await page.getByRole("menuitem",{name:"修订档案"}).click();
  await editor.getByLabel("执行协议（选填）",{exact:true}).waitFor();
}
try {
  await page.goto(base+"/#/projects");
  await page.getByLabel("用户名",{exact:true}).fill("admin");
  await page.getByLabel("密码",{exact:true}).fill("Schema113-test-password");
  await page.getByRole("button",{name:"登录",exact:true}).click();
  await page.getByRole("button",{name:"新增子项目",exact:true}).click();
  await editor.getByLabel("项目名称",{exact:true}).fill("新建时选择协议");
  await chooseFramework("2026业务框架 · 2026");
  await editor.getByLabel("执行协议（选填）",{exact:true}).click();
  await page.getByRole("option",{name:/2026甲执行协议/}).waitFor();
  assert.equal(await page.getByRole("option",{name:/2027乙执行协议/}).count(),0,
    "agreement choices must follow selected framework");
  await page.getByRole("option",{name:/2026甲执行协议/}).click();
  await page.screenshot({path:join(out,"create-project-with-optional-agreement.png"),fullPage:true});
  await editor.getByRole("button",{name:"保存",exact:true}).click();
  await editor.waitFor({state:"hidden"});
  await detail.getByRole("heading",{name:"新建时选择协议",exact:true}).waitFor();
  const first=s.projects.list().find(x=>x.name==="新建时选择协议");
  assert.ok(first);
  assert.equal(first.framework_id,f1.id);
  assert.equal(first.funding.agreement_id,a1.id);
  assert.equal(await detail.getByRole("button",{name:"资金归属"}).count(),0);

  await editProfile();
  await chooseFramework("2027业务框架 · 2027");
  assert.equal(await editor.getByLabel("执行协议（选填）",{exact:true}).inputValue(),"",
    "changing annual framework must clear the prior agreement");
  await chooseAgreement("2027乙执行协议");
  await page.screenshot({path:join(out,"reserve-project-switches-framework-and-agreement.png"),fullPage:true});
  await editor.getByRole("button",{name:"保存",exact:true}).click();
  await editor.waitFor({state:"hidden"});
  const changed=s.projects.get(first.id);
  assert.equal(changed.framework_id,f2.id);
  assert.equal(changed.funding.agreement_id,a2.id);
  assert.deepEqual(s.projects.history(first.id).profiles.map(item=>item.framework_id),[f1.id,f2.id]);

  await detail.getByRole("button",{name:"关闭详情",exact:true}).click();
  await page.getByRole("button",{name:"新增子项目",exact:true}).click();
  await editor.getByLabel("项目名称",{exact:true}).fill("执行协议可空的子项目");
  await chooseFramework("2027业务框架 · 2027");
  assert.equal(await editor.getByText(/不选择执行协议，即直接归属所选年度框架/).isVisible(),true);
  await page.screenshot({path:join(out,"project-directly-owned-by-framework.png"),fullPage:true});
  await editor.getByRole("button",{name:"保存",exact:true}).click();
  await editor.waitFor({state:"hidden"});
  await detail.getByText("直接归属年度框架（无需执行协议）").waitFor();
  const second=s.projects.list().find(x=>x.name==="执行协议可空的子项目");
  assert.equal(second.framework_id,f2.id);
  assert.equal(second.funding,null);
  assert.ok(s.funding.details("frameworks",f2.id).projects
    .some(p=>p.id===second.id && p.agreement_id===null));
  assert.deepEqual(exceptions,[]);
  console.log("PROJECT_OPTIONAL_AGREEMENT_BROWSER_OK creation optional agreement, same-framework choices, reserve changes, no standalone attribution, empty agreement");
} catch(error) {
  console.error("PROJECT_OPTIONAL_AGREEMENT_BROWSER_ERRORS",exceptions);
  await page.screenshot({path:join(out,"failure.png"),fullPage:true});
  throw error;
} finally {
  await browser.close();
  await new Promise(done=>server.close(done));
  for(const callback of cleanup.reverse())await callback();
}

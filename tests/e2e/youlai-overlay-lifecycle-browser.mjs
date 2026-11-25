import assert from "node:assert/strict";
import { approvedFixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";
import { chromium } from "playwright";
import { resolve,join } from "node:path";
import { existsSync,mkdirSync,writeFileSync } from "node:fs";
const cleanup=[],f=approvedFixture({after:fn=>cleanup.push(fn)});
f.save("agreements",{name:"浮层测试协议",framework_id:f.framework.id,limit_fen:100000});
const server=httpServer(f.s,{staticDirectory:resolve(process.env.SD_BROWSER_STATIC_DIRECTORY||"dist/web")});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const base="http://127.0.0.1:"+server.address().port;
const out=resolve("test-results/youlai-overlay-lifecycle");mkdirSync(out,{recursive:true});
const browser=await chromium.launch(existsSync(chromium.executablePath())?{headless:true}:{headless:true,channel:"chrome"});
const results=[];
try{
 for(const theme of ["light","dark"]){
 const width=1920;
 const page=await browser.newPage({viewport:{width,height:1080},colorScheme:theme});
 page.setDefaultTimeout(12000);
 const errors=[];page.on("pageerror",e=>errors.push(e.message));
 const main=page.locator(".layout-content");
 const overlay=page.locator(".el-overlay:visible").filter({has:page.locator(".el-dialog,.el-drawer,.el-message-box")});
 async function go(path,marker){await page.goto(base+"/#"+path);await main.getByText(marker,{exact:true}).first().waitFor();await page.waitForFunction(()=>!document.querySelector(".layout-content .el-loading-mask"))}
 async function navigate(path){
  // Vue Router navigation without a browser-driven hash replacement; leave guards own the decision.
  await page.evaluate(path=>{void document.querySelector("#app").__vue_app__.config.globalProperties.$router.push(path)},path);
 }
 async function clear(key){
  await overlay.first().waitFor({state:"hidden"});
  await page.waitForFunction(()=>!document.body.classList.contains("el-popup-parent--hidden"));
  assert.equal(await overlay.count(),0,key);
  results.push({width,theme,key,pass:true});
 }
 async function action(id){
  const direct=main.locator('[data-guide-action="'+id+'"]:visible').first();
  if(await direct.count())await direct.click();
  else{await main.locator('[data-guide-menu~="'+id+'"]:visible').first().click();await page.locator('[data-guide-action="'+id+'"]:visible').first().click()}
 }
 await page.goto(base+"/#/login");
 await page.waitForFunction(()=>document.title==="输电项目全流程管理系统");
 assert.equal(await page.title(),"输电项目全流程管理系统");
 await page.getByPlaceholder("用户名").fill("admin");
 await page.getByPlaceholder("密码").fill("Schema113-test-password");
 await page.getByRole("button",{name:"登录",exact:true}).click();await page.waitForURL(/#\/dashboard/);
 assert.equal(await page.locator('.layout-toolbar [class*="i-svg:language"]').count(),0);
 await page.waitForFunction(()=>document.title==="输电项目全流程管理系统");
 assert.equal(await page.title(),"输电项目全流程管理系统");
 for(const [kind,title] of [["frameworks","年度框架"],["agreements","执行协议"]]){
  await go("/funding/"+kind,"新增"+title);
  await action(kind+".projects");
  const drawer=page.getByRole("dialog",{name:title+"资金与项目归属"});await drawer.waitFor();
  // Changing only the table preference URL must not close the current drawer.
  const route=new URL(page.url());const hash=route.hash;const sep=hash.includes("?")?"&":"?";
  await page.goto(base+"/"+hash+sep+"_list=invalid");await drawer.waitFor();
  assert.equal(await drawer.isVisible(),true);
  await go("/dashboard","实际费用趋势");await clear(kind+"-leave");
  await page.goBack();await main.getByRole("button",{name:"新增"+title,exact:true}).waitFor();await clear(kind+"-back");
  await action(kind+".history");await page.getByRole("dialog",{name:title+"正式版本历史"}).waitFor();
  await go("/dashboard","实际费用趋势");await clear(kind+"-history-leave");
 }
 await go("/funding/finance","新增结算草稿");
 await main.getByRole("button",{name:"新增结算草稿",exact:true}).click();
 await page.getByRole("dialog",{name:"选择已有正式立项的子项目"}).waitFor();
 await go("/dashboard","实际费用趋势");await clear("finance-picker-leave");
 await page.goBack();await main.getByRole("button",{name:"新增结算草稿",exact:true}).waitFor();await clear("finance-picker-back");
 await go("/funding/frameworks","新增年度框架");
 await main.getByRole("button",{name:"新增年度框架",exact:true}).click();
 const form=page.getByRole("dialog",{name:"新增年度框架"});await form.waitFor();
 await form.locator("input").first().fill("未保存浮层验收");
 await navigate("/dashboard");
 const confirm=page.getByRole("dialog",{name:"放弃表单修改"});await confirm.waitFor();
 await confirm.getByRole("button",{name:"继续填写",exact:true}).click();await confirm.waitFor({state:"hidden"});
 await form.waitFor();assert.equal(await form.locator("input").first().inputValue(),"未保存浮层验收");
 await page.waitForURL(/funding\/frameworks/);
 await navigate("/dashboard");await confirm.waitFor();
 await confirm.getByRole("button",{name:"放弃修改",exact:true}).click();
 await main.getByText("实际费用趋势",{exact:true}).waitFor();await clear("crud-dirty-leave");
 await go("/funding/finance?project="+f.project.id+"&work=costs","登记实际费用");
 await main.getByRole("button",{name:"登记实际费用",exact:true}).click();
 const cost=page.getByRole("dialog",{name:"登记实际费用"});await cost.waitFor();
 await cost.locator("input").first().fill("未保存费用");
 await navigate("/dashboard");await confirm.waitFor();
 await confirm.getByRole("button",{name:"继续填写",exact:true}).click();await confirm.waitFor({state:"hidden"});
 await cost.waitFor();assert.equal(await cost.locator("input").first().inputValue(),"未保存费用");
 await navigate("/dashboard");await confirm.waitFor();await confirm.getByRole("button",{name:"放弃修改",exact:true}).click();
 await main.getByText("实际费用趋势",{exact:true}).waitFor();await clear("cost-dirty-leave");
 await go("/assets/materials","新增物资");await page.keyboard.press("F1");await page.getByRole("dialog",{name:"使用指引",exact:true}).waitFor();
 await go("/dashboard","实际费用趋势");await clear("guide-leave");
 await go("/configuration/access","新增 IP 授权");
 await main.getByRole("button",{name:"新增 IP 授权",exact:true}).click();
 const grant=page.getByRole("dialog",{name:"新增 IP 授权"});await grant.waitFor();
 assert.equal(await grant.evaluate(el=>el.closest(".el-overlay").parentElement===document.body),true);
 await page.screenshot({path:join(out,"ip-"+width+".png"),animations:"disabled"});
 await grant.locator(".el-dialog__headerbtn").click();await clear("ip-native-portal");
 assert.deepEqual(errors,[]);
 await page.close();
 console.log("OVERLAY_LIFECYCLE_OK",width,theme,results.filter(r=>r.width===width).length);
 }
 console.log("YOULAI_OVERLAY_LIFECYCLE_OK",results.length,"cases");
}finally{writeFileSync(join(out,"results.json"),JSON.stringify(results,null,2));await browser.close();await new Promise(r=>server.close(r));for(const fn of cleanup.reverse())await fn()}

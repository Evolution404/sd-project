import assert from "node:assert/strict";
import {existsSync,mkdirSync} from "node:fs";
import {join} from "node:path";
import {chromium} from "playwright";
import {fixture} from "../helpers.mjs";
import {httpServer} from "../../dist/server/platform/http/server.js";

const cleanup=[];
const {s,save}=fixture({after:fn=>cleanup.push(fn)});
for (const name of ["指引测试框架一","指引测试框架二"])
  save("frameworks",{name,fiscal_year:2026,limit_fen:100000});
const server=httpServer(s);
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const browser=await chromium.launch(existsSync(chromium.executablePath())?
  {headless:true}:{headless:true,channel:"chrome"});
const page=await browser.newPage({viewport:{width:1280,height:960}});
const errors=[],writes=[];
page.on("pageerror",e=>errors.push(e.message));
page.on("request",req=>{
  if(["POST","PUT","PATCH","DELETE"].includes(req.method()) &&
      req.url().includes("/api/") && !req.url().endsWith("/api/login"))
    writes.push(req.method()+" "+req.url());
});
const out=join(process.cwd(),"test-results/p10/live-action-help");
mkdirSync(out,{recursive:true});
const base="http://127.0.0.1:"+server.address().port;
async function searchAction(text,expected,insideDialog=false){
  if(insideDialog) await page.locator(".el-dialog [data-guide-modal-help]").last().click();
  else await page.getByRole("button",{name:"使用指引",exact:true}).click();
  const drawer=page.getByRole("dialog",{name:"使用指引"});
  await drawer.waitFor();
  await drawer.getByRole("tab",{name:"操作搜索"}).click();
  await drawer.getByRole("textbox",{name:"搜索业务操作说明"}).fill(text);
  const item=drawer.locator(".el-collapse-item").filter({hasText:expected}).first();
  const header=item.locator(".el-collapse-item__header");
  if(await header.getAttribute("aria-expanded")!=="true") await header.click();
  return {drawer,item};
}
try{
  await page.goto(base+"/#/demands");
  await page.getByLabel("用户名",{exact:true}).fill("admin");
  await page.getByLabel("密码",{exact:true}).fill("Schema113-test-password");
  await page.getByRole("button",{name:"登录",exact:true}).click();
  await page.getByRole("heading",{name:"专业需求",exact:true}).waitFor();
  assert.equal(await page.locator('[data-guide-action="demands.create"]').count(),1);
  let {drawer,item}=await searchAction("新增需求","新增需求 · 专业需求");
  await item.getByRole("button",{name:"定位当前按钮"}).click();
  await drawer.waitFor({state:"hidden"});
  await page.locator(".el-tour__content:visible").waitFor();
  await page.getByText("不能自行等同审核",{exact:false}).last().waitFor();
  assert.equal(await page.getByRole("region",{name:"新增专业需求"}).count(),0);
  assert.deepEqual(writes,[],"Highlight is read-only and never clicks a business action");
  await page.screenshot({path:join(out,"demand-anchored-readonly-tour.png"),fullPage:true});
  await page.keyboard.press("Escape");
  await page.locator(".el-tour__content:visible").waitFor({state:"hidden"});

  ({drawer,item}=await searchAction("参考价格","新增参考价格规则 · 参考价格"));
  await item.getByRole("button",{name:"前往参考价格",exact:true}).click();
  await page.getByRole("heading",{name:"参考价格",exact:true}).waitFor();
  await drawer.waitFor({state:"hidden"});

  await page.goto(base+"/#/dictionaries/tower_materials");
  await page.getByRole("tab",{name:"杆塔材质"}).waitFor();
  assert.equal(await page.locator('[data-guide-action="dictionaries.tower-material"]').count(),1);
  ({drawer,item}=await searchAction("杆塔材质","杆塔材质 · 基础数据"));
  await item.getByRole("button",{name:"定位当前按钮"}).click();
  await drawer.waitFor({state:"hidden"});
  await page.locator(".el-tour__content:visible").waitFor();
  assert.deepEqual(writes,[],"Dictionary version creation was not invoked");
  await page.screenshot({path:join(out,"material-anchored-readonly-tour.png"),fullPage:true});
  // Excel dialogs are teleported. A guide may explain the actual template
  // button but must not execute the download, upload, preview or commit action.
  await page.keyboard.press("Escape");
  await page.locator(".el-tour__content:visible").waitFor({state:"hidden"});
  await page.goto(base+"/#/demands");
  await page.locator('[data-guide-action="excel.import"]').click();
  await page.locator('[data-guide-action="excel.template"]').waitFor();
  assert.equal(await page.locator('[data-guide-action="excel.preview"]').count(),1);
  ({drawer,item}=await searchAction("参考价格","新增参考价格规则 · 参考价格",true));
  const origin=page.url();
  await item.getByRole("button",{name:"前往参考价格",exact:true}).click();
  await drawer.getByText(/请先关闭指引，保存或退出/).waitFor();
  assert.equal(page.url(),origin);
  assert.ok(await page.locator('[data-guide-action="excel.template"]').isVisible());
  await drawer.getByRole("button",{name:"关闭此对话框",exact:true}).click();
  await drawer.waitFor({state:"hidden"});
  ({drawer,item}=await searchAction("excel.template","导入 Excel",true));
  await item.getByRole("button",{name:"定位当前按钮"}).click();
  await drawer.waitFor({state:"hidden"});
  const excelTour=page.locator(".el-tour__content:visible");
  const finish=excelTour.getByRole("button",{name:"结束导览",exact:true});
  await finish.waitFor();
  assert.equal(await finish.evaluate(button=>{
    const rect=button.getBoundingClientRect();
    return button.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2));
  }),true,"A business dialog must not cover the guide controls");
  await finish.click();
  await excelTour.waitFor({state:"hidden"});
  assert.ok(await page.locator('[data-guide-action="excel.template"]').isVisible());
  assert.deepEqual(writes,[],"An Excel dialog help target must never perform an API write");
  await page.locator(".el-dialog__headerbtn").last().click();

  // The workbench locates a single queue, without selecting any of its rows.
  await page.goto(base+"/#/dashboard");
  const queue=page.locator('[data-guide-action="dashboard.open"]');
  await queue.waitFor();
  assert.equal(await queue.count(),1);
  ({drawer,item}=await searchAction("dashboard.open","查看待办 · 工作台"));
  await item.getByRole("button",{name:"定位当前按钮"}).click();
  await drawer.waitFor({state:"hidden"});
  await page.locator(".el-tour__content:visible").getByText("查看待办",{exact:true}).waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".el-tour__content:visible").waitFor({state:"hidden"});

  // Several framework rows share an action. Never choose an arbitrary row.
  await page.goto(base+"/#/frameworks");
  await page.getByRole("button",{name:"指引测试框架二",exact:true}).waitFor();
  assert.equal(await page.locator('[data-guide-action="frameworks.detail"]').count(),2);
  ({drawer,item}=await searchAction("frameworks.detail","查看资金概览 · 年度框架"));
  await item.getByRole("button",{name:"定位当前按钮"}).click();
  await drawer.getByText(/当前没有唯一可定位/).waitFor();
  assert.equal(await drawer.isVisible(),true);
  assert.deepEqual(writes,[],"Duplicate action IDs cannot cause automatic selection");
  await page.keyboard.press("Escape");
  await drawer.waitFor({state:"hidden"});
  assert.deepEqual(errors,[]);
  console.log("P10_LIVE_ACTION_BROWSER_OK direct, teleported Excel modal, duplicate-row safe fallback, zero writes");
}catch(error){
  console.error("P10_LIVE_ACTION_BROWSER_FAILED",error,errors);
  await page.screenshot({path:join(out,"failure.png"),fullPage:true});
  throw error;
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
  cleanup.forEach(fn=>fn());
}

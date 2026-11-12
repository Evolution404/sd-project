import assert from "node:assert/strict";
import {existsSync,mkdirSync} from "node:fs";
import {join} from "node:path";
import {chromium} from "playwright";
import {fixture} from "../helpers.mjs";
import {httpServer} from "../../dist/server/platform/http/server.js";

const cleanup=[];
const {s}=fixture({after:fn=>cleanup.push(fn)});
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
async function searchAction(text,expected){
  await page.getByRole("button",{name:"使用指引",exact:true}).click();
  const drawer=page.getByRole("dialog",{name:"使用指引"});
  await drawer.waitFor();
  await drawer.getByRole("tab",{name:"操作搜索"}).click();
  await drawer.getByRole("textbox",{name:"搜索业务操作说明"}).fill(text);
  const item=drawer.locator(".el-collapse-item").filter({hasText:expected}).first();
  await item.locator(".el-collapse-item__header").click();
  return {drawer,item};
}
try{
  await page.goto(base+"/#/demands");
  await page.getByLabel("用户名",{exact:true}).fill("admin");
  await page.getByLabel("密码",{exact:true}).fill("Schema113-test-password");
  await page.getByRole("button",{name:"登录",exact:true}).click();
  await page.getByRole("heading",{name:"专业需求",exact:true}).waitFor();
  assert.equal(await page.locator('[data-guide-action="demands.create"]').count(),1);
  let {drawer,item}=await searchAction("新增需求","新增需求 · demands");
  await item.getByRole("button",{name:"定位当前按钮"}).click();
  await drawer.waitFor({state:"hidden"});
  await page.locator(".el-tour__content:visible").waitFor();
  await page.getByText("不能自行等同审核",{exact:false}).last().waitFor();
  assert.equal(await page.getByRole("dialog",{name:"新增专业需求"}).count(),0);
  assert.deepEqual(writes,[],"Highlight is read-only and never clicks a business action");
  await page.screenshot({path:join(out,"demand-anchored-readonly-tour.png"),fullPage:true});
  await page.keyboard.press("Escape");
  await page.locator(".el-tour__content:visible").waitFor({state:"hidden"});

  ({drawer,item}=await searchAction("参考价格","新增参考价格规则 · pricing"));
  await item.getByRole("button",{name:"定位当前按钮"}).click();
  await page.getByText(/当前没有唯一可定位/).first().waitFor();
  assert.equal(await drawer.isVisible(),true);
  await drawer.getByRole("button",{name:"Close"}).click().catch(async()=>{
    await page.keyboard.press("Escape");
  });
  await drawer.waitFor({state:"hidden"});

  await page.goto(base+"/#/dictionaries/tower_materials");
  await page.getByRole("tab",{name:"杆塔材质"}).waitFor();
  assert.equal(await page.locator('[data-guide-action="dictionaries.tower-material"]').count(),1);
  ({drawer,item}=await searchAction("杆塔材质","杆塔材质 · dictionaries"));
  await item.getByRole("button",{name:"定位当前按钮"}).click();
  await drawer.waitFor({state:"hidden"});
  await page.locator(".el-tour__content:visible").waitFor();
  assert.deepEqual(writes,[],"Dictionary version creation was not invoked");
  await page.screenshot({path:join(out,"material-anchored-readonly-tour.png"),fullPage:true});
  assert.deepEqual(errors,[]);
  console.log("P10_LIVE_ACTION_BROWSER_OK direct demand and material anchors, no arbitrary fallback and zero business writes");
}catch(error){
  console.error("P10_LIVE_ACTION_BROWSER_FAILED",error,errors);
  await page.screenshot({path:join(out,"failure.png"),fullPage:true});
  throw error;
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
  cleanup.forEach(fn=>fn());
}

import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";
import { selectFormChoice, chooseDemandLocations } from "./field-helper.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

const cleanup=[];
const {s,user,unit,operation,demandInput,save}=fixture({after:fn=>cleanup.push(fn)});
const original=s.demands.save(user,{...demandInput,
  work_locations:[demandInput.work_locations[0]],
});
const revisedUnit=s.dictionaries.saveDictionary(user,"units",
  {expected_version:1,quantity_precision:2},unit.id);
const revisedOperation=s.catalog.save(user,"operations",
  {expected_version:1,adopt_current_unit:true},operation.id);
assert.equal(revisedUnit.version,2);
assert.equal(revisedOperation.default_unit_version,2);
const independentUnit=save("units",{name:"个",quantity_precision:0});
const independentOperation=save("operations",{
  name:"安装单个装置",work_object_id:operation.work_object_id,
  default_unit_id:independentUnit.id,
  completion_standard:"安装完好",
});
const server=httpServer(s);
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const browser=await chromium.launch(existsSync(chromium.executablePath())
  ? {headless:true}:{headless:true,channel:"chrome"});
const page=await browser.newPage({viewport:{width:1280,height:1000}});
const failures=[];
page.on("pageerror",error=>failures.push(error.message));
let writes=0;
page.on("request",request=>{
  if(request.method()==="POST" && /\/api\/demands(?:\/|$)/.test(new URL(request.url()).pathname))writes++;
});
const out=join(process.cwd(),"test-results/schema113/adopted-quantity");
mkdirSync(out,{recursive:true});
const editor=page.locator(".business-work-surface:visible");
async function openDetail() {
  await page.goto("http://127.0.0.1:"+server.address().port+"/#/demands?demand="+original.id);
  await page.getByLabel("用户名",{exact:true}).fill("admin");
  await page.getByLabel("密码",{exact:true}).fill("Schema113-test-password");
  await page.getByRole("button",{name:"登录",exact:true}).click();
  const detail=page.locator(".business-detail-dialog:visible");
  await detail.getByRole("button",{name:"修订需求"}).click();
  await editor.getByText("需求数量（整数）").first().waitFor();
}
try {
  await openDetail();
  assert.equal(s.demands.get(original.id).operation_version,1);
  assert.equal(s.demands.get(original.id).unit_version,1);
  await page.screenshot({path:join(out,"01-frozen-old-unit-precision.png"),fullPage:true});
  await editor.getByRole("tab",{name:"作业位置与工作量",exact:true}).click();
  const count=editor.locator(".quantity-cell input:visible").first();
  await count.fill("1.5");
  await count.press("Tab");
  await editor.getByText("数量超过正式计量单位允许的小数位").waitFor();
  const writesAfterInvalidInteger = writes;
  await editor.getByRole("button",{name:"保存需求版本"}).click();
  assert.equal(writes,writesAfterInvalidInteger,"invalid integer quantity must not submit prior value");
  assert.equal(s.demands.get(original.id).work_locations[0].quantity_scaled,30000);
  // Fault injection: a failed unit lookup must prevent a real POST, never
  // silently fall back to four decimals.
  await page.route("**/api/catalog/units/"+unit.id+"?history=true",route=>
    route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"模拟暂时不可用"})}));
  await editor.getByRole("button",{name:"取消",exact:true}).click();
  await page.locator(".el-message-box:visible .el-button--primary").click().catch(()=>{});
  const detail=page.locator(".business-detail-dialog:visible");
  await detail.getByRole("button",{name:"修订需求"}).click();
  await editor.getByText("正式计量单位版本读取失败",{exact:false}).waitFor();
  const previousWrites=writes;
  await editor.getByRole("button",{name:"保存需求版本"}).click();
  assert.equal(writes,previousWrites,"failed precision must never write demand");
  await page.screenshot({path:join(out,"02-loading-failure-blocked.png"),fullPage:true});
  await page.unroute("**/api/catalog/units/"+unit.id+"?history=true");
  await editor.getByRole("button",{name:"重新读取正式单位版本"}).click();
  await editor.getByText("需求数量（整数）").first().waitFor();
  // The latest operation version uses two places, but frozen edit is still zero.
  await editor.getByRole("button",{name:"取消",exact:true}).click();
  await page.locator(".el-message-box:visible .el-button--primary").click().catch(()=>{});
  await detail.getByRole("button",{name:"关闭详情",exact:true}).click();
  await detail.waitFor({state:"hidden"});
  await page.getByRole("button",{name:"新增需求",exact:true}).click();
  await selectFormChoice(page,"操作类型",operation.name,editor);
  await editor.getByText("需求数量（最多2位小数）").first().waitFor();
  await chooseDemandLocations(page,["T16"]);
  await editor.getByRole("tab",{name:"作业位置与工作量",exact:true}).click();
  const amount=editor.locator(".quantity-cell input:visible").first();
  await amount.fill("0.25");
  await amount.press("Tab");
  assert.equal(await amount.inputValue(),"0.25");
  await amount.fill("0.2501");
  await amount.press("Tab");
  await editor.getByText("数量超过正式计量单位允许的小数位").waitFor();
  await page.screenshot({path:join(out,"03-two-decimal-precision.png"),fullPage:true});
  // Use controlled response latency: last choice wins even if first request
  // completes after the final choice.
  await page.route("**/api/catalog/units/"+unit.id+"?history=true",async route=>{
    await new Promise(resolve=>setTimeout(resolve,350));
    await route.continue();
  });
  await editor.getByRole("tab",{name:"基本信息",exact:true}).click();
  await selectFormChoice(page,"操作类型",independentOperation.name,editor);
  await page.getByRole("dialog",{name:"核对操作类型变化",exact:true}).getByRole("button",{name:"应用新定义",exact:true}).click();
  await editor.getByText("需求数量（整数）").first().waitFor();
  await selectFormChoice(page,"操作类型",operation.name,editor);
  await page.getByRole("dialog",{name:"核对操作类型变化",exact:true}).getByRole("button",{name:"应用新定义",exact:true}).click();
  await editor.getByRole("tab",{name:"基本信息",exact:true}).click();
  await selectFormChoice(page,"操作类型",independentOperation.name,editor);
  await page.getByRole("dialog",{name:"核对操作类型变化",exact:true}).getByRole("button",{name:"应用新定义",exact:true}).click();
  await editor.getByText("需求数量（整数）").first().waitFor();
  await page.waitForTimeout(500);
  assert.equal(await editor.getByText("需求数量（最多2位小数）").count(),0,
    "stale earlier unit history must not overwrite last selection");
  assert.deepEqual(failures,[]);
  console.log("ADOPTED_QUANTITY_PRECISION_BROWSER_OK frozen old version, forbidden 1.5 set, failed lookup no writes, retry, 0.25 allowed/0.2501 forbidden, rapid selection");
} finally {
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
  for(const fn of cleanup.reverse())await fn();
}

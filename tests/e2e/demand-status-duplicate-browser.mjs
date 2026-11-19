import assert from "node:assert/strict";
import {existsSync, mkdirSync} from "node:fs";
import {join} from "node:path";
import {chromium} from "playwright";
import {fixture} from "../helpers.mjs";
import {inspect} from "../inspector.mjs";
import {httpServer} from "../../dist/server/platform/http/server.js";

const cleanup=[];
const {s,user,save,demandInput,unit,operation}=fixture({after:fn=>cleanup.push(fn)},{quantity_precision:4});
s.catalog.save(user,"units",{name:"每基杆塔安装装置套数",quantity_precision:4,expected_version:1},unit.id);
s.catalog.save(user,"operations",{...operation,adopt_current_unit:true,expected_version:1},operation.id);
demandInput.work_locations[0].quantity_scaled=12345;
const primary=s.demands.save(user,demandInput);
const other=s.demands.save(user,{
  ...demandInput,problem_description:"第二次发现的独立故障",
  duplicate_review_tokens: {[primary.id]:s.demands.review(primary.id).duplicate_review_token},
    duplicate_decision:"separate", duplicate_matches:[primary.demand_no],
  duplicate_reason:"第二次现场发现，独立处置",
});
const tower=save("physical",{asset_no:"RETURN-TEST",tower_material:"angle"});
const returned=s.demands.save(user,{
  ...demandInput,problem_description:"需退回核对的需求",
  work_locations:[{location_kind:"physical_tower",physical_tower_id:tower.id,quantity_scaled:10000}],
});
s.demands.transition(user,returned.id,{expected_version:1,expected_event_seq:1,status:"returned"});
const server=httpServer(s);
await new Promise(done=>server.listen(0,"127.0.0.1",done));
const browser=await chromium.launch(existsSync(chromium.executablePath())
  ? {headless:true} : {headless:true,channel:"chrome"});
const page=await browser.newPage({viewport:{width:1500,height:1060}});
const errors=[];
page.on("pageerror",err=>errors.push(err.message));
const base="http://127.0.0.1:"+server.address().port;
const out=join(process.cwd(),"test-results/schema113/demand-status-duplicate");
mkdirSync(out,{recursive:true});
const editor=page.getByRole("region",{name:"修订需求",exact:true});
const review=page.getByRole("region",{name:"疑似重复需求核对",exact:true});
try {
  await page.goto(base+"/#/demands");
  await page.getByLabel("用户名",{exact:true}).fill("admin");
  await page.getByLabel("密码",{exact:true}).fill("Schema113-test-password");
  await page.getByRole("button",{name:"登录",exact:true}).click();
  await page.getByRole("tab",{name:"已退回",exact:true}).click();
  await page.getByRole("row").filter({hasText:primary.demand_no}).waitFor({state:"hidden"});
  await page.getByRole("row").filter({hasText:returned.demand_no}).waitFor();
  assert.equal(await page.getByRole("tab",{name:"已退回",exact:true}).getAttribute("aria-selected"),"true");
  assert.equal(await page.getByRole("button",{name:"筛选需求状态"}).count(),0);
  assert.equal(await page.getByRole("row").filter({hasText:primary.demand_no}).count(),0,
    "returned tab must exclude pending demand");
  await page.getByRole("tab",{name:"待确认",exact:true}).click();
  await page.getByRole("row").filter({hasText:returned.demand_no}).waitFor({state:"hidden"});
  await page.getByRole("row").filter({hasText:primary.demand_no}).waitFor();
  assert.equal(await page.getByRole("row").filter({hasText:returned.demand_no}).count(),0,
    "pending tab must exclude returned demand");
  await page.waitForTimeout(420); // capture after the tab-ink animation has settled
  await page.screenshot({path:join(out,"five-state-tabs.png"),fullPage:true});

  await page.getByRole("row").filter({hasText:primary.demand_no})
    .locator(".cell-link:visible").first().click();
  const detail=page.locator(".business-detail-dialog:visible");
  await detail.getByText(primary.demand_no).waitFor();
  await detail.getByRole("button",{name:"修订需求",exact:true}).click();
  await editor.getByLabel("问题描述",{exact:true}).fill("保留现场修改并核对重合需求");
  await editor.getByRole("tab",{name:"作业位置与工作量"}).click();
  const inline=editor.locator(".quantity-cell .quantity-inline:visible").first();
  await inline.waitFor();
  for (const width of [1500,1280,960,760]) {
    await page.setViewportSize({width,height:1060});
    const bounds=await inline.evaluate(element=>{
    const input=element.querySelector(".el-input__wrapper")?.getBoundingClientRect();
    const unit=element.querySelector(".quantity-unit")?.getBoundingClientRect();
    return {input:input && [input.top,input.bottom,input.right],unit:unit && [unit.top,unit.bottom,unit.left], overflow:element.scrollWidth>element.clientWidth+1};
  });
  assert.ok(bounds.input && bounds.unit);
  assert.ok(Math.abs((bounds.input[0]+bounds.input[1])/2-(bounds.unit[0]+bounds.unit[1])/2)<10,
    "quantity input and its unit must be on the same horizontal line");
    assert.ok(bounds.unit[2] >= bounds.input[2] - 2, "unit must follow input");
    assert.equal(bounds.overflow,false,"long units must fit their quantity cell");
  }
  await page.setViewportSize({width:1500,height:1060});
  await editor.getByRole("button",{name:"保存需求版本",exact:true}).click();
  await review.waitFor();
  await review.getByText(other.demand_no,{exact:false}).first().waitFor();
  await review.getByText("第二次发现的独立故障",{exact:false}).waitFor();
  await review.getByText("位置重合",{exact:true}).first().waitFor();
  assert.equal(await review.getByRole("button",{name:"确认独立并保存"}).isDisabled(),true);
  await page.waitForTimeout(470); // Allow the long comparison layout to settle
  await page.screenshot({path:join(out,"duplicate-side-by-side.png"),fullPage:true});
  await review.getByRole("button",{name:"返回继续修改",exact:true}).click();
  await review.waitFor({state:"hidden"});
  assert.equal(await editor.getByLabel("问题描述",{exact:true}).inputValue(),
    "保留现场修改并核对重合需求");
  await editor.getByRole("button",{name:"暂存并返回",exact:true}).click();
  await editor.waitFor({state:"hidden"});
  assert.equal(s.demands.get(primary.id).current_version,1,"parking is not a formal save");
  await detail.getByRole("button",{name:"修订需求",exact:true}).click();
  await editor.getByRole("button",{name:"恢复草稿",exact:true}).click();
  await editor.getByLabel("问题描述",{exact:true}).waitFor();
  assert.equal(await editor.getByLabel("问题描述",{exact:true}).inputValue(),
    "保留现场修改并核对重合需求");
  await editor.getByRole("button",{name:"保存需求版本",exact:true}).click();
  await review.waitFor();
  await review.getByLabel("独立保留依据（必填）").fill("不同故障原因与现场发现批次，各自独立实施");
  await review.locator(".duplicate-decision .el-checkbox").click();
  assert.equal(await review.getByRole("button",{name:"确认独立并保存"}).isEnabled(),true);
  s.sources.revise(user,other.sources[0].id,{description:"对比后被其他人员修订的来源"});
  await review.getByRole("button",{name:"确认独立并保存"}).click();
  await review.getByText("对比后被其他人员修订的来源",{exact:false}).waitFor();
  assert.equal(s.demands.get(primary.id).current_version,1,"stale review must not save a version");
  assert.equal(await review.getByText("保留现场修改并核对重合需求",{exact:false}).count(),1);
  await review.getByLabel("独立保留依据（必填）").fill("不同故障原因与现场发现批次，重新核对后各自独立实施");
  await review.locator(".duplicate-decision .el-checkbox").click();
  await review.getByRole("button",{name:"确认独立并保存"}).click();
  await editor.waitFor({state:"hidden"});
  assert.equal(s.demands.get(primary.id).current_version,2);
  const audits=inspect(s).list("demand_duplicate_reviews");
  assert.ok(audits.some(item => item.matched_demand_id===other.id &&
    item.new_demand_id===primary.id && item.reason.includes("不同故障原因")));
  assert.deepEqual(errors,[]);
  console.log("DEMAND_STATUS_DUPLICATE_BROWSER_OK visible status filters, inline units, direct comparison, park & recover, formal revision");
} catch(err) {
  console.error("DEMAND_STATUS_DUPLICATE_BROWSER_FAILURE",errors);
  await page.screenshot({path:join(out,"failure.png"),fullPage:true});
  throw err;
} finally {
  await browser.close();
  await new Promise(done=>server.close(done));
  for(const fn of cleanup.reverse())await fn();
}

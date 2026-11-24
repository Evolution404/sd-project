import assert from "node:assert/strict";
import {fixture} from "../helpers.mjs";
import {httpServer} from "../../dist/server/platform/http/server.js";
import {chromium} from "playwright";
import {resolve} from "node:path";
import { mkdirSync } from "node:fs";
const clean=[];
const f=fixture({after:x=>clean.push(x)});
const pricedAttribute=f.s.standards.saveOperation(f.user,{
  name:f.operation.name,expected_version:f.operation.version,
  attributes_schema_json:[{key:"work_ratio",label:"施工系数",scope:"demand",source:"manual",type:"decimal",
    precision:2,requirement:"optional",pricing:true,enabled:true,sort_order:1,hint:""}],
},f.operation.id);
const srv=httpServer(f.s,{staticDirectory:resolve(process.env.SD_BROWSER_STATIC_DIRECTORY || "dist/web")});
await new Promise(ok=>srv.listen(0,"127.0.0.1",ok));
const base="http://127.0.0.1:"+srv.address().port;
let browser,page;
try{
  browser=await chromium.launch({headless:true,channel:"chrome"});
  page=await browser.newPage({viewport:{width:1920,height:1080}});
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  await page.goto(base+"/#/login");
  await page.getByPlaceholder("用户名").fill("admin");
  await page.getByPlaceholder("密码").fill("Schema113-test-password");
  await page.getByRole("button",{name:"登录",exact:true}).click();
  await page.waitForURL(url=>url.hash.startsWith("#/dashboard"));
  await page.goto(base+"/#/standards/pricing");
  await page.getByText("每塔基费及套费",{exact:true}).first().waitFor({timeout:12000});
  const row=page.getByRole("row").filter({hasText:"每塔基费及套费"});
  await row.getByRole("button",{name:"修订"}).click();
  let dialog=page.getByRole("dialog",{name:"修订参考价格规则"});
  await dialog.getByText("操作版本：V1",{exact:true}).waitFor();
  await dialog.getByRole("tab",{name:"计价方式"}).click();
  await dialog.getByRole("textbox",{name:"单位费（元）"}).fill("33.21");
  await dialog.getByRole("textbox",{name:"试算数量"}).fill("3");
  await dialog.getByRole("button",{name:"校验并试算"}).click();
  await dialog.getByText("试算金额 ¥199.63",{exact:true}).waitFor();
  await dialog.getByRole("button",{name:"保存正式规则"}).click();
  await page.getByText("¥33.21",{exact:true}).first().waitFor({timeout:14000});
  const adopted=f.s.catalog.get("prices",f.price.id);
  assert.equal(adopted.version_no,2);
  assert.equal(adopted.unit_price_fen,3321);
  assert.equal(adopted.pricing_mode,"base_plus_unit");
  assert.equal(adopted.operation_id,f.operation.id);
  assert.equal(adopted.operation_version,1);
  await row.getByRole("button",{name:"更多操作"}).click();
  await page.getByRole("menuitem",{name:"历史"}).click();
  await page.getByText("V1",{exact:true}).first().waitFor({timeout:12000});
  await page.getByText("V2",{exact:true}).first().waitFor({timeout:12000});
  await page.locator(".el-drawer:visible .el-drawer__close-btn").click();
  async function choose(label, option) {
    const control=dialog.locator(".el-form-item").filter({has:page.getByText(label,{exact:true})}).locator(".el-select");
    await control.click();
    const list=await control.getByRole("combobox").getAttribute("aria-controls");
    assert.ok(list);
    await page.locator("[id='"+list+"']").getByRole("option",{name:option,exact:true}).click();
  }
  const input=(name,value)=>dialog.getByRole("textbox",{name}).fill(value);
  for (const [mode,label,total] of [
    ["fixed","固定费用","12.34"],["per_unit","按单位计价","15.00"],["quantity_bracket","整批阶梯","7.00"],
    ["progressive_bracket","累进阶梯","9.00"],["group","按组计价","18.00"],["rate","费率模型","19.00"],
    ["composite","复合计价","7.00"],
  ]) {
    await page.getByRole("button",{name:"新增参考价格",exact:true}).click();
    dialog=page.getByRole("dialog",{name:"新增参考价格规则"});
    await input("规则名称","新版规则验收 "+label);
    await choose("操作类型",f.operation.name);
    await dialog.getByText("操作版本：V2",{exact:true}).waitFor();
    await input("价格来源","现场工料备案");
    await input("计价依据","批准来源范围及测算复核");
    for(const name of ["价格日期","生效日期"]) {
      const date=dialog.getByLabel(name);
      await date.fill("2026-11-20");
      await date.press("Enter");
    }
    if (mode === "fixed") {
      await dialog.getByRole("tab",{name:"适用条件"}).click();
      await dialog.getByText("限制施工系数",{exact:true}).click();
      await input("最小值","1.25");
      await input("最大值","2.50");
    }
    await dialog.getByRole("tab",{name:"计价方式"}).click();
    await choose("计价模型",label);
    if (mode === "fixed") await input("固定金额（元）","12.34");
    if (mode === "per_unit") await input("单位费（元）","5.00");
    if (mode === "quantity_bracket") {
      await choose("计价作用域","每批作业");
      await dialog.getByRole("button",{name:"添加数量档"}).click();
      await input("起始数量","1");
      await input("本档基础费（元）","1");
      await input("本档单价（元）","2");
    }
    if (mode === "progressive_bracket") {
      await dialog.getByRole("button",{name:"添加累进档"}).click();
      await input("本档单价（元）","3");
    }
    if (mode === "group") {
      await input("每组容量","2");
      await input("每组金额（元）","9");
    }
    if (mode === "rate") {
      await choose("计价作用域","每项目");
      await dialog.getByRole("spinbutton",{name:"费率（万分比）"}).fill("950");
      await input("试算人工费用（元）","200");
    }
    if (mode === "composite") {
      await dialog.getByRole("button",{name:"增加费用组成"}).click();
      await input("费用覆盖名称","专用人工费");
      await choose("费用模型","固定费用");
      await input("固定金额（元）","7");
    }
    await input("试算数量","3");
    await dialog.getByRole("button",{name:"校验并试算"}).click();
    await dialog.getByText("试算金额 ¥"+total,{exact:true}).waitFor();
    if (mode === "composite") {
      mkdirSync("test-results/youlai-y4",{recursive:true});
      await page.screenshot({path:"test-results/youlai-y4/pricing-composite-1920.png"});
    }
    await dialog.getByRole("button",{name:"保存正式规则"}).click();
    await dialog.waitFor({state:"hidden"});
    const rule=f.s.catalog.list("prices").find(item=>item.title==="新版规则验收 "+label);
    assert.ok(rule);
    assert.equal(rule.pricing_mode,mode);
    assert.equal(rule.operation_version,pricedAttribute.version);
    assert.equal(rule.unit_version,pricedAttribute.default_unit_version);
    if(mode==="fixed")assert.deepEqual(JSON.parse(rule.additional_conditions_json),{work_ratio:{op:"range",min:"1.25",max:"2.50"}});
    if(mode==="quantity_bracket")assert.equal(rule.pricing_scope,"work_batch");
    if(mode==="rate")assert.equal(rule.pricing_scope,"project");
  }
  assert.deepEqual(errors,[]);
  console.log("YOULAI_Y4_PRICING_OK eight formula models, scopes, applicability, persisted formal versions and server preview");
}catch(cause){
  mkdirSync("test-results/youlai-y4",{recursive:true});
  await page?.screenshot({path:"test-results/youlai-y4/pricing-failure.png"}).catch(()=>{});
  throw cause;
}finally{
  await browser?.close();
  await new Promise(ok=>srv.close(ok));
  for(const task of clean.reverse())await task();
}

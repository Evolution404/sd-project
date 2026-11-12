import assert from "node:assert/strict";
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fixture } from "../helpers.mjs";
import { selectFormChoice } from "./field-helper.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

const cleanup = [];
const { s,save,unit,operation:physicalOperation } =
  fixture({ after: fn=>cleanup.push(fn) });
const v=save("voltages",{name:"110kV"});
const lineA=save("lines",{name:"列模式甲线",voltage_level_id:v.id});
const lineB=save("lines",{name:"列模式乙线",voltage_level_id:v.id});
const shared=save("physical",{
  asset_no:"PHY-SHARED-01", tower_type:"angle", tower_nature:"tension",
});
const towers=new Map();
for(const number of ["1","02","2","3","10","11","#2","#10","A2","A10"]){
  const row=save("towers",{line_id:lineA.id,tower_no:number,
    ...(number==="2" ? {physical_mode:"shared",physical_tower_id:shared.id} : {})});
  towers.set(number,row);
}
save("towers",{line_id:lineB.id,tower_no:"2A",physical_mode:"shared",
  physical_tower_id:shared.id});
save("spans",{line_id:lineA.id,start_tower_id:towers.get("2").id,
  end_tower_id:towers.get("3").id,transmission_center_length_mm:285000,status:"active"});
save("spans",{line_id:lineA.id,start_tower_id:towers.get("10").id,
  end_tower_id:towers.get("11").id,transmission_center_length_mm:330000,status:"active"});
const lineObject=save("objects",{name:"线路对象测试",object_position:"corridor",attribution_unit:"logical_tower"});
const lineOperation=save("operations",{name:"位置模式与排序测试",
  work_object_id:lineObject.id,default_unit_id:unit.id,
  completion_standard:"位置清单合法"});

const server=httpServer(s);
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const browser=await chromium.launch(existsSync(chromium.executablePath()) ?
  {headless:true}:{headless:true,channel:"chrome"});
const context=await browser.newContext({viewport:{width:1440,height:970}});
const page=await context.newPage(), errors=[], writes=[], catalogCalls=[];
page.on("pageerror",error=>errors.push(error.message));
page.on("request",request=>{
  const url=request.url();
  if(url.includes("/api/catalog/") && request.method()==="GET")
    catalogCalls.push(url);
  if(["POST","PATCH","PUT","DELETE"].includes(request.method()) &&
      url.includes("/api/")&&!url.endsWith("/api/login"))
    writes.push(request.method()+" "+url);
});
const base="http://127.0.0.1:"+server.address().port;
const output=join(process.cwd(),"test-results/dux/location-schema-sort");
mkdirSync(output,{recursive:true});
const editor=page.getByRole("dialog",{name:"新增专业需求",exact:true});
const picker=page.getByRole("dialog",{name:"添加作业位置",exact:true});
const rows=()=>picker.locator(".el-table__body-wrapper tr");
const headers=()=>picker.locator(".el-table__header-wrapper th");
const count=async()=>rows().count();
async function begin(name) {
  await page.goto(base+"/#/demands");
  // A new independent UI journey must not inherit the previous modal stack.
  await page.reload();
  // A previous deliberately unsaved demand belongs to the preceding test leg.
  await page.evaluate(() => sessionStorage.removeItem("sd-demand-draft:new"));
  if(await page.getByLabel("用户名",{exact:true}).isVisible().catch(()=>false)){
    await page.getByLabel("用户名",{exact:true}).fill("admin");
    await page.getByLabel("密码",{exact:true}).fill("Schema113-test-password");
    await page.getByRole("button",{name:"登录",exact:true}).click();
  }
  await page.getByRole("button",{name:"新增需求",exact:true}).click();
  await selectFormChoice(page,"操作类型",name,editor);
  await editor.getByRole("button",{name:"添加作业位置",exact:true}).click();
  await picker.waitFor();
}
async function selectLine(label){
  await picker.locator(".picker-filters .el-select").first().click();
  await page.getByRole("option",{name:new RegExp(label)}).last().click();
  await rows().first().waitFor();
}
async function getHeaders(){
  return (await headers().allInnerTexts()).map(x=>x.replace(/\s+/g,"").trim()).filter(Boolean);
}
async function expectHeader(name){
  assert.ok((await getHeaders()).some(x=>x.includes(name)),
    "Expected column "+name+": "+(await getHeaders()).join(","));
}
async function noHeader(name){
  assert.ok(!(await getHeaders()).some(x=>x.includes(name)),
    "Forbidden column "+name+": "+(await getHeaders()).join(","));
}
async function awaitSort(key, direction, headerName) {
  const header=headers().filter({hasText:headerName}).first();
  for (let attempt = 0; attempt < 3; attempt++) {
    const response=page.waitForResponse(r=>{
      if(!r.url().includes("/api/catalog/") || r.request().method()!=="GET")
        return false;
      const p=new URL(r.url()).searchParams;
      return p.get("sort")===key;
    },{timeout:10000});
    await header.locator(direction === "asc" ? ".sort-caret.ascending" : ".sort-caret.descending").click();
    const next=new URL((await response).url()).searchParams;
    if(next.get("direction")===direction){
      await rows().first().waitFor();
      return;
    }
  }
  throw Error("The header did not produce "+key+" "+direction);
}

try {
  await begin(physicalOperation.name);
  await expectHeader("资产编号");
  await expectHeader("关联线路");
  await expectHeader("关联杆号");
  await expectHeader("关联回路数");
  await noHeader("杆号或档距");
  await noHeader("作业设备");
  await noHeader("电压等级");
  const relatedHeader=headers().filter({hasText:"关联杆号"}).first();
  assert.equal(await relatedHeader.locator(".caret-wrapper").count(),1,
    "Physical linked tower numbers must expose working sorting");
  await expectHeader("杆塔性质");
  await picker.getByText("角钢塔",{exact:true}).first().waitFor();
  await picker.getByText("耐张塔",{exact:true}).first().waitFor();
  await awaitSort("related_towers","asc","关联杆号");
  await selectLine("列模式甲线");
  await picker.getByText("PHY-SHARED-01",{exact:true}).waitFor();
  assert.equal(await picker.getByText("PHY-SHARED-01",{exact:true}).count(),1,
    "Same physical tower cannot appear twice when line filter is active");
  const linkedRow = rows().filter({hasText:"PHY-SHARED-01"}).first();
  const linkedContent=await linkedRow.innerText();
  assert.ok(linkedContent.includes("2") && linkedContent.includes("2A"),
    "The same physical record must show its actual multi-circuit association");
  await picker.getByRole("button",{name:"列设置"}).click();
  const settings=page.getByRole("dialog",{name:"自定义表格列"});
  await settings.waitFor();
  assert.ok(await settings.getByText("资产编号",{exact:true}).count());
  await settings.getByRole("button",{name:"完成",exact:true}).click();
  await page.screenshot({path:join(output,"physical-specific.png"),fullPage:true});
  await picker.getByText("粘贴杆号清单或连续区间",{exact:true}).click();
  await picker.getByPlaceholder("12、13、18-25（按真实台账逐项匹配）").fill("2");
  await picker.getByRole("button",{name:"匹配并选择",exact:true}).click();
  await picker.getByText("已选择 1 处，可切换线路继续选择。",{exact:true}).waitFor();
  const returnedPhysical=await page.evaluate(async()=>(
    [...document.querySelectorAll(".el-table__body-wrapper tr")].length
  ));
  assert.ok(returnedPhysical>0);

  await begin(lineOperation.name);
  await selectLine("列模式甲线");
  await expectHeader("所属线路");
  await expectHeader("电压等级");
  await expectHeader("杆号");
  await noHeader("资产编号");
  await noHeader("作业设备");
  await noHeader("杆号或档距");
  await awaitSort("tower_no","asc","杆号");
  const firstSix=(await rows().allInnerTexts()).slice(0,6)
    .map(x=>x.trim().split(/\n|\t/).map(v=>v.trim()).filter(Boolean));
  const towerIndex=(await getHeaders()).findIndex(x=>x.includes("杆号"));
  assert.ok(towerIndex>=0);
  assert.ok(firstSix[0].join(" ").includes("1"));
  const cells=await rows().all();
  const currentNumbers=[];
  for (const row of cells.slice(0,6)){
    const numbers=await row.locator("td").allInnerTexts();
    currentNumbers.push(numbers[3]?.trim());
  }
  assert.deepEqual(currentNumbers,["1","02","2","3","10","11"]);
  await page.screenshot({path:join(output,"logical-natural-sort.png"),fullPage:true});
  await picker.getByRole("button",{name:"筛选杆号"}).click();
  const filter=page.getByPlaceholder("筛选杆号");
  await filter.fill("A10"); await filter.press("Enter");
  await page.waitForTimeout(160);
  assert.equal(await count(),1);
  assert.ok((await rows().first().innerText()).includes("A10"));
  assert.ok(catalogCalls.some(url=>{
    const p=new URL(url).searchParams;
    return (p.get("filters")||"").includes('"tower_no":"A10"');
  }));
  await picker.getByRole("button",{name:/已筛选.*清除/}).click();
  await page.waitForTimeout(160);
  await picker.locator(".picker-filters .el-select").nth(1).click();
  await page.getByRole("option",{name:"档距",exact:true}).click();
  await expectHeader("档距");
  await expectHeader("中心管辖长度");
  await noHeader("杆号或档距");
  await noHeader("杆号");
  assert.ok((await rows().allInnerTexts()).some(x=>x.includes("2 ~ 3")));
  assert.ok((await rows().allInnerTexts()).some(x=>x.includes("10 ~ 11")));
  await picker.getByRole("button",{name:"列设置"}).click();
  await settings.waitFor();
  await settings.getByText("起点杆号",{exact:true}).click();
  await settings.getByRole("button",{name:"完成",exact:true}).click();
  await expectHeader("起点杆号");
  await awaitSort("start_tower_no","asc","起点杆号");
  await page.screenshot({path:join(output,"span-columns.png"),fullPage:true});
  const spanPref=await page.evaluate(()=>localStorage.getItem("sd-columns:demand:location-picker:span"));
  assert.ok(spanPref && !JSON.parse(spanPref).hidden.includes("start_tower_no"));
  await picker.locator(".picker-filters .el-select").nth(1).click();
  await page.getByRole("option",{name:"逻辑杆塔",exact:true}).click();
  await expectHeader("杆号");
  await noHeader("档距");
  const logicalPref=await page.evaluate(()=>localStorage.getItem("sd-columns:demand:location-picker:logical_tower"));
  assert.notEqual(logicalPref,spanPref,"Per-kind column settings must be isolated");
  assert.deepEqual(errors,[]);
  assert.deepEqual(writes,[],"Sorting/filtering/previewing cannot persist business data");
  console.log("LOCATION_SCHEMA_SORT_BROWSER_OK physical unique, per-entity columns, natural sort, real server filters, spans, independent preferences, zero writes");
} catch(error) {
  console.error("LOCATION_SCHEMA_SORT_BROWSER_FAILURE",error.message,errors,catalogCalls.slice(-10));
  await page.screenshot({path:join(output,"failure.png"),fullPage:true});
  throw error;
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
  for(const action of cleanup.reverse())await action();
}

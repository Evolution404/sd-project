import assert from "node:assert/strict";
import {existsSync,mkdirSync} from "node:fs";
import {resolve,join} from "node:path";
import {chromium} from "playwright";
import {approvedFixture} from "../helpers.mjs";
import {httpServer} from "../../dist/server/platform/http/server.js";
const cleanup=[],f=approvedFixture({after:fn=>cleanup.push(fn)});
const {s,user,framework,project,operation,unit}=f;
let reserve;
for(let i=0;i<320;i++)reserve=s.projects.save(user,{name:"大数据储备"+String(i).padStart(3,"0"),framework_id:framework.id});
const candidateRows=[];
for(let i=0;i<265;i++){
 const tower=f.save("physical",{asset_no:"大数据位置"+i});
 candidateRows.push(s.demands.save(user,{operation_id:operation.id,problem_description:"大数据需求"+String(i).padStart(3,"0"),
  expected_on:"2026-12-31",completion_standard:"安装牢固",sources:[{description:"专项候选验收"}],
  work_locations:[{location_kind:"physical_tower",physical_tower_id:tower.id,quantity_scaled:10000}]}));
}
for(let i=0;i<225;i++)s.materials.save(user,{unit_id:unit.id,name:"大数据物资"+String(i).padStart(3,"0"),model:"MODEL-"+i,status:"active"});
const dir=resolve(process.env.SD_BROWSER_STATIC_DIRECTORY||"dist/web");assert.ok(existsSync(join(dir,"index.html")));
const server=httpServer(s,{staticDirectory:dir});
await new Promise(ok=>server.listen(0,"127.0.0.1",ok));
const origin="http://127.0.0.1:"+server.address().port;
const shots=resolve("test-results/youlai-large-candidates");mkdirSync(shots,{recursive:true});
let browser,page;
try{
 browser=await chromium.launch(existsSync(chromium.executablePath())?{headless:true}:{headless:true,channel:"chrome"});
 page=await browser.newPage({viewport:{ width: 1920, height: 1080 }});
 const errors=[];page.on("pageerror",e=>errors.push(e.message));
 await page.goto(origin+"/#/login");
 await page.getByPlaceholder("用户名").fill("admin");
 await page.getByPlaceholder("密码").fill("Schema113-test-password");
 await page.getByRole("button",{name:"登录",exact:true}).click();
 await page.waitForURL(/#\/dashboard/);
 await page.goto(origin+"/#/business/projects?project="+reserve.id);
 await page.getByRole("button",{name:"关联需求",exact:true}).click();
 const picker=page.getByRole("dialog",{name:"关联完整专业需求"});
 await picker.getByText("共 265 条",{exact:true}).waitFor();
 await picker.locator(".el-table__body-wrapper tbody tr").first().waitFor();
 const first=await picker.locator(".el-table__body-wrapper tbody tr").first().innerText();
 const firstRow=candidateRows.find(row=>first.includes(row.demand_no));
 assert.ok(firstRow);
 await picker.getByRole("row").filter({hasText:firstRow.demand_no}).locator("label.el-checkbox").click();
 const next=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/demands/candidates"&&new URL(r.url()).searchParams.get("page")==="2");
 await picker.locator(".el-pagination .btn-next").click();
 const second=await (await next).json();assert.equal(second.total,265);
 const secondRow=second.items[0];
 assert.equal(typeof secondRow.line_count,"number");
 assert.equal(Object.hasOwn(secondRow,"line_summary"),false);
 assert.equal(Object.hasOwn(secondRow,"line_names_json"),false);
 await picker.getByRole("row").filter({hasText:secondRow.demand_no}).locator("label.el-checkbox").click();
 await picker.getByRole("button",{name:"关联已选完整需求（2）",exact:true}).waitFor();
 await page.screenshot({path:join(shots,"demand-page2-selection.png"),animations:"disabled"});
 await picker.getByRole("button",{name:"关联已选完整需求（2）",exact:true}).click();
 await picker.waitFor({state:"hidden"});
 assert.deepEqual(new Set(s.projects.get(reserve.id).scopes.map(x=>x.demand_id)),new Set([firstRow.id,secondRow.id]));
 await page.goto(origin+"/#/funding/finance");
 await page.getByRole("button",{name:"新增结算草稿",exact:true}).click();
 const projects=page.getByRole("dialog",{name:"选择已有正式立项的子项目"});
 await projects.getByText(project.name,{exact:true}).waitFor();
 assert.equal(await projects.getByRole("button",{name:"选择项目",exact:true}).count(),1);
 await projects.getByText("共 1 条",{exact:true}).waitFor();
 await page.screenshot({path:join(shots,"approved-project-not-truncated.png"),animations:"disabled"});
 await projects.getByRole("button",{name:"取消",exact:true}).click();
 await page.goto(origin+"/#/assets/materials");
 const main=page.locator(".layout-content");
 await main.getByText("共 225 条",{exact:true}).waitFor();
 // Go directly past the original 200-row cap using the native pagination jumper.
 const jumper=main.locator(".el-pagination__jump input");
 await jumper.fill("12");await jumper.press("Enter");
 await main.getByText("大数据物资000",{exact:true}).waitFor();
 await main.getByRole("button",{name:"进入批量编辑",exact:true}).click();
 const {worksheetCanvas}=await import("./youlai-business-worksheet-helpers.mjs");
 const sheet=main.getByRole("region",{name:"物资资料",exact:true});
 await worksheetCanvas(sheet);
 await sheet.getByText(/共 5 行/).waitFor();
 await page.screenshot({path:join(shots,"materials-page12.png"),animations:"disabled"});
 await main.getByRole("button",{name:"返回查看态",exact:true}).click();
 assert.equal(await jumper.inputValue(),"12");
 await main.getByText("大数据物资000",{exact:true}).waitFor();
 assert.deepEqual(errors,[]);
 console.log("YOULAI_LARGE_CANDIDATES_OK 265 demand candidates, cross-page selected atomic link, approved project among 321 projects, batch editing page 12 of 225 materials");
}catch(e){await page?.screenshot({path:join(shots,"failure.png"),animations:"disabled"}).catch(()=>{});throw e}
finally{await browser?.close();await new Promise(ok=>server.close(ok));for(const fn of cleanup.reverse())await fn()}

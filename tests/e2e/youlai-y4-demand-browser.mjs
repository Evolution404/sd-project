import {pickDemandPositions} from "./youlai-business-worksheet-helpers.mjs";
import assert from "node:assert/strict";
import {worksheetCanvas,selectWorksheetCell,typeWorksheetCell} from "./youlai-business-worksheet-helpers.mjs";
import {copySettlementSelection} from "./youlai-settlement-grid-helpers.mjs";
import { existsSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { chromium } from "playwright";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";
import { makeWorkbook } from "../../dist/server/modules/exchange/workbook.js";
import ExcelJS from "exceljs";
import { columnIndex } from "../workbook-helpers.mjs";

const clean=[];
const {s,user,save,operation,demandInput,unit}=fixture({after:fn=>clean.push(fn)});
const expectedMaterial=s.materials.save(user,{name:"预计物资专项",model:"DEMAND-MATERIAL",specification:"标准型",unit_id:unit.id,note:"",status:"active"});
const demand=s.demands.save(user,demandInput);
const addedTower=save("physical",{asset_no:"T18",tower_material:"angle"});
const excelTowers=["T19","T20"].map(asset_no=>save("physical",{asset_no,tower_material:"angle"}));
assert.equal(demand.work_locations.length,3);
const backend=httpServer(s,{staticDirectory:resolve(process.env.SD_BROWSER_STATIC_DIRECTORY || "dist/web")});
await new Promise(ok=>backend.listen(0,"127.0.0.1",ok));
const port=backend.address().port;
const root=process.cwd();
const out=join(root,"test-results","youlai-y4");
mkdirSync(out,{recursive:true});
let browser,page;
try {
  browser=await chromium.launch(existsSync(chromium.executablePath())
    ? {headless:true}:{headless:true,channel:"chrome"});
  const context=await browser.newContext({viewport:{ width: 1920, height: 1080 }});
  page=await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(Crypto.prototype, "randomUUID", { configurable: true, value: undefined });
  });
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  const base=`http://127.0.0.1:${port}/`;
  await page.goto(base+"#/login");
  assert.deepEqual(await page.evaluate(() => [typeof crypto.randomUUID, typeof crypto.getRandomValues]),
    ["undefined", "function"], "plain intranet HTTP exposes getRandomValues without randomUUID");
  await page.getByPlaceholder("用户名").fill("admin");
  await page.getByPlaceholder("密码").fill("Schema113-test-password");
  await page.getByRole("button",{name:"登录",exact:true}).click();
  await page.waitForURL(url=>url.hash.startsWith("#/dashboard"),{timeout:14000});
  await page.goto(base+"#/business/demands");
  await page.getByText("防鸟设施缺失",{exact:true}).first().waitFor({timeout:14000});
  await page.locator(".el-table").first().waitFor();
  await page.screenshot({path:join(out,"demand-list-1920.png"),fullPage:false});
  assert.ok(await page.locator(".el-table").getByText(demand.demand_no).count());
  const demandRow=page.getByRole("row").filter({hasText:"防鸟设施缺失"}).first();
  await demandRow.getByRole("button",{name:"查看详情"}).click();
  const drawer=page.locator(".el-drawer:visible").last();
  await drawer.getByText("作业位置（3）").waitFor();
  assert.equal(await drawer.locator(".el-table__body tr.el-table__row").filter({hasText:/T1[567]/}).count(),3,
    "all three frozen locations must be shown");
  assert.ok(await drawer.getByText("T15").count());
  assert.ok(await drawer.getByText("T16").count());
  assert.ok(await drawer.getByText("T17").count());
  await page.screenshot({path:join(out,"demand-detail-three-locations-1920.png"),fullPage:false});
  const width=1920;
  await drawer.getByRole("tab",{name:"作业位置（3）",exact:true}).waitFor();
  await page.screenshot({path:join(out,`demand-detail-${width}.png`),fullPage:false});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
  assert.ok(overflow<=1,`demand main viewport overflow at ${width}px: ${overflow}px`);
  assert.ok(await drawer.getByRole("tab",{name:"作业位置（3）",exact:true}).isVisible());
  await drawer.getByRole("tab",{name:"正式历史"}).click();
  await drawer.getByText("第 1 次状态事件").waitFor({timeout:10000});
  await drawer.getByRole("tab",{name:"作业位置（3）"}).click();
  await drawer.getByRole("button",{name:"确认专业需求"}).click();
  await page.locator(".el-message-box:visible").getByRole("button",{name:"确定"}).click();
  await page.getByText("正式状态已更新").waitFor({timeout:10000});
  assert.equal(s.demands.get(demand.id).status,"active");
  const current=s.demands.get(demand.id);
  assert.equal(current.work_locations.length,3);
  assert.deepEqual(current.work_locations.map(x=>x.quantity_scaled),[30000,20000,40000]);
  assert.equal(current.work_locations.reduce((sum,x)=>sum+x.quantity_scaled,0),90000);
  await page.screenshot({path:join(out,"demand-confirmed-1920.png"),fullPage:false});
  await drawer.getByRole("button",{name:"关闭",exact:true}).click();
  await page.getByRole("button",{name:"新增专业需求",exact:true}).click();
  await page.waitForURL(/\/demands\/edit/);
  await page.getByRole("combobox",{name:"操作类型"}).fill(operation.name);
  await page.getByRole("option",{name:operation.name,exact:true}).click();
  await page.getByRole("textbox",{name:"问题描述"}).fill("浏览器登记独立的两处防鸟问题");
  await page.getByRole("tab",{name:"作业位置（0）"}).click();
  await pickDemandPositions(page,[["T15",/T15/],["T18",/T18/]]);
  const work=page.locator('[data-grid-key="demands:positions"]');
  const canvas=await worksheetCanvas(work);
  const widths=[180,145,125,170];
  await page.context().grantPermissions(["clipboard-read","clipboard-write"]);
  await typeWorksheetCell(page,canvas,1,2,widths,"2");
  await typeWorksheetCell(page,canvas,2,2,widths,"1");
  await page.getByRole("tab",{name:"预计物资（0）"}).click();
  const {pickNativeRows}=await import("./youlai-business-worksheet-helpers.mjs");
  await pickNativeRows(page,{title:"选择预计物资",placeholder:"搜索名称、规格或型号",queries:[["预计物资专项",/预计物资专项/]],confirm:"添加预计物资"});
  const materialWork=page.locator('[data-grid-key="demands:materials"]');
  const materialCanvas=await worksheetCanvas(materialWork);
  await typeWorksheetCell(page,materialCanvas,1,2,[180,95,125,150],"3");
  await page.getByRole("tab",{name:"作业位置（2）"}).click();
  await page.getByRole("button",{name:"保存专业需求"}).click();
  const duplicate=page.getByRole("dialog",{name:"核对疑似重复需求"});
  await duplicate.getByText("防鸟设施缺失",{exact:true}).waitFor();
  assert.equal(s.demands.search({page:1,page_size:20,q:"浏览器登记",filters:{}}).total,0);
  await duplicate.getByRole("button",{name:"返回编辑"}).click();
  for(const [row,value] of [[1,"2"],[2,"1"]]){
    await selectWorksheetCell(canvas,row,2,widths);
    assert.equal((await copySettlementSelection(page)).trim(),value);
  }
  await page.getByRole("button",{name:"保存专业需求"}).click();
  await duplicate.getByRole("textbox",{name:"保留独立需求的依据"}).fill("现场核对确定是两个独立缺陷");
  await duplicate.getByRole("button",{name:"独立保留并保存"}).click();
  await drawer.getByText("作业位置（2）").waitFor();
  const [created]=s.demands.search({page:1,page_size:20,q:"浏览器登记",filters:{}}).items;
  assert.ok(created);
  assert.deepEqual(s.demands.get(created.id).work_locations.map(row=>row.quantity_scaled),[20000,10000]);
  assert.equal(s.demands.get(created.id).work_locations[1].physical_tower_id,addedTower.id);
  assert.equal(s.demands.get(created.id).materials[0].material_id,expectedMaterial.id);
  assert.equal(s.demands.get(created.id).materials[0].quantity_scaled,30000);
  await drawer.getByRole("button",{name:"确认专业需求"}).click();
  await page.getByRole("dialog",{name:"确认专业需求"}).getByRole("button",{name:"确定"}).click();
  await page.getByText("正式状态已更新").waitFor();
  assert.equal(s.demands.get(created.id).status,"active");
  await drawer.getByRole("button",{name:"正式修订"}).click();
  await page.getByRole("textbox",{name:"问题描述"}).fill("浏览器修订独立需求");
  await page.getByRole("textbox",{name:"修订说明",exact:true}).fill("复核现场台账后补正");
  await page.getByRole("button",{name:"保存专业需求"}).click();
  await duplicate.getByRole("textbox",{name:"保留独立需求的依据"}).fill("重新核对仍为独立缺陷");
  await duplicate.getByRole("button",{name:"独立保留并保存"}).click();
  await drawer.getByText("V2",{exact:true}).waitFor();
  const revised=s.demands.get(created.id);
  assert.equal(revised.current_version,2);
  assert.equal(revised.operation_version,1);
  assert.deepEqual(revised.work_locations.map(row=>row.quantity_scaled),[20000,10000]);
  await drawer.getByRole("button",{name:"关闭",exact:true}).click();
  await page.getByRole("button",{name:"导入 Excel",exact:true}).click();
  const exchange=page.getByRole("dialog",{name:"导入 Excel"});
  const template=page.waitForEvent("download");
  await exchange.getByRole("button",{name:"下载模板",exact:true}).click();
  assert.equal((await template).suggestedFilename(),"需求模板.xlsx");
  async function upload(rows) {
    const buffer=await makeWorkbook("demands",{
      documents:rows.map(entry=>({import_ref:entry.ref,operation_name:operation.name,
        problem_description:entry.problem,completion_standard:"复核安装到位"})),
      work_locations:rows.map(entry=>({import_ref:entry.ref,location_kind:"physical_tower",
        asset_no:entry.asset,quantity_scaled:entry.quantity})),
    });
    await exchange.locator(".el-upload input[type=file]").setInputFiles({
      name:"需求业务预检.xlsx",mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",buffer,
    });
  }
  const legal={ref:"YL-EXCEL-01",problem:"Excel 合法需求",asset:excelTowers[0].asset_no,quantity:10000};
  const invalid={ref:"YL-EXCEL-02",problem:"Excel 待纠错需求",asset:excelTowers[1].asset_no,quantity:15000};
  const beforeExcel=s.demands.list().length;
  await upload([legal,invalid]);
  await exchange.getByText("新增 1 条，修改 0 条，保持 0 条，1 条需处理",{exact:true}).waitFor();
  assert.equal(s.demands.list().length,beforeExcel);
  assert.equal(await exchange.getByRole("button",{name:"保存整批"}).isEnabled(),false);
  const corrections=page.waitForEvent("download");
  await exchange.getByRole("button",{name:"下载待修正的原表"}).click();
  assert.equal((await corrections).suggestedFilename(),"待修正的原表.xlsx");
  await exchange.getByText("有问题时，整批暂不保存",{exact:true}).click();
  await exchange.getByRole("button",{name:"保存可处理单据"}).click();
  await page.getByRole("dialog",{name:"保存可处理单据"}).getByRole("button",{name:"确定"}).click();
  await exchange.getByText(/已处理 1 条/).waitFor();
  assert.equal(s.demands.list().length,beforeExcel+1);
  await upload([{...invalid,quantity:20000}]);
  await exchange.getByText("新增 1 条，修改 0 条，保持 0 条，0 条需处理",{exact:true}).waitFor();
  await exchange.getByText("有问题时，整批暂不保存",{exact:true}).click();
  await exchange.getByRole("button",{name:"保存整批"}).click();
  await exchange.getByText("已处理 1 条，0 项需处理",{exact:true}).waitFor();
  assert.equal(s.demands.list().length,beforeExcel+2);
  const corrected=s.demands.list().find(row=>row.problem_description===invalid.problem);
  assert.equal(corrected.work_locations[0].quantity_scaled,20000);
  await exchange.getByRole("button",{name:"关闭",exact:true}).click();
  const correctedRow = page.getByRole("row").filter({ hasText: invalid.problem });
  await correctedRow.getByRole("cell", { name: invalid.problem, exact: true }).waitFor();
  await correctedRow.locator("label.el-checkbox").click();
  await page.getByRole("button", { name: "导入 Excel", exact: true }).click();
  const exportOne = page.waitForEvent("download");
  await exchange.getByRole("button", { name: "下载勾选记录（1）", exact: true }).click();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(await (await exportOne).path());
  const positions = workbook.getWorksheet("作业位置");
  const quantityColumn = columnIndex(positions, "quantity_scaled");
  assert.ok(quantityColumn > 0);
  const quantity = positions.getRow(2).getCell(quantityColumn);
  const uploadRevision = async value => {
    quantity.value = value;
    await exchange.locator(".el-upload input[type=file]").setInputFiles({
      name: "内网批量修改验收.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    });
  };
  await exchange.getByText("仅修改", { exact: true }).click();
  await uploadRevision("2.5");
  await exchange.getByText(/套只允许整数数量/).first().waitFor();
  assert.equal(await exchange.getByRole("button", { name: "保存整批" }).isDisabled(), true);
  assert.equal(s.demands.get(corrected.id).current_version, 1);
  assert.equal(s.demands.get(corrected.id).quantity_scaled, 20000);
  await uploadRevision("3");
  await exchange.getByText("新增 0 条，修改 1 条，保持 0 条，0 条需处理", { exact: true }).waitFor();
  assert.equal(s.demands.get(corrected.id).current_version, 1);
  await exchange.getByRole("button", { name: "保存整批" }).click();
  await exchange.getByText("已处理 1 条，0 项需处理", { exact: true }).waitFor();
  const lanRevision = s.demands.get(corrected.id);
  assert.equal(lanRevision.current_version, 2);
  assert.equal(lanRevision.quantity_scaled, 30000);
  assert.equal(lanRevision.work_locations[0].physical_tower_id, excelTowers[1].id);
  assert.equal(errors.length,0,errors.join(";"));
  console.log("YOULAI_Y4_DEMAND_OK upstream CrudPage, create/confirm/revise, duplicate review, frozen unit, LAN HTTP Excel preflight and stable identity update");
} catch(error){
  await page?.screenshot({path:join(out,"demand-failure.png"),fullPage:false}).catch(()=>{});
  throw error;
} finally {
  await browser?.close();

  await new Promise(ok=>backend.close(ok));
  for(const fn of clean.reverse())await fn();
}

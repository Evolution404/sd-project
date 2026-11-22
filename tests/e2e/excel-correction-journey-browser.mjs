import { selectNavigation } from "./navigation-helper.mjs";
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { columnIndex } from "../workbook-helpers.mjs";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";
import { makeWorkbook } from "../../dist/server/modules/exchange/workbook.js";

const cleanup=[];
const {s,operation,towers}=fixture({after:action=>cleanup.push(action)});
const server=httpServer(s);
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const browser=await chromium.launch(existsSync(chromium.executablePath())
  ? {headless:true}:{headless:true,channel:"chrome"});
const page=await browser.newPage({viewport:{width:1280,height:920}});
const errors=[];
page.on("pageerror",error=>errors.push(error.message));
const output=join(process.cwd(),"test-results/schema113/excel-correction");
mkdirSync(output,{recursive:true});

async function workbookUpload(documents, locations) {
  const buffer=await makeWorkbook("demands",{
    documents,work_locations:locations,
  });
  await page.locator(".el-dialog:visible .el-upload input[type=file]").setInputFiles({
    name:"专业需求数据交换.xlsx",
    mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });
}
async function waitPreview(dialog,valid,invalid) {
  await dialog.getByText(`新增 ${valid} 条，修改 0 条，${invalid} 条需处理`,{exact:true}).waitFor({timeout:20000});
}
const documents=[
  {import_ref:"E2-JOURNEY-VALID",operation_name:operation.name,
    problem_description:"合法完整工作量",completion_standard:"整套安装完好"},
  {import_ref:"E2-JOURNEY-FIX",operation_name:operation.name,
    problem_description:"需要纠正半套工作量",completion_standard:"整套安装完好"},
];
const locations=[
  {import_ref:documents[0].import_ref,location_kind:"physical_tower",
    asset_no:towers[0].asset_no,quantity_scaled:20000},
  {import_ref:documents[1].import_ref,location_kind:"physical_tower",
    asset_no:towers[1].asset_no,quantity_scaled:15000},
];

try {
  const base="http://127.0.0.1:"+server.address().port;
  await page.goto(base);
  await page.getByLabel("用户名",{exact:true}).fill("admin");
  await page.getByLabel("密码",{exact:true}).fill("Schema113-test-password");
  await page.getByRole("button",{name:"登录",exact:true}).click();
  await page.getByRole("heading",{name:"工作台",exact:true}).waitFor();
  await selectNavigation(page,"专业需求");
  await page.getByRole("heading",{name:"专业需求",exact:true}).waitFor();
  await page.getByRole("button",{name:"导入 Excel",exact:true}).click();
  const dialog=page.getByRole("dialog",{name:"导入 Excel"});
  await dialog.waitFor();
  const templateDownload = page.waitForEvent("download");
  await dialog.getByRole("button", {name:"下载模板"}).click();
  assert.match((await templateDownload).suggestedFilename(),/xlsx$/i);
  assert.equal(await dialog.getByRole("button", { name: "选择 Excel 文件", exact: true }).count(), 1);
  await workbookUpload(documents,locations);
  await waitPreview(dialog,1,1);
  await dialog.getByRole("region", { name: "需要处理" }).getByRole("cell", { name: "作业位置 · 第 3 行" }).waitFor();
  assert.equal(await dialog.getByRole("button", { name: "重新上传", exact: true }).count(), 1);
  assert.equal(s.demands.list().length,0,"Excel preview must not write business facts");
  await dialog.getByText("整数",{exact:false}).first().waitFor();
  const issueDownload=page.waitForEvent("download");
  await dialog.getByRole("button", {name:"下载问题清单"}).click();
  assert.match((await issueDownload).suggestedFilename(),/xlsx$/i);
  await page.screenshot({path:join(output,"01-invalid-preflight.png"),fullPage:true});

  await dialog.getByRole("button",{name:"导入选项"}).click();
  const atomic=dialog.getByRole("checkbox", { name: "有问题时，整批暂不保存" });
  assert.equal(await atomic.isChecked(),true);
  const submit=dialog.getByRole("button",{name:"保存 1 条需求"});
  assert.equal(await submit.isDisabled(),true,"atomic mode cannot write invalid batch");
  await dialog.getByText("有问题时，整批暂不保存", { exact: true }).click();
  assert.equal(await atomic.isChecked(),false);
  await submit.click();
  await dialog.getByText("已处理 1 条",{exact:true}).waitFor();
  assert.equal(s.demands.list().length,1,"only legitimate row should commit");
  const first=s.demands.list().find(x=>x.problem_description==="合法完整工作量");
  assert.ok(first);
  assert.equal(s.demands.get(first.id).quantity_scaled,20000);
  await page.screenshot({path:join(output,"02-partial-commit.png"),fullPage:true});
  const downloadEvent=page.waitForEvent("download");
  await dialog.getByRole("button",{name:"下载导入结果"}).click();
  const file=await downloadEvent;
  assert.match(file.suggestedFilename(),/xlsx$/i);

  const correctedEvent = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "下载待处理记录", exact: true }).click();
  const corrected = new ExcelJS.Workbook();
  await corrected.xlsx.readFile(await (await correctedEvent).path());
  assert.ok(corrected.getWorksheet("导入检查问题"));
  const positions = corrected.getWorksheet("作业位置");
  const quantityColumn = columnIndex(positions, "quantity_scaled");
  assert.equal(positions.getRow(2).getCell(quantityColumn).value, null);
  positions.getRow(3).getCell(quantityColumn).value = "2";
  await page.locator(".el-dialog:visible .el-upload input[type=file]").setInputFiles({
    name:"已修正.xlsx",
    mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(await corrected.xlsx.writeBuffer()),
  });
  await waitPreview(dialog,1,0);
  assert.equal(s.demands.list().length,1,"corrected preview still read-only");
  await dialog.getByRole("button",{name:"保存 1 条需求"}).click();
  await dialog.getByText("已处理 1 条",{exact:true}).waitFor();
  const all=s.demands.list();
  assert.equal(all.length,2);
  const fixed=all.find(x=>x.problem_description==="需要纠正半套工作量");
  assert.ok(fixed);
  assert.equal(s.demands.get(fixed.id).quantity_scaled,20000);
  await page.screenshot({path:join(output,"03-corrected-committed.png"),fullPage:true});
  await dialog.getByRole("button",{name:"完成",exact:true}).click();
  await page.reload();
  await page.getByRole("heading",{name:"专业需求",exact:true}).waitFor();
  assert.equal(s.demands.list().length,2);
  assert.deepEqual(errors,[]);
  console.log("EXCEL_CORRECTION_JOURNEY_OK preview zero writes, invalid integer-unit, atomic protection, partial commit, result workbook, corrected retry, formal persistence");
} finally {
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
  for(const action of cleanup.reverse())await action();
}

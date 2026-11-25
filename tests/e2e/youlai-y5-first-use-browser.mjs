import {pickDemandPositions} from "./youlai-business-worksheet-helpers.mjs";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import { createSystem } from "../../dist/server/bootstrap.js";
import { httpServer } from "../../dist/server/platform/http/server.js";

const staticDirectory = resolve(process.env.SD_BROWSER_STATIC_DIRECTORY || "dist/web");
assert.ok(existsSync(join(staticDirectory, "index.html")), "Build the production frontend before first-use testing");
const dataDirectory = mkdtempSync(join(tmpdir(), "sd113-youlai-first-use-"));
const s = createSystem(dataDirectory);
assert.equal(s.catalog.list("operations").length, 0);
assert.equal(s.catalog.list("units").length, 0);
assert.equal(s.catalog.list("physical").length, 0);
s.auth.initialize("admin", "First-use-browser-password");
const backend = httpServer(s, { staticDirectory });
await new Promise(resolve => backend.listen(0, "127.0.0.1", resolve));
const origin = "http://127.0.0.1:" + backend.address().port;
const output = resolve("test-results/youlai-y5");
mkdirSync(output, { recursive: true });

let browser, page;
try {
  browser = await chromium.launch(existsSync(chromium.executablePath())
    ? { headless: true } : { headless: true, channel: "chrome" });
  page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin + "/#/login");
  await page.getByPlaceholder("用户名").fill("admin");
  await page.getByPlaceholder("密码").fill("First-use-browser-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL(/#\/dashboard/);
  await page.goto(origin + "/#/business/demands/edit");
  const text = "空库首次巡视发现防鸟装置缺失";
  await page.getByRole("textbox", { name: "问题描述" }).fill(text);
  await page.getByRole("button", { name: "保留草稿并配置作业标准" }).click();
  await page.getByText("专业需求草稿已暂存", { exact: true }).waitFor();
  await page.screenshot({ path: join(output, "first-use-saved-demand-1920.png") });

  async function newRecord(button, title = button) {
    await page.getByRole("button", { name: button, exact: true }).click();
    return page.getByRole("dialog", { name: title });
  }
  async function save(dialog, name = "确定") {
    await dialog.getByRole("button", { name, exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
  }
  async function choose(dialog, field, option) {
    const select = dialog.locator(".el-form-item").filter({
      has: page.getByText(field, { exact: true }),
    }).locator(".el-select");
    await select.click();
    const list = await select.getByRole("combobox").getAttribute("aria-controls");
    assert.ok(list);
    await page.locator("[id='" + list + "']").getByRole("option", { name: option, exact: typeof option === "string" }).click();
  }

  await page.getByRole("button", { name: "配置计量单位" }).click();
  const unit = await newRecord("新增计量单位");
  await unit.getByRole("textbox", { name: "计量单位名称" }).fill("套");
  await save(unit);
  assert.equal(s.catalog.list("units")[0].quantity_precision, 0);
  await page.getByRole("button", { name: "配置作业对象" }).click();
  const object = await newRecord("新增作业对象");
  await object.getByRole("textbox", { name: "名称" }).fill("防鸟装置");
  await choose(object, "对象位置", "本体");
  await choose(object, "归属单元", "物理杆塔");
  await save(object);
  await page.getByRole("button", { name: "配置操作类型" }).click();
  await page.getByRole("button", { name: "新增操作类型", exact: true }).click();
  const definition = page.getByRole("region", { name: "新增操作类型", exact: true });
  await definition.getByRole("textbox", { name: "名称" }).fill("安装防鸟装置");
  await choose(definition, "作业对象", "防鸟装置");
  await choose(definition, "固定计量单位", "套");
  await definition.getByRole("tab", { name: "录入模板" }).click();
  await definition.getByRole("textbox", { name: "建议数量" }).fill("2");
  await definition.getByRole("textbox", { name: "验收标准" }).fill("安装牢固，现场复核");
  await save(definition, "保存正式版本");
  assert.equal(s.catalog.list("operations")[0].default_quantity_scaled, 20000);

  await page.getByRole("button", { name: "登记设备" }).click();
  await page.getByRole("tab", { name: "物理杆塔", exact: true }).click();
  const physical = await newRecord("新增物理杆塔");
  await physical.getByRole("textbox", { name: "已有现场铭牌" }).fill("FIRST-T001");
  await save(physical);
  assert.equal(s.catalog.list("physical")[0].asset_no, "FIRST-T001");
  await page.getByRole("button", { name: "配置年度框架" }).click();
  const framework = await newRecord("新增年度框架");
  await framework.getByRole("textbox", { name: "年度框架名称" }).fill("首次录入框架");
  await framework.getByRole("spinbutton", { name: "年度" }).fill("2026");
  await framework.getByRole("textbox", { name: "额度（元）" }).fill("10000.00");
  await save(framework);
  assert.equal(s.funding.list("frameworks")[0].limit_fen, 1000000);

  await page.getByRole("button", { name: "返回需求草稿" }).click();
  const problem = page.getByRole("textbox", { name: "问题描述" });
  await problem.waitFor();
  await page.getByText("已恢复专业需求草稿", { exact: true }).waitFor();
  assert.equal(await problem.inputValue(), text);
  await page.getByRole("combobox", { name: "操作类型" }).fill("安装防鸟装置");
  await page.getByRole("option", { name: "安装防鸟装置", exact: true }).click();
  await page.getByText("第 1 版", { exact: true }).waitFor();
  const acceptance = page.getByRole("textbox", { name: "验收标准" });
  await acceptance.waitFor();
  assert.equal(await acceptance.inputValue(), "安装牢固，现场复核");
  await page.getByRole("tab", { name: "作业位置（0）" }).click();
  await pickDemandPositions(page,[["FIRST-T001",/FIRST-T001/]]);
  await page.getByRole("button", { name: "保存专业需求" }).click();
  const demandDrawer = page.locator(".el-drawer:visible");
  await demandDrawer.getByText("作业位置（1）", { exact: true }).waitFor();
  const [demand] = s.demands.list();
  assert.equal(demand.problem_description, text);
  assert.equal(demand.work_locations[0].quantity_scaled, 20000);
  await demandDrawer.getByRole("tab", { name: "附件", exact: true }).click();
  const evidence = demandDrawer.getByRole("region", { name: "业务附件" });
  const description = Buffer.from("首次巡视记录同行核对");
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    evidence.locator("button").filter({ hasText: "上传附件" }).click(),
  ]);
  await chooser.setFiles({ name: "首次巡视.txt", mimeType: "text/plain", buffer: description });
  const uploaded = evidence.getByRole("link", { name: "首次巡视.txt", exact: true });
  await uploaded.waitFor();
  const [file] = await Promise.all([page.waitForEvent("download"), uploaded.click()]);
  assert.equal(file.suggestedFilename(), "首次巡视.txt");
  assert.deepEqual(readFileSync(await file.path()), description);
  await evidence.getByRole("button", { name: "修订说明" }).click();
  const note = page.getByRole("dialog", { name: "修订附件说明" });
  await note.getByRole("textbox").fill("第二次巡视已复核");
  await note.getByRole("button", { name: "确定" }).click();
  await evidence.getByText("第二次巡视已复核", { exact: true }).waitFor();
  await evidence.getByRole("button", { name: "移除关联" }).click();
  await page.getByRole("dialog", { name: "移除附件关联" }).getByRole("button", { name: "确定" }).click();
  await uploaded.waitFor({ state: "hidden" });
  await evidence.getByText("包括已移除", { exact: true }).click();
  assert.equal(await evidence.getByRole("checkbox", { name: "包括已移除" }).isChecked(), true);
  await evidence.getByText("首次巡视.txt（已移除）", { exact: true }).waitFor();
  const attachments = await page.request.get(origin + "/api/evidence?" + new URLSearchParams({
    owner_kind: "demand_id", owner_id: demand.id, deleted: "true",
  }));
  const [preserved] = await attachments.json();
  assert.equal(preserved.deleted, true);
  assert.equal(preserved.note, "第二次巡视已复核");
  assert.equal(preserved.bytes, description.length);
  await demandDrawer.getByRole("button", { name: "确认专业需求", exact: true }).click();
  await page.getByRole("dialog", { name: "确认专业需求" }).getByRole("button", { name: "确定" }).click();
  await demandDrawer.getByText("待承接", { exact: true }).waitFor();
  await demandDrawer.getByRole("button", { name: "创建子项目并承接", exact: true }).click();
  const projectForm = page.getByRole("dialog", { name: "创建子项目并承接" });
  await projectForm.getByRole("textbox", { name: "项目名称" }).fill("首次承接项目");
  await choose(projectForm, "年度框架", /首次录入框架/);
  await save(projectForm);
  await page.waitForURL(url => url.hash.startsWith("#/business/projects?project="));
  const adopted = s.demands.get(demand.id).binding;
  assert.ok(adopted);
  assert.equal(s.projects.get(adopted.project_id).name, "首次承接项目");
  assert.equal(s.projects.get(adopted.project_id).scopes[0].proposed_quantity_scaled, 20000);
  assert.equal(s.projects.get(adopted.project_id).funding, null);
  await page.locator(".el-drawer:visible").getByText("首次承接项目", { exact: false }).first().waitFor();
  await page.screenshot({ path: join(output, "first-use-adopted-demand-1920.png") });
  assert.deepEqual(errors, []);
  console.log("YOULAI_Y5_FIRST_USE_OK empty database, safe setup handoff, draft restored and initial demand adopted");
} catch (cause) {
  await page?.screenshot({ path: join(output, "first-use-failure.png") }).catch(() => {});
  throw cause;
} finally {
  await browser?.close();
  await new Promise(resolve => backend.close(resolve));
  s.close();
  rmSync(dataDirectory, { recursive: true, force: true });
}

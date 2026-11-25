import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { approvedFixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

const callbacks = [];
const { s, user, project, node } = approvedFixture({ after: done => callbacks.push(done) });
const title = "实际费用附件验收";
const input = { cost_node_id: node.id, title, amount_fen: 25000, occurred_on: "2026-11-20", evidence: "专项核对" };
const cost = s.finance.cost(user, project.id, input);
const server = httpServer(s, { staticDirectory: resolve(process.env.SD_BROWSER_STATIC_DIRECTORY || "dist/web") });
await new Promise(done => server.listen(0, "127.0.0.1", done));
const origin = "http://127.0.0.1:" + server.address().port;
let browser, page;
try {
  browser = await chromium.launch(existsSync(chromium.executablePath()) ? { headless: true } : { headless: true, channel: "chrome" });
  page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, acceptDownloads: true });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin + "/#/login");
  await page.getByPlaceholder("用户名").fill("admin");
  await page.getByPlaceholder("密码").fill("Schema113-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL(/#\/dashboard/);
  const portfolio = origin + "/#/funding/finance";
  await page.goto(portfolio);
  const projectLink = page.getByRole("link", { name: project.name, exact: true });
  await projectLink.waitFor();
  assert.equal(await page.getByRole("tab", { name: "按项目办理", exact: true }).getAttribute("aria-selected"), "true");
  const projectSearch = page.getByPlaceholder("搜索项目名称或编号");
  await projectSearch.fill(project.code);
  await projectSearch.press("Enter");
  await page.waitForURL(url => url.href !== portfolio && url.hash.startsWith("#/funding/finance?"));
  const filteredPortfolio = page.url();
  await projectLink.click();
  await page.getByRole("button", { name: "返回项目财务列表", exact: true }).click();
  await page.waitForURL(url => url.href === filteredPortfolio);
  assert.equal(await projectSearch.inputValue(), project.code);
  await projectLink.click();
  await page.waitForURL(url => url.hash.includes("project=" + project.id));
  await page.getByRole("tab", { name: "费用科目、费用及核对", exact: true }).click();
  const row = page.getByRole("row").filter({ has: page.getByRole("cell", { name: title, exact: true }) });
  const attachments = page.getByRole("dialog", { name: "实际费用版本附件", exact: true });
  async function rowAction(name) {
    await row.waitFor();
    const button = row.getByRole("button", { name, exact: true });
    if (await button.count()) await button.click();
    else {
      await row.getByRole("button", { name: "更多操作", exact: true }).click();
      await page.getByRole("menuitem", { name, exact: true }).click();
    }
  }
  async function close(scope) {
    await scope.locator(".el-drawer__close-btn").click();
    await scope.waitFor({ state: "hidden" });
  }
  async function download(name, content) {
    const received = page.waitForEvent("download");
    await attachments.getByRole("link", { name, exact: true }).click();
    assert.equal(readFileSync(await (await received).path(), "utf8"), content);
  }
  await row.waitFor();
  await rowAction("附件");
  const file = "一期凭据.txt";
  const content = "正式费用版本一的原始凭据";
  await attachments.locator('input[type="file"]').setInputFiles({ name: file, mimeType: "text/plain", buffer: Buffer.from(content) });
  await download(file, content);
  await close(attachments);
  const second = s.finance.cost(user, project.id, { ...input, amount_fen: 30000, expected_version: 1 }, cost.entry_id);
  s.evidence.upload(user, { owner_kind: "cost_version_id", owner_id: second.id,
    filename: "二期凭据.txt", base64: Buffer.from("正式费用版本二的凭据").toString("base64") });
  await page.reload();
  await page.getByRole("tab", { name: "费用科目、费用及核对", exact: true }).click();
  await rowAction("查看历史");
  const history = page.getByRole("dialog", { name: "实际费用历史", exact: true });
  await history.getByRole("row").filter({ has: page.getByRole("cell", { name: "1", exact: true }) })
    .getByRole("button", { name: "附件", exact: true }).click();
  await attachments.getByRole("link", { name: file, exact: true }).waitFor();
  assert.equal(await attachments.getByRole("button", { name: "上传附件" }).count(), 0);
  const frozenLink = s.evidence.list(user, "cost_version_id", cost.id)[0];
  const denied = [
    ["POST", "/api/evidence", { owner_kind: "cost_version_id", owner_id: cost.id, filename: "历史版本更改.txt",
      base64: Buffer.from("禁止写入历史费用").toString("base64") }],
    ["POST", "/api/evidence/" + frozenLink.id, { note: "禁止修订" }],
    ["DELETE", "/api/evidence/" + frozenLink.id, {}],
  ];
  for (const [index, [method, endpoint, data]] of denied.entries()) {
    const response = await page.request.fetch(origin + endpoint,
      { method, data, headers: { "Idempotency-Key": "historical-cost-evidence-" + index } });
    assert.equal(response.status(), 409, await response.text());
  }
  assert.equal(s.evidence.list(user, "cost_version_id", cost.id).length, 1);
  await close(attachments);
  await close(history);
  await rowAction("删除");
  await page.getByRole("dialog", { name: "删除实际费用", exact: true }).getByRole("button", { name: "确定", exact: true }).click();
  await row.waitFor({ state: "hidden" });
  await page.getByText("包含已删除费用", { exact: true }).click();
  const deleted = row.getByRole("cell", { name: "已删除", exact: true });
  await deleted.waitFor();
  assert.equal(await row.getByRole("button", { name: /修订|删除|作废|费用核对/ }).count(), 0);
  const positions = await Promise.all([deleted.boundingBox(), row.getByRole("button", { name: "附件", exact: true }).boundingBox()]);
  assert.ok(positions[0] && positions[1] && positions[0].x + positions[0].width <= positions[1].x);
  await rowAction("附件");
  await history.getByRole("row").filter({ has: page.getByRole("cell", { name: "2", exact: true }) })
    .getByRole("button", { name: "附件", exact: true }).click();
  const archivedLink = attachments.getByRole("link", { name: "二期凭据.txt", exact: true });
  const archiveUrl = await archivedLink.getAttribute("href");
  const archiveResponse = await page.request.get(origin + archiveUrl);
  assert.equal(archiveResponse.status(), 200, await archiveResponse.text());
  assert.equal(await archiveResponse.text(), "正式费用版本二的凭据");
  assert.match(archiveResponse.headers()["content-disposition"], /^attachment;/);
  await download("二期凭据.txt", "正式费用版本二的凭据");
  assert.equal(await attachments.getByRole("button", { name: "上传附件" }).count(), 0);
  const output = resolve("test-results/youlai-y4");
  mkdirSync(output, { recursive: true });
  await page.screenshot({ path: join(output, "cost-evidence-readonly-1920.png"), animations: "disabled" });
  await close(attachments);
  await close(history);
  s.finance.removeNode(user, project.id, node.id, { expected_version: 1 });
  await page.reload();
  await page.getByRole("tab", { name: "费用科目、费用及核对", exact: true }).click();
  await page.getByRole("tab", { name: "费用科目", exact: true }).click();
  const deletedNode = page.getByRole("row").filter({ has: page.getByRole("cell", { name: node.name, exact: true }) });
  const includeDeleted = page.getByRole("checkbox", { name: "包含已删除", exact: true });
  const deletedLabel = page.getByText("包含已删除", { exact: true });
  await deletedLabel.waitFor();
  assert.equal(await includeDeleted.isChecked(), false);
  assert.equal(await deletedNode.count(), 0);
  await deletedLabel.click();
  assert.equal(await includeDeleted.isChecked(), true);
  await deletedNode.getByRole("cell", { name: "已删除", exact: true }).waitFor();
  assert.equal(await deletedNode.getByRole("button", { name: /修订|删除|新增下级/ }).count(), 0);
  await deletedNode.getByRole("button", { name: "查看历史", exact: true }).click();
  const nodeHistory = page.getByRole("dialog", { name: "费用科目历史", exact: true });
  for (const version of ["1", "2"]) {
    await nodeHistory.getByRole("row").filter({ has: page.getByRole("cell", { name: version, exact: true }) })
      .getByRole("cell", { name: node.name, exact: true }).waitFor();
  }
  await page.screenshot({ path: join(output, "cost-category-history-1920.png"), animations: "disabled" });
  await close(nodeHistory);
  const activeNode = s.finance.node(user, project.id, { name: "复验科目" });
  const activeTitle = "跨项目检索验收费用";
  s.finance.cost(user, project.id, { ...input, cost_node_id: activeNode.id, title: activeTitle, amount_fen: 140000 });
  await page.goto(portfolio);
  await page.getByRole("tab", { name: "实际费用", exact: true }).click();
  const crossSearch = page.getByPlaceholder("费用事项或项目编号");
  const crossRow = page.getByRole("row").filter({ has: page.getByRole("cell", { name: activeTitle, exact: true }) });
  assert.match(await crossRow.innerText(), /¥1,?400\.00/);
  await crossSearch.fill(activeTitle);
  await crossSearch.press("Enter");
  await page.waitForURL(url => url.hash.includes("view=costs") && url.hash.includes("_list="));
  const crossUrl = page.url();
  await crossRow.getByRole("button", { name: "查看正式历史", exact: true }).click();
  const crossHistory = page.getByRole("dialog", { name: "财务正式历史", exact: true });
  await crossHistory.getByText(activeTitle, { exact: true }).first().waitFor();
  assert.equal(page.url(), crossUrl);
  await close(crossHistory);
  await page.getByRole("tab", { name: "结算单", exact: true }).click();
  await page.waitForURL(url => url.hash.endsWith("view=settlements"));
  assert.equal(await page.getByPlaceholder("结算编号 / 项目名称 / 项目编号").inputValue(), "");
  await page.goBack();
  await page.waitForURL(url => url.href === crossUrl);
  await crossRow.waitFor();
  assert.equal(await crossSearch.inputValue(), activeTitle);
  await page.reload();
  await crossRow.waitFor();
  assert.equal(await crossSearch.inputValue(), activeTitle);
  await crossSearch.fill("不存在的费用");
  await crossSearch.press("Enter");
  await crossRow.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "重置", exact: true }).click();
  await crossRow.waitFor();
  assert.equal(await crossSearch.inputValue(), "");
  assert.deepEqual(errors, []);
  console.log("YOULAI_COST_EVIDENCE_OK versioned evidence, deleted costs and categories, project-first workflow and cross-project return state");
} catch (error) {
  const output = resolve("test-results/youlai-y4");
  mkdirSync(output, { recursive: true });
  if (page) await page.screenshot({ path: join(output, "cost-evidence-failed-1920.png"), animations: "disabled" });
  throw error;
} finally {
  await browser?.close();
  await new Promise(done => server.shutdown(done));
  for (const callback of callbacks.reverse()) await callback();
}

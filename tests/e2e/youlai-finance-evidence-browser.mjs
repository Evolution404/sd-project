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
let browser;
try {
  browser = await chromium.launch(existsSync(chromium.executablePath()) ? { headless: true } : { headless: true, channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, acceptDownloads: true });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin + "/#/login");
  await page.getByPlaceholder("用户名").fill("admin");
  await page.getByPlaceholder("密码").fill("Schema113-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL(/#\/dashboard/);
  const path = origin + "/#/funding/finance?project=" + project.id + "&work=costs";
  await page.goto(path);
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
  assert.deepEqual(errors, []);
  console.log("YOULAI_COST_EVIDENCE_OK version-specific upload, original bytes, frozen write denial deleted-row evidence and archived category history");
} finally {
  await browser?.close();
  await new Promise(done => server.shutdown(done));
  for (const callback of callbacks.reverse()) await callback();
}

import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { approvedFixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

const cleanup = [];
const { s, user, project, node, scope } = approvedFixture({ after: action => cleanup.push(action) });
for (let index = 0; index < 35; index++) {
  s.finance.cost(user, project.id, { cost_node_id: node.id, title: "按需加载费用" + index,
    amount_fen: 1000 + index, occurred_on: "2026-11-17", evidence: "加载验收凭据" });
  s.finance.saveDraft(user, project.id, {
    items: [{ cost_node_id: node.id, project_scope_id: scope.id, quantity_scaled: 10000,
      amount_fen: 500 + index, evidence: "按需加载结算" }],
    resolutions: [{ project_scope_id: scope.id, resolved_quantity_scaled: 10000, evidence: "加载验收工程量" }],
  });
}
const server = httpServer(s);
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch(existsSync(chromium.executablePath()) ? { headless: true } : { headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const base = "http://127.0.0.1:" + server.address().port;
const out = join(process.cwd(), "test-results/schema113/workspace-loading");
mkdirSync(out, { recursive: true });
const errors = [], requests = [], journeys = [];
page.on("pageerror", error => errors.push(error.message));
page.on("request", request => {
  const url = new URL(request.url());
  if (url.pathname.startsWith("/api/")) requests.push({ method: request.method(), path: url.pathname, search: url.search });
});
const detail = page.locator(".business-detail-dialog:visible");
async function measure(name, action) {
  const start = requests.length, began = Date.now();
  await action();
  journeys.push({ name, businessClicks: 1, elapsedMs: Date.now() - began, requests: requests.slice(start) });
}
try {
  await page.goto(base + "/#/projects?q=" + encodeURIComponent(project.name));
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("Schema113-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: project.name });
  await row.locator(".cell-link:visible").first().waitFor();
  const listUrl = page.url();
  requests.length = 0;
  await measure("项目列表打开详情", async () => {
    const response = page.waitForResponse(response => response.url().includes(`/api/projects/${project.id}/actions`));
    await row.locator(".cell-link:visible").first().click();
    assert.equal((await response).status(), 200);
    await detail.getByRole("heading", { name: project.name, exact: true }).waitFor();
  });
  assert.equal(page.url(), listUrl, "viewing must retain the background list URL");
  assert.ok(requests.some(row => row.path === `/api/projects/${project.id}/summary`));
  assert.ok(!requests.some(row => row.path.startsWith("/api/history/") || /\/(?:costs|settlements|reconciliations|approval-history|history|cost-tree)$/.test(row.path)),
    "overview must defer finance rows and full history");
  await measure("项目详情进入财务", async () => {
    const response = page.waitForResponse(response => response.url().includes(`/api/projects/${project.id}/settlements?`));
    await detail.getByRole("tab", { name: "费用与结算", exact: true }).click();
    await detail.getByRole("button", { name: "打开项目财务工作区", exact: true }).click();
    const pageResult = await (await response).json();
    assert.equal(pageResult.total, 35);
    assert.equal(pageResult.items.length, 30);
    await page.getByRole("tab", { name: "结算单", exact: true }).click();
    await page.getByRole("heading", { name: "独立结算单", exact: true }).waitFor();
  });
  await page.getByRole("tab", { name: "实际费用", exact: true }).click();
  const costsPanel = page.locator(".business-detail-page:visible .panel").filter({ has: page.getByRole("heading", { name: "实际费用", exact: true }) });
  const secondPage = page.waitForResponse(response => response.url().includes(`/api/projects/${project.id}/costs?page=2&`));
  await costsPanel.locator(".el-pagination").getByText("2", { exact: true }).click();
  const secondPageResult = await (await secondPage).json();
  assert.equal(secondPageResult.total, 35);
  assert.equal(secondPageResult.items.length, 5);
  await costsPanel.getByRole("row").filter({ hasText: "按需加载费用" }).first().waitFor();
  await costsPanel.getByRole("heading", { name: "实际费用", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(out, "finance-page-two.png"), fullPage: true });
  await page.getByRole("region", { name: "费用与结算", exact: true }).getByRole("button", { name: "← 返回", exact: true }).click();
  await measure("项目详情打开完整历史", async () => {
    const response = page.waitForResponse(response => response.url().includes(`/api/history/projects/${project.id}?`));
    await detail.getByRole("tab", { name: "历史记录", exact: true }).click();
    assert.equal((await response).status(), 200);
    const history = detail.getByRole("region", { name: "历史记录", exact: true });
    await history.getByRole("navigation", { name: "办理时间线", exact: true }).waitFor();
    assert.equal((await (await response).json()).items.length, 10);
  });
  for (const [kind, label, heading] of [
    ["costs", "真实费用", "真实费用记录"], ["settlements", "结算单", "当前草稿"],
  ]) {
    await page.goto(base + "/#/finance/" + kind);
    await page.getByRole("tab", { name: label, exact: true }).waitFor();
    await page.locator(".cell-link:visible").first().waitFor();
    const route = page.url();
    await measure("跨项目" + label + "打开记录", async () => {
      await page.locator(".cell-link:visible").first().click();
      await detail.getByText(heading, { exact: true }).waitFor();
    });
    assert.equal(page.url(), route);
  }
  assert.deepEqual(errors, []);
  writeFileSync(join(out, "journeys.json"), JSON.stringify({ generatedAt: new Date().toISOString(),
    baseline: "Current UI measurements. Historical click counts were not measured.", journeys, errors }, null, 2));
  console.log("PROJECT_WORKSPACE_LOADING_OK", JSON.stringify({ journeys: journeys.map(({ name, businessClicks }) => ({ name, businessClicks })),
    overviewDefersFinanceAndHistory: true, settlementRowsPerPage: 30, totalSettlements: 35 }));
} catch (error) {
  await page.screenshot({ path: join(out, "failure.png"), fullPage: true });
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.shutdown(resolve));
  for (const action of cleanup.reverse()) await action();
}

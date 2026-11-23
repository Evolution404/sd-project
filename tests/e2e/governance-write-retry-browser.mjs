import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright";
import { approvedFixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";
import { selectFormChoice } from "./field-helper.mjs";

const cleanup = [];
let browser, server;
try {
  const { s, project } = approvedFixture({ after: dispose => cleanup.push(dispose) });
  server = httpServer(s);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch(existsSync(chromium.executablePath()) ? { headless: true } : { headless: true, channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1450, height: 1000 } });
  const keys = [];
  let firstStatus;
  await page.route("**/api/projects/" + project.id + "/costs", async route => {
    if (route.request().method() !== "POST") return route.continue();
    keys.push(route.request().headers()["idempotency-key"]);
    if (keys.length > 1) return route.continue();
    const upstream = await route.fetch();
    firstStatus = upstream.status();
    await route.abort("connectionfailed");
  });
  await page.goto("http://127.0.0.1:" + server.address().port + "/#/projects/" + project.id + "/finance");
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("Schema113-test-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("tab", { name:"实际费用", exact:true }).click();
  await page.getByRole("button", { name: "核定费用", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "核定真实费用" });
  await editor.getByLabel("费用事项", { exact: true }).fill("断线重试费用");
  await selectFormChoice(page, "末级费用科目", "人工费", editor);
  await editor.getByLabel("实际金额（元）", { exact: true }).fill("100");
  await editor.getByLabel("费用凭据", { exact: true }).fill("隔离测试");
  const save = editor.getByRole("button", { name: "保存", exact: true });
  await save.click();
  await page.getByText(/尚未收到保存结果/).waitFor();
  assert.equal(firstStatus, 200);
  await save.click();
  await editor.waitFor({ state: "hidden" });
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
  assert.equal(s.finance.costs(project.id).length, 1);
  assert.equal(s.finance.summary(project.id).actual_cost_fen, 10000);
  console.log("GOVERNANCE_WRITE_RETRY_OK");
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  for (const dispose of cleanup.reverse()) await dispose();
}

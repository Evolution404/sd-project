import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

const cleanup = [];
const { s } = fixture({ after: fn => cleanup.push(fn) });
const server = httpServer(s);
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch(existsSync(chromium.executablePath())
  ? { headless: true } : { headless: true, channel: "chrome" });
const page = await browser.newPage();
let loginRequests = 0;
page.on("request", req => {
  if (req.method() === "POST" && new URL(req.url()).pathname === "/api/login") loginRequests++;
});
try {
  await page.goto("http://127.0.0.1:" + server.address().port);
  await page.getByLabel("用户名", { exact: true }).fill("admin");
  await page.getByLabel("密码", { exact: true }).fill("Schema113-test-password");
  await page.getByLabel("密码", { exact: true }).press("Enter");
  await page.getByRole("heading", { name: "工作台", exact: true }).waitFor();
  assert.equal(loginRequests, 1, "enter submits a single login request");
  await page.getByRole("button", { name: /^账号设置/ }).click();
  await page.getByRole("menuitem", { name: "退出登录", exact: true }).click();
  await page.getByLabel("用户名", { exact: true }).waitFor();
  console.log("AUTH_LOGIN_ENTER_BROWSER_OK single submission and logout");
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
  for (const fn of cleanup.reverse()) await fn();
}

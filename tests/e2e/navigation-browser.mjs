import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { approvedFixture } from "../helpers.mjs";
import { httpServer } from "../../server/http/server.mjs";

const cleanup = [];
const { s, user, save, demand, project } = approvedFixture({ after: action => cleanup.push(action) });
const voltage = save("voltages", { name: "220kV" });
const lines = Array.from({ length: 35 }, (_, i) => save("lines", { name: `路由验收${String(i).padStart(2, '0')}线`, voltage_level_id: voltage.id }));
s.management.saveUser(user, { username: "route-reader", password: "Route-reader-password", role: "viewer", status: "active" });
const server = httpServer(s);
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch(existsSync(chromium.executablePath()) ? { headless: true } : { headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const output = join(process.cwd(), "test-results/schema113/navigation");
mkdirSync(output, { recursive: true });
async function login(name, password) {
  await page.getByLabel("用户名", { exact: true }).fill(name);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.locator('.shell').waitFor();
}
try {
  // Login retains the requested authorized business location.
  await page.goto(`${base}/#/demands/${demand.id}`);
  await login("admin", "Schema113-test-password");
  await page.getByRole("button", { name: "返回需求列表", exact: true }).waitFor();
  await page.reload();
  await page.getByRole("button", { name: "返回需求列表", exact: true }).click();
  await page.getByRole("heading", { name: "专业需求", exact: true }).waitFor();
  await page.goBack();
  await page.getByRole("button", { name: "返回需求列表", exact: true }).waitFor();
  await page.goForward();
  await page.getByRole("heading", { name: "专业需求", exact: true }).waitFor();

  const modules = [
    ["工作台", "/dashboard"], ["年度框架与子项目", "/projects"],
    ["执行协议与资金", "/funding"], ["实际费用与结算", "/finance"],
    ["作业标准与参考价格", "/standards"], ["系统管理", "/system"],
    ["输电设备台账", "/ledger"],
  ];
  for (const [name, path] of modules) {
    await page.getByRole("menuitem", { name, exact: true }).click();
    await page.waitForURL(url => url.hash === '#' + path);
    await page.reload();
    await page.getByRole("heading", { name: name === "执行协议与资金" ? "年度框架、协议与组织" : name, exact: true }).waitFor();
  }
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await page.waitForURL(/page=2/);
  const chosen = page.getByRole('row').filter({ hasText: "路由验收00线" });
  await chosen.getByRole("button", { name: "查看", exact: true }).click();
  await page.getByRole("heading", { name: /路由验收00线/ }).waitFor();
  assert.ok(page.url().includes(lines[0].id));
  await page.reload();
  await page.getByRole("heading", { name: /路由验收00线/ }).waitFor();
  await page.goBack();
  await page.getByRole("heading", { name: "输电设备台账", exact: true }).waitFor();
  assert.equal(await page.locator('.el-pager .is-active').innerText(), '2');
  await page.goForward();
  await page.getByRole("heading", { name: /路由验收00线/ }).waitFor();
  await page.getByRole("button", { name: "返回列表", exact: true }).click();
  const search = page.getByPlaceholder("搜索名称或真实属性");
  await search.fill("路由验收17线");
  await search.press("Enter");
  await page.getByRole('row').filter({ hasText: '路由验收17线' }).getByRole('button', { name: '查看', exact: true }).click();
  await page.getByRole('button', { name: '返回列表', exact: true }).click();
  assert.equal(await search.inputValue(), '路由验收17线');
  assert.equal(await page.locator('.el-pager .is-active').innerText(), '1');
  await page.reload();
  assert.equal(await search.inputValue(), '路由验收17线');

  await page.getByRole('button', { name: '筛选线路名称', exact: true }).click();
  await page.getByPlaceholder('筛选线路名称', { exact: true }).fill('17');
  await page.getByPlaceholder('筛选线路名称', { exact: true }).press('Enter');
  await page.getByRole('heading', { name: '输电设备台账', exact: true }).click();
  await page.getByRole('columnheader', { name: /线路名称/ }).locator('.caret-wrapper').click();
  await page.waitForURL(url => url.hash.includes('sort=name'));
  await page.reload();
  await page.getByRole('row').filter({ hasText: '路由验收17线' }).waitFor();
  assert.match(await page.getByRole('columnheader', { name: /线路名称/ }).getAttribute('class'), /ascending|descending/);
  await page.getByRole('button', { name: '筛选线路名称', exact: true }).click();
  assert.equal(await page.getByPlaceholder('筛选线路名称', { exact: true }).inputValue(), '17');
  await page.getByRole('heading', { name: '输电设备台账', exact: true }).click();

  // Catalog tab and formal history are addressable and survive a refresh.
  await page.getByRole('tab', { name: '电压等级', exact: true }).click();
  await page.getByRole('row').filter({ hasText: '220kV' }).getByRole('button', { name: '更多操作' }).click();
  await page.getByRole('menuitem', { name: '历史', exact: true }).click();
  await page.getByRole('heading', { name: '完整版本与审计历史', exact: true }).waitFor();
  await page.reload();
  await page.getByRole('heading', { name: '完整版本与审计历史', exact: true }).waitFor();
  await page.goBack();
  await page.getByRole('heading', { name: '输电设备台账', exact: true }).waitFor();
  await page.goBack();
  await page.getByRole('tab', { name: '线路', exact: true }).waitFor();
  assert.equal(await search.inputValue(), '路由验收17线');

  await page.goto(`${base}/#/projects/${project.id}?tab=finance`);
  await page.getByRole('heading', { name: '独立结算单', exact: true }).waitFor();
  await page.reload();
  await page.getByRole('heading', { name: '独立结算单', exact: true }).waitFor();
  await page.getByRole('tab', { name: '需求与批准范围', exact: true }).click();
  await page.reload();
  await page.getByRole('heading', { name: '当前关联需求', exact: true }).waitFor();
  await page.screenshot({ path: join(output, 'project-route.png'), fullPage: true });
  await page.goto(`${base}/#/projects/missing-project`);
  await page.getByRole('alert').filter({ hasText: '不存在' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '修订档案', exact: true }).count(), 0);
  await page.goto(`${base}/#/unknown/path`);
  await page.getByText('页面不存在', { exact: true }).waitFor();

  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await page.goto(`${base}/#/ledger/lines/${lines[0].id}`);
  await login('route-reader', 'Route-reader-password');
  await page.getByRole('heading', { name: /路由验收00线/ }).waitFor();
  assert.ok(await page.getByRole('button', { name: '编辑', exact: true }).isDisabled());
  await page.goto(`${base}/#/system/audit`);
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  const response = await page.request.get(`${base}/api/audit`);
  assert.equal(response.status(), 403);
  await page.goto(`${base}/#/projects/${project.id}?tab=finance`);
  await page.getByRole('heading', { name: '独立结算单', exact: true }).waitFor();
  assert.ok(await page.getByRole('button', { name: '新增结算草稿', exact: true }).isDisabled());
  assert.deepEqual(errors, []);
  console.log('NAVIGATION_BROWSER_OK modules, detail deep links, login, refresh, back/forward, list query/page/tab restoration, missing identities and authorization');
} catch (error) {
  await page.screenshot({ path: join(output, 'failure.png'), fullPage: true });
  console.log('FAILURE_URL', page.url(), 'ERRORS', errors, (await page.locator('main').innerText()).slice(0,1600));
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  for (const action of cleanup.reverse()) await action();
}

import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

const cleanup = [];
const { s, user, save, operation } = fixture({ after: action => cleanup.push(action) });
s.management.saveUser(user, {
  username: "demand-reader", password: "Demand-reader-test-2026", role: "viewer", status: "active",
});
function createDemand(name, number) {
  const tower = save("physical", { asset_no: "ACTION-" + number });
  return s.demands.save(user, {
    operation_id: operation.id, problem_description: name, expected_on: "2026-12-31",
    work_locations: [{ location_kind: "physical_tower", physical_tower_id: tower.id, quantity_scaled: 10000 }],
  });
}
function move(row, status, sequence = 1) {
  s.demands.transition(user, row.id, { expected_version: 1, expected_event_seq: sequence, status });
}
const pending = createDemand("操作区待确认验收", 1);
const returned = createDemand("操作区已退回验收", 2);
move(returned, "active");
move(returned, "returned", 2);
const unbound = createDemand("操作区待承接验收", 3);
move(unbound, "active");
const bound = createDemand("操作区已承接验收", 4);
move(bound, "active");
const framework = save("frameworks", {
  name: "操作区专项验收框架", fiscal_year: 2026, limit_fen: 100000,
});
const project = s.projects.save(user, { name: "操作区专项验收项目", framework_id: framework.id });
s.projects.link(user, project.id, { demand_id: bound.id, expected_version: 1 });
const cancelled = createDemand("操作区已取消验收", 5);
move(cancelled, "active");
move(cancelled, "cancelled", 2);
const scenarios = [
  { row: pending, state: "待确认", primary: "确认并待承接", menu: ["取消需求"] },
  { row: returned, state: "已退回", primary: "确认并待承接", menu: ["取消需求"] },
  { row: unbound, state: "待承接", primary: "关联子项目", menu: ["退回修改", "取消需求"] },
  { row: bound, state: "已承接", primary: "进入承接项目", menu: [] },
  { row: cancelled, state: "已取消", primary: null, menu: ["删除需求"] },
];
const server = httpServer(s);
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch(existsSync(chromium.executablePath())
  ? { headless: true } : { headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const base = "http://127.0.0.1:" + server.address().port;
const output = join(process.cwd(), "test-results/schema113/demand-detail-actions");
mkdirSync(output, { recursive: true });
const detail = page.locator(".business-detail-dialog:visible");
async function login(name, password) {
  await page.getByLabel("用户名", { exact: true }).fill(name);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.locator(".shell").waitFor();
}
async function open(row) {
  await page.goto(base + "/#/demands?demand=" + row.id);
  await detail.getByRole("heading", { name: new RegExp(row.problem_description) }).waitFor();
}
try {
  await page.goto(base + "/#/demands");
  await login("admin", "Schema113-test-password");
  for (const [index, scenario] of scenarios.entries()) {
    for (const width of [1500, 960, 760]) {
      await page.setViewportSize({ width, height: 1000 });
      await open(scenario.row);
      await detail.getByText(scenario.state, { exact: true }).first().waitFor();
      const actions = detail.locator(".demand-action-buttons");
      assert.equal(await detail.locator(".demand-technical-reference [data-guide-action='demands.history']").count(), 1);
      assert.equal(await actions.getByRole("button", { name: "参考价试算", exact: true }).count(),
        scenario.state === "已取消" ? 0 : 1);
      assert.equal(await actions.getByRole("button", { name: "修订需求", exact: true }).count(),
        scenario.state === "已取消" ? 0 : 1);
      assert.equal(await actions.locator(".el-button--primary").count(), scenario.primary ? 1 : 0);
      if (scenario.primary)
        assert.equal(await actions.getByRole("button", { name: scenario.primary, exact: true }).count(), 1);
      assert.equal(await actions.getByRole("button", { name: "其他处理", exact: true }).count(),
        scenario.menu.length ? 1 : 0);
      const card = await detail.locator(".demand-next-action").boundingBox();
      assert.ok(card);
      for (const button of await actions.getByRole("button").all()) {
        const rect = await button.boundingBox();
        assert.ok(rect && rect.x >= card.x - 2 && rect.x + rect.width <= card.x + card.width + 2,
          "button must remain in its card: " + scenario.state + ", " + width);
      }
      if (width === 1500) {
        if (scenario.menu.length) {
          await actions.getByRole("button", { name: "其他处理" }).click();
          for (const name of scenario.menu) {
            const item = page.getByRole("menuitem", { name, exact: true });
            await item.waitFor();
            assert.equal(await item.count(), 1);
          }
          await detail.locator(".detail-header").click();
        }
        if (scenario.state === "待承接") {
          await actions.getByRole("button", { name: "参考价试算" }).click();
          const quote = page.getByRole("dialog", { name: "参考价格" });
          await quote.getByRole("button", { name: "重新试算" }).waitFor();
          await quote.getByRole("button", { name: "关闭报价" }).click();
          await detail.getByRole("button", { name: "历史记录" }).click();
          const history = page.getByRole("dialog", { name: "需求历史记录" });
          await history.waitFor();
          await history.locator(".el-dialog__headerbtn").click();
        }
      }
      if (width === 760) await page.screenshot({
        path: join(output, String(index + 1) + "-" + scenario.state + "-760.png"),
      });
    }
  }
  await page.setViewportSize({ width: 1500, height: 1000 });
  await open(pending);
  await detail.getByRole("button", { name: "确认并待承接" }).click();
  await page.locator(".el-message-box:visible .el-button--primary").click();
  await detail.getByRole("button", { name: "关联子项目" }).waitFor();
  await detail.getByRole("button", { name: "其他处理" }).click();
  await page.getByRole("menuitem", { name: "退回修改" }).waitFor();
  await detail.locator(".detail-header").click();
  await detail.getByRole("button", { name: "关闭详情" }).click();
  await detail.waitFor({ state: "hidden" });

  await page.getByRole("button", { name: /^账号设置/ }).click();
  await page.getByRole("menuitem", { name: "退出登录" }).click();
  await login("demand-reader", "Demand-reader-test-2026");
  await open(unbound);
  assert.equal(await detail.getByRole("button", { name: "关联子项目" }).isDisabled(), true);
  assert.equal(await detail.getByRole("button", { name: "修订需求" }).isDisabled(), true);
  assert.equal(await detail.getByRole("button", { name: "参考价试算" }).isEnabled(), true);
  assert.equal(await detail.getByRole("button", { name: "历史记录" }).isEnabled(), true);
  await detail.getByRole("button", { name: "其他处理" }).click();
  assert.equal(await page.getByRole("menuitem", { name: "退回修改" }).isDisabled(), true);
  assert.equal(await page.getByRole("menuitem", { name: "取消需求" }).isDisabled(), true);
  await open(cancelled);
  assert.equal(await detail.getByRole("button", { name: "其他处理" }).count(), 0);
  assert.deepEqual(errors, []);
  console.log("DEMAND_DETAIL_ACTIONS_BROWSER_OK five states, three widths, quote, history, menu, viewer permissions, live refresh");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  for (const done of cleanup.reverse()) await done();
}

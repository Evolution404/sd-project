import { chromium } from "playwright";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { approvedFixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

const cleanup = [];
const { s, user, save, project, node } = approvedFixture({
  after: (action) => cleanup.push(action),
});
const leaf = s.finance.node(user, project.id, {
  name: "安装人工",
  parent_id: node.id,
});
s.finance.cost(user, project.id, {
  title: "原实际人工费",
  cost_node_id: leaf.id,
  occurred_on: "2026-11-10",
  amount_fen: 12345,
  evidence: "真实测试凭据",
});
const company = save("organizations", { name: "示例公司" });
const department = save("organizations", {
  name: "运检部",
  parent_unit_id: company.id,
});
const center = save("organizations", {
  name: "输电中心",
  parent_unit_id: department.id,
});
const other = save("organizations", { name: "其他公司" });
for (let index = 0; index < 45; index++) {
  s.finance.node(user, project.id, {
    name: "长树科目" + index,
    parent_id: node.id,
  });
  save("organizations", {
    name: "长树单位" + index,
    parent_unit_id: company.id,
  });
}
s.projects.save(
  user,
  {
    ...project,
    managing_unit_id: center.id,
    expected_version: project.profile_version,
  },
  project.id,
);
s.management.saveUser(user, {
  username: "tree-viewer",
  password: "Tree-viewer-password",
  role: "viewer",
  status: "active",
});
const server = httpServer(s);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch(
  existsSync(chromium.executablePath())
    ? { headless: true }
    : { headless: true, channel: "chrome" },
);
const page = await browser.newPage({ viewport: { width: 1500, height: 1050 } });
const errors = [];
let stage = "initialization";
page.setDefaultTimeout(12000);
page.setDefaultNavigationTimeout(15000);
function checkpoint(label) {
  stage = label;
  console.log(`TREE_STAGE ${label} route=${new URL(page.url()).hash} width=${page.viewportSize()?.width}`);
}

page.on("pageerror", (error) => errors.push(error.message));
const output = join(process.cwd(), "test-results/schema113/trees");
mkdirSync(output, { recursive: true });
async function login(name, password) {
  await page.getByLabel("用户名", { exact: true }).fill(name);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.locator(".shell").waitFor();
}
async function pickTree(scope, label, name) {
  const control = scope.getByLabel(label, { exact: true });
  await control.click();
  await control.fill(name);
  const popup = page.locator(
    ".el-select-dropdown.business-tree-select-popper:visible",
  );
  await popup.waitFor({ timeout: 7000 });
  await popup
    .locator(".el-tree-node__content")
    .filter({ has: page.getByText(name, { exact: true }) })
    .last()
    .click();
}
async function selectNode(workspace, name) {
  await workspace
    .locator(".tree-node-label")
    .filter({ hasText: new RegExp("^" + name + "$") })
    .click();
}
async function saveEditor(name) {
  const editor = page.getByRole("dialog", { name, exact: true });
  await editor.getByRole("button", { name: "保存", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
}
try {
  await page.goto(`${base}/#/projects?project=${project.id}`);
  await login("admin", "Schema113-test-password");
  let detail = page.locator(".business-detail-dialog:visible");
  await detail.getByRole("tab", { name: "费用与结算", exact: true }).click();
  await detail.getByRole("button", { name: "打开项目财务工作区", exact: true }).click();
  detail = page.locator(".business-detail-page:visible");
  const workspace = detail.locator(".cost-category-workspace");
  await workspace
    .locator(".tree-node-label")
    .filter({ hasText: /^人工费$/ })
    .waitFor();
  let fullProjectRequests = 0;
  const count = (request) => {
    if (new URL(request.url()).pathname === `/api/projects/${project.id}`)
      fullProjectRequests++;
  };
  page.on("request", count);
  await workspace
    .getByRole("button", { name: "展开全部", exact: true })
    .click();
  await page.waitForFunction(
    () => {
      const tree = document.querySelector(
        ".cost-category-workspace .business-tree .el-tree",
      );
      return tree && tree.scrollHeight > tree.clientHeight;
    },
    undefined,
    { timeout: 7000 },
  );
  assert.equal(
    await workspace
      .locator(".business-tree .el-tree")
      .evaluate((tree) => tree.scrollHeight > tree.clientHeight),
    true,
  );
  const treeSearch = workspace.getByPlaceholder("搜索费用科目");
  await treeSearch.fill("安装人工");
  await selectNode(workspace, "安装人工");
  await treeSearch.clear();
  await workspace
    .locator(".tree-path")
    .getByText("人工费 / 安装人工", { exact: true })
    .waitFor();
  assert.equal(
    await workspace
      .getByRole("button", { name: "新增下级", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(fullProjectRequests, 0);
  page.off("request", count);
  await workspace
    .getByRole("button", { name: "新增科目", exact: true })
    .click();
  const nodeEditor = page.getByRole("dialog", {
    name: "费用科目版本",
    exact: true,
  });
  await nodeEditor.getByLabel("名称", { exact: true }).fill("机械费");
  await saveEditor("费用科目版本");
  await workspace
    .getByRole("button", { name: "新增下级", exact: true })
    .click();
  await nodeEditor.getByText("机械费", { exact: true }).waitFor();
  await nodeEditor.getByLabel("名称", { exact: true }).fill("吊装");
  await saveEditor("费用科目版本");
  await workspace
    .getByRole("button", { name: "编辑版本", exact: true })
    .click();
  assert.equal(await nodeEditor.locator(".el-tree-select").count(), 0);
  await nodeEditor.getByLabel("名称", { exact: true }).fill("取消的名称");
  await nodeEditor.getByRole("button", { name: "取消", exact: true }).click();
  await page
    .getByRole("dialog", { name: "放弃未保存的修改？" })
    .getByRole("button", { name: "放弃修改" })
    .click();
  await nodeEditor.waitFor({ state: "hidden" });
  assert.equal(
    await workspace
      .locator(
        ".el-tree-node.is-current > .el-tree-node__content .tree-node-label",
      )
      .innerText(),
    "吊装",
  );
  await workspace
    .getByRole("button", { name: "编辑版本", exact: true })
    .click();
  await nodeEditor.getByLabel("名称", { exact: true }).fill("吊装新名");
  await saveEditor("费用科目版本");
  await workspace
    .getByRole("button", { name: "删除科目", exact: true })
    .click();
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await workspace
    .locator(".tree-facts")
    .getByText("已删除", { exact: true })
    .waitFor();
  await workspace
    .getByRole("button", { name: "版本与删除历史", exact: true })
    .click();
  const history = page.getByRole("dialog", {
    name: "费用科目版本与删除历史",
    exact: true,
  });
  await history.getByRole("article", { name: "事项详情" }).getByRole("heading", { name: "删除费用科目", exact: true }).waitFor();
  await history.getByRole("button", { name: "关闭详情", exact: true }).click();
  await selectNode(workspace, "人工费");
  await detail.getByRole("button", { name: "核定费用", exact: true }).click();
  const costEditor = page.getByRole("dialog", {
    name: "核定真实费用",
    exact: true,
  });
  await costEditor
    .getByLabel("费用事项", { exact: true })
    .fill("树形选择新增费用");
  await pickTree(costEditor, "末级费用科目", "安装人工");
  await costEditor.getByLabel("实际金额（元）", { exact: true }).fill("200.00");
  await costEditor.getByLabel("费用凭据", { exact: true }).fill("正式测试凭据");
  await saveEditor("核定真实费用");
  await workspace
    .locator(".tree-facts")
    .getByText("¥323.45", { exact: true })
    .waitFor();
  const costsPanel = detail.locator(".panel").filter({
    has: page.getByRole("heading", { name: "实际费用", exact: true }),
  });
  const editedCost = costsPanel
    .getByRole("row")
    .filter({ hasText: "树形选择新增费用" });
  await editedCost.getByRole("button", { name: "更多操作" }).click();
  await page.getByRole("menuitem", { name: "更正", exact: true }).click();
  await costEditor.getByLabel("实际金额（元）", { exact: true }).fill("210.00");
  await saveEditor("核定真实费用");
  await workspace
    .locator(".tree-facts")
    .getByText("¥333.45", { exact: true })
    .waitFor();
  await editedCost.getByRole("button", { name: "更多操作" }).click();
  await page.getByRole("menuitem", { name: "作废费用", exact: true }).click();
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await workspace
    .locator(".tree-facts")
    .getByText("¥123.45", { exact: true })
    .waitFor();
  await workspace
    .getByRole("row")
    .filter({ hasText: "树形选择新增费用" })
    .getByRole("button", { name: "查看费用", exact: true })
    .click();
  const costHistory = page.getByRole("dialog", {
    name: "实际费用与历史",
    exact: true,
  });
  await costHistory.getByRole("button", { name: /核定实际费用/ }).click();
  await costHistory.getByRole("article", { name: "事项详情" }).getByText("¥200.00", { exact: true }).first().waitFor();
  await costHistory
    .getByRole("button", { name: "关闭详情", exact: true })
    .click();
  await costHistory.waitFor({ state: "hidden" });
  await workspace.scrollIntoViewIfNeeded();
  for (const width of [1500, 1100, 760]) {
    await page.setViewportSize({ width, height: 1050 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    await page.waitForTimeout(400); // Let Element Plus close/resize transitions finish before visual capture.
    await page.screenshot({
      path: join(output, `cost-tree-${width}.png`),
      fullPage: true,
    });
  }
  await detail.getByRole("button", { name: "← 返回", exact: true }).click();
  // Restore desktop viewport before exercising tree actions; mobile uses a list/detail switch.
  await page.setViewportSize({ width: 1100, height: 1050 });
  checkpoint("organization-entry");
  await page.goto(base + "/#/dictionaries/organizations");
  const organization = page.locator(".organization-workspace");
  checkpoint("organization-expand");
  await organization
    .getByRole("button", { name: "展开全部", exact: true })
    .click();
  await selectNode(organization, "运检部");
  await organization
    .getByRole("button", { name: "新增直属下级", exact: true })
    .click();
  const orgEditor = page.getByRole("dialog", {
    name: "归口单位资料",
    exact: true,
  });
  // The tree-select may render its chosen label as an input value rather than a text node.
  const adoptedParent = orgEditor.locator(".el-select").first();
  await adoptedParent.waitFor();
  const parentPreview = await adoptedParent.evaluate((el) =>
    [el.textContent, ...Array.from(el.querySelectorAll("input"), (input) => input.value)].join(" "));
  assert.ok(parentPreview.includes("示例公司 / 运检部"), "adopted organization parent must be visible: " + parentPreview);
  await orgEditor.getByLabel("名称", { exact: true }).fill("运行班组");
  await saveEditor("归口单位资料");
  await selectNode(organization, "运检部");
  await organization
    .getByRole("button", { name: "调整上级", exact: true })
    .click();
  const moveEditor = page.getByRole("dialog", {
    name: "调整组织上级",
    exact: true,
  });
  let releasePreview;
  let markPreviewStarted;
  const pendingPreview = new Promise(resolve => { releasePreview = resolve; });
  const previewStarted = new Promise(resolve => { markPreviewStarted = resolve; });
  await page.route("**/organizations/*/move-preview?*", async route => {
    const response = await route.fetch();
    markPreviewStarted();
    await pendingPreview;
    await route.fulfill({ response });
  }, { times: 1 });
  await pickTree(moveEditor, "目标上级单位", "其他公司");
  await moveEditor.getByRole("button", { name: "预览调整", exact: true }).click();
  await previewStarted;
  await pickTree(moveEditor, "目标上级单位", "示例公司");
  const lateResponse = page.waitForResponse(response => response.url().includes("/move-preview"));
  releasePreview();
  await lateResponse;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await moveEditor.getByRole("button", { name: "确认调整", exact: true }).isDisabled(), true);
  assert.equal(await moveEditor.getByText("其他公司 / 运检部", { exact: true }).count(), 0);
  await pickTree(moveEditor, "目标上级单位", "其他公司");
  await moveEditor
    .getByRole("button", { name: "预览调整", exact: true })
    .click();
  await moveEditor.getByText("其他公司 / 运检部", { exact: true }).waitFor();
  await moveEditor
    .getByRole("button", { name: "确认调整", exact: true })
    .click();
  await moveEditor.waitFor({ state: "hidden" });
  assert.equal(
    s.catalog.get("organizations", department.id).parent_unit_id,
    other.id,
  );
  assert.equal(
    await organization
      .locator(
        ".el-tree-node.is-current > .el-tree-node__content .tree-node-label",
      )
      .innerText(),
    "运检部",
  );
  await selectNode(organization, "运行班组");
  await organization
    .getByRole("button", { name: "删除单位", exact: true })
    .click();
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await organization
    .locator(".tree-facts")
    .getByText("已删除", { exact: true })
    .waitFor();
  await selectNode(organization, "输电中心");
  await organization
    .getByRole("button", { name: "编辑资料", exact: true })
    .click();
  await orgEditor.getByLabel("名称", { exact: true }).fill("输电中心新名");
  await saveEditor("归口单位资料");
  await organization
    .getByRole("row")
    .filter({ hasText: project.name })
    .getByText("输电中心", { exact: true })
    .waitFor();
  const organizationUrl = page.url();
  await organization
    .getByRole("button", { name: "查看项目", exact: true })
    .click();
  const linkedProject = page.getByRole("dialog", {
    name: "关联子项目资料",
    exact: true,
  });
  await linkedProject.getByText(project.name, { exact: true }).waitFor();
  assert.equal(page.url(), organizationUrl);
  await linkedProject
    .getByRole("button", { name: "关闭详情", exact: true })
    .click();
  await linkedProject.waitFor({ state: "hidden" });
  await organization
    .getByRole("button", { name: "组织变更历史", exact: true })
    .click();
  const orgHistory = page.getByRole("dialog", {
    name: "组织正式版本与上级历史",
    exact: true,
  });
  await orgHistory.getByRole("button", { name: /建立归口单位/ }).click();
  await orgHistory.getByRole("article", { name: "事项详情" })
    .getByText("示例公司 / 运检部 / 输电中心", { exact: true }).waitFor();
  await orgHistory
    .getByRole("button", { name: "关闭详情", exact: true })
    .click();
  for (const width of [1500, 1100, 760]) {
    await page.setViewportSize({ width, height: 1050 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    await page.waitForTimeout(400); // Let Element Plus close/resize transitions finish before visual capture.
    await page.screenshot({
      path: join(output, `organization-tree-${width}.png`),
      fullPage: true,
    });
  }
  await page.goto(`${base}/#/projects?project=${project.id}`);
  detail = page.locator(".business-detail-dialog:visible");
  await detail.getByRole("button", { name: "编辑档案", exact: true }).click();
  const profileEditor = page.locator(
    ".el-overlay:not(.business-detail-overlay) > .el-overlay-dialog:visible .el-dialog",
  );
  await profileEditor
    .getByText("示例公司 / 运检部 / 输电中心（采用版本）", { exact: true })
    .waitFor();
  await profileEditor
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await detail.getByRole("button", { name: "关闭详情", exact: true }).click();
  await page.setViewportSize({ width: 1100, height: 1050 });
  checkpoint("organization-viewer");
  await page.goto(base + "/#/dictionaries/organizations");
  await page.getByRole("button", { name: /^账号设置/ }).click();
  await page.getByRole("menuitem", { name: "退出登录", exact: true }).click();
  await login("tree-viewer", "Tree-viewer-password");
  await page.locator(".organization-workspace").waitFor();
  assert.equal(
    await page.getByRole("button", { name: "新增一级单位", exact: true }).count(),
    0,
    "只读账号没有新增一级单位权限",
  );
  assert.equal(
    await page
      .getByRole("button", { name: "调整上级", exact: true })
      .isDisabled(),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    "TREES_BROWSER_OK cost roots/children, readonly hierarchy, sums, historical deletion, tree selectors, organization versioned move and adopted historical path, 3 widths and viewer",
  );
} catch (error) {
  console.error(`TREE_FAILURE stage=${stage} route=${page.url()} width=${page.viewportSize()?.width}`);
  await page.screenshot({ path: join(output, "failure.png"), fullPage: true }).catch(() => {});
  const diagnostic = await page.evaluate(() => ({
    title: document.title,
    heading: document.querySelector("main h1")?.textContent,
    workspace: document.querySelector(".organization-workspace")?.textContent?.slice(0, 2000),
    buttons: [...document.querySelectorAll("button")].filter(x => x.getBoundingClientRect().width).map(x => x.textContent?.trim()).slice(0, 70),
    viewport: [innerWidth, innerHeight],
  })).catch(error => ({ diagnosticError: String(error) }));
  writeFileSync(join(output, "failure-diagnostic.json"), JSON.stringify({ stage, url: page.url(), errors, diagnostic }, null, 2));
  console.log("TREE_FAILURE_URL", page.url(), errors);
  console.log(
    await page.locator(".el-select__popper").evaluateAll((nodes) =>
      nodes.map((node) => ({
        class: node.className,
        text: node.textContent,
        visible: getComputedStyle(node).display,
        hidden: node.getAttribute("aria-hidden"),
      })),
    ),
  );
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  for (const action of cleanup.reverse()) await action();
}

import {inspect} from "../inspector.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { approvedFixture, fixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";

test("cost tree rolls up current formal costs once, isolates projects and protects immutable parents", (t) => {
  const { s, user, project, node } = approvedFixture(t);
  const child = s.finance.node(user, project.id, {
    name: "安装人工",
    parent_id: node.id,
  });
  const leaf = s.finance.node(user, project.id, {
    name: "现场安装",
    parent_id: child.id,
  });
  const cost = s.finance.cost(user, project.id, {
    title: "现场实际人工",
    cost_node_id: leaf.id,
    amount_fen: 12345,
    occurred_on: "2026-11-10",
    evidence: "真实费用",
  });
  let nodes = s.finance.costTree(user, project.id);
  assert.equal(nodes.find((row) => row.id === node.id).actual_cost_fen, 12345);
  assert.equal(nodes.find((row) => row.id === child.id).actual_cost_fen, 12345);
  assert.equal(nodes.find((row) => row.id === leaf.id).actual_cost_fen, 12345);
  assert.equal(nodes.find((row) => row.id === leaf.id).selectable, true);
  assert.equal(nodes.find((row) => row.id === leaf.id).can_add_child, false);
  assert.equal(nodes.find((row) => row.id === node.id).selectable, false);
  assert.throws(
    () =>
      s.finance.node(
        user,
        project.id,
        { name: "非法移动", parent_id: null, expected_version: 1 },
        child.id,
      ),
    /层级身份/,
  );
  assert.throws(
    () =>
      s.finance.node(user, project.id, {
        name: "已引用再拆",
        parent_id: leaf.id,
      }),
    /叶子费用项/,
  );
  s.finance.node(
    user,
    project.id,
    { name: "人工费", status: "inactive", expected_version: 1 },
    node.id,
  );
  assert.equal(
    s.finance.costTree(user, project.id).find((row) => row.id === leaf.id)
      .selectable,
    false,
  );
  assert.throws(
    () =>
      s.finance.cost(user, project.id, {
        title: "非法新增",
        cost_node_id: leaf.id,
        amount_fen: 10,
        occurred_on: "2026-11-10",
        evidence: "测试",
      }),
    /上级必须启用/,
  );
  const detail = s.finance.categoryDetail(user, project.id, node.id);
  assert.equal(detail.total, 1);
  assert.equal(detail.items[0].cost_node_id, leaf.id);
  s.finance.cost(
    user,
    project.id,
    {
      ...cost,
      request_key: undefined,
      cost_node_id: leaf.id,
      status: "voided",
      expected_version: 1,
    },
    cost.entry_id,
  );
  nodes = s.finance.costTree(user, project.id);
  assert.equal(nodes.find((row) => row.id === node.id).actual_cost_fen, 0);
  assert.equal(
    s.finance.categoryDetail(user, project.id, node.id).items[0].status,
    "voided",
  );
  s.finance.removeNode(user, project.id, leaf.id, { expected_version: 1 });
  assert.equal(
    s.finance.costTree(user, project.id).find((row) => row.id === leaf.id)
      .deleted,
    true,
  );
  assert.equal(
    s.finance.categoryDetail(user, project.id, leaf.id).versions.length,
    2,
  );
});

test("organization moves are versioned, preview-bound, cycle-safe and preserve project adoption", (t) => {
  const { s, user, save } = fixture(t);
  const root = save("organizations", { name: "公司" });
  const department = save("organizations", {
    name: "生产部",
    parent_unit_id: root.id,
  });
  const center = save("organizations", {
    name: "中心",
    parent_unit_id: department.id,
  });
  const other = save("organizations", { name: "其他公司" });
  const framework = save("frameworks", {
    name: "树形测试",
    fiscal_year: 2026,
    limit_fen: 10000,
  });
  const project = s.projects.save(user, {
    name: "采用旧组织定义的项目",
    framework_id: framework.id,
    managing_unit_id: center.id,
  });
  const adopted = project.managing_unit_version_id;
  assert.throws(
    () => s.organizations.preview(user, root.id, center.id),
    /自身或下级/,
  );
  assert.throws(
    () => s.organizations.preview(user, center.id, center.id),
    /自身或下级/,
  );
  const preview = s.organizations.preview(user, department.id, other.id);
  assert.equal(preview.descendants, 1);
  assert.match(preview.before_path, /公司 \/ 生产部/);
  s.organizations.move(user, department.id, { ...preview, confirm_move: true });
  assert.equal(s.catalog.get("organizations", department.id).version_no, 2);
  assert.equal(
    s.organizations.detail(user, department.id).versions[1].parent_unit_id,
    root.id,
  );
  assert.throws(
    () =>
      s.organizations.move(user, department.id, {
        ...preview,
        confirm_move: true,
      }),
    /没有变化|版本冲突/,
  );
  const toRoot = s.organizations.preview(user, department.id, null);
  s.organizations.move(user, department.id, { ...toRoot, confirm_move: true });
  assert.equal(
    s.catalog.get("organizations", department.id).parent_unit_id,
    null,
  );
  s.catalog.save(
    user,
    "organizations",
    { name: "中心新名称", expected_version: 1 },
    center.id,
  );
  const revised = s.projects.save(
    user,
    {
      ...project,
      name: "项目资料修订",
      expected_version: project.profile_version,
    },
    project.id,
  );
  assert.equal(revised.managing_unit_version_id, adopted);
  assert.equal(revised.managing_unit_name, "中心");
  assert.equal(
    s.organizations.detail(user, center.id).projects[0].adopted_name,
    "中心",
  );
  s.catalog.remove(user, "organizations", other.id, 1);
  assert.throws(
    () => s.organizations.preview(user, center.id, other.id),
    /有效且未删除/,
  );
  assert.equal(inspect(s).integrity().foreignKeys.length, 0);
});

test("tree HTTP endpoints require authentication and keep mutation permissions", async (t) => {
  const { s, user, save, project, node } = approvedFixture(t);
  const unit = save("organizations", { name: "只读组织" });
  s.management.saveUser(user, {
    username: "tree-reader",
    password: "Tree-reader-password",
    role: "viewer",
    status: "active",
  });
  const session = s.auth.login("tree-reader", "Tree-reader-password");
  const server = httpServer(s);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  assert.equal((await fetch(base + "/organizations")).status, 401);
  const headers = {
    Cookie: "sd113=" + session.token,
    "Content-Type": "application/json",
    "Idempotency-Key": "tree-http-test-001",
  };
  const admin = s.auth.login("admin", "Schema113-test-password");
  const adminHeaders = {
    ...headers,
    Cookie: "sd113=" + admin.token,
    "Idempotency-Key": "tree-http-admin-001",
  };
  assert.equal(
    (
      await fetch(
        base + `/organizations/${unit.id}/move-preview?parent_id=${unit.id}`,
        { headers: adminHeaders },
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await fetch(base + `/projects/${project.id}/nodes/${node.id}`, {
        headers: adminHeaders,
        method: "POST",
        body: JSON.stringify({
          name: "非法修改父级",
          parent_id: "forged-parent",
          expected_version: 1,
        }),
      })
    ).status,
    422,
  );
  assert.equal(
    s.finance.costTree(user, project.id).find((item) => item.id === node.id)
      .version_no,
    1,
  );
  assert.equal((await fetch(base + "/organizations", { headers })).status, 200);
  const tree = await fetch(base + `/projects/${project.id}/cost-tree`, {
    headers,
  });
  assert.equal(tree.status, 200);
  assert.ok((await tree.json()).length);
  assert.equal(
    (
      await fetch(base + `/organizations/${unit.id}/parent`, {
        method: "POST",
        headers,
        body: JSON.stringify({ parent_id: null }),
      })
    ).status,
    403,
  );
});

test("cost subtree settlement attribution is independent of budgets and other project trees", (t) => {
  const { s, user, project, node, scope, approval, framework } =
    approvedFixture(t);
  const left = s.finance.node(user, project.id, {
    name: "安装",
    parent_id: node.id,
  });
  const right = s.finance.node(user, project.id, {
    name: "拆除",
    parent_id: node.id,
  });
  s.finance.cost(user, project.id, {
    title: "安装实际费用",
    cost_node_id: left.id,
    amount_fen: 10000,
    occurred_on: "2026-11-10",
    evidence: "测试事实",
  });
  s.finance.cost(user, project.id, {
    title: "拆除实际费用",
    cost_node_id: right.id,
    amount_fen: 20000,
    occurred_on: "2026-11-10",
    evidence: "测试事实",
  });
  const draft = s.finance.saveDraft(user, project.id, {
    approval_version_id: approval.id,
    items: [
      {
        cost_node_id: left.id,
        project_scope_id: scope.id,
        quantity_scaled: 10000,
        amount_fen: 15000,
        evidence: "本期费用",
      },
    ],
    resolutions: [
      {
        project_scope_id: scope.id, location_item_no: 1,
        resolved_quantity_scaled: 10000,
        evidence: "本期解决",
      },
    ],
  });
  s.finance.submit(user, draft.id, {
    expected_version: 0,
    expected_edit_version: 1,
  });
  s.finance.review(user, draft.id, {
    expected_version: 1,
    expected_event_seq: 1,
    action: "approve",
  });
  const other = s.projects.save(user, {
    name: "其他项目",
    framework_id: framework.id,
  });
  const own = s.finance.node(user, other.id, { name: "其他费用" });
  assert.throws(
    () =>
      s.finance.node(user, other.id, {
        name: "跨项目子科目",
        parent_id: node.id,
      }),
    /同一项目|不属于|FOREIGN|跨项目|费用/,
  );
  assert.equal(s.finance.costTree(user, other.id).length, 1);
  assert.equal(s.finance.costTree(user, other.id)[0].id, own.id);
  const tree = s.finance.costTree(user, project.id);
  assert.equal(tree.find((item) => item.id === node.id).actual_cost_fen, 30000);
  assert.equal(tree.find((item) => item.id === node.id).settlement_fen, 15000);
  assert.equal(tree.find((item) => item.id === right.id).settlement_fen, 0);
  assert.equal(
    tree.find((item) => item.id === node.id).approved_budget_fen,
    undefined,
  );
});

test("delete impact is checked again inside transactions and parent histories keep their original names", (t) => {
  const { s, user, project, node, save } = approvedFixture(t);
  const initial = s.finance
    .costTree(user, project.id)
    .find((item) => item.id === node.id);
  s.finance.cost(user, project.id, {
    title: "预览后新增的引用",
    cost_node_id: node.id,
    amount_fen: 500,
    occurred_on: "2026-11-10",
    evidence: "正式依据",
  });
  assert.throws(
    () =>
      s.finance.removeNode(user, project.id, node.id, {
        expected_version: initial.version_no,
        expected_references: initial.reference_count,
        expected_children: 0,
      }),
    /引用已变化/,
  );
  assert.equal(
    s.finance.costTree(user, project.id).find((item) => item.id === node.id)
      .deleted,
    false,
  );
  const parent = save("organizations", { name: "原上级" });
  const child = save("organizations", {
    name: "子单位",
    parent_unit_id: parent.id,
  });
  s.catalog.save(
    user,
    "organizations",
    { name: "上级新名称", expected_version: 1 },
    parent.id,
  );
  const historical = s.organizations.detail(user, child.id).versions[0];
  assert.equal(historical.parent_name, "原上级");
  assert.equal(historical.historical_path, "原上级 / 子单位");
  s.catalog.save(
    user,
    "organizations",
    { name: "子单位修订", expected_version: 1 },
    child.id,
  );
  assert.equal(
    s.organizations.detail(user, child.id).versions[0].historical_path,
    "上级新名称 / 子单位修订",
  );
  assert.throws(
    () =>
      s.organizations.remove(user, parent.id, {
        expected_version: 2,
        expected_children: 0,
      }),
    /直属下级已变化/,
  );
});

test("organization move previews reject changed target definitions and stale source versions", (t) => {
  const { s, user, save } = fixture(t);
  const first = save("organizations", { name: "一级" });
  const second = save("organizations", { name: "另一级" });
  const child = save("organizations", {
    name: "下级",
    parent_unit_id: first.id,
  });
  const before = s.organizations.preview(user, child.id, second.id);
  s.catalog.save(
    user,
    "organizations",
    { name: "目标改名", expected_version: 1 },
    second.id,
  );
  assert.throws(
    () =>
      s.organizations.move(user, child.id, { ...before, confirm_move: true }),
    /重新预览/,
  );
  assert.equal(
    s.catalog.get("organizations", child.id).parent_unit_id,
    first.id,
  );
  const latest = s.organizations.preview(user, child.id, second.id);
  s.organizations.move(user, child.id, { ...latest, confirm_move: true });
  assert.throws(
    () =>
      s.organizations.move(user, child.id, {
        ...latest,
        parent_id: null,
        confirm_move: true,
      }),
    /版本冲突/,
  );
  assert.equal(s.organizations.detail(user, child.id).versions.length, 2);
});

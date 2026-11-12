import { attribute } from "../helpers.mjs";
import {inspect} from "../inspector.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSystem } from "../../dist/server/bootstrap.js";
import { httpServer } from "../../dist/server/platform/http/server.js";

function blank(t) {
  const root = mkdtempSync(join(tmpdir(), "sd113-blank-integration-"));
  const dir = join(root, "data");
  assert.equal(existsSync(join(dir, "schema113.sqlite")), false, "must start with no database");
  let system = createSystem(dir);
  t.after(() => {
    system?.close();
    rmSync(root, { recursive: true, force: true });
  });
  assert.equal(system.catalog.list("units").length, 0);
  assert.equal(system.catalog.list("objects").length, 0);
  assert.equal(system.catalog.list("lines").length, 0);
  assert.equal(system.catalog.list("operations").length, 0);
  assert.equal(system.demands.list().length, 0);
  assert.equal(system.projects.list().length, 0);
  system.auth.initialize("admin", "Blank-Integration-Password");
  const { user } = system.auth.login("admin", "Blank-Integration-Password");
  return { s: system, user, dir, save: (kind, input) => system.catalog.save(user, kind, input),
    reopen() {
      system.close();
      system = createSystem(dir);
      return system;
    } };
}
const versionOf = (row) => row.version_no || row.version || 1;

test("EMPTY DB: dictionary, standards, ledger, funding masters support create/edit/delete + formal history", (t) => {
  const { s, user, save } = blank(t);
  const unit = save("units", { name: "套" });
  const object = save("objects", { name: "防鸟装置", work_target_type: "physical" });
  const voltage = save("voltages", { name: "220kV" });
  const line = save("lines", { name: "空库线路甲", voltage_level_id: voltage.id });
  const physical = save("physical", { asset_no: "EMPTY-T15", tower_type: "angle" });
  const tower1 = save("towers", {
    line_id: line.id, physical_tower_id: physical.id, tower_no: "15",
  });
  const tower2 = save("towers", { line_id: line.id, tower_no: "16" });
  const span = save("spans", {
    line_id: line.id, start_tower_id: tower1.id, end_tower_id: tower2.id,
    transmission_center_length_mm: 123000, status: "draft",
  });
  assert.equal(s.catalog.list("spans")[0].transmission_center_length_mm, 123000);
  const factor = attribute();
  const operation = save("operations", {
    name: "安装防鸟装置", work_object_id: object.id, default_unit_id: unit.id,
    attributes_schema_json: [factor],
  });
  const material = save("materials", { name: "防鸟装置材料", unit_id: unit.id, model: "A1" });
  const priority = save("priorities", { name: "紧急" });
  const category = save("categories", { name: "专业技改" });
  const org = save("organizations", { name: "输电运检中心" });
  const framework = save("frameworks", { name: "2026年度框架", fiscal_year: 2026, limit_fen: 500000 });
  const agreement = save("agreements", { name: "第一批执行协议", framework_id: framework.id, limit_fen: 250000 });
  const price = save("prices", {
    title: "防鸟装置安装普通条件", operation_id: operation.id,
    pricing_mode: "per_unit", unit_price_fen: 3000,
    additional_conditions_json: {
      [factor.key]: { op: "eq", value: "普通" },
    },
    price_source: "空库测试", price_date: "2026-01-01", effective_on: "2026-01-01", basis: "测试",
  });
  assert.equal(s.catalog.operationAttributes(operation.id).items[0].label, "施工难度");
  const pricePreview = s.catalog.previewPrice(user, {
    ...price, existing_id: price.id, sample_quantity_scaled: 25000,
  });
  assert.equal(pricePreview.sample.amount_fen, 7500);
  assert.throws(() => s.catalog.previewPrice(user, {
    ...price, title: "", existing_id: price.id,
  }), /请填写规则名称/);
  const checks = [
    ["prices", price, { title: "防鸟装置安装普通条件修订" }],
    ["operations", operation, { name: "安装防鸟设施" }],
    ["materials", material, { model: "A2" }],
    ["spans", span, { transmission_center_length_mm: 124000 }],
    ["towers", tower1, { display_name: "甲线15号" }],
    ["physical", physical, { tower_type: "suspension" }],
    ["lines", line, { name: "空库线路甲改名" }],
    ["voltages", voltage, { name: "220千伏" }],
    ["agreements", agreement, { name: "第一批执行协议修订" }],
    ["frameworks", framework, { name: "2026年度工程框架" }],
    ["objects", object, { name: "防鸟设施" }],
    ["units", unit, { name: "组" }],
    ["priorities", priority, { name: "优先" }],
    ["categories", category, { name: "运检技改" }],
    ["organizations", org, { name: "输电专业" }],
  ];
  for (const [kind, created, change] of checks) {
    const updated = s.catalog.save(user, kind, {
      ...change, expected_version: versionOf(created),
    }, created.id);
    assert.equal(s.catalog.get(kind, created.id).id, created.id, "stable identity " + kind);
    assert.equal(versionOf(updated), versionOf(created) + 1, "edit version " + kind);
    assert.ok(s.catalog.history(kind, created.id), "history " + kind);
    s.catalog.remove(user, kind, created.id, versionOf(updated));
    assert.ok(!s.catalog.list(kind).some((row) => row.id === created.id),
      "excluded from active list: " + kind);
    assert.equal(s.catalog.get(kind, created.id, true).deleted, true,
      "retained historical identity: " + kind);
  }
  assert.equal(inspect(s).integrity().foreignKeys.length, 0);
  assert.equal(inspect(s).integrity().integrity[0].integrity_check, "ok");
});

test("EMPTY DB: demand -> quote -> project -> agreement -> actual cost -> staged settlements -> delete/restore history", (t) => {
  const { s, user, save, reopen } = blank(t);
  const unit = save("units", { name: "套" });
  const object = save("objects", { name: "防鸟装置", work_target_type: "physical" });
  const factor = attribute();
  const operation = save("operations", { name: "安装防鸟装置",
    work_object_id: object.id, default_unit_id: unit.id,
    completion_standard: "安装牢固",
    attributes_schema_json: [factor] });
  const tower = save("physical", { asset_no: "FRESH-T1", tower_type: "angle" });
  const price = save("prices", { title: "安装参考价", operation_id: operation.id,
    pricing_mode: "base_plus_unit", base_fee_fen: 10000, unit_price_fen: 2000,
    price_source: "合同参照", price_date: "2026-01-01",
    effective_on: "2026-01-01", basis: "正式试算" });
  assert.ok(price.id);
  let demand = s.demands.save(user, {
    operation_id: operation.id, problem_description: "缺少防鸟设施",
    work_locations: [{ location_kind: "physical_tower", physical_tower_id: tower.id,
      quantity_scaled: 20000,
      attributes: { [factor.key]: "普通" } }],
    sources: [{ description: "班组巡视" }],
  });
  const originalDemand = demand.id;
  demand = s.demands.save(user, {
    operation_id: operation.id, expected_version: 1, problem_description: "需安装防鸟装置",
    work_locations: [{ location_kind: "physical_tower", physical_tower_id: tower.id,
      quantity_scaled: 30000,
      attributes: { [factor.key]: "困难" } }],
    sources: demand.sources,
  }, demand.id);
  assert.equal(demand.current_version, 2);
  assert.equal(s.pricing.quote(user, demand.id, {
    expected_version: 2, pricing_date: "2026-11-09",
  }).total_fen, 16000);
  s.demands.transition(user, demand.id, { expected_version: 2,
    expected_event_seq: 1, status: "active" });
  const framework = save("frameworks", { name: "新库年度框架", fiscal_year: 2026,
    limit_fen: 1000000 });
  const agreement = save("agreements", { name: "本次执行协议",
    framework_id: framework.id, limit_fen: 500000 });
  let project = s.projects.save(user, {
    name: "新库防鸟子项目", framework_id: framework.id,
  });
  const tempProject = s.projects.save(user, {
    name: "待删除测试子项目", framework_id: framework.id,
  });
  const tempChanged = s.projects.save(user, {
    name: "已编辑的测试子项目", expected_version: tempProject.profile_version,
  }, tempProject.id);
  assert.equal(tempChanged.name, "已编辑的测试子项目");
  s.projects.remove(user, tempProject.id, {
    expected_version: tempChanged.version,
  });
  assert.ok(!s.projects.list().some((p) => p.id === tempProject.id));
  project = s.projects.link(user, project.id,
    { demand_id: demand.id, expected_version: 2 });
  project = s.projects.fund(user, project.id,
    { agreement_id: agreement.id, expected_version: 0 });
  assert.equal(project.funding.agreement_id, agreement.id);
  project = s.projects.stock(user, project.id, { expected_version: 1 });
  project = s.projects.approvalDraft(user, project.id, {
    expected_version: 2, approved_budget_fen: 20000,
    scopes: [{ project_scope_id: project.scopes[0].id,
      demand_version: 2,
      locations: [{ location_item_no: 1, approved_quantity_scaled: 30000 }] }],
  });
  const approval = project.approvals[0];
  const evaluation = s.pricing.quote(user, demand.id, {
    expected_version: 2,
    approval_scope_version_id: approval.scopes[0].id,
    confirm: true, pricing_date: "2026-11-09",
  });
  assert.equal(evaluation.total_fen, 16000);
  project = s.projects.approve(user, project.id, approval.id,
    { expected_version: 2 });
  let comparison = s.finance.summary(project.id);
  assert.equal(comparison.reference_total_fen, 16000);
  assert.equal(comparison.approved_budget_fen, 20000);
  assert.equal(comparison.reference_budget_difference_fen, -4000);
  const node = s.finance.node(user, project.id, { name: "安装人工费" });
  const nodeEdited = s.finance.node(user, project.id, { name: "安装综合费用",
    expected_version: 1 }, node.id);
  assert.equal(nodeEdited.version_no, 2);
  const cost = s.finance.cost(user, project.id, {
    cost_node_id: node.id, title: "安装费用", occurred_on: "2026-11-09",
    amount_fen: 22000, evidence: "现场确认单",
  });
  const costUpdated = s.finance.cost(user, project.id, {
    cost_node_id: node.id, title: "安装费用最终金额", occurred_on: "2026-11-09",
    amount_fen: 24000, evidence: "正式核定", expected_version: 1,
  }, cost.entry_id);
  assert.equal(costUpdated.version_no, 2);
  let bill = s.finance.saveDraft(user, project.id, {
    number: "EMPTY-SETTLE-01", approval_version_id: approval.id,
    items: [{ cost_node_id: node.id, project_scope_id: project.scopes[0].id,
      quantity_scaled: 30000, amount_fen: 18000, evidence: "结算证明" }],
    resolutions: [{ project_scope_id: project.scopes[0].id,
      resolved_quantity_scaled: 30000, evidence: "施工复核" }],
  });
  bill = s.finance.submit(user, bill.id, {
    expected_version: 0, expected_edit_version: 1,
  });
  bill = s.finance.review(user, bill.id, {
    expected_version: 1, expected_event_seq: 1, action: "approve",
  });
  assert.equal(s.finance.summary(project.id).settlement_fen, 18000);
  assert.equal(s.finance.summary(project.id).actual_cost_fen, 24000);
  comparison = s.finance.summary(project.id);
  assert.equal(comparison.reference_total_fen, 16000);
  assert.equal(comparison.actual_reference_difference_fen, 8000);
  assert.equal(comparison.settlement_fen, 18000);
  s.finance.removeSettlement(user, bill.id, {
    expected_version: 1, expected_edit_version: 0,
  });
  assert.equal(s.finance.summary(project.id).settlement_fen, 0);
  assert.equal(s.finance.history(bill.id).length, 2);
  s.finance.removeCost(user, project.id, cost.entry_id, { expected_version: 2 });
  assert.equal(s.finance.costs(project.id).length, 0);
  s.finance.removeNode(user, project.id, node.id, { expected_version: 2 });
  assert.equal(inspect(s).integrity().foreignKeys.length, 0);
  const restored = reopen();
  assert.equal(restored.demands.get(originalDemand).current_version, 2);
  assert.equal(restored.projects.get(project.id).status, "approved");
  assert.equal(restored.finance.summary(project.id).settlement_fen, 0);
  assert.equal(restored.catalog.get("prices", price.id).id, price.id);
  assert.equal(inspect(restored).integrity().integrity[0].integrity_check, "ok");
});

test("EMPTY DB: system users/IP/audit + authenticated HTTP read/write and precheck", async (t) => {
  const { s, user, save } = blank(t);
  const server = httpServer(s);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = "http://127.0.0.1:" + server.address().port;
  assert.equal((await fetch(base + "/api/catalog/units")).status, 401);
  const login = await fetch(base + "/api/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "Blank-Integration-Password" }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const headers = { "Content-Type": "application/json", Cookie: cookie };
  const read = async (path) => {
    const response = await fetch(base + path, { headers });
    assert.equal(response.status, 200, path + ": " + await response.clone().text());
    return response.json();
  };
  let counter = 0;
  const write = async (method, path, input) => {
    const response = await fetch(base + path, {
      method, headers: { ...headers, "Idempotency-Key": "fresh-e2e-" + ++counter + "-request" },
      body: JSON.stringify(input),
    });
    assert.equal(response.status, 200, method + " " + path + ": " + await response.clone().text());
    return response.json();
  };
  for (const path of ["/api/catalog/units", "/api/catalog/lines", "/api/demands",
    "/api/projects", "/api/dashboard", "/api/users", "/api/ips", "/api/audit"])
    assert.ok(await read(path), "read empty module " + path);
  const unit = await write("POST", "/api/catalog/units", { name: "根库新建单位" });
  const updated = await write("POST", "/api/catalog/units/" + unit.id,
    { name: "根库编辑单位", expected_version: 1 });
  assert.equal(updated.version, 2);
  await write("DELETE", "/api/catalog/units/" + unit.id, { expected_version: 2 });
  assert.equal((await read("/api/catalog/units")).total, 0);
  const ip = await write("POST", "/api/ips", { ip: "192.0.2.81", note: "测试" });
  assert.equal(ip.ok, true);
  const ips = await read("/api/ips");
  await write("DELETE", "/api/ips/" + ips.items.find((x) => x.ip === "192.0.2.81").id, {});
  const viewer = await write("POST", "/api/users", {
    username: "empty-viewer", password: "Blank-Viewer-Password", role: "viewer",
  });
  await write("DELETE", "/api/users/" + viewer.id, {});
  await write("POST", "/api/audit", { message: "从空库开始的集成审计" });
  assert.ok((await read("/api/audit")).items.length > 0);
  assert.equal(inspect(s).integrity().foreignKeys.length, 0);
});

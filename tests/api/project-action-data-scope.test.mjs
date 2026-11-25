import assert from "node:assert/strict";
import { test } from "node:test";
import { approvedFixture } from "../helpers.mjs";
import { httpServer } from "../../dist/server/platform/http/server.js";
import { makeWorkbook } from "../../dist/server/modules/exchange/workbook.js";

test("scope follows the role granting the exact operation and guards ownership changes, queue paging and formal writes", async t => {
  const { s, user: admin, save, framework, project, node, operation } = approvedFixture(t);
  const department = save("organizations", { name: "输电一部" });
  const child = save("organizations", { name: "输电一部运检班", parent_unit_id: department.id });
  const second = save("organizations", { name: "调度支持部" });
  const separate = save("organizations", { name: "输电二部" });

  const defineRole = (code, permissions, data_scopes) => {
    const role = s.management.saveRole(admin, { code, name: code });
    return s.management.setRolePermissions(admin, code, {
      permissions, data_scopes, expected_version: role.version,
    });
  };
  const local = defineRole("local_formal_action", ["project.stock", "project.approve", "settlement.approve"], [
    { permission_code: "project.stock", scope: "department" },
    { permission_code: "project.approve", scope: "department_and_children" },
    { permission_code: "settlement.approve", scope: "self" },
  ]);
  defineRole("custom_approval", ["project.approve", "cost.confirm"], [
    { permission_code: "project.approve", scope: "custom", organization_ids: [second.id] },
    { permission_code: "cost.confirm", scope: "custom", organization_ids: [second.id] },
  ]);
  defineRole("draft_editor", ["write"], [{ permission_code: "write", scope: "department" }]);
  const account = s.management.saveUser(admin, {
    username: "local-reviewer", password: "local-reviewer-password", role: "viewer",
    role_codes: ["viewer", "local_formal_action", "custom_approval", "draft_editor"],
    organization_ids: [department.id],
  });

  const reserve = (name, unit, owner) => s.projects.save(admin, {
    name, framework_id: framework.id, managing_unit_id: unit.id, owner_id: owner,
  });
  const localReserve = reserve("本组织储备项目", department);
  const childReserve = reserve("下级组织储备项目", child);
  const createPending = (name, unit, owner) => {
    const tower = save("physical", { asset_no: "T" + crypto.randomUUID().slice(0, 8), tower_material: "angle" });
    const demand = s.demands.save(admin, {
      operation_id: operation.id, problem_description: name, expected_on: "2026-12-30",
      completion_standard: "安装牢固",
      work_locations: [{ location_kind: "physical_tower", physical_tower_id: tower.id, quantity_scaled: 10000 }],
      sources: [{ description: "现场巡视记录" }],
    });
    s.demands.transition(admin, demand.id, { expected_version: 1, expected_event_seq: 1, status: "active" });
    const row = reserve(name, unit, owner);
    s.projects.link(admin, row.id, { demand_id: demand.id, expected_version: 1 });
    const stocked = s.projects.stock(admin, row.id, { expected_version: 1 });
    return s.projects.approvalDraft(admin, row.id, {
      expected_version: stocked.version, approved_budget_fen: 10000,
      scopes: [{ project_scope_id: stocked.scopes[0].id, demand_version: 1,
        locations: [{ location_item_no: 1, approved_quantity_scaled: 10000 }] }],
    });
  };
  const childApproval = createPending("甲 下级组织待批项目", child);
  const customApproval = createPending("乙 自定义组织待批项目", second);
  const otherApproval = createPending("丙 外部组织待批项目", separate, account.id);

  const server = httpServer(s);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = "http://127.0.0.1:" + server.address().port;
  async function login(username, password) {
    const response = await fetch(base + "/api/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    assert.equal(response.status, 200);
    return response.headers.get("set-cookie").split(";")[0];
  }
  let cookie = await login("local-reviewer", "local-reviewer-password");
  const call = (path, body, method = body ? "POST" : "GET", credentials = cookie) => fetch(base + "/api" + path, {
    method,
    headers: { Cookie: credentials, ...(body ? {
      "Content-Type": "application/json", Origin: base, "Idempotency-Key": crypto.randomUUID(),
    } : {}) },
    body: body && JSON.stringify(body),
  });
  const checks = await call("/projects/stock-batch/preview", { items: [
    { id: localReserve.id, expected_version: 1 }, { id: childReserve.id, expected_version: 1 },
  ] });
  assert.equal(checks.status, 200);
  const [localPreview, childPreview] = await checks.json();
  assert.equal(localPreview.reason, "");
  assert.match(childPreview.reason, /授权数据范围/);
  assert.equal(childPreview.label, childReserve.id);
  const batch = await call("/projects/stock-batch", { items: [
    { id: localReserve.id, expected_version: 1 }, { id: childReserve.id, expected_version: 1 },
  ] });
  assert.equal(batch.status, 403);
  assert.equal(s.projects.get(localReserve.id).status, "reserve");
  assert.equal((await call("/projects/" + localReserve.id + "/stock", { expected_version: 1 })).status, 200);
  const drafted = await call("/projects/" + localReserve.id, {
    name: "本组织项目正式修订", expected_version: localReserve.profile_version,
  });
  assert.equal(drafted.status, 200);
  const amended = s.projects.get(localReserve.id);
  assert.equal(amended.name, "本组织项目正式修订");
  const transfer = await call("/projects/" + localReserve.id, {
    name: amended.name, expected_version: amended.profile_version, managing_unit_id: second.id,
  });
  assert.equal(transfer.status, 403);
  assert.equal(s.projects.get(localReserve.id).managing_unit_id, department.id);
  const outsideCreate = await call("/projects", {
    name: "未授权的组织项目", framework_id: framework.id, managing_unit_id: separate.id,
  });
  assert.equal(outsideCreate.status, 403);
  assert.ok(!s.projects.list().some(row => row.name === "未授权的组织项目"));

  const queue = await call("/projects/handling?task=initial&page_size=1");
  assert.equal(queue.status, 200);
  assert.equal((await queue.json()).total, 2, "out-of-scope rows must be excluded before pagination");
  assert.equal((await call("/projects/" + otherApproval.id)).status, 200, "its read role remains global");
  const approve = row => call("/projects/" + row.id + "/approvals/" +
    row.approvals.find(approval => approval.status === "draft").id + "/approve", { expected_version: row.version });
  assert.equal((await approve(otherApproval)).status, 403, "settlement self scope is not combined with project approval");
  const attempt = await call("/projects/" + otherApproval.id, {
    name: otherApproval.name, expected_version: otherApproval.profile_version, managing_unit_id: department.id,
  });
  assert.equal(attempt.status, 403, "ownership reassignment must not widen a scoped approver's own grant");
  assert.equal(s.projects.get(otherApproval.id).managing_unit_id, separate.id);
  assert.equal((await approve(childApproval)).status, 200);
  assert.equal((await approve(customApproval)).status, 200);
  assert.equal(s.projects.get(otherApproval.id).status, "stocked");
  assert.equal((await call("/projects/" + project.id + "/settlements", {
    approval_version_id: project.approval.id, mode: "project_total", amount_fen: 12000,
    basis: "外组织项目不得编制", items: [], resolutions: [],
  })).status, 403);
  assert.equal(s.finance.settlements(project.id).length, 0);

  // A mixed Excel batch must fail closed, even when ordinary row-error handling
  // permits partial imports. Recheck ownership at commit, not just preview.
  const localExcelA = createPending("Excel 本组织项目甲", department);
  const localExcelB = createPending("Excel 本组织项目乙", department);
  assert.equal((await approve(localExcelA)).status, 200);
  assert.equal((await approve(localExcelB)).status, 200);
  const workbook = rows => makeWorkbook("settlements", {
    documents: rows.map((row, index) => ({
      number: "EXCEL-SCOPE-" + (index + 1), project_id: row.id,
      approval_version_id: s.projects.get(row.id).approval.id, amount_fen: 5500,
      mode: "project_total", basis: "权限批次核验",
    })),
  });
  const previewExcel = (body, projectId) => fetch(base + "/api/exchange/settlements/preview" +
    (projectId ? "?project_id=" + projectId : ""), {
    method: "POST", headers: { Cookie: cookie, Origin: base,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, body,
  });
  const denied = await previewExcel(await workbook([localExcelA, childApproval]));
  assert.equal(denied.status, 403, await denied.clone().text());
  const deniedContext = await previewExcel(await workbook([childApproval]), childApproval.id);
  assert.equal(deniedContext.status, 403, await deniedContext.clone().text());
  const valid = await previewExcel(await workbook([localExcelA, localExcelB]));
  assert.equal(valid.status, 200, await valid.clone().text());
  const previewResult = await valid.json();
  assert.equal(previewResult.summary.created, 2, JSON.stringify(previewResult.issues));
  assert.equal(s.finance.settlements(localExcelA.id).length, 0);
  assert.equal(s.finance.settlements(localExcelB.id).length, 0);
  const beforeTransfer = s.projects.get(localExcelB.id);
  s.projects.save(admin, { name: beforeTransfer.name, expected_version: beforeTransfer.profile_version,
    managing_unit_id: separate.id }, localExcelB.id);
  for (const atomic of [false, true]) {
    const rejected = await call("/exchange/" + previewResult.token + "/commit", {
      request_key: crypto.randomUUID(), atomic,
    });
    assert.equal(rejected.status, 403, await rejected.clone().text());
    assert.equal(s.finance.settlements(localExcelA.id).length, 0);
    assert.equal(s.finance.settlements(localExcelB.id).length, 0);
    assert.equal(s.finance.summary(localExcelA.id).settlement_fen, 0);
    assert.equal(s.finance.summary(localExcelB.id).settlement_fen, 0);
  }

  const draft = s.finance.saveDraft(admin, project.id, {
    approval_version_id: project.approval.id,
    mode: "project_total", amount_fen: 12000, basis: "组织范围审核试单",
    items: [], resolutions: [],
  });
  const submitted = s.finance.submit(admin, draft.id, {
    expected_version: 0, expected_edit_version: draft.draft.edit_version,
  });
  const review = () => call("/settlements/" + submitted.id + "/review", {
    action: "approve", expected_version: submitted.version.version_no, expected_event_seq: submitted.review.event_seq,
  });
  assert.equal((await review()).status, 403);
  assert.equal(s.finance.summary(project.id).settlement_fen, 0);
  assert.equal((await call("/projects/" + project.id + "/costs", {
    expected_version: 0, cost_node_id: node.id, title: "组织范围费用",
    amount_fen: 1000, occurred_on: "2026-11-22", evidence: "现场票据",
  })).status, 403);
  s.projects.save(admin, { name: project.name, expected_version: project.profile_version, owner_id: account.id }, project.id);
  assert.equal((await review()).status, 200);
  assert.equal(s.finance.summary(project.id).settlement_fen, 12000);

  const adminCookie = await login("admin", "Schema113-test-password");
  const setPermissions = body => call("/roles/" + local.code + "/permissions", body, "PUT", adminCookie);
  const updated = await setPermissions({
    expected_version: local.version, permissions: local.permissions,
    data_scopes: [{ permission_code: "project.approve", scope: "custom", organization_ids: [separate.id] }],
  });
  assert.equal(updated.status, 200);
  assert.equal((await call("/session")).status, 401, "scope changes revoke current role-member sessions");
  assert.equal((await setPermissions({
    expected_version: local.version, permissions: local.permissions,
  })).status, 409);
  const newest = await updated.json();
  assert.deepEqual(newest.data_scopes, [{
    permission_code: "project.approve", scope: "custom", organization_ids: [separate.id],
  }]);
  assert.equal((await setPermissions({
    expected_version: newest.version, permissions: local.permissions,
    data_scopes: [{ permission_code: "read", scope: "self" }],
  })).status, 422);
  const audit = s.audit.history("roles", local.code).find(row => row.action === "permission_grant" &&
    JSON.parse(row.after_json).version === newest.version);
  assert.deepEqual(JSON.parse(audit.before_json).data_scopes, local.data_scopes);
  assert.deepEqual(JSON.parse(audit.after_json).data_scopes, newest.data_scopes);
  cookie = await login("local-reviewer", "local-reviewer-password");
  assert.equal((await approve(otherApproval)).status, 200);
});

test("a project profile revision retains omitted adopted facts and permits explicit clearing", t => {
  const { s, user, save, framework, project } = approvedFixture(t);
  const org = save("organizations", { name: "归口运检部" });
  const category = save("categories", { name: "线路维护" });
  const full = s.projects.save(user, {
    name: project.name, expected_version: project.profile_version, owner_id: user.id, manager_id: user.id,
    managing_unit_id: org.id, category_id: category.id,
    planned_start_on: "2026-11-20", planned_end_on: "2027-01-01",
    preliminary_estimate_fen: 56700, preliminary_estimate_basis: "工作量初核",
  }, project.id);
  const renamed = s.projects.save(user, { name: "档案名称修订", expected_version: full.profile_version }, project.id);
  for (const field of ["owner_id", "manager_id", "managing_unit_id", "managing_unit_version_id", "category_id",
    "category_version", "planned_start_on", "planned_end_on", "preliminary_estimate_fen", "preliminary_estimate_basis"]) {
    assert.equal(renamed[field], full[field], field);
  }
  assert.equal(renamed.framework_id, framework.id);
  const cleared = s.projects.save(user, {
    name: renamed.name, expected_version: renamed.profile_version,
    manager_id: null, planned_end_on: null, preliminary_estimate_fen: null,
  }, project.id);
  assert.equal(cleared.manager_id, null);
  assert.equal(cleared.planned_end_on, null);
  assert.equal(cleared.preliminary_estimate_fen, null);
  assert.equal(cleared.managing_unit_id, org.id);
});

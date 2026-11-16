import {inspect} from "../inspector.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSystem } from "../../dist/server/bootstrap.js";
import { ensureDemoDatabase, DEMO_ACCOUNT, DEMO_PASSWORD } from "../../scripts/demo/seed-demo.mjs";

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), "sd-funding-contract-"));
  const dir = join(root, "demo");
  ensureDemoDatabase(dir);
  const s = createSystem(dir);
  t.after(() => { s.close(); rmSync(root, { recursive: true, force: true }); });
  const { user } = s.auth.login(DEMO_ACCOUNT, DEMO_PASSWORD);
  const projects = s.projects.list();
  const approved = projects.find(item => item.name.includes("青峰线防鸟装置整治"));
  const reserve = projects.find(item => item.name.includes("河湾线绝缘子专项更换"));
  const framework = s.catalog.get("frameworks",approved.framework_id);
  const agreements = s.catalog.list("agreements");
  const assigned = agreements.find(item => item.id === approved.funding.agreement_id);
  const other = agreements.find(item => item.id !== assigned.id);
  assert.ok(approved && reserve && assigned && other);
  return { s, user, approved, reserve, framework, assigned, other };
}

test("project agreement choices show only eligible agreements in same annual framework", t => {
  const { s, user, approved, framework, assigned, other } = setup(t);
  const foreignFramework = s.catalog.save(user, "frameworks", {
    name: "另一个年度框架", fiscal_year: 2027, limit_fen: 999999,
  });
  const foreign = s.catalog.save(user, "agreements", {
    name: "不同框架的协议", framework_id: foreignFramework.id, limit_fen: 200000,
  });
  const inactive = s.catalog.save(user, "agreements", {
    name: "已停用协议", framework_id: framework.id, limit_fen: 300000, status: "inactive",
  });
  const future = s.catalog.save(user, "agreements", {
    name: "未来生效协议", framework_id: framework.id, limit_fen: 300000,
    effective_from: "2099-01-01",
  });
  const expired = s.catalog.save(user, "agreements", {
    name: "已经到期协议", framework_id: framework.id, limit_fen: 300000,
    effective_to: "2000-12-31",
  });
  const result = s.projects.agreementOptions(approved.id);
  assert.equal(result.framework_id, framework.id);
  assert.equal(result.project_approved_budget_fen, 50000);
  assert.deepEqual(new Set(result.options.filter(x => x.eligible).map(x => x.id)),
    new Set([assigned.id, other.id]));
  assert.ok(!result.options.some(x => x.id === foreign.id));
  assert.ok(!result.options.some(x => x.id === inactive.id));
  assert.ok(!result.options.some(x => x.id === future.id));
  assert.ok(!result.options.some(x => x.id === expired.id));
  const row = result.options.find(x => x.id === assigned.id);
  assert.equal(row.limit_fen, assigned.limit_fen);
  assert.equal(row.linked_projects_count, 1);
  assert.equal(row.linked_approved_budget_fen, 50000);
  assert.equal(row.budget_difference_fen, assigned.limit_fen - 50000);
});

test("service rejects cross-framework, inactive and out-of-date agreements before writing history", t => {
  const { s, user, reserve, framework } = setup(t);
  const externalFramework = s.catalog.save(user, "frameworks", {
    name: "跨框架", fiscal_year: 2027, limit_fen: 800000,
  });
  const foreign = s.catalog.save(user, "agreements", {
    name: "跨框架执行协议", framework_id: externalFramework.id, limit_fen: 100000,
  });
  const inactive = s.catalog.save(user, "agreements", {
    name: "暂停使用", framework_id: framework.id, status: "inactive", limit_fen: 100000,
  });
  const future = s.catalog.save(user, "agreements", {
    name: "待生效", framework_id: framework.id, limit_fen: 100000,
    effective_from: "2099-01-01",
  });
  const expired = s.catalog.save(user, "agreements", {
    name: "已失效", framework_id: framework.id, limit_fen: 100000,
    effective_to: "2000-01-01",
  });
  // The second demo project has funding V1, so an attempted revision uses V1.
  const baseline = reserve.funding.version_no;
  for (const [row, matcher] of [
    [foreign, /年度框架/], [inactive, /停用或删除/],
    [future, /尚未生效或已过期/], [expired, /尚未生效或已过期/],
  ]) {
    assert.throws(() => s.projects.fund(user, reserve.id, {
      agreement_id: row.id, expected_version: baseline,
    }), matcher);
    assert.equal(s.projects.get(reserve.id).funding.version_no, baseline);
  }
  assert.equal(inspect(s).integrity().foreignKeys.length, 0);
});

test("reassigning funding changes only current association and recalculates budget reference", t => {
  const { s, user, approved, assigned, other } = setup(t);
  const before = s.projects.agreementOptions(approved.id);
  assert.equal(before.options.find(x => x.id === other.id).linked_approved_budget_fen, 0);
  assert.throws(() => s.projects.fund(user, approved.id, {
    agreement_id: assigned.id, expected_version: approved.funding.version_no,
  }), /未变化/);
  let updated = s.projects.fund(user, approved.id, {
    agreement_id: other.id, expected_version: approved.funding.version_no,
    reason: "演示预算归属变更",
  });
  assert.equal(updated.funding.agreement_id, other.id);
  assert.equal(updated.funding.version_no, 2);
  const after = s.projects.agreementOptions(approved.id);
  assert.equal(after.options.find(x => x.id === assigned.id).linked_approved_budget_fen, 0);
  assert.equal(after.options.find(x => x.id === other.id).linked_approved_budget_fen, 50000);
  assert.equal(inspect(s).where("project_funding_versions", { project_id: approved.id }).length, 2);

  updated = s.projects.fund(user, approved.id, {
    agreement_id: null, expected_version: 2,
  });
  assert.equal(updated.funding.agreement_id, null);
  assert.equal(updated.funding.version_no, 3);
  assert.equal(s.projects.agreementOptions(approved.id).options
    .find(x => x.id === other.id).linked_approved_budget_fen, 0);
  assert.equal(inspect(s).where("project_funding_versions", { project_id: approved.id }).length, 3);
});

test("old inactive linked agreement is readable but cannot be selected for a new association", t => {
  const { s, user, approved, reserve, assigned } = setup(t);
  s.catalog.save(user, "agreements", {
    status: "inactive", expected_version: assigned.version_no,
    reason: "执行协议停止使用",
  }, assigned.id);
  const activeChoices = s.projects.agreementOptions(approved.id);
  const old = activeChoices.options.find(x => x.id === assigned.id);
  assert.equal(old.eligible, false);
  assert.equal(old.status, "inactive");
  assert.ok(!s.projects.agreementOptions(reserve.id).options.some(x => x.id === assigned.id));
  assert.throws(() => s.projects.fund(user, reserve.id, {
    agreement_id: assigned.id, expected_version: reserve.funding.version_no,
  }), /停用或删除/);
});

test("agreement budget comparison is not enforced as a hard spending cap", t => {
  const { s, user, approved, assigned } = setup(t);
  s.catalog.save(user, "agreements", {
    limit_fen: 10000, expected_version: assigned.version_no,
  }, assigned.id);
  const figure = s.projects.agreementOptions(approved.id).options
    .find(x => x.id === assigned.id);
  assert.equal(figure.limit_fen, 10000);
  assert.equal(figure.linked_approved_budget_fen, 50000);
  assert.equal(figure.budget_difference_fen, -40000);
  assert.equal(s.projects.get(approved.id).funding.agreement_id, assigned.id);
});

test("funding selection reuses the archive writer and preserves the adopted category version", t => {
  const { s, user, approved, other } = setup(t);
  const category = s.catalog.save(user, "categories", { name: "原采用项目类别" });
  const project = s.projects.save(user, {
    ...approved, category_id: category.id, expected_version: approved.profile_version,
  }, approved.id);
  s.catalog.save(user, "categories", {
    name: "新版项目类别", expected_version: 1,
  }, category.id);
  const changed = s.projects.fund(user, project.id, {
    agreement_id: other.id, expected_version: project.funding.version_no,
  });
  assert.equal(changed.funding.agreement_id, other.id);
  assert.equal(changed.profile_version, project.profile_version);
  assert.equal(changed.category_version, 1);
  assert.equal(changed.category_name, "原采用项目类别");
});

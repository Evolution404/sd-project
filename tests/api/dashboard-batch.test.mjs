import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { approvedFixture } from "../helpers.mjs";

test("dashboard batch aggregates preserve exact project finance and formal settlement history", t => {
  const { s, user, project, scope, approval, node, framework } = approvedFixture(t);
  const withoutApproval = s.projects.save(user, {
    name: "另一未立项子项目", framework_id: framework.id,
  });
  for (let i = 0; i < 20; i++)
    s.projects.save(user, { name: "集合查询项目" + i, framework_id: framework.id });
  s.finance.cost(user, project.id, {
    cost_node_id: node.id, title: "本期真实费用",
    occurred_on: "2026-11-11", amount_fen: 140000, evidence: "原始凭据",
  });
  let bill = s.finance.saveDraft(user, project.id, {
    approval_version_id: approval.id,
    items: [{ cost_node_id: node.id, project_scope_id: scope.id,
      quantity_scaled: 10000, amount_fen: 60000, evidence: "阶段结算凭据" }],
    resolutions: [{ project_scope_id: scope.id,
      resolved_quantity_scaled: 20000, evidence: "完成量现场确认" }],
  });
  bill = s.finance.submit(user, bill.id, {
    expected_version: 0, expected_edit_version: 1,
  });
  s.finance.review(user, bill.id, {
    expected_version: 1, expected_event_seq: 1, action: "approve",
  });

  const called = { portfolio: 0, totals: 0, demands: 0, prices: 0 };
  const original = {
    portfolio: s.projectPort.projectDashboardPortfolio,
    totals: s.financePort.portfolioFinanceTotals,
    demands: s.financePort.portfolioFinanceDemands,
    prices: s.pricing.summariesForApprovals,
  };
  s.projectPort.projectDashboardPortfolio = (...args) => {
    called.portfolio++;
    return original.portfolio(...args);
  };
  s.financePort.portfolioFinanceTotals = (...args) => {
    called.totals++;
    return original.totals(...args);
  };
  s.financePort.portfolioFinanceDemands = (...args) => {
    called.demands++;
    return original.demands(...args);
  };
  s.pricing.summariesForApprovals = (...args) => {
    called.prices++;
    return original.prices(...args);
  };
  const dashboard = s.dashboard(user);
  assert.deepEqual(called, { portfolio: 1, totals: 1, demands: 1, prices: 1 });
  assert.equal(dashboard.portfolio.length, 22);
  assert.equal(dashboard.projects, 22);
  assert.equal(dashboard.portfolio.find(row => row.id === withoutApproval.id).approved_budget_fen, null);
  const current = dashboard.portfolio.find(row => row.id === project.id);
  assert.equal(current.actual_cost_fen, 140000);
  assert.equal(current.settlement_fen, 60000);
  assert.equal(current.demands[0].resolved_quantity_scaled, 20000);
  for (const row of dashboard.portfolio) {
    const expected = s.finance.summary(row.id);
    for (const key of Object.keys(expected))
      assert.deepEqual(row[key], expected[key], "dashboard mismatch: " + row.id + "." + key);
  }
  const frameworkRow = dashboard.frameworks.find(row => row.id === framework.id);
  assert.equal(frameworkRow.actual_cost_fen, 140000);
  assert.equal(frameworkRow.projects, 22);
  assert.equal(frameworkRow.approved_budget_fen, 120000);
  assert.equal(frameworkRow.difference_fen, 140000 - framework.limit_fen);
  assert.deepEqual(dashboard.months.filter(month => month.month === "2026-11"),
    [{ month: "2026-11", actual_cost_fen: 140000 }]);
  assert.deepEqual(dashboard.quarters
    .filter(row => row.framework === framework.name)
    .map(row => row.cumulative_actual_fen), [0, 0, 0, 140000]);
  assert.equal(dashboard.pending_demands, 0);
});

test("archived projects leave all dashboard totals and remain exportable on request", async t => {
  const { s, user, project, node, framework } = approvedFixture(t);
  const active = s.projects.save(user, { name: "仍在管理的子项目", framework_id: framework.id });
  s.finance.cost(user, project.id, {
    cost_node_id: node.id, title: "结项项目费用",
    occurred_on: "2026-07-09", amount_fen: 12345, evidence: "测试凭据",
  });
  const preview = s.projectClosure.preview(user, project.id);
  const closed = s.projectClosure.commit(user, project.id, {
    expected_version: preview.expected_version, preview_hash: preview.preview_hash,
  });
  s.projects.remove(user, project.id, { expected_version: closed.version });
  const dashboard = s.dashboard(user);
  assert.deepEqual(dashboard.portfolio.map(row => row.id), [active.id]);
  assert.deepEqual(dashboard.months, []);
  assert.ok(dashboard.quarters.every(row => row.cumulative_actual_fen === 0));
  assert.equal(dashboard.frameworks.find(row => row.id === framework.id).actual_cost_fen, 0);

  const query = { page: 1, page_size: 30, q: "", filters: {}, sort: "created_at", direction: "desc", deleted: true };
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await s.exchange.projectReport(user, [], query));
  const sheet = workbook.getWorksheet("子项目清单");
  const headers = sheet.getRow(3).values;
  const records = sheet.getSheetValues().slice(4);
  assert.deepEqual(new Set(records.map(row => row[headers.indexOf("项目名称")])), new Set([project.name, active.name]));
  const archive = records.find(row => row[headers.indexOf("项目名称")] === project.name);
  assert.equal(archive[headers.indexOf("归档状态")], "已归档删除");
  assert.equal(archive[headers.indexOf("核定实际费用（元）")], 123.45);
});

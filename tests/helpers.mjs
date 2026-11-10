import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSystem } from "../dist/server/bootstrap.js";
export function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "sd113-"));
  const s = createSystem(dir);
  t.after(() => {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  });
  s.auth.initialize("admin", "Schema113-test-password");
  const { user } = s.auth.login("admin", "Schema113-test-password");
  const save = (kind, input) => s.catalog.save(user, kind, input);
  const unit = save("units", { code: "set", name: "套" }),
    object = save("objects", {
      code: "bird",
      name: "防鸟装置",
      work_target_type: "physical",
    });
  const operation = save("operations", {
    code: "install",
    name: "安装防鸟装置",
    default_unit_id: unit.id,
    work_object_id: object.id,
    work_target_type: "physical",
    completion_standard: "安装牢固",
    default_target_object: "防鸟装置",
  });
  const towers = [15, 16, 17].map((n) =>
    save("physical", { asset_no: `T${n}`, tower_type: "angle" }),
  );
  const price = save("prices", {
    code: "base-price",
    title: "每塔基费及套费",
    operation_id: operation.id,
    pricing_mode: "base_plus_unit",
    unit_price_fen: 2000,
    base_fee_fen: 10000,
    price_source: "测试依据",
    price_date: "2026-01-01",
    effective_on: "2026-01-01",
    basis: "合成测试",
  });
  const demandInput = {
    demand_no: "D001",
    operation_id: operation.id,
    problem_description: "防鸟设施缺失",
    completion_standard: "安装牢固",
    work_locations: towers.map((tower, i) => ({
      location_kind: "physical_tower",
      physical_tower_id: tower.id,
      quantity_scaled: [30000, 20000, 40000][i],
    })),
    sources: [{ description: "现场巡视记录" }],
  };
  return {
    s,
    user,
    dir,
    save,
    unit,
    object,
    operation,
    towers,
    price,
    demandInput,
  };
}
export function approvedFixture(t) {
  const f = fixture(t),
    { s, user, save, demandInput } = f,
    demand = s.demands.save(user, demandInput);
  s.demands.transition(user, demand.id, {
    expected_version: 1,
    expected_event_seq: 1,
    status: "active",
  });
  const framework = save("frameworks", {
    code: "F26",
    fiscal_year: 2026,
    name: "年度框架",
    limit_fen: 100000,
  });
  let project = s.projects.save(user, {
    code: "P01",
    name: "测试子项目",
    framework_id: framework.id,
  });
  project = s.projects.link(user, project.id, {
    demand_id: demand.id,
    expected_version: 1,
  });
  project = s.projects.stock(user, project.id, { expected_version: 1 });
  const scope = project.scopes[0];
  project = s.projects.approvalDraft(user, project.id, {
    expected_version: 2,
    approved_budget_fen: 120000,
    scopes: [
      {
        project_scope_id: scope.id,
        demand_version: 1,
        locations: demand.work_locations.map((loc, index) => ({
          location_item_no: index + 1,
          approved_quantity_scaled: loc.quantity_scaled,
        })),
      },
    ],
  });
  const approval = project.approvals[0];
  project = s.projects.approve(user, project.id, approval.id, {
    expected_version: 2,
  });
  const node = s.finance.node(user, project.id, { name: "人工费" });
  return { ...f, demand, framework, project, scope, approval, node };
}

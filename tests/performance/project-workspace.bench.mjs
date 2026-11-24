import assert from "node:assert/strict";
import { test } from "node:test";
import { performance } from "node:perf_hooks";
import { fixture } from "../helpers.mjs";
import { inspect } from "../inspector.mjs";
import { projectReadRepository } from "../../dist/server/database/repositories/projects.js";
import { financeReadRepository } from "../../dist/server/database/repositories/finance.js";

test("60 complete demands and 12 approval versions use fixed collection reads", { timeout: 180000 }, t => {
  const { s, user, save, operation } = fixture(t);
  const framework = save("frameworks", { name: "大规模项目验收框架", fiscal_year: 2026, limit_fen: 10000000 });
  let project = s.projects.save(user, { name: "60需求120位置12版项目", framework_id: framework.id });
  const demands = s.database.transaction(() => Array.from({ length: 60 }, (_, index) => {
    const towers = [0, 1].map(offset => save("physical", { asset_no: "项目压力" + index + "-" + offset }));
    const demand = s.demands.save(user, {
      operation_id: operation.id, problem_description: "整条需求压力验收" + index, expected_on: "2027-06-30",
      work_locations: towers.map(tower => ({ location_kind: "physical_tower", physical_tower_id: tower.id, quantity_scaled: 10000 })),
    });
    s.demands.transition(user, demand.id, { expected_version: 1, expected_event_seq: 1, status: "active" });
    return demand;
  }));
  project = s.projects.linkMany(user, project.id, { links: demands.map(row => ({ demand_id: row.id, expected_version: 1 })) });
  project = s.projects.stock(user, project.id, { expected_version: 1 });
  const store = inspect(s);
  let reads = 0;
  const repository = projectReadRepository({
    ...store,
    query(...args) { reads++; return store.query(...args); },
    get(...args) { reads++; return store.get(...args); },
  });
  const demandMap = new Map(demands.map(row => [row.id, row]));
  const financeRepository=financeReadRepository({
    ...store,
    query(...args){reads++;return store.query(...args);},
    get(...args){reads++;return store.get(...args);},
  });
  const samples = [];
  for (let version = 1; version <= 12; version++) {
    project = s.projects.approvalDraft(user, project.id, {
      expected_version: project.version, approved_budget_fen: 100000 + version,
      expected_approval_version_id: project.approval?.id, confirm_changes: true,
      scopes: project.scopes.filter(row => row.binding).map(scope => ({
        project_scope_id: scope.id, demand_version: 1,
        locations: demandMap.get(scope.demand_id).work_locations.map(location => ({
          location_item_no: location.item_no, approved_quantity_scaled: location.quantity_scaled,
        })),
      })),
    });
    const draft = project.approvals.find(row => row.status === "draft");
    project = s.projects.approve(user, project.id, draft.id, { expected_version: project.version });
    if (![1, 12].includes(version)) continue;
    const began = performance.now();
    reads = 0;
    const current = repository.projectApprovalHistory(project.id, true);
    assert.equal(reads, 4);
    assert.equal(current.length, 1);
    assert.equal(current[0].scopes.length, 60);
    assert.equal(current[0].scopes.flatMap(row => row.locations).length, 120);
    assert.equal(current[0].version_no, version);
    reads = 0;
    const candidates = repository.projectApprovalCandidates(project.id);
    assert.equal(reads, 1);
    assert.equal(candidates.length, 60);
    assert.equal(candidates.flatMap(row => row.work_locations).length, 120);
    reads = 0;
    const history = repository.projectApprovalHistory(project.id);
    assert.equal(reads, 4);
    assert.equal(history.length, version);
    assert.equal(history[0].approved_budget_fen, 100001);
    reads=0;
    const worksheet=financeRepository.settlementWorksheet(project.id,project.approval.id);
    assert.equal(reads,4,"full settlement worksheet must use four set-based reads for 120 positions");
    assert.equal(worksheet.rows.length,120);
    assert.equal(worksheet.rows.filter(row=>row.editable).length,120);
    assert.ok(worksheet.rows.every(row=>row.prior_resolved_quantity_scaled===0));
    samples.push({ versions: version, currentApprovalReads: 4, candidateReads: 1, fullHistoryReads: 4, settlementWorksheetReads:4,
      readElapsedMs: Math.round(performance.now() - began) });
  }
  assert.deepEqual(inspect(s).integrity().foreignKeys, []);
  console.log("PROJECT_WORKSPACE_SQL_BENCH", JSON.stringify({ demands: 60, locations: 120, samples }));
});

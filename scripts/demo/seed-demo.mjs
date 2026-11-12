import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, lstatSync, mkdtempSync, renameSync, rmSync, openSync, writeSync, closeSync } from "node:fs";
import { resolve, join, dirname, basename } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createSystem } from "../../dist/server/bootstrap.js";
import { today } from "../../dist/server/platform/auth/service.js";

export const DEMO_ACCOUNT = "demo";
export const DEMO_PASSWORD = "DemoOnly-2026!";
const MARKER = "DEMO-DATA.json";
const SEED_VERSION = 3;
const OLDER_DEMO_VERSIONS = new Set([1, 2]);
const SCHEMA_SQL = resolve(import.meta.dirname, "../../server/database/schema/schema113.sql");
function schemaFingerprint() {
  return createHash("sha256").update(readFileSync(SCHEMA_SQL)).digest("hex");
}

function counts(system) {
  return {
    voltages: system.catalog.list("voltages").length,
    units: system.catalog.list("units").length,
    lines: system.catalog.list("lines").length,
    physicalTowers: system.catalog.list("physical").length,
    logicalTowers: system.catalog.list("towers").length,
    spans: system.catalog.list("spans").length,
    workObjects: system.catalog.list("objects").length,
    operations: system.catalog.list("operations").length,
    materials: system.catalog.list("materials").length,
    priceFeatures: system.standards.operations().reduce((sum,op)=>sum+JSON.parse(op.attributes_schema_json).length,0),
    priceRules: system.catalog.list("prices").length,
    demands: system.demands.list().length,
    frameworks: system.catalog.list("frameworks").length,
    agreements: system.catalog.list("agreements").length,
    projects: system.projects.list().length,
  };
}

function populate(system, password) {
  return system.database.transaction(() => {
    system.auth.initialize(DEMO_ACCOUNT, password);
    const { user } = system.auth.login(DEMO_ACCOUNT, password);
    const add = (kind, data) => system.catalog.save(user, kind, data);
    // Every demonstration unit explicitly declares quantity precision.
    const unitSet = add("units", { code: "DEMO_UNIT_SET", name: "套", quantity_precision: 0 });
    const unitString = add("units", { code: "DEMO_UNIT_STRING", name: "串", quantity_precision: 0 });
    const unitSection = add("units", { code: "DEMO_UNIT_SECTION", name: "处", quantity_precision: 0 });
    const unitPiece = add("units", { code: "DEMO_UNIT_PIECE", name: "片", quantity_precision: 0 });
    const unitMeter = add("units", { code: "DEMO_UNIT_METER", name: "米", quantity_precision: 2 });
    add("units", { code: "DEMO_UNIT_AREA", name: "平方米", quantity_precision: 2 });
    const voltages = {};
    for (const voltage of ["35kV", "110kV", "220kV", "500kV", "1000kV", "±200kV", "±500kV", "±800kV"])
      voltages[voltage] = add("voltages", { name: voltage });
    add("categories", { name: "线路日常检修" });
    add("categories", { name: "线路专项整治" });
    add("priorities", { name: "一般" });
    add("priorities", { name: "重要" });
    add("priorities", { name: "紧急" });
    add("organizations", { name: "【演示】输电运检班" });
    add("organizations", { name: "【演示】施工协作单位" });

    const line220 = add("lines", {
      code: "DEMO-LINE-220", name: "【演示】220kV青峰线",
      voltage_level_id: voltages["220kV"].id,
    });
    const line110 = add("lines", {
      code: "DEMO-LINE-110", name: "【演示】110kV河湾线",
      voltage_level_id: voltages["110kV"].id,
    });
    function createTowerSeries(line, label, numbers) {
      const result = [];
      for (const n of numbers) {
        const physical = add("physical", {
          asset_no: "DEMO-" + label + "-T" + n,
          tower_type: n % 2 ? "angle" : "suspension",
        });
        const logical = add("towers", {
          line_id: line.id, physical_tower_id: physical.id,
          tower_no: String(n),
        });
        result.push({ physical, logical });
      }
      return result;
    }
    const towers220 = createTowerSeries(line220, "220", [15, 16, 17, 18]);
    const towers110 = createTowerSeries(line110, "110", [21, 22, 23, 24]);
    function addSpans(line, towers) {
      return towers.slice(1).map((tower, i) => add("spans", {
        line_id: line.id,
        start_tower_id: towers[i].logical.id,
        end_tower_id: tower.logical.id,
        transmission_center_length_mm: [168000, 220000, 185000][i],
        status: "active",
      }));
    }
    const spans220 = addSpans(line220, towers220);
    addSpans(line110, towers110);

    const bird = add("objects", {
      name: "防鸟装置", code: "DEMO-WO-BIRD", work_target_type: "physical",
    });
    const insulator = add("objects", {
      name: "绝缘子串", code: "DEMO-WO-INSULATOR", work_target_type: "physical",
    });
    const conductor = add("objects", {
      name: "导线", code: "DEMO-WO-CONDUCTOR", work_target_type: "line",
    });
    const difficulty = { key: "demo-difficulty", label: "【演示】现场作业难度", scope: "location", source: "manual", type: "select",
      requirement: "pricing", pricing: true, enabled: true, sort_order: 1, hint: "",
      options: [{value:"常规",label:"常规"},{value:"复杂",label:"复杂"}] };
    const birdOperation = add("operations", {
      name: "安装防鸟装置", code: "DEMO-OP-BIRD",
      work_object_id: bird.id, default_unit_id: unitSet.id,
      completion_standard: "防鸟装置安装牢固、方向正确，现场验收合格",
      attributes_schema_json: [difficulty],
    });
    const insulatorOperation = add("operations", {
      name: "更换绝缘子串", code: "DEMO-OP-INSULATOR",
      work_object_id: insulator.id, default_unit_id: unitString.id,
      completion_standard: "绝缘子串更换完成，连接件安装及质量验收合格",
    });
    const spanOperation = add("operations", {
      name: "处理导线缺陷", code: "DEMO-OP-CONDUCTOR",
      work_object_id: conductor.id, default_unit_id: unitSection.id,
      work_target_type: "line", allow_tower: 0, allow_span: 1,
      default_location_kind: "span",
      completion_standard: "导线缺陷消除，验收无遗留问题",
    });
    const birdMaterial = add("materials", {
      name: "防鸟装置", code: "DEMO-MAT-BIRD",
      unit_id: unitSet.id, model: "FN-01",
      specification: "示例型号（非采购依据）",
    });
    add("materials", {
      name: "复合绝缘子", code: "DEMO-MAT-INSULATOR",
      unit_id: unitPiece.id, model: "FXBW-110",
      specification: "示例型号（非采购依据）",
    });
    add("materials", {
      name: "防振金具", code: "DEMO-MAT-DAMPER",
      unit_id: unitSet.id, model: "FD-01",
      specification: "示例型号（非采购依据）",
    });
    add("materials", {
      name: "导线辅助材料", code: "DEMO-MAT-CONDUCTOR",
      unit_id: unitMeter.id, model: "DEMO-CABLE",
      specification: "演示用途",
    });
    const priceDate = "2026-01-01";
    function rule(title, code, operation, amount, extra = {}) {
      return add("prices", {
        title, code, operation_id: operation.id,
        pricing_mode: "per_unit",
        unit_price_fen: amount,
        price_source: "【演示】虚构参考价（不能用于工程结算）",
        price_date: priceDate,
        effective_on: priceDate,
        basis: "演示系统功能与报价流程，非正式定额",
        ...extra,
      });
    }
    rule("【演示】防鸟安装—常规施工", "DEMO-PRICE-BIRD-EASY",
      birdOperation, 3600, {
        additional_conditions_json: {
          [difficulty.key]: { op: "eq", value: "常规" },
        },
      });
    rule("【演示】防鸟安装—复杂施工", "DEMO-PRICE-BIRD-HARD",
      birdOperation, 5200, {
        additional_conditions_json: {
          [difficulty.key]: { op: "eq", value: "复杂" },
        },
      });
    rule("【演示】绝缘子串更换", "DEMO-PRICE-INSULATOR",
      insulatorOperation, 12800);
    rule("【演示】导线缺陷处理", "DEMO-PRICE-CONDUCTOR",
      spanOperation, 8900);

    const currentDate = today();
    const installDemand = system.demands.save(user, {
      demand_no: "DEMO-D-001",
      operation_id: birdOperation.id,
      problem_description: "【演示】220kV青峰线15、16号杆塔缺少防鸟装置",
      completion_standard: "补装防鸟装置并验收",
      materials: [{ material_id: birdMaterial.id, quantity_scaled: 50000 }],
      work_locations: [
        {
          location_kind: "physical_tower",
          physical_tower_id: towers220[0].physical.id,
          quantity_scaled: 20000,
          attributes: {
            [difficulty.key]: "常规",
          },
        },
        {
          location_kind: "physical_tower",
          physical_tower_id: towers220[1].physical.id,
          quantity_scaled: 30000,
          attributes: {
            [difficulty.key]: "复杂",
          },
        },
      ],
      sources: [{ description: "【演示】巡视缺陷发现记录" }],
    });
    system.demands.transition(user, installDemand.id, {
      expected_version: 1, expected_event_seq: 1, status: "active",
    });
    const replacementDemand = system.demands.save(user, {
      demand_no: "DEMO-D-002",
      operation_id: insulatorOperation.id,
      problem_description: "【演示】110kV河湾线21号杆塔绝缘子串老化",
      work_locations: [{
        location_kind: "physical_tower",
        physical_tower_id: towers110[0].physical.id,
        quantity_scaled: 10000,
      }],
      sources: [{ description: "【演示】现场定期检查记录" }],
    });
    system.demands.transition(user, replacementDemand.id, {
      expected_version: 1, expected_event_seq: 1, status: "active",
    });
    system.demands.save(user, {
      demand_no: "DEMO-D-003",
      operation_id: spanOperation.id,
      problem_description: "【演示】220kV青峰线15—16号档导线局部损伤",
      work_locations: [{
        location_kind: "span", span_id: spans220[0].id, quantity_scaled: 10000,
      }],
      sources: [{ description: "【演示】巡检照片及缺陷处理建议" }],
    });

    const framework = add("frameworks", {
      code: "DEMO-F-2026", name: "【演示】2026年输电线路检修框架",
      fiscal_year: 2026, limit_fen: 50000000,
    });
    const agreement = add("agreements", {
      code: "DEMO-AG-01", name: "【演示】2026年度首批执行协议",
      framework_id: framework.id, limit_fen: 25000000,
    });
    const agreement2 = add("agreements", {
      code: "DEMO-AG-02", name: "【演示】2026年度补充执行协议",
      framework_id: framework.id, limit_fen: 10000000,
    });

    let project = system.projects.save(user, {
      name: "【演示】青峰线防鸟装置整治", framework_id: framework.id,
    });
    project = system.projects.link(user, project.id, {
      demand_id: installDemand.id, expected_version: 1,
    });
    project = system.projects.fund(user, project.id, {
      agreement_id: agreement.id, expected_version: 0,
    });
    project = system.projects.stock(user, project.id, { expected_version: 1 });
    project = system.projects.approvalDraft(user, project.id, {
      expected_version: 2,
      approved_budget_fen: 50000,
      scopes: [{
        project_scope_id: project.scopes[0].id,
        demand_version: 1,
        locations: [
          { location_item_no: 1, approved_quantity_scaled: 20000 },
          { location_item_no: 2, approved_quantity_scaled: 30000 },
        ],
        materials: [{
          material_id: birdMaterial.id,
          quantity_scaled: 50000,
        }],
      }],
    });
    const approval = project.approvals[0];
    const quote = system.pricing.quote(user, installDemand.id, {
      expected_version: 1,
      approval_scope_version_id: approval.scopes[0].id,
      confirm: true, pricing_date: currentDate,
    });
    if (!quote.complete || quote.total_fen !== 22800)
      throw Error("演示报价未完整匹配预期： " + JSON.stringify({
        complete: quote.complete, total: quote.total_fen,
        missing: quote.missing,
      }));
    project = system.projects.approve(user, project.id, approval.id, {
      expected_version: 2,
    });
    const node = system.finance.node(user, project.id, {
      name: "【演示】安装人工及综合费用",
    });
    system.finance.cost(user, project.id, {
      cost_node_id: node.id, title: "【演示】防鸟装置安装实际发生费用",
      occurred_on: currentDate, amount_fen: 27400,
      evidence: "【演示】现场费用核定记录（虚构）",
    });
    let bill = system.finance.saveDraft(user, project.id, {
      number: "DEMO-S-001", approval_version_id: approval.id,
      items: [{
        cost_node_id: node.id,
        project_scope_id: project.scopes[0].id,
        quantity_scaled: 20000,
        amount_fen: 10800,
        evidence: "【演示】第一批结算资料",
      }],
      resolutions: [{
        project_scope_id: project.scopes[0].id,
        resolved_quantity_scaled: 20000,
        evidence: "【演示】第一批完成验收",
      }],
    });
    bill = system.finance.submit(user, bill.id, {
      expected_version: 0, expected_edit_version: 1,
    });
    system.finance.review(user, bill.id, {
      expected_version: 1, expected_event_seq: 1, action: "approve",
    });
    system.finance.saveDraft(user, project.id, {
      number: "DEMO-S-002", approval_version_id: approval.id,
      items: [{
        cost_node_id: node.id,
        project_scope_id: project.scopes[0].id,
        quantity_scaled: 30000,
        amount_fen: 16600,
        evidence: "【演示】第二批待提交结算资料",
      }],
      resolutions: [{
        project_scope_id: project.scopes[0].id,
        resolved_quantity_scaled: 30000,
        evidence: "【演示】第二批施工登记",
      }],
    });

    let pending = system.projects.save(user, {
      name: "【演示】河湾线绝缘子专项更换",
      framework_id: framework.id,
    });
    pending = system.projects.link(user, pending.id, {
      demand_id: replacementDemand.id, expected_version: 1,
    });
    pending = system.projects.fund(user, pending.id, {
      agreement_id: agreement2.id, expected_version: 0,
    });
    system.projects.stock(user, pending.id, { expected_version: 1 });
    return {
      ...counts(system),
      referenceTotalFen: system.finance.summary(project.id).reference_total_fen,
      actualCostFen: system.finance.summary(project.id).actual_cost_fen,
      approvedSettlementFen: system.finance.summary(project.id).settlement_fen,
    };
  });
}

/**
 * Rebuild only a verifiably managed demo when its seed/schema changed.
 * The existing directory is atomically moved to a unique archive, never
 * deleted; no SQL migration or shared-data alteration takes place.
 */
function refreshOutdatedDemo(directory, options, marker) {
  if (basename(directory) !== "demo" || lstatSync(directory).isSymbolicLink() ||
      !lstatSync(directory).isDirectory() ||
      !existsSync(join(directory, "schema113.sqlite")) ||
      lstatSync(join(directory, "schema113.sqlite")).isSymbolicLink() ||
      typeof marker.createdAt !== "string" ||
      !Number.isInteger(marker.projects) || marker.projects < 1)
    throw Error("旧演示目录身份无法确认，拒绝自动重建，请手动检查");
  const parent = dirname(directory);
  // An exclusive lock prevents two demo refreshes from moving the same data.
  const lock = join(parent, ".demo-refresh.lock");
  const lockHandle = requireDemoRefreshLock(lock);
  let staging;
  try {
    staging = mkdtempSync(join(parent, ".demo-refresh-"));
    const seeded = ensureDemoDatabase(staging, options);
    const archive = join(parent,
      "demo-archive-" + new Date().toISOString().replace(/[:.]/g, "-") +
      "-" + randomUUID().slice(0, 8));
    renameSync(directory, archive);
    try {
      renameSync(staging, directory);
      staging = undefined;
    } catch (error) {
      renameSync(archive, directory);
      throw error;
    }
    return { ...seeded, directory, archive, refreshed: true, previous_seed_version: marker.version };
  } finally {
    if (staging && existsSync(staging))
      rmSync(staging, { recursive: true, force: true });
    releaseDemoRefreshLock(lockHandle, lock);
  }
}
function requireDemoRefreshLock(lock) {
  const fd = openDemoLock(lock);
  return fd;
}
function openDemoLock(lock) {
  try {
    const fd = openSync(lock, "wx", 0o600);
    writeSync(fd, String(process.pid));
    return fd;
  } catch (error) {
    if (error?.code === "EEXIST")
      throw Error("检测到演示数据刷新任务已在运行；为保护数据，请检查演示目录再试");
    throw error;
  }
}
function releaseDemoRefreshLock(fd, lock) {
  closeSync(fd);
  rmSync(lock, { force: true });
}

/**
 * Create a separate, completely fictional demo installation. Never import
 * examples into a non-demo runtime database or overwrite an existing folder.
 */
export function ensureDemoDatabase(dataDir, options = {}) {
  const directory = resolve(dataDir);
  const markerPath = join(directory, MARKER);
  if (existsSync(markerPath)) {
    const marker = JSON.parse(readFileSync(markerPath, "utf8"));
    if (marker.purpose !== "local-demo" ||
        (!OLDER_DEMO_VERSIONS.has(marker.version) && marker.version !== SEED_VERSION))
      throw Error("已有演示数据版本与当前程序不匹配，请手动检查，拒绝覆盖");
    if (OLDER_DEMO_VERSIONS.has(marker.version) ||
        marker.schema_sha256 !== schemaFingerprint())
      return refreshOutdatedDemo(directory, options, marker);
    const system = createSystem(directory);
    try {
      const existing = counts(system);
      if (existing.operations < 3 || existing.projects < 2)
        throw Error("演示数据不完整，拒绝静默重新生成，请检查现有演示目录");
      return { created: false, directory, ...existing };
    } finally {
      system.close();
    }
  }
  if (existsSync(directory) && readdirSync(directory).length)
    throw Error("目标目录已有非演示数据，拒绝写入：" + directory);
  mkdirSync(directory, { recursive: true });
  const system = createSystem(directory);
  try {
    const result = populate(system, options.password || DEMO_PASSWORD);
    const database=system.database.connection;
    if (database.prepare("PRAGMA foreign_key_check").all().length ||
        database.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok")
      throw Error("演示数据完整性检查未通过");
    const metadata = {
      purpose: "local-demo", version: SEED_VERSION,
      schema_sha256: schemaFingerprint(),
      note: "全部数据虚构，仅供熟悉系统，不可用于真实工程",
      createdAt: new Date().toISOString(),
      ...result,
    };
    writeFileSync(markerPath, JSON.stringify(metadata, null, 2) + "\n",
      { encoding: "utf8", flag: "wx" });
    return { created: true, directory, ...result };
  } finally {
    system.close();
  }
}

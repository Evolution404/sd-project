import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, lstatSync, mkdtempSync, renameSync, rmSync, openSync, writeSync, closeSync, rmdirSync } from "node:fs";
import { resolve, join, dirname, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { seedCommonDefinitions } from "../seed/common.mjs";
import { createHash, randomUUID } from "node:crypto";
import { createSystem } from "../../dist/server/bootstrap.js";
import { today } from "../../dist/server/platform/auth/service.js";

export const DEMO_ACCOUNT = "demo";
export const DEMO_PASSWORD = "DemoOnly-2026!";
const MARKER = "DEMO-DATA.json";
const SEED_VERSION = 6;
const OLDER_DEMO_VERSIONS = new Set([1, 2, 3, 4, 5]);
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

function populate(system, password, realAssets=false) {
  return system.database.transaction(() => {
    if(!realAssets)system.auth.initialize(DEMO_ACCOUNT, password);
    const { user } = system.auth.login(DEMO_ACCOUNT, password);
    const add = (kind, data) => system.catalog.save(user, kind, data);
    if(realAssets)seedCommonDefinitions(system,user);
    const ensure=(kind,data)=>realAssets?(system.catalog.list(kind).find(row=>row.name===data.name)||add(kind,data)):add(kind,data);
    // Every demonstration unit explicitly declares quantity precision.
    const unitSet = ensure("units", { code: "DEMO_UNIT_SET", name: "套", quantity_precision: 0 });
    const unitString = ensure("units", { code: "DEMO_UNIT_STRING", name: "串", quantity_precision: 0 });
    const unitSection = ensure("units", { code: "DEMO_UNIT_SECTION", name: "处", quantity_precision: 0 });
    const unitPiece = ensure("units", { code: "DEMO_UNIT_PIECE", name: "片", quantity_precision: 0 });
    const unitMeter = ensure("units", { code: "DEMO_UNIT_METER", name: "米", quantity_precision: 2 });
    ensure("units", { code: "DEMO_UNIT_AREA", name: "平方米", quantity_precision: 2 });
    const voltages = {};
    for (const voltage of ["35kV", "110kV", "220kV", "500kV", "1000kV", "±200kV", "±500kV", "±800kV"])
      voltages[voltage] = ensure("voltages", { name: voltage });
    ensure("categories", { name: "线路日常检修" });
    ensure("categories", { name: "线路专项整治" });
    ensure("priorities", { name: "一般" });
    ensure("priorities", { name: "重要" });
    ensure("priorities", { name: "紧急" });
    add("organizations", { name: "【演示】输电运检班" });
    add("organizations", { name: "【演示】施工协作单位" });

    let line220,line110,towers220,towers110,spans220,allSpans;
    if(realAssets){
      const lineRows=system.catalog.list("lines"), towerRows=system.catalog.list("towers"), spanRows=system.catalog.list("spans").filter(row=>row.status==="active");
      const towersById=new Map(towerRows.map(row=>[row.id,row]));
      const select=voltage=>{
        for(const line of lineRows.filter(row=>row.voltage_level_id===voltages[voltage].id)){
          const spans=spanRows.filter(row=>row.line_id===line.id&&row.transmission_center_length_mm>0&&towersById.get(row.start_tower_id)?.status==="active"&&towersById.get(row.end_tower_id)?.status==="active");
          if(spans.length>=12){
            const first=spans[0];
            return {line,spans,towers:[first.start_tower_id,first.end_tower_id].map(id=>({logical:towersById.get(id)}))};
          }
        }
        throw Error("真实台账缺少满足演示条件的 "+voltage+" 线路");
      };
      const a=select("220kV"),b=select("110kV");
      line220=a.line;line110=b.line;towers220=a.towers;towers110=b.towers;spans220=a.spans;
      allSpans=spanRows.filter(row=>row.transmission_center_length_mm>0);
      if(allSpans.length<35)throw Error("真实台账档距不足");
    }else{
    const lineDefinitions = [
      ["220", "220kV青峰线", "220kV", 15],
      ["110", "110kV河湾线", "110kV", 21],
      ["35", "35kV云岭线", "35kV", 1],
      ["500", "500kV远航线", "500kV", 31],
      ["220B", "220kV长宁线", "220kV", 51],
      ["110B", "110kV玉兰线", "110kV", 41],
    ];
    const demoLines = lineDefinitions.map(([code, name, voltage, start]) => ({
      code, start, line: add("lines", {
        code: "DEMO-LINE-" + code, name: "【演示】" + name,
        voltage_level_id: voltages[voltage].id,
      }),
    }));
    line220 = demoLines[0].line; line110 = demoLines[1].line;
    function createTowerSeries(line, label, numbers) {
      const result = [];
      for (const n of numbers) {
        const physical = add("physical", {
          asset_no: "DEMO-" + label + "-T" + n,
          tower_material: n % 2 ? "angle" : "pipe",
        });
        const logical = add("towers", {
          line_id: line.id, physical_tower_id: physical.id,
          tower_no: String(n),
        });
        result.push({ physical, logical });
      }
      return result;
    }
    const towerGroups = demoLines.map(({line, code, start}) =>
      createTowerSeries(line, code, Array.from({length: 12}, (_, index) => start + index)));
    [towers220, towers110] = towerGroups;
    function addSpans(line, towers) {
      return towers.slice(1).map((tower, i) => add("spans", {
        line_id: line.id,
        start_tower_id: towers[i].logical.id,
        end_tower_id: tower.logical.id,
        transmission_center_length_mm: [168000, 220000, 185000, 276000, 198000][i % 5],
        status: "active",
      }));
    }
    const spanGroups = demoLines.map(({line}, index) => addSpans(line, towerGroups[index]));
    [spans220] = spanGroups;
    allSpans = spanGroups.flat();
    }
    const label220=realAssets?line220.name:"220kV青峰线",label110=realAssets?line110.name:"110kV河湾线";
    const project220=realAssets?line220.name:"青峰线",project110=realAssets?line110.name:"河湾线";

    const bird = add("objects", {
      name: "防鸟装置", code: "DEMO-WO-BIRD", object_position: "body", attribution_unit: "logical_tower",
    });
    const insulator = add("objects", {
      name: "绝缘子串", code: "DEMO-WO-INSULATOR", object_position: "body", attribution_unit: "logical_tower",
    });
    const conductor = add("objects", {
      name: "导线", code: "DEMO-WO-CONDUCTOR", object_position: "corridor", attribution_unit: "logical_tower",
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
    // Each pricing model has its own concrete work operation and immutable rule.
    // Amounts are fictional examples, not utility-approved tariffs or quotas.
    const modelExamples = [
      {mode:"fixed", title:"导线定期专项巡检", params:{}, unit:18000},
      {mode:"base_plus_unit", title:"导线修补及进场", params:{}, unit:4500, base:8000},
      {mode:"quantity_bracket", title:"导线压接处理", params:{}, unit:0,
        brackets:[{min_quantity_scaled:10000,max_quantity_scaled:20000,base_fee_fen:2000,unit_price_fen:4000},
          {min_quantity_scaled:30000,max_quantity_scaled:null,base_fee_fen:3500,unit_price_fen:3500}]},
      {mode:"progressive_bracket", title:"导线分段防腐", params:{tiers:[
        {up_to_quantity_scaled:20000,unit_price_fen:5000},
        {up_to_quantity_scaled:50000,unit_price_fen:4000},
        {up_to_quantity_scaled:null,unit_price_fen:3000}]}, unit:0},
      {mode:"group", title:"导线防振装置检查", params:{group_size_scaled:30000,group_fee_fen:13000},unit:0},
      {mode:"rate", title:"导线专项人工费率核算", params:{rate_basis:"labor",rate_basis_points:1500},unit:0},
      {mode:"composite", title:"导线综合缺陷治理", params:{},unit:0,
        components:[{coverage_key:"labor",formula_mode:"per_unit",unit_price_fen:4000},
          {coverage_key:"machinery",formula_mode:"fixed",unit_price_fen:12000}]},
    ].map((example, index) => {
      const operation = add("operations", {
        name:"【演示】" + example.title, code:"DEMO-OP-MODE-" + example.mode.toUpperCase(),
        work_object_id:conductor.id, default_unit_id:unitSection.id,
        completion_standard:"【演示】按操作标准完成" + example.title + "并验收",
      });
      rule("【演示】" + example.title + "参考价", "DEMO-PRICE-MODE-" + index,
        operation, example.unit, {
          pricing_mode:example.mode, base_fee_fen:example.base || 0,
          calculation_params_json:example.params,
          quantity_brackets_json:example.brackets || [],
          fee_components_json:example.components || [],
        });
      return {...example, operation};
    });


    const currentDate = today();
    const installDemand = system.demands.save(user, {
      demand_no: "DEMO-D-001",
      operation_id: birdOperation.id,
      problem_description: "【演示】"+label220+towers220[0].logical.tower_no+"、"+towers220[1].logical.tower_no+"号杆塔缺少防鸟装置",
      expected_on: currentDate,
      completion_standard: "补装防鸟装置并验收",
      materials: [{ material_id: birdMaterial.id, quantity_scaled: 50000 }],
      work_locations: [
        {
          location_kind: "logical_tower",
          logical_tower_id: towers220[0].logical.id,
          quantity_scaled: 20000,
          attributes: {
            [difficulty.key]: "常规",
          },
        },
        {
          location_kind: "logical_tower",
          logical_tower_id: towers220[1].logical.id,
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
      problem_description: "【演示】"+label110+towers110[0].logical.tower_no+"号杆塔绝缘子串老化",
      expected_on: currentDate,
      work_locations: [{
        location_kind: "logical_tower",
        logical_tower_id: towers110[0].logical.id,
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
      problem_description: "【演示】"+label220+towers220[0].logical.tower_no+"—"+towers220[1].logical.tower_no+"号档导线局部损伤",
      work_locations: [{
        location_kind: "span", span_id: spans220[0].id, quantity_scaled: 10000,
      }],
      sources: [{ description: "【演示】巡检照片及缺陷处理建议" }],
    });

    // Three realistic demand examples per additional model, each on a
    // different span; the same work operation is not duplicated at a site.
    const modelDemands = [];
    for (const [modelIndex, example] of modelExamples.entries()) {
      for (let repeat = 0; repeat < 3; repeat++) {
        const workSpan = allSpans[modelIndex * 5 + repeat];
        const demand = system.demands.save(user, {
          operation_id: example.operation.id,
          problem_description: "【演示】" + example.title + "（现场样例" + (repeat + 1) + "）",
          expected_on: new Date(Date.parse(currentDate+"T00:00:00Z")+
            (modelIndex+repeat+1)*86400000).toISOString().slice(0,10),
          work_locations: [{
            location_kind:"span", span_id:workSpan.id,
            quantity_scaled:(repeat + 1) * 10000,
            work_mode:"non_outage",
          }],
          sources:[{description:"【演示】虚构巡视及施工条件，不代表真实电网设备"}],
        });
        system.demands.transition(user,demand.id,{
          expected_version:1, expected_event_seq:1, status:"active",
        });
        const bases = example.mode === "rate"
          ? {1:{labor:200000 + repeat * 50000,evidence:"【演示】虚构人工费清单"}}
          : {};
        const result = system.pricing.quote(user,demand.id,{
          expected_version:1,pricing_date:currentDate,confirm:true,bases,
        });
        if (!result.complete || result.total_fen === null)
          throw Error("演示计价模型无法完整计价：" + example.mode + " / " +
            JSON.stringify(result.missing));
        modelDemands.push({demand,example,bases,modelIndex,repeat});
      }
    }

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
      name: "【演示】"+project220+"防鸟装置整治", framework_id: framework.id,
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
      number: "DEMO-S-001", approval_version_id: approval.id, mode: "itemized",
      items: [{
        cost_node_id: node.id,
        project_scope_id: project.scopes[0].id,
        quantity_scaled: 20000,
        amount_fen: 10800,
        evidence: "【演示】第一批结算资料",
      }],
      resolutions: [{
        project_scope_id: project.scopes[0].id, location_item_no: 1,
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
      mode: "project_total", amount_fen: 16600,
      basis: "【演示】第二批按项目总额结算，待提交",
    });

    let pending = system.projects.save(user, {
      name: "【演示】"+project110+"绝缘子专项更换",
      framework_id: framework.id,
    });
    pending = system.projects.link(user, pending.id, {
      demand_id: replacementDemand.id, expected_version: 1,
    });
    pending = system.projects.fund(user, pending.id, {
      agreement_id: agreement2.id, expected_version: 0,
    });
    system.projects.stock(user, pending.id, { expected_version: 1 });
    // Spread demonstrable lifecycle stages across additional projects.
    // Approved projects always adopt the entire one-position demand.
    const demoFramework2 = add("frameworks",{
      name:"【演示】2026年输电线路专项治理框架",fiscal_year:2026,limit_fen:80000000,
    });
    for (const [index, example] of modelDemands.slice(0,14).entries()) {
      const selectedFramework = index % 2 ? framework : demoFramework2;
      let demoProject = system.projects.save(user,{
        name:"【演示】" + example.example.title + "项目" + (example.repeat + 1),
        framework_id:selectedFramework.id,
      });
      demoProject = system.projects.link(user,demoProject.id,{
        demand_id:example.demand.id,expected_version:1,
      });
      if (index % 5 === 4) continue; // legitimate reserved project
      demoProject = system.projects.stock(user,demoProject.id,{expected_version:1});
      if (index % 5 === 3) continue; // stocked, not yet submitted
      demoProject = system.projects.approvalDraft(user,demoProject.id,{
        expected_version:2,
        approved_budget_fen:100000 + index * 25000,
        scopes:[{
          project_scope_id:demoProject.scopes[0].id,
          demand_version:1,
          locations:[{location_item_no:1,
            approved_quantity_scaled:(example.repeat + 1) * 10000}],
        }],
      });
      const price = system.pricing.quote(user,example.demand.id,{
        expected_version:1,
        approval_scope_version_id:demoProject.approvals[0].scopes[0].id,
        pricing_date:currentDate,confirm:true,bases:example.bases,
      });
      if (!price.complete) throw Error("演示项目计价不完整：" + example.example.mode);
      if (index % 5 === 2) continue; // approval draft for workflow demo
      demoProject = system.projects.approve(user,demoProject.id,
        demoProject.approvals[0].id,{expected_version:2});
    }
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
  const useImportedAssets = options.real === true || Boolean(options.assetSource);
  if (existsSync(markerPath)) {
    const marker = JSON.parse(readFileSync(markerPath, "utf8"));
    if (marker.purpose !== "local-demo" ||
        (!OLDER_DEMO_VERSIONS.has(marker.version) && marker.version !== SEED_VERSION))
      throw Error("已有演示数据版本与当前程序不匹配，请手动检查，拒绝覆盖");
    const real=marker.asset_basis==="imported-ledger";
    if(real!==useImportedAssets)
      throw Error("真实台账演示与合成夹具必须使用独立目录");
    if (OLDER_DEMO_VERSIONS.has(marker.version) || marker.schema_sha256 !== schemaFingerprint()){
      if(real)throw Error("真实台账演示库结构改变，请使用升级工具，不得自动重建已有业务数据");
      return refreshOutdatedDemo(directory, options, marker);
    }
    const system = createSystem(directory);
    try {
      const existing = counts(system);
      if (existing.operations < 10 || existing.projects < 16 || existing.lines < 6)
        throw Error("演示数据不完整，拒绝静默重新生成，请检查现有演示目录");
      return { created: false, directory, ...existing };
    } finally {
      system.close();
    }
  }
  if (existsSync(directory) && readdirSync(directory).length)
    throw Error("目标目录已有非演示数据，拒绝写入：" + directory);
  if(useImportedAssets){
    if(!options.assetSource)throw Error("首次创建真实台账演示需要显式提供本地源文件");
    if(typeof options.password!=="string"||options.password.length<16||options.password===DEMO_PASSWORD)
      throw Error("真实台账演示必须使用独立的强密码，不允许固定演示凭据");
    mkdirSync(dirname(directory),{recursive:true,mode:0o700});
    const staging=mkdtempSync(join(dirname(directory),".real-demo-import-"));
    const output=join(staging,"seed"),candidate=join(output,"data");
    try{
      const result=spawnSync(process.execPath,[resolve(import.meta.dirname,"../import/line-statistics.mjs"),options.assetSource,output],{
        env:{...process.env,SD_SEED_ACCOUNT:DEMO_ACCOUNT,SD_ADMIN_PASSWORD:options.password},encoding:"utf8",timeout:180000
      });
      if(result.status!==0)throw Error("真实台账导入失败："+result.stderr);
      const system=createSystem(candidate);
      let populated;
      try{
        const before=counts(system);
        populated=populate(system,options.password,true);
        for(const key of ["lines","physicalTowers","logicalTowers","spans"])if(before[key]!==populated[key])throw Error("演示业务写入改变真实基础台账数量："+key);
        if(!system.database.verifyIntegrity())throw Error("演示数据完整性检查未通过");
        const imported=JSON.parse(readFileSync(join(output,"IMPORT-RECEIPT.json"),"utf8"));
        const metadata={purpose:"local-demo",version:SEED_VERSION,schema_sha256:schemaFingerprint(),asset_basis:"imported-ledger",source_sha256:imported.source_sha256,createdAt:new Date().toISOString(),note:"真实设备基础台账；新增需求、项目、价格均为虚构演示",...populated};
        writeFileSync(join(candidate,MARKER),JSON.stringify(metadata,null,2)+"\n",{flag:"wx",mode:0o600});
        system.database.checkpoint();
      }finally{system.close()}
      if(existsSync(directory))rmdirSync(directory);
      renameSync(candidate,directory);
      return {created:true,directory,...populated};
    }finally{rmSync(staging,{recursive:true,force:true});}
  }
  mkdirSync(directory,{recursive:true});
  const system = createSystem(directory);
  try {
    const result = populate(system, options.password || DEMO_PASSWORD);
    if (!system.database.verifyIntegrity())
      throw Error("演示数据完整性检查未通过");
    const metadata = {
      purpose: "local-demo", version: SEED_VERSION,
      schema_sha256: schemaFingerprint(),
      asset_basis:options.assetSource?"imported-ledger":"synthetic-fixture",
      note: options.assetSource?"真实台账；新增需求、价格、项目等均为虚构演示，不可作为真实业务依据":"全部数据虚构，仅供熟悉系统，不可用于真实工程",
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

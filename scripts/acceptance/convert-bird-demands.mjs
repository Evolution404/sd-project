import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { createSystem } from "../../dist/server/bootstrap.js";
import { readEquipmentAudit } from "../../dist/server/database/queries/equipment-audit.js";
import { createExchange } from "../../dist/server/modules/exchange/service.js";
import {
  makeWorkbook,
  attributeColumn,
} from "../../dist/server/modules/exchange/workbook.js";
const output = resolve(process.argv[2] || "test-results/dux/bird");
await mkdir(output, { recursive: true });
const raw = JSON.parse(await readFile(join(output, "原始读取.json"), "utf8"));
const detailSheets = raw.sheets.filter(
  (sheet) =>
    sheet.rows[0]?.cells["3"] === "线路" &&
    sheet.rows[0]?.cells["4"] === "杆塔号",
);
const records = detailSheets.flatMap((sheet) =>
  sheet.rows
    .filter((row) => row.row !== 1 && row.cells["3"] && row.cells["4"])
    .map((row) => ({ ...row, sheet: sheet.name })),
);
const ledgerPath = resolve(process.argv[3] || "data/schema113.sqlite");
const ledgerBefore = createHash("sha256")
  .update(await readFile(ledgerPath))
  .digest("hex");
const ledger = readEquipmentAudit(ledgerPath);
const modes = [
  { column: 8, name: "安装防鸟刺", complete: 20, multiplier: 1 },
  { column: 9, name: "安装V串防鸟挡板", complete: 23, multiplier: 1 },
  { column: 10, name: "安装非V串防鸟挡板", complete: 23, multiplier: 3 },
  { column: 11, name: "安装单串防鸟罩", complete: 17, multiplier: 1 },
  { column: 12, name: "安装双串防鸟罩", complete: 17, multiplier: 1 },
];
const attribute = (key, label, options) => ({
  key,
  label,
  scope: "location",
  source: "manual",
  type: options ? "select" : "text",
  requirement: "optional",
  pricing: false,
  enabled: true,
  sort_order: 1,
  hint: "按原始资料核对",
  ...(options
    ? { options: options.map((value) => ({ value, label: value })) }
    : {}),
});
const attributes = [
  attribute("bird-droppings", "鸟粪等级", ["二级", "三级"]),
  attribute("bird-nest", "鸟巢等级", ["二级", "三级"]),
  attribute("bird-risk", "鸟害等级", ["二级", "三级", "东方白鹳3公里区域"]),
  attribute("cover-model", "防鸟罩型"),
  attribute("site-note", "现场说明"),
];
const cleanTower = (row) => {
  const line = String(row.cells["3"]),
    tower = String(row.cells["4"]).trim();
  return tower.startsWith(line) ? tower.slice(line.length).trim() : tower;
};
const identity = (row) =>
  String(row.cells["2"]) +
  "\0" +
  String(row.cells["3"]) +
  "\0" +
  cleanTower(row);
const grouped = new Map();
for (const row of records) {
  const key = identity(row);
  if (!grouped.has(key)) grouped.set(key, []);
  grouped.get(key).push(row);
}
const duplicateGroups = [...grouped.values()].filter((rows) => rows.length > 1);
const duplicateKeys = new Set(duplicateGroups.map((rows) => identity(rows[0])));

const inventory = [],
  candidates = [],
  completed = [],
  retired = [],
  review = [],
  missing = [];
for (const row of records) {
  const cells = row.cells,
    remark = String(cells["26"] || "").trim();
  const stateText = [remark, cells["11"], cells["12"]].join(" ");
  const state = /无此塔/.test(stateText)
    ? "无此塔"
    : /退役/.test(stateText)
      ? "退役"
      : /停役/.test(stateText)
        ? "停役"
        : /下地|电缆/.test(stateText)
          ? "下地或电缆"
          : null;
  const matches = ledger.filter(
    (item) =>
      item.line_name === String(cells["3"]) &&
      item.voltage_name === String(cells["2"]) &&
      (item.tower_no === String(cells["4"]).trim() ||
        item.tower_no === cleanTower(row)),
  );
  const base = {
    sheet: row.sheet,
    source_row: row.row,
    line: String(cells["3"]),
    voltage: String(cells["2"]),
    source_tower: String(cells["4"]),
    tower_no: cleanTower(row),
    remark,
    ledger_match:
      matches.length === 1
        ? "唯一匹配"
        : matches.length
          ? "台账歧义"
          : "台账未匹配",
  };
  if (matches.length !== 1) missing.push(base);
  if (state) retired.push({ ...base, state });
  for (const mode of modes) {
    const value = cells[String(mode.column)];
    if (
      value === undefined ||
      value === null ||
      String(value).trim() === "" ||
      value === 0
    )
      continue;
    const fact = {
      ...base,
      operation: mode.name,
      source_quantity: value,
      multiplier: mode.multiplier,
      quantity: typeof value === "number" ? value * mode.multiplier : null,
      completed_on: cells[String(mode.complete)] || null,
    };
    inventory.push(fact);
    if (state) {
      review.push({ ...fact, reason: state });
      continue;
    }
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value <= 0
    ) {
      review.push({ ...fact, reason: "应装数量含非正整数或状态文字" });
      continue;
    }
    if (cells[String(mode.complete)]) {
      completed.push(fact);
      continue;
    }
    if (duplicateKeys.has(identity(row))) {
      review.push({
        ...fact,
        reason: "同线路杆号源记录重复，须人工核实数量和现场属性",
      });
      continue;
    }
    if (/用户|溧水|江宁|构架/.test(remark)) {
      review.push({ ...fact, reason: "设备归属或位置范围待核实" });
      continue;
    }
    const values = {};
    for (const [column, key] of [
      [5, "bird-droppings"],
      [6, "bird-nest"],
      [7, "bird-risk"],
      [13, "cover-model"],
      [26, "site-note"],
    ]) {
      const value = cells[String(column)];
      if (
        value !== undefined &&
        value !== null &&
        String(value).trim() &&
        value !== "/"
      )
        values[key] = String(value).trim();
    }
    const invalid = attributes.find(
      (field) =>
        field.type === "select" &&
        values[field.key] &&
        !field.options.some((option) => option.value === values[field.key]),
    );
    if (invalid) {
      review.push({ ...fact, reason: invalid.label + "存在未定义原值" });
      continue;
    }
    candidates.push({ ...fact, attributes: values });
  }
}
function csv(rows) {
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const cell = (value) =>
    '"' +
    String(
      value === undefined || value === null
        ? ""
        : typeof value === "object"
          ? JSON.stringify(value)
          : value,
    ).replaceAll('"', '""') +
    '"';
  return (
    "\ufeff" +
    [keys, ...rows.map((row) => keys.map((key) => row[key]))]
      .map((row) => row.map(cell).join(","))
      .join("\r\n")
  );
}
for (const [name, rows] of Object.entries({
  可转换候选记录: candidates,
  台账无法匹配: missing,
  已完成措施: completed,
  退役停役下地及其他状态: retired,
  待人工核实: review,
  重复及冲突: duplicateGroups.flatMap((group) =>
    group.map((row) => ({
      sheet: row.sheet,
      source_row: row.row,
      line: row.cells["3"],
      tower: row.cells["4"],
      values: row.cells,
    })),
  ),
}))
  await writeFile(join(output, name + ".csv"), csv(rows));
const isolated = await mkdtemp(join(tmpdir(), "sd-dux-bird-"));
const system = createSystem(isolated);
let integration;
try {
  system.auth.initialize("admin", "Bird-Acceptance-Isolated-2026");
  const { user } = system.auth.login("admin", "Bird-Acceptance-Isolated-2026");
  const save = (kind, input) => system.catalog.save(user, kind, input);
  const unit = save("units", { name: "个", quantity_precision: 0 });
  const object = save("objects", {
    name: "线路侧防鸟设施",
    work_target_type: "line",
  });
  const operationMap = new Map(),
    lines = new Map(),
    positions = new Map();
  const principles = records
    .map((row) => String(row.cells["28"] || ""))
    .filter(Boolean);
  for (const mode of modes) {
    const principle = principles.find((text) =>
      text.startsWith(
        mode.column === 8
          ? "防鸟刺"
          : mode.column <= 10
            ? "防鸟挡板"
            : "防鸟罩",
      ),
    );
    operationMap.set(
      mode.name,
      save("operations", {
        name: mode.name,
        work_object_id: object.id,
        default_unit_id: unit.id,
        completion_standard:
          principle || raw.sheets[0].rows[0].cells[String(mode.column)],
        attributes_schema_json: attributes,
        allow_tower: 1,
        allow_span: 0,
      }),
    );
  }
  // This isolated fixture is built from explicit source line/tower facts. It does
  // not assert shared physical identity or create records in the source ledger.
  system.database.transaction(() => {
    const voltages = new Map();
    for (const fact of candidates) {
      if (!voltages.has(fact.voltage))
        voltages.set(fact.voltage, save("voltages", { name: fact.voltage }));
      const lineKey = fact.voltage + "\0" + fact.line;
      if (!lines.has(lineKey))
        lines.set(
          lineKey,
          save("lines", {
            name: fact.line,
            voltage_level_id: voltages.get(fact.voltage).id,
          }),
        );
      const towerKey = lineKey + "\0" + fact.tower_no;
      if (!positions.has(towerKey))
        positions.set(
          towerKey,
          save("towers", {
            line_id: lines.get(lineKey).id,
            tower_no: fact.tower_no,
          }),
        );
    }
  });
  const demands = new Map();
  for (const fact of candidates) {
    const key = fact.operation + "\0" + fact.voltage + "\0" + fact.line;
    if (!demands.has(key)) demands.set(key, []);
    demands.get(key).push(fact);
  }
  const documents = [],
    work_locations = [],
    provenance = [];
  for (const [index, facts] of [...demands.values()].entries()) {
    const first = facts[0],
      operation = operationMap.get(first.operation),
      importRef = "XQ" + String(index + 1).padStart(3, "0");
    documents.push({
      import_ref: importRef,
      operation_name: operation.name,
      problem_description:
        first.line + " " + first.operation + "（原表待实施记录）",
      completion_standard: operation.completion_standard,
      primary_source:
        "20260915防鸟反措明细.xlsx / " +
        first.sheet +
        " / 原始行 " +
        facts.map((row) => row.source_row).join("、") +
        " / SHA256 " +
        raw.sha256,
    });
    for (const [position, fact] of facts.entries()) {
      const locationRef = "WZ" + String(position + 1).padStart(3, "0");
      work_locations.push({
        import_ref: importRef,
        location_ref: locationRef,
        location_kind: "logical_tower",
        line_name: fact.line,
        voltage_name: fact.voltage,
        tower_no: fact.tower_no,
        quantity_scaled: fact.quantity * 10000,
        ...Object.fromEntries(
          Object.entries(fact.attributes).map(([key, value]) => [
            attributeColumn(key),
            value,
          ]),
        ),
      });
      provenance.push({
        ...fact,
        import_ref: importRef,
        location_ref: locationRef,
      });
    }
  }
  const bytes = await makeWorkbook(
    "demands",
    { documents, work_locations },
    { attributes },
  );
  await writeFile(join(output, "防鸟反措_需求转换.xlsx"), bytes);
  await writeFile(join(output, "转换关联与原始行号.csv"), csv(provenance));
  console.log(
    "BIRD_CONVERSION_READY",
    JSON.stringify({
      documents: documents.length,
      locations: work_locations.length,
      isolated_equipment: positions.size,
    }),
  );
  const exchange = createExchange(system),
    preview = await exchange.preview(user, "demands", bytes, {
      mode: "create",
    });
  if (preview.issues.length)
    throw Error(JSON.stringify(preview.issues.slice(0, 4)));
  if (system.demands.list().length) throw Error("预检写入了正式需求");
  const result = exchange.commit(user, preview.token, {
    request_key: "bird-real-file-isolated-20261112",
    atomic: true,
  });
  if (result.issues.length)
    throw Error(JSON.stringify(result.issues.slice(0, 4)));
  const registered = system.demands.list();
  const total = registered.reduce((sum, row) => sum + row.quantity_scaled, 0);
  if (total !== candidates.reduce((sum, row) => sum + row.quantity * 10000, 0))
    throw Error("转换工作量与导入正式工作量不一致");
  integration = {
    demands: registered.length,
    locations: registered.reduce(
      (sum, row) => sum + row.work_locations.length,
      0,
    ),
    quantity_scaled: total,
    isolated_equipment: positions.size,
    preview_issues: preview.issues.length,
    commit_issues: result.issues.length,
    idempotent:
      JSON.stringify(
        exchange.commit(user, preview.token, {
          request_key: "bird-real-file-isolated-20261112",
          atomic: true,
        }),
      ) === JSON.stringify(result),
  };
  await writeFile(join(output, "隔离导入正式编号.csv"), csv(result.results));
} finally {
  system.close();
  await rm(isolated, { recursive: true, force: true });
}
const sourceAfter = createHash("sha256")
  .update(await readFile(raw.source))
  .digest("hex");
const ledgerAfter = createHash("sha256")
  .update(await readFile(ledgerPath))
  .digest("hex");
if (sourceAfter !== raw.sha256 || ledgerAfter !== ledgerBefore)
  throw Error("只读审计源发生变化");
const summary = {
  source: raw.source,
  source_sha256: raw.sha256,
  sheets: raw.sheets.map((sheet) => ({
    name: sheet.name,
    physical_rows: sheet.row_count,
    nonempty_rows: sheet.rows.length,
  })),
  records: records.length,
  lines: new Set(records.map((row) => row.cells["3"])).size,
  unique_positions: grouped.size,
  duplicate_groups: duplicateGroups.length,
  ledger_path: ledgerPath,
  ledger_positions: ledger.length,
  unmatched_records: missing.length,
  inventory_measures: inventory.length,
  completed_measures: completed.length,
  excluded_device_records: retired.length,
  review_measures: review.length,
  candidate_measures: candidates.length,
  measures: modes.map((mode) => ({
    operation: mode.name,
    multiplier: mode.multiplier,
    positive_records: inventory.filter(
      (row) => row.operation === mode.name && row.quantity > 0,
    ).length,
    raw_quantity: inventory
      .filter((row) => row.operation === mode.name && row.quantity > 0)
      .reduce((sum, row) => sum + row.source_quantity, 0),
    converted_quantity: inventory
      .filter((row) => row.operation === mode.name && row.quantity > 0)
      .reduce((sum, row) => sum + row.quantity, 0),
    candidate_records: candidates.filter((row) => row.operation === mode.name)
      .length,
  })),
  integration,
  source_unchanged: true,
  ledger_unchanged: true,
};
await writeFile(
  join(output, "验收统计.json"),
  JSON.stringify(summary, null, 2),
);
await writeFile(
  join(output, "原始字段与目标映射.csv"),
  csv([
    {
      source: "线路、电压等级、杆塔号",
      target: "作业位置的真实逻辑杆塔引用",
      rule: "精确线路、电压、杆号。以同列线路完整前缀分离杆号，保留#及前导零；不猜测实物共塔。",
    },
    {
      source: "第8至12列",
      target: "五种独立操作类型和位置需求数量",
      rule: "第10列按用户2026-11-12确认乘以3，其余保持原整数；工作量×10000。",
    },
    {
      source: "鸟粪、鸟巢、鸟害等级",
      target: "位置级单选属性",
      rule: "空与/保持未知，东方白鹳区域原样保留为正式选项；没有价格依据，候选均不启用计价。",
    },
    {
      source: "防鸟罩型号、备注",
      target: "位置级文字属性",
      rule: "仅保留实际填写事实，不推断800/1200mm，状态备注优先排除或待核实。",
    },
    {
      source: "是否钢管塔",
      target: "设备台账待核实属性",
      rule: "属于已有台账事实，不再复制为独立需求属性。",
    },
    {
      source: "完成时间、治理前后照片",
      target: "已完成及历史证据清单",
      rule: "按措施分别排除已完成记录，不转成新增待实施需求，不作发现日期。",
    },
    {
      source: "班组、资产归属、储备顺序、立项时间",
      target: "来源依据或待核实",
      rule: "不从空白推断优先级、项目或管理单位。",
    },
  ]),
);
console.log(JSON.stringify(summary, null, 2));

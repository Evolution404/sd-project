import ExcelJS from "exceljs";
import { scaledDecimal, decimalText } from "../../shared/decimal.js";
import { exchangeColumnLabels as labels, issueDetails } from "../../shared/exchange-display.js";
import { requireValue } from "../../shared/errors/business-error.js";
import type { WorkbookKind, WorkbookReportKind, WorkbookRow, WorkbookIssue, ParsedWorkbookRow, ParsedWorkbook, WorkbookRows, WorkbookLayouts, WorkbookSheetDefinition, WorkbookOptions, ExchangeReportScope } from "../../shared/types/exchange.js";
export const MAX_BYTES = 12 * 1024 * 1024,
  MAX_ROWS = 25000,
  MAX_DOCUMENTS = 5000;
export const attributeColumn = (key: string): string => "attribute_" + Buffer.from(key).toString("hex");
export const attributeKey = (column: string): string => Buffer.from(column.slice(10), "hex").toString();
export const KEEP = "__KEEP__",
  CLEAR = "__CLEAR__",
  DELETE = "delete";
const CLEAR_LABEL = "清空原值";
const KEEP_LABEL = "保留原值";
const decimalPlaces: Record<string,number> = {
  transmission_center_length_mm: 3,
  height_scaled: 4,
  quantity_scaled: 4,
  resolved_quantity_scaled: 4,
  amount_fen: 2,
  unit_price_fen: 2,
};
// Business-readable Excel values; official identity/version columns remain
// in the workbook (hidden), so maintenance export can roundtrip safely.
const businessChoices: Record<string,Record<string,string>> = {
  line_kind: { main: "主线", branch: "支线" },
  status: { active: "在用", inactive: "停用", retired: "退役", draft: "草稿" },
  location_kind: {
    physical_tower: "物理杆塔",
    logical_tower: "逻辑杆塔",
    span: "档距",
  },
  work_mode: { outage: "停电", non_outage: "不停电", unspecified: "未明确" },
  action: { upsert: "新增或修改", delete: "删除" },
  tower_nature: { straight: "直线", tension: "耐张" },
  mode: { project_total: "按项目总额", itemized: "按子费用" },
  tower_material: {angle:"角钢塔",pipe:"钢管杆"},
};
const technicalColumns = new Set([
  "id",
  "tower_code",
  "line_id",
  "voltage_level_id",
  "parent_line_id",
  "junction_tower_id",
  "start_tower_id",
  "end_tower_id",
  "expected_version",
  "expected_edit_version",
  "operation_id",
  "project_id",
  "approval_version_id",
  "funding_version_id",
  "logical_tower_id",
  "physical_tower_id",
  "span_id",
  "material_id",
  "cost_node_id",
  "project_scope_id",
  "priority_id",
  "number",
  "field_key",
  "primary_source_id",
]);
function externalChoice(key:string, value:unknown):unknown {
  return typeof value === "string" ? businessChoices[key]?.[value] || value : value;
}
function internalChoice(key:string, value:unknown):unknown {
  if (!businessChoices[key] || typeof value !== "string") return value;
  const match = Object.entries(businessChoices[key]).find(
    ([, text]) => text === value,
  );
  return match ? match[0] : value;
}

export const layouts: WorkbookLayouts = {
  assets: [
    {
      name: "线路",
      key: "documents",
      columns: [
        "id",
        "expected_version",
        "voltage_level_id",
        "name",
        "voltage_name",
        "line_kind",
        "parent_line_id",
        "parent_line_name",
        "parent_voltage_name",
        "junction_tower_id",
        "junction_tower_no",
        "status",
      ],
    },
    {
      name: "物理杆塔",
      key: "physical",
      columns: [
        "id",
        "expected_version",
        "asset_no",
        "tower_material",
        "tower_nature",        "model",
        "height_scaled",
        "purpose",
        "longitude",
        "latitude",
        "commissioned_on",
        "status",
      ],
    },
    {
      name: "杆塔",
      key: "towers",
      columns: [
        "id",
        "expected_version",
        "line_id",
        "physical_tower_id",
        "line_name",
        "voltage_name",
        "tower_no",
        "status",
        "sharing_line_name",
        "sharing_voltage_name",
        "sharing_tower_no",
        "asset_no",
        "tower_material",
        "tower_nature",        "model",
        "height_scaled",
        "longitude",
        "latitude",
        "operations_team",
        "management_department",
      ],
    },
    {
      name: "档距",
      key: "spans",
      columns: [
        "id",
        "expected_version",
        "line_id",
        "start_tower_id",
        "end_tower_id",
        "line_name",
        "voltage_name",
        "start_tower_no",
        "start_line_name",
        "start_voltage_name",
        "end_tower_no",
        "end_line_name",
        "end_voltage_name",
        "transmission_center_length_mm",
        "status",
      ],
    },
  ],
  demands: [
    { name: "需求清单", key: "documents", columns: ["import_ref", "demand_no", "id", "expected_version", "operation_id", "operation_name",
      "problem_description", "completion_standard", "target_object", "priority_id", "priority_name", "expected_on", "primary_source_id", "primary_source", "discovered_on"] },
    { name: "作业位置", key: "work_locations", columns: ["import_ref", "location_ref", "action", "location_kind", "logical_tower_id", "physical_tower_id", "span_id",
      "line_name", "voltage_name", "tower_no", "end_tower_no", "asset_no", "quantity_scaled", "work_mode", "specification"] },
    { name: "预计物资", key: "materials", columns: ["import_ref", "action", "material_id", "material_name", "material_model", "material_specification", "quantity_scaled", "unit_name", "note"] },
    { name: "补充来源", key: "sources", columns: ["import_ref", "action", "id", "description", "discovered_on"] },
  ],
  settlements: [
    {
      name: "结算单",
      key: "documents",
      columns: [
        "number",
        "id",
        "project_id",
        "expected_version",
        "expected_edit_version",
        "approval_version_id",
        "funding_version_id",
        "amount_fen",
        "mode",
        "settlement_on",
        "basis",
        "change_type",
        "project_name",
      ],
    },
    {
      name: "费用明细",
      key: "items",
      columns: [
        "number",
        "action",
        "cost_node_id",
        "project_scope_id",
        "quantity_scaled",
        "amount_fen",
        "unit_price_fen",
        "evidence",
        "cost_node_path",
        "demand_description",
      ],
    },
    {
      name: "需求解决明细",
      key: "resolutions",
      columns: [
        "number",
        "action",
        "project_scope_id",
        "resolved_quantity_scaled",
        "evidence",
        "demand_description",
      ],
    },
  ],
};
for (const [kind, sheets] of Object.entries(layouts))
  for (const sheet of sheets)
    if (kind === "settlements" && sheet.key !== "documents")
      sheet.columns.push("document_row");
function businessHeader(key:string, kind:WorkbookKind, sheet?:string):string {
  if(kind === "demands" && key === "quantity_scaled") return sheet === "materials" ? "预计数量" : "需求数量";
  // Identity/version columns stay hidden; ordinary equipment users see only
  // Chinese business fields, never technical implementation keys.
  if (kind === "assets") {
    if (key === "voltage_name") return "电压等级";
    if (key === "tower_no") return "杆塔号";
    return labels[key] || key;
  }
  if (decimalPlaces[key])
    return key === "amount_fen" ? "本次金额（元）"
      : key === "unit_price_fen" ? "单价（元）"
      : key === "resolved_quantity_scaled" ? "本次新增解决数量"
      : "工作数量";
  return labels[key] || key;
}
const requiredColumns: Partial<Record<WorkbookKind,Record<string,string[]>>> = {
  assets: { documents: ["name", "voltage_name"], towers: ["line_name", "tower_no"], spans: ["line_name", "start_tower_no", "end_tower_no"] },
  demands: { documents: ["import_ref", "operation_name", "problem_description"], work_locations: ["import_ref", "location_ref", "location_kind", "quantity_scaled"], materials: ["import_ref", "material_name", "quantity_scaled"], sources: ["import_ref", "description"] },
  settlements: { items: ["cost_node_path", "amount_fen", "evidence"], resolutions: ["demand_description", "resolved_quantity_scaled", "evidence"] },
};
const conditionalColumns = new Set([
  "parent_line_name", "junction_tower_no", "sharing_line_name", "sharing_tower_no",
  "document_row", "location_row", "field_name", "factor_name", "value",
]);
function headerRequirement(kind:WorkbookKind, definition:WorkbookSheetDefinition, key:string):string {
  if (requiredColumns[kind]?.[definition.key]?.includes(key)) return "新增必填";
  if (conditionalColumns.has(key) || (kind === "demands" && definition.key === "work_locations"
    && ["line_name", "tower_no", "end_tower_no", "asset_no"].includes(key))) return "条件必填";
  return "";
}
export function issue(
  sheet:string,
  row:number,
  field:string,
  value:unknown,
  reason:string,
  suggestion = "修正后重新上传",
):WorkbookIssue {
  return { sheet, row, field, raw_value: value, reason, suggestion };
}
function cellValue(cell:ExcelJS.Cell):unknown {
  const value = cell.value;
  requireValue(
    !(
      value &&
      typeof value === "object" &&
      ("formula" in value || "sharedFormula" in value)
    ),
    "导入不接受公式，请粘贴为值",
  );
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  requireValue(
    value === null || ["string", "number", "boolean"].includes(typeof value),
    "不支持富文本、超链接或错误单元格",
  );
  return value;
}
async function readWorkbook(buffer: Buffer) {
  requireValue(
    buffer.length > 0 && buffer.length <= MAX_BYTES,
    "Excel文件须在12MB以内",
  );
  requireValue(buffer[0] === 0x50 && buffer[1] === 0x4b, "只接受.xlsx工作簿");
  let endOfDirectory = -1;
  for (
    let offset = buffer.length - 22;
    offset >= Math.max(0, buffer.length - 65557);
    offset--
  ) {
    if (
      buffer.readUInt32LE(offset) === 0x06054b50 &&
      offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length
    ) {
      endOfDirectory = offset;
      break;
    }
  }
  requireValue(endOfDirectory >= 0, "Excel ZIP目录无效");
  const entryCount = buffer.readUInt16LE(endOfDirectory + 10),
    directorySize = buffer.readUInt32LE(endOfDirectory + 12);
  let position = buffer.readUInt32LE(endOfDirectory + 16),
    totalUncompressed = 0;
  requireValue(
    entryCount > 0 &&
      entryCount <= 2000 &&
      position + directorySize <= endOfDirectory,
    "Excel ZIP目录规模无效",
  );
  for (let index = 0; index < entryCount; index++) {
    requireValue(
      position + 46 <= endOfDirectory &&
        buffer.readUInt32LE(position) === 0x02014b50,
      "Excel ZIP条目无效",
    );
    const size = buffer.readUInt32LE(position + 24);
    totalUncompressed += size;
    requireValue(
      size !== 0xffffffff && totalUncompressed <= 80 * 1024 * 1024,
      "Excel解压规模超出限制",
    );
    position +=
      46 +
      buffer.readUInt16LE(position + 28) +
      buffer.readUInt16LE(position + 30) +
      buffer.readUInt16LE(position + 32);
  }
  const workbook = new ExcelJS.Workbook();
  try {
    // ExcelJS declares a pre-Node24 Buffer signature; the bytes have already passed ZIP checks.
    const compatibleBytes = buffer as unknown as Parameters<typeof workbook.xlsx.load>[0];
    await workbook.xlsx.load(compatibleBytes);
  } catch {
    requireValue(false, "Excel文件损坏或格式无效");
  }
  requireValue(!workbook.getWorksheet("报表标记"), "业务报表不能导入。如需修改已有记录，请先点「用 Excel 批量修改」。");
  return workbook;
}
export async function parseWorkbook(buffer:Buffer, kind:WorkbookKind):Promise<ParsedWorkbook> {
  const workbook = await readWorkbook(buffer);
  const layout = layouts[kind];
  requireValue(layout, "未知交换类型");
  const rows:WorkbookRows = {documents:[]},
    issues:WorkbookIssue[] = [];
  let count = 0;
  for (const definition of layout) {
    const sheet = workbook.getWorksheet(definition.name);
    rows[definition.key] = [];
    if (!sheet) {
      requireValue(
        definition.key !== "documents",
        `缺少${definition.name}工作表`,
      );
      continue;
    }
    requireValue(sheet.columnCount <= 180, "工作表列数超出限制");
    const headers = new Map<number,string>();
    sheet.getRow(1).eachCell((cell, column) => {
      const visible = String(cell.value || "").trim().replace(/^(新增必填|条件必填)\s*\n/, "");
      const namedColumns = workbook.definedNames.getNames(`${sheet.name}!${cell.address}`)
        .filter(name => name.startsWith(`sd113_${definition.key}_`))
        .map(name => name.slice(`sd113_${definition.key}_`.length));
      requireValue(namedColumns.length <= 1, "表头字段绑定冲突 " + definition.name + "." + visible);
      const canonical = namedColumns[0] || definition.columns.find(
        (columnKey) => visible === businessHeader(columnKey, kind, definition.key),
      );
      requireValue(typeof canonical === "string", "无法确认Excel表头业务字段",422);
      requireValue(
        definition.columns.includes(canonical) || (kind === "demands" && /^(?:documents|work_locations)$/.test(definition.key) && /^attribute_[0-9a-f]+$/.test(canonical)),
        "未知列 " + definition.name + "." + visible,
      );
      requireValue(
        ![...headers.values()].includes(canonical),
        "重复列 " + businessHeader(canonical, kind, definition.key),
      );
      headers.set(column, canonical);
    });
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      count++;
      requireValue(count <= MAX_ROWS, "工作簿业务行数超过25000");
      const rawValues:Record<string,unknown>={};
      const data:ParsedWorkbookRow = { _sheet: definition.name, _row: rowNumber };
      for (const [column, key] of headers) {
        try {
          const value = cellValue(row.getCell(column));
          rawValues[key]=value;
          if (value !== KEEP && value !== KEEP_LABEL && value !== null) {
            const places = decimalPlaces[key];
            data[key] =
              value === CLEAR || value === CLEAR_LABEL
                ? null
                : places
                  ? scaledDecimal(value, places, key)
                  : internalChoice(key, value);
          }
        } catch (error) {
          issues.push(
            issue(
              definition.name,
              rowNumber,
              key,
              String(row.getCell(column).value),
              error instanceof Error ? error.message : "工作簿单元格校验失败",
            ),
          );
        }
      }
      const dataKeys = Object.keys(data).filter(key => key !== "_sheet" && key !== "_row");
      const emptyExample = kind === "demands" && definition.key === "work_locations" &&
        data.import_ref === "XQ001" && data.location_ref === "WZ001" &&
        dataKeys.every(key => key === "import_ref" || key === "location_ref");
      if (dataKeys.length && !emptyExample) rows[definition.key].push({...data,_raw_values:rawValues});
    });
  }
  requireValue(
    rows.documents.length <= MAX_DOCUMENTS,
    "单批最多5000张业务单据",
  );
  return { rows, issues };
}
function formatScaledCell(value:unknown,places:number):string {
  requireValue(typeof value === "number" && Number.isSafeInteger(value), "Excel数字列的数据必须是安全整数");
  return decimalText(value,places);
}
function columnHint(kind: WorkbookKind, sheet: string, key: string) {
  if (kind === "demands") {
    if (key === "import_ref") return "示例组号 XQ001。同一需求在其他工作表使用同一组号。";
    if (key === "location_ref") return "示例位置 WZ001。同一需求内的位置组号须各不相同。";
    if (key === "quantity_scaled") return "填写实际工作量，例如计量单位为套时填写整数。";
  }
  if (kind === "assets") {
    if (key === "parent_line_name" || key === "junction_tower_no") return "支线才填写所属主线和接入杆塔。";
    if (key === "sharing_line_name" || key === "sharing_tower_no") return "与已有杆塔共用同一实物时填写。";
    if (key === "asset_no" && sheet === "physical") return "此表用于单独维护物理杆塔。普通新建杆塔请填写「杆塔」表。";
  }
  if (kind === "settlements" && key === "amount_fen" && sheet === "documents") return "填写本次结算金额（元）。按费用明细计算时可留空。";
  return "";
}

export async function makeWorkbook(kind:WorkbookKind, rows:Partial<Record<string,WorkbookRow[]>> = {}, options:WorkbookOptions = {}):Promise<Buffer> {
  requireValue(layouts[kind], "未知交换类型");
  if (kind === "demands") {
    const documents = (rows.documents?.length ? rows.documents : [{import_ref:"XQ001"}]).map((row,index)=>({...row,import_ref:row.import_ref || "XQ"+String(index+1).padStart(3,"0")}));
    rows = { ...rows, documents };
    for (const key of ["work_locations","materials","sources"]) {
      rows[key] = (rows[key] || []).map((row,index)=>({...row,
        import_ref:row.import_ref || (documents.length === 1 ? documents[0].import_ref : undefined),
        ...(key === "work_locations" ? {location_ref:row.location_ref || "WZ"+String(index+1).padStart(3,"0")} : {})}));
    }
  }
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "输电项目管理";
  const definitions = [...layouts[kind]];
  const primaryKey = options.assetKind === "lines" ? "documents" : options.assetKind;
  const primaryIndex = kind === "assets" ? definitions.findIndex(sheet => sheet.key === primaryKey) : -1;
  if (primaryIndex > 0) definitions.unshift(definitions.splice(primaryIndex, 1)[0]!);
  for (const original of definitions) {
    const scope = original.key === "documents" ? "demand" : original.key === "work_locations" ? "location" : null;
    const attributes = kind === "demands" && scope ? [...new Map((options.attributes || []).filter(field => field.scope === scope && field.source === "manual" && field.enabled).map(field => [field.key,field])).values()] : [];
    const definition = { ...original, columns: [...original.columns, ...attributes.map(field => attributeColumn(field.key))] };
    requireValue(definition.columns.length <= 180, "附加属性列超过180列，请缩小操作类型范围");
    const sheet = workbook.addWorksheet(definition.name);
    if (kind === "demands" && definition.key === "sources" && !rows.sources?.length) sheet.state = "hidden";
    sheet.columns = definition.columns.map((key) => ({
      header: [attributes.find(field => attributeColumn(field.key) === key)?.requirement === "save" ? "新增必填" :
        attributes.find(field => attributeColumn(field.key) === key)?.requirement === "pricing" ? "条件必填" : headerRequirement(kind, definition, key),
        attributes.find(field => attributeColumn(field.key) === key)?.label || businessHeader(key, kind, definition.key)].filter(Boolean).join("\n"),
      key,
      hidden: technicalColumns.has(key),
      width: [
        "id",
        "operation_id",
        "project_id",
        "approval_version_id",
      ].includes(key)
        ? 40
        : 26,
    }));
    for (const column of sheet.columns) {
      column.hidden = technicalColumns.has(column.key ?? "");
      column.style = {
        ...column.style,
        protection: { locked: technicalColumns.has(column.key ?? "") },
      };
    }
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    for (const [index, key] of definition.columns.entries()) {
      const headerCell = sheet.getCell(1, index + 1);
      headerCell.protection = { locked: false };
      headerCell.alignment = { vertical: "middle", wrapText: true };
      workbook.definedNames.add(`${sheet.name}!${headerCell.address}`, `sd113_${definition.key}_${key}`);
      const hint = columnHint(kind, definition.key, key);
      if (hint) headerCell.note = hint;
      if (!businessChoices[key]) continue;
      const options = Object.values(businessChoices[key]).join(",");
      const letter = sheet.getColumn(index + 1).letter;
      const validations = sheet as ExcelJS.Worksheet & {dataValidations:{add(range:string, validation:ExcelJS.DataValidation):void}};
      validations.dataValidations.add(letter + "2:" + letter + "5001", {
        type: "list",
        allowBlank: true,
        showErrorMessage: false,
        formulae: ['"' + options + '"'],
      });
    }
    sheet.getRow(1).height = 42;
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF23434E" },
    };
    for (const data of rows[definition.key] || []) {
      const row:Record<string,unknown> = {};
      for (const key of definition.columns) {
        const value = data[key];
        row[key] =
          value == null
            ? null
            : decimalPlaces[key]
              ? formatScaledCell(value, decimalPlaces[key])
              : Array.isArray(value) && key.startsWith("attribute_") ? value.join("、")
              : typeof value === "object"
                ? JSON.stringify(value)
                : externalChoice(key, value);
      }
      sheet.addRow(row);
    }
    if (options.template && kind === "demands" && definition.key === "work_locations") {
      sheet.getCell("A2").value = "XQ001";
      sheet.getCell("A2").note = "示例。此处填写需求清单中同一条需求的组号。";
      sheet.getCell("B2").value = "WZ001";
      sheet.getCell("B2").note = "同一需求内，每个位置用不同组号。";
    }
    if (!options.report)
      await sheet.protect("", {
        selectLockedCells: true,
        selectUnlockedCells: true,
        insertRows: true,
        deleteRows: true,
        autoFilter: true,
        sort: true,
      });
    if (!options.report)
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: {
          row: Math.max(2, sheet.rowCount),
          column: definition.columns.length,
        },
      };
  }
  const info = workbook.addWorksheet("使用说明");
  info.columns = [{ width: 110 }];
  const instructions: Record<WorkbookKind, string[]> = {
    demands: [
      "先填需求清单，再填作业位置。预计物资有需要时再填。",
      "同一条需求的组号一致。例：需求清单中的 XQ001 对应作业位置中的 XQ001；多个位置分别用 WZ001、WZ002。",
      "一个位置一行。按操作类型的计量单位填写实际工作量。",
    ],
    assets: [
      "只填写要新增或修改的设备表。普通新增杆塔填写「杆塔」。",
      "档距填写所属线路和两端杆塔号，填写范围是输电中心管辖的长度，单位为米。",
    ],
    settlements: [
      "只知道本次结算金额时，在「结算单」填入金额（元），即可保存草稿。",
      "有费用明细或实际解决量时，填写相应的表。多张结算单按结算单所在行号关联明细。",
      "导入后在系统内提交审核，批准后计入项目累计结算。",
    ],
  };
  for (const instruction of [
    ...instructions[kind],
    "填写表头标出的必填内容。修改已有记录时留空保留原值，需清空则填写「清空原值」。",
    "含「明细动作」的表可选「删除」。粘贴外部数据时请选择粘贴为值。",
  ]) {
    const row = info.addRow([instruction]);
    row.alignment = { wrapText: true, vertical: "middle" };
    row.height = 30;
  }

  if (options.lookups) {
    const sheet = workbook.addWorksheet("可选基础数据");
    sheet.columns = [
      { header: "类别", key: "kind", width: 22 },
      { header: "稳定标识", key: "id", width: 42 },
      { header: "型号", key: "model", width: 24 },
      { header: "规格", key: "specification", width: 24 },
      { header: "名称", key: "name", width: 38 },
    ];
    sheet.getColumn("id").hidden = true;
    for (const row of options.lookups) sheet.addRow(row);
  }
  if (options.report) {
    const properties = workbook.addWorksheet("报表标记");
    properties.state = "veryHidden";
    properties.addRow(["READ_ONLY_REPORT"]);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
export async function correctionWorkbook(buffer: Buffer, issues: WorkbookIssue[],
  completed: ReadonlyMap<string, ReadonlySet<number>>): Promise<Buffer> {
  const workbook = await readWorkbook(buffer);
  const title = "导入检查问题";
  const previousSummary = workbook.getWorksheet(title);
  if (previousSummary) workbook.removeWorksheet(previousSummary.id);
  const summary = workbook.addWorksheet(title);
  summary.columns = [
    { header: "位置（点击跳转）", key: "place", width: 32 },
    { header: "字段", key: "field", width: 24 },
    { header: "问题", key: "issue", width: 52 },
    { header: "处理建议", key: "suggestion", width: 52 },
  ];
  for (const [name, rows] of completed) {
    const sheet = workbook.getWorksheet(name);
    if (!sheet) continue;
    for (const row of rows) sheet.getRow(row).values = [];
  }
  for (const issue of issues) {
    const details = issueDetails(issue);
    const sheet = workbook.getWorksheet(issue.sheet);
    const place = issue.sheet + " · 第 " + issue.row + " 行";
    summary.addRow({ place: sheet && issue.row > 0
      ? { text: place, hyperlink: "#'" + sheet.name.replace(/'/g, "''") + "'!A" + issue.row }
      : place, field: details.label, issue: details.reason, suggestion: details.suggestion });
    if (sheet && issue.row > 1 && issue.row <= sheet.rowCount) {
      const row = sheet.getRow(issue.row);
      row.eachCell(cell => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE8DD" } };
      });
    }
  }
  workbook.views = [{ x: 0, y: 0, width: 12000, height: 18000, activeTab: workbook.worksheets.length - 1, firstSheet: 0, visibility: "visible" }];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function errorsWorkbook(issues:WorkbookIssue[]):Promise<Buffer> {
  const workbook = new ExcelJS.Workbook(),
    sheet = workbook.addWorksheet("问题清单");
  sheet.columns = [
    ["import_ref", "导入关联号"],
    ["demand_no", "正式需求编号"],
    ["location_ref", "位置关联号"],
    ["sheet", "工作表"],
    ["row", "行号"],
    ["field", "字段"],
    ["raw_value", "原始值"],
    ["reason", "原因"],
    ["suggestion", "建议"],
  ].map(([key, header]) => ({
    key,
    header,
    width: key === "reason" ? 55 : 28,
  }));
  for (const item of issues) {
    const details = issueDetails(item);
    sheet.addRow({ ...item, field: details.label, raw_value: details.value, suggestion: details.suggestion });
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function makeBusinessReport(kind:WorkbookReportKind, records:Record<string,unknown>[], positions:Record<string,unknown>[] = [], scope?:ExchangeReportScope):Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "输电项目管理";
  function addSheet(name:string, rows:Record<string,unknown>[], summary?: ExchangeReportScope) {
    const sheet = workbook.addWorksheet(name);
    const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    if (!headers.length) headers.push("当前筛选结果为空");
    sheet.columns = headers.map((header) => ({
      key: header,
      width: header.includes("描述") || header.includes("依据") ? 42 : 24,
    }));
    if (summary) {
      const time = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 19).replace("T", " ");
      sheet.addRow([`范围：${summary.label}，共 ${summary.count} 条`]);
      sheet.addRow(["生成时间（北京时间）：" + time]);
      for (const row of [1, 2]) {
        sheet.mergeCells(row, 1, row, Math.max(2, headers.length));
        sheet.getRow(row).height = row === 1 ? 30 : 20;
      }
    }
    const heading = sheet.addRow(headers);
    for (const row of rows) sheet.addRow(row);
    sheet.views = [{ state: "frozen", ySplit: heading.number }];
    heading.height = 42;
    heading.font = { bold: true, color: { argb: "FFFFFFFF" } };
    heading.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF23434E" },
    };
    sheet.pageSetup = {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    };
    sheet.eachRow(
      (row) => (row.alignment = { vertical: "top", wrapText: true }),
    );
    return sheet;
  }
  addSheet(
    kind === "demands"
      ? "专业需求报表"
      : kind === "assets"
        ? "设备台账报表"
        : kind === "exchange"
          ? "导入结果"
          : kind === "projects" ? "子项目清单" : "结算业务报表",
    records, scope,
  );
  if (positions.length) addSheet(kind === "settlements" ? "生效需求解决量" : "需求位置报表", positions);
  const marker = workbook.addWorksheet("报表标记");
  marker.state = "veryHidden";
  marker.addRow(["READ_ONLY_REPORT"]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

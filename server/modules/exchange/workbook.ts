import ExcelJS from "exceljs";
import { scaledDecimal, decimalText } from "../../shared/decimal.js";
import { requireValue } from "../../shared/errors/business-error.js";
import type { WorkbookKind, WorkbookReportKind, WorkbookRow, WorkbookIssue, ParsedWorkbookRow, ParsedWorkbook, WorkbookRows, WorkbookLayouts, WorkbookSheetDefinition, WorkbookOptions } from "../../shared/types/exchange.js";
export const MAX_BYTES = 12 * 1024 * 1024,
  MAX_ROWS = 25000,
  MAX_DOCUMENTS = 5000;
export const attributeColumn = (key: string): string => "attribute_" + Buffer.from(key).toString("hex");
export const attributeKey = (column: string): string => Buffer.from(column.slice(10), "hex").toString();
export const KEEP = "__KEEP__",
  CLEAR = "__CLEAR__",
  DELETE = "delete";
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
const labels: Record<string,string> = {
  import_ref: "导入关联号",
  location_ref: "位置关联号",
  primary_source: "主要来源说明",
  primary_source_id: "主要来源身份",
  unit_name: "单位",
  line_kind: "线路类型",
  parent_line_name: "所属主线名称（支线填写）",
  parent_voltage_name: "所属主线电压等级（重名时填写）",
  junction_tower_no: "主线接入杆塔号（支线填写）",
  start_tower_no: "起点杆塔号",
  start_line_name: "起点所属线路（支线接入时填写）",
  start_voltage_name: "起点线路电压等级（重名时填写）",
  end_line_name: "终点所属线路（支线接入时填写）",
  end_voltage_name: "终点线路电压等级（重名时填写）",
  transmission_center_length_mm: "输电中心管辖长度（米）",
  sharing_line_name: "共用实物的已有线路",
  sharing_voltage_name: "共塔线路电压等级",
  sharing_tower_no: "共用实物的已有杆塔号",
  name: "线路名称",
  tower_nature: "杆塔性质",
  line_id: "线路身份",
  voltage_level_id: "电压等级身份",
  parent_line_id: "主线路身份",
  junction_tower_id: "接入杆塔身份",
  start_tower_id: "起点杆塔身份",
  end_tower_id: "终点杆塔身份",
  tower_code: "系统编号",
  purpose: "用途",
  commissioned_on: "投运日期",
  tower_material: "杆塔材质",
  model: "型号",
  height_scaled: "杆塔高度（米）",
  longitude: "经度",
  latitude: "纬度",
  operations_team: "运维班组",
  management_department: "管辖部门",
  status: "状态",
  operation_name: "操作类型名称",
  priority_name: "优先级名称",
  line_name: "线路名称",
  voltage_name: "电压等级名称（同名线路时填写）",
  tower_no: "杆塔号或档距起点杆号",
  end_tower_no: "档距终点杆号",
  asset_no: "独立实物资产铭牌号",
  material_name: "物资名称",
  material_model: "物资型号",
  material_specification: "物资规格",
  project_name: "子项目名称",
  demand_description: "项目需求问题描述",
  document_row: "对应清单行号（多单据时填写）",
  location_row: "作业位置表行号",
  factor_name: "现场特征名称",
  factor_id: "系统特征身份",
  specification: "作业规格",
  field_key: "字段标识",
  field_name: "字段名称",
  value: "实际值",
  cost_node_path: "费用科目完整路径",
  demand_no: "需求编号",
  number: "结算编号",
  id: "系统标识",
  expected_version: "原正式版本",
  expected_edit_version: "原草稿版本",
  operation_id: "操作标识",
  problem_description: "问题描述",
  target_object: "处理部位",
  completion_standard: "验收标准",
  priority_id: "优先级标识",
  expected_on: "预计解决时间",
  action: "明细动作",
  location_kind: "位置类型",
  logical_tower_id: "逻辑塔标识",
  physical_tower_id: "物理塔标识",
  span_id: "档距标识",
  quantity_scaled: "数量（万分之一单位）",
  work_mode: "作业方式",
  material_id: "物资标识",
  note: "备注",
  description: "来源说明",
  discovered_on: "提出日期",
  project_id: "子项目标识",
  approval_version_id: "批准版本标识",
  funding_version_id: "资金版本标识",
  settlement_on: "结算日期",
  basis: "结算依据",
  change_type: "版本动作",
  cost_node_id: "费用科目标识",
  project_scope_id: "项目需求范围标识",
  amount_fen: "本次金额（分）",
  unit_price_fen: "单价（分）",
  evidence: "事实依据",
  resolved_quantity_scaled: "本次新增解决量（万分之一单位）",
};
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
export async function parseWorkbook(buffer:Buffer, kind:WorkbookKind):Promise<ParsedWorkbook> {
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
  requireValue(
    !workbook.getWorksheet("报表标记"),
    "业务报表不能回导，请使用数据维护导出",
  );
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
          if (value !== KEEP && value !== null) {
            const places = decimalPlaces[key];
            data[key] =
              value === CLEAR
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
              kind === "assets" ? businessHeader(key, kind, definition.key) : key,
              String(row.getCell(column).value),
              error instanceof Error ? error.message : "工作簿单元格校验失败",
            ),
          );
        }
      }
      if (Object.keys(data).length > 2) rows[definition.key].push({...data,_raw_values:rawValues});
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
  for (const original of layouts[kind]) {
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
  for (const text of [
    options.report
      ? "业务报表，仅供阅读，不可回导"
      : "数据维护工作簿，可离线修改并回导",
    "金额填写人民币元（最多2位小数），工作量填写实际单位数量（最多4位小数）；档距输电中心管辖长度填写米（最多3位小数），未知请留空，明确无管辖长度填0。",
    "线路、物理杆塔、逻辑杆塔、档距可在同一份 Excel 内录入。普通新增杆塔只需填写逻辑杆塔表；物理杆塔表用于独立维护已有实体或明确新建独立实物。",
    "支线在“线路”填写所属主线和主线接入杆塔号；档距填写所属线路和两端杆塔号。共塔必须明确填写要共享的已有杆塔，不允许猜测实物身份。",
    "系统身份和原版本自动携带。新增填写业务名称、线路杆号及真实属性，单据号由服务端生成。同名歧义须在系统核对后使用维护导出。",
    kind === "demands" ? "需求清单的导入关联号须唯一，作业位置、预计物资和补充来源均填写相同关联号。位置关联号在同一需求内唯一。插行、排序和删除行均保持关联号。" : "多张结算单请明确明细归属。",
    "表头上方标有“新增必填”的列在新增时填写；“条件必填”按支线、共塔、作业位置或多单据关系填写。维护时未填写的单元格保持原值。",
    "表头可以修改显示名称，字段绑定由工作簿自动携带。位置类型、作业方式、杆塔性质和明细动作使用中文下拉选项。",
    `${KEEP} 保持原值，${CLEAR} 明确清除，空单元格/缺少列保持原值。文本空串请使用 __EMPTY__。`,
    "明细action填upsert或delete。未出现的工作表或明细行保持原值。",
    "导入结算只保存草稿。正式提交和审核须在系统内分别操作。",
    "请勿填写公式。系统不按线路名称、杆号或显示名称模糊匹配。",
  ])
    info.addRow([text]);

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
    properties.addRow(["READ_ONLY_REPORT"]);
  }
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
  for (const item of issues)
    sheet.addRow({
      ...item,
      raw_value:
        typeof item.raw_value === "object"
          ? JSON.stringify(item.raw_value)
          : item.raw_value,
    });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function makeBusinessReport(kind:WorkbookReportKind, records:Record<string,unknown>[], positions:Record<string,unknown>[] = []):Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "输电项目管理";
  const marker = workbook.addWorksheet("报表标记");
  marker.addRow(["只读业务报表"]);
  marker.addRow([
    "业务报表用于统计、审核与打印。维护回导请下载数据维护工作簿。",
  ]);
  function addSheet(name:string, rows:Record<string,unknown>[]) {
    const sheet = workbook.addWorksheet(name);
    const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    if (!headers.length) headers.push("当前筛选结果为空");
    sheet.columns = headers.map((header) => ({
      header,
      key: header,
      width: header.includes("描述") || header.includes("依据") ? 42 : 24,
    }));
    for (const row of rows) sheet.addRow(row);
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.getRow(1).height = 42;
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
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
          : "结算业务报表",
    records,
  );
  if (positions.length) addSheet("需求位置报表", positions);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

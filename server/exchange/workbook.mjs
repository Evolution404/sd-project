import ExcelJS from "exceljs";
import { scaledDecimal, decimalText } from "../domain/decimal.mjs";
import { requireValue } from "../domain/errors.mjs";
export const MAX_BYTES = 12 * 1024 * 1024,
  MAX_ROWS = 25000,
  MAX_DOCUMENTS = 5000;
export const KEEP = "__KEEP__",
  CLEAR = "__CLEAR__",
  DELETE = "delete";
const externalScale = {
  height_scaled: ["height", 4],
  quantity_scaled: ["quantity", 4],
  resolved_quantity_scaled: ["resolved_quantity", 4],
  amount_fen: ["amount", 2],
  unit_price_fen: ["unit_price", 2],
};
const internalScale = Object.fromEntries(
  Object.entries(externalScale).map(([key, [external, places]]) => [
    external,
    [key, places],
  ]),
);
// Business-readable Excel values; official identity/version columns remain
// in the workbook (hidden), so maintenance export can roundtrip safely.
const businessChoices = {
  status: { active: "在用", inactive: "停用", retired: "退役", draft: "草稿" },
  distinct_physical: { true: "是", false: "否" },
  location_kind: {
    physical_tower: "物理杆塔",
    logical_tower: "逻辑杆塔",
    span: "档距",
  },
  work_mode: { outage: "停电", non_outage: "不停电", unspecified: "未明确" },
  action: { upsert: "新增或修改", delete: "删除" },
};
const technicalColumns = new Set([
  "id",
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
  "demand_no",
  "number",
  "field_key",
  "factor_id",
]);
function externalChoice(key, value) {
  return businessChoices[key]?.[value] || value;
}
function internalChoice(key, value) {
  if (!businessChoices[key] || typeof value !== "string") return value;
  const match = Object.entries(businessChoices[key]).find(
    ([, text]) => text === value,
  );
  return match ? match[0] : value;
}

export const layouts = {
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
        "status",
        "erection_type",
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
        "distinct_physical",
        "asset_no",
        "tower_type",
        "model",
        "height_scaled",
        "longitude",
        "latitude",
        "operations_team",
        "management_department",
      ],
    },
  ],
  demands: [
    {
      name: "需求清单",
      key: "documents",
      columns: [
        "demand_no",
        "id",
        "expected_version",
        "operation_id",
        "problem_description",
        "target_object",
        "completion_standard",
        "priority_id",
        "expected_on",
        "operation_name",
        "priority_name",
      ],
    },
    {
      name: "作业位置",
      key: "work_locations",
      columns: [
        "demand_no",
        "action",
        "location_kind",
        "logical_tower_id",
        "physical_tower_id",
        "span_id",
        "quantity_scaled",
        "work_mode",
        "specification",
        "line_name",
        "voltage_name",
        "tower_no",
        "end_tower_no",
        "asset_no",
      ],
    },
    {
      name: "预计物资",
      key: "materials",
      columns: [
        "demand_no",
        "action",
        "material_id",
        "quantity_scaled",
        "note",
        "material_name",
        "material_model",
        "material_specification",
      ],
    },
    {
      name: "来源依据",
      key: "sources",
      columns: ["demand_no", "id", "description", "discovered_on"],
    },
    {
      name: "补充现场字段",
      key: "custom_fields",
      columns: ["demand_no", "field_key", "field_name", "value"],
    },
    {
      name: "现场价格特征",
      key: "site_features",
      columns: [
        "demand_no",
        "location_row",
        "factor_id",
        "factor_name",
        "value",
      ],
    },
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
    if (kind !== "assets" && sheet.key !== "documents")
      sheet.columns.push("document_row");
const labels = {
  sharing_line_name: "共用实物的已有线路",
  sharing_voltage_name: "共塔线路电压等级",
  sharing_tower_no: "共用实物的已有杆塔号",
  distinct_physical: "明确确认同号但不同实物",
  name: "线路名称",
  erection_type: "架设方式",
  tower_type: "塔型",
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
  expected_on: "期望日期",
  action: "明细动作",
  location_kind: "位置类型",
  logical_tower_id: "逻辑塔标识",
  physical_tower_id: "物理塔标识",
  span_id: "档距标识",
  quantity_scaled: "数量（万分之一单位）",
  work_mode: "作业方式",
  site_features_json: "现场特征JSON",
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
export function issue(
  sheet,
  row,
  field,
  value,
  reason,
  suggestion = "修正后重新上传",
) {
  return { sheet, row, field, raw_value: value, reason, suggestion };
}
function cellValue(cell) {
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
export async function parseWorkbook(buffer, kind) {
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
    await workbook.xlsx.load(buffer);
  } catch {
    requireValue(false, "Excel文件损坏或格式无效");
  }
  requireValue(
    !workbook.getWorksheet("报表标记"),
    "业务报表不能回导，请使用数据维护导出",
  );
  const layout = layouts[kind];
  requireValue(layout, "未知交换类型");
  const rows = {},
    issues = [];
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
    requireValue(sheet.columnCount <= 80, "工作表列数超出限制");
    const headers = new Map();
    sheet.getRow(1).eachCell((cell, column) => {
      const header = String(cell.value || "")
        .split("|")
        .at(-1)
        .trim();
      requireValue(
        definition.columns.includes(internalScale[header]?.[0] || header),
        `未知列 ${definition.name}.${header}`,
      );
      requireValue(![...headers.values()].includes(header), `重复列 ${header}`);
      headers.set(column, header);
    });
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      count++;
      requireValue(count <= MAX_ROWS, "工作簿业务行数超过25000");
      const data = { _sheet: definition.name, _row: rowNumber };
      for (const [column, key] of headers) {
        try {
          const value = cellValue(row.getCell(column));
          if (value !== KEEP && value !== null) {
            const mapping = internalScale[key];
            data[mapping?.[0] || key] =
              value === CLEAR
                ? null
                : mapping
                  ? scaledDecimal(value, mapping[1], key)
                  : internalChoice(key, value);
          }
        } catch (error) {
          issues.push(
            issue(
              definition.name,
              rowNumber,
              key,
              String(row.getCell(column).value),
              error.message,
            ),
          );
        }
      }
      if (Object.keys(data).length > 2) rows[definition.key].push(data);
    });
  }
  requireValue(
    rows.documents.length <= MAX_DOCUMENTS,
    "单批最多5000张业务单据",
  );
  return { rows, issues };
}
export async function makeWorkbook(kind, rows = {}, options = {}) {
  requireValue(layouts[kind], "未知交换类型");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "输电项目管理";
  const info = workbook.addWorksheet("使用说明");
  info.columns = [{ width: 110 }];
  for (const text of [
    options.report
      ? "业务报表，仅供阅读，不可回导"
      : "数据维护工作簿，可离线修改并回导",
    "金额填写人民币元（最多2位小数），工作量填写实际单位数量（最多4位小数）。",
    "系统身份和原版本自动携带。新增填写业务名称、线路杆号及真实属性，单据号由服务端生成。同名歧义须在系统核对后使用维护导出。",
    "一张清单时明细自动归属，多张清单用实际Excel行号关联。行号只表达文件中真实的归属关系。",
    "位置类型、作业方式和明细动作可直接选择中文选项；系统在导入时自动对应正式取值。",
    `${KEEP} 保持原值，${CLEAR} 明确清除，空单元格/缺少列保持原值。文本空串请使用 __EMPTY__。`,
    "明细action填upsert或delete。未出现的工作表或明细行保持原值。",
    "导入结算只保存草稿。正式提交和审核须在系统内分别操作。",
    "请勿填写公式。系统不按线路名称、杆号或显示名称模糊匹配。",
  ])
    info.addRow([text]);
  for (const definition of layouts[kind]) {
    const sheet = workbook.addWorksheet(definition.name);
    sheet.columns = definition.columns.map((key) => ({
      header: `${externalScale[key] ? (key === "amount_fen" ? "本次金额（元）" : key === "unit_price_fen" ? "单价（元）" : key === "resolved_quantity_scaled" ? "本次新增解决数量" : "工作数量") : labels[key] || key}|${externalScale[key]?.[0] || key}`,
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
      column.hidden = technicalColumns.has(column.key);
      column.style = {
        ...column.style,
        protection: { locked: technicalColumns.has(column.key) },
      };
    }
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    for (const [index, key] of definition.columns.entries()) {
      if (!businessChoices[key]) continue;
      const options = Object.values(businessChoices[key]).join(",");
      const letter = sheet.getColumn(index + 1).letter;
      sheet.dataValidations.add(letter + "2:" + letter + "5001", {
        type: "list",
        allowBlank: true,
        showErrorMessage: false,
        formulae: ['"' + options + '"'],
      });
    }
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF23434E" },
    };
    for (const data of rows[definition.key] || []) {
      const row = {};
      for (const key of definition.columns) {
        const value = data[key];
        row[key] =
          value == null
            ? null
            : externalScale[key]
              ? decimalText(value, externalScale[key][1])
              : typeof value === "object"
                ? JSON.stringify(value)
                : externalChoice(key, value);
      }
      sheet.addRow(row);
    }
    if (!options.report)
      await sheet.protect(undefined, {
        selectLockedCells: false,
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
export async function errorsWorkbook(issues) {
  const workbook = new ExcelJS.Workbook(),
    sheet = workbook.addWorksheet("问题清单");
  sheet.columns = [
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

export async function makeBusinessReport(kind, records, positions = []) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "输电项目管理";
  const marker = workbook.addWorksheet("报表标记");
  marker.addRow(["READ_ONLY_REPORT"]);
  marker.addRow([
    "业务报表用于统计、审核与打印。维护回导请下载数据维护工作簿。",
  ]);
  function addSheet(name, rows) {
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

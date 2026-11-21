import type { HistoryValue } from "./types/history.js";
import { document, facts, feeName, json, label, money, number, pricingModels, quantity, record, rows, string, table, text,
  type ReadRow } from "./business-history-values.js";

function words(value: unknown, options: ReadRow[] = []): HistoryValue {
  if (Array.isArray(value)) return value.map(item => words(item, options)).filter(part => part !== null).join("、") || null;
  if (typeof value === "boolean") return value ? "是" : "否";
  return text(options.find(option => option.value === value)?.label ?? value);
}

function parameterRows(parameters: ReadRow, component?: ReadRow) {
  return facts(
    ["单价或定额", money(component?.unit_price_fen ?? parameters.unit_price_fen)],
    ["基础费", money(component?.base_fee_fen ?? parameters.base_fee_fen)],
    ["每组数量", quantity(parameters.group_size_scaled)],
    ["每组金额", money(parameters.group_fee_fen)],
    ["费用计算基数", label(parameters.rate_basis, {
      labor: "人工费", materials: "材料费", machinery: "机械费", approved_subtotal: "批准范围参考费用小计",
    })],
    ["费用计算比例", number(parameters.rate_basis_points) === undefined ? null : `${Number(parameters.rate_basis_points) / 100}%`],
    ["最低收费", money(parameters.min_amount_fen)],
    ["封顶金额", money(parameters.max_amount_fen)],
  ).filter(fact => fact.value !== null).map(fact => [fact.label, fact.value]);
}
function bracketRows(brackets: ReadRow[]) {
  return brackets.map(bracket => [
    quantity(bracket.min_quantity_scaled), quantity(bracket.max_quantity_scaled) ?? "无上限",
    money(bracket.base_fee_fen), money(bracket.unit_price_fen),
  ]);
}
function tierRows(tiers: ReadRow[]) {
  return tiers.map(tier => [
    quantity(tier.up_to_quantity_scaled) ?? "剩余数量", money(tier.unit_price_fen),
  ]);
}
const bracketColumns = ["起始数量", "截止数量", "基础费", "单价"];
const tierColumns = ["截止数量", "单价"];

export function definitionTables(kind: "operations" | "prices", row: ReadRow) {
  if (kind === "operations") {
    const attributes = rows(json(row.attributes_schema_json));
    const columns = ["字段", "填写位置", "取值来源", "字段类型", "要求", "参与计价", "可选项", "说明"];
    const recordedConstraints = attributes.flatMap(field => {
      const limits = facts(
        ["默认值", words(field.default_value, rows(field.options))],
        ["小数位数", number(field.precision)],
        ["最小值", text(field.min)],
        ["最大值", text(field.max)],
      ).filter(fact => fact.value !== null);
      return limits.map(fact => [text(field.label), fact.label, fact.value]);
    });
    return [...table("附加属性定义", columns, attributes.map(field => [
      text(field.label), label(field.scope, { demand: "需求", location: "作业位置" }),
      field.source === "asset" ? label(field.asset_field, {
        voltage_level_id: "台账 · 电压等级", tower_material: "台账 · 杆塔材质", tower_nature: "台账 · 杆塔性质",
      }) : label(field.source, { manual: "手工填写", ledger: "台账取值" }),
      label(field.type, { text: "单行文字", textarea: "多行文字", select: "单选", multiselect: "多选",
        integer: "整数", decimal: "小数", boolean: "是否", date: "日期" }),
      field.enabled === false ? "已停用" : label(field.requirement, { optional: "选填", save: "保存必填", pricing: "计价必需" }),
      field.pricing ? "是" : "否",
      Array.isArray(field.options) ? field.options.map(option => words(record(option).label ?? option)).filter(Boolean).join("、") : null,
      text(field.hint),
    ]), attributes.map(field => String(field.key))),
    ...table("附加属性取值规则", ["字段", "规则", "采用值"], recordedConstraints)];
  }
  const parameters = document(row.calculation_params_json);
  const components = rows(json(row.fee_components_json)).map((component, index) => ({
    component,
    name: string(component.title ?? component.name) ?? feeName(component.coverage_key, index, true),
    parameters: document(component.calculation_params_json ?? component.parameters),
  }));
  const criteria = record(json(row.additional_conditions_json));
  const definitions = rows(json(row.attributes_schema_json));
  return [
    ...table("现场适用条件", ["条件", "判断", "要求"], definitions.flatMap(definition => {
      const key = string(definition.key), name = string(definition.label);
      if (!key || !name || !Object.hasOwn(criteria, key)) return [];
      const condition = record(criteria[key]);
      const options = rows(definition.options);
      return [[name, label(condition.op, { eq: "等于", in: "属于", range: "在范围内", gte: "不少于", lte: "不多于" }),
        condition.op === "range" ? [words(condition.min), words(condition.max)].filter(value => value !== null).join(" 至 ")
          : words(condition.value ?? condition.values, options)]];
    })),
    ...table("计价参数", ["项目", "采用值"], parameterRows(parameters)),
    ...table("整批数量阶梯", bracketColumns, bracketRows(rows(json(row.quantity_brackets_json)))),
    ...table("累进计价阶梯", tierColumns, tierRows(rows(parameters.tiers))),
    ...table("费用分项", ["费用", "计价方式"], components.map(({ component, name }) => [
      name, label(component.formula_mode ?? component.pricing_mode, pricingModels),
    ]), components.map(({ component }) => String(component.coverage_key))),
    ...table("费用分项参数", ["费用", "项目", "采用值"], components.flatMap(({ name, component, parameters }) =>
      parameterRows(parameters, component).map(values => [name, ...values]))),
    ...table("费用分项整批数量阶梯", ["费用", ...bracketColumns], components.flatMap(({ name, component, parameters }) =>
      bracketRows(rows(json(component.quantity_brackets_json) ?? parameters.brackets)).map(values => [name, ...values]))),
    ...table("费用分项累进计价阶梯", ["费用", ...tierColumns], components.flatMap(({ name, parameters }) =>
      tierRows(rows(parameters.tiers)).map(values => [name, ...values]))),
  ];
}

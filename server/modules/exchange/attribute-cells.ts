import type { AttributeScope, OperationAttribute } from "../../shared/types/operation-attributes.js";
import { requireValue } from "../../shared/errors/business-error.js";
import { attributeKey } from "./workbook.js";

/** Workbook cells are converted to domain input values before shared validation. */
export function attributeCells(schema: OperationAttribute[], scope: AttributeScope, row: Record<string, unknown>): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [column, raw] of Object.entries(row)) {
    if (!column.startsWith("attribute_")) continue;
    const key = attributeKey(column);
    const field = schema.find(item => item.key === key && item.scope === scope && item.source === "manual");
    requireValue(field, "附加属性未对应采用的正式定义及层级");
    if (raw === null) { values[key] = null; continue; }
    if (Array.isArray(raw)) {
      requireValue(field.type === "multiselect" || (field.type === "select" && raw.length === 1), "附加属性选项格式无效");
      values[key] = field.type === "select" ? raw[0] : raw;
      continue;
    }
    let value = raw;
    if (field.type === "integer") {
      requireValue(/^-?\d+$/.test(String(raw)), `${field.label}须为整数`);
      value = Number(raw);
    } else if (field.type === "decimal") value = String(raw);
    else if (field.type === "boolean") {
      requireValue([true, false, "是", "否", "true", "false"].includes(raw as boolean | string), `${field.label}须填写是或否`);
      value = raw === true || raw === "是" || raw === "true";
    } else if (field.type === "select" || field.type === "multiselect") {
      const choice = (text: string) => {
        const candidates = field.options.filter(option => option.value === text || option.label === text);
        requireValue(candidates.length === 1, `${field.label}选项不存在或有歧义`);
        return candidates[0].value;
      };
      value = field.type === "select" ? choice(String(raw)) : String(raw).split(/[、,，\n]/).map(text => choice(text.trim()));
    }
    values[key] = value;
  }
  return values;
}

import type { ApplicablePriceRule, PriceCondition } from "./model.js";
import { attributeNumber } from "../../shared/operation-attributes.js";
import type { OperationAttribute } from "../../shared/types/operation-attributes.js";

export function priceRulesMayOverlap(a: ApplicablePriceRule, b: ApplicablePriceRule, schema: OperationAttribute[] = []): boolean {
  if (a.status !== "active" || b.status !== "active" || a.operation_id !== b.operation_id ||
      a.operation_version !== b.operation_version || a.pricing_scope !== b.pricing_scope ||
      a.unit_id !== b.unit_id || a.unit_version !== b.unit_version) return false;
  for (const field of ["voltage_level_id", "tower_type", "specification"] as const)
    if (a[field] && b[field] && a[field] !== b[field]) return false;
  if (a.work_mode !== "both" && b.work_mode !== "both" && a.work_mode !== b.work_mode) return false;
  const ca: Record<string, PriceCondition> = typeof a.additional_conditions_json === "string"
    ? JSON.parse(a.additional_conditions_json) : a.additional_conditions_json || {};
  const cb: Record<string, PriceCondition> = typeof b.additional_conditions_json === "string"
    ? JSON.parse(b.additional_conditions_json) : b.additional_conditions_json || {};
  for (const [key, x] of Object.entries(ca)) {
    const y = cb[key];
    if (!y) continue;
    const field = schema.find(item => item.key === key);
    const numeric = field?.type === "integer" || field?.type === "decimal";
    if (x.op === "eq" && y.op === "eq") {
      if (numeric ? attributeNumber(x.value, field.precision, field.label) !== attributeNumber(y.value, field.precision, field.label)
        : x.value !== y.value) return false;
    } else {
      const xmin = x.op === "eq" ? x.value : x.min;
      const xmax = x.op === "eq" ? x.value : x.max;
      const ymin = y.op === "eq" ? y.value : y.min;
      const ymax = y.op === "eq" ? y.value : y.max;
      if (attributeNumber(xmax, 4, "条件") < attributeNumber(ymin, 4, "条件") ||
        attributeNumber(ymax, 4, "条件") < attributeNumber(xmin, 4, "条件")) return false;
    }
  }
  return true;
}

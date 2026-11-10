import { requireValue, integer } from "../../shared/errors/business-error.js";
import { isObject } from "../../shared/types/contracts.js";
import type { ApplicablePriceRule, PriceCondition } from "./model.js";

export interface FactorDefinition {
  kind: "enum" | "number";
  values?: (string | { value: string; label: string })[];
  min?: number | null;
  max?: number | null;
  unit_id?: string;
  unit_version?: number;
  asset_field?: string;
}

export function validateFactorDefinition(value: unknown, { allowLegacyAsset = false } = {}): FactorDefinition {
  requireValue(isObject(value), "价格特征定义无效");
  requireValue(value.kind === "enum" || value.kind === "number", "价格特征须选择选项或整数");
  requireValue(allowLegacyAsset || !Object.hasOwn(value, "asset_field"),
    "台账属性应直接作为价格适用条件，不再建立重复价格特征");
  if (value.kind === "enum") {
    requireValue(Array.isArray(value.values) && value.values.length > 0, "选项类型至少配置一个可选值");
    const keys = value.values.map((item: unknown) => {
      const key = typeof item === "string" ? item : isObject(item) ? item.value : undefined;
      requireValue(typeof key === "string" && key.trim() && key === key.trim() &&
        (typeof item === "string" || (isObject(item) && typeof item.label === "string" && item.label.trim())),
        "价格特征选项不能为空，且不得包含首尾空格");
      return key;
    });
    requireValue(new Set(keys).size === keys.length, "同一价格特征的可选值不能重复");
    requireValue(value.min === undefined && value.max === undefined && !value.unit_id && !value.unit_version,
      "枚举特征不能配置整数范围或计量单位");
  } else {
    requireValue(value.values === undefined || (Array.isArray(value.values) && !value.values.length),
      "整数特征不能同时配置枚举选项");
    for (const key of ["min", "max"])
      if (value[key] != null)
        requireValue(typeof value[key] === "number" && Number.isSafeInteger(value[key]),
          `${key === "min" ? "最小值" : "最大值"}必须为整数`);
    requireValue(value.min == null || value.max == null || Number(value.min) <= Number(value.max),
      "价格特征最小值不能大于最大值");
    requireValue(!value.unit_version || value.unit_id, "整数单位版本缺少对应单位");
    if (value.unit_id) {
      requireValue(typeof value.unit_id === "string", "请重新选择有效的整数计量单位");
      integer(value.unit_version, "整数计量单位版本", 1);
    }
  }
  return value as unknown as FactorDefinition;
}

export function validateFeatureValue(definition: FactorDefinition, value: unknown, label = "现场价格特征"): string | number {
  requireValue(definition && ["enum", "number"].includes(definition.kind), "现场特征定义版本无效");
  if (definition.kind === "number") {
    requireValue(typeof value === "number" && Number.isSafeInteger(value), `${label}必须为整数`);
    requireValue((definition.min == null || value >= definition.min) &&
      (definition.max == null || value <= definition.max), `${label}不在允许的数值范围内`);
    return value;
  }
  requireValue(typeof value === "string" && value.trim(), `${label}必须填写有效选项`);
  if (definition.values?.length)
    requireValue(definition.values.some(option => (typeof option === "string" ? option : option.value) === value),
      `${label}不在正式选项中`);
  return value;
}

export function validateFactorCondition(definition: FactorDefinition, condition: unknown, label = "价格适用条件"): void {
  requireValue(isObject(condition), `${label}无效`);
  if (definition.kind === "enum") {
    requireValue(condition.op === "eq", `${label}只能精确匹配选项`);
    validateFeatureValue(definition, condition.value, label);
  } else {
    requireValue(condition.op === "range" && typeof condition.min === "number" &&
      typeof condition.max === "number" && Number.isSafeInteger(condition.min) &&
      Number.isSafeInteger(condition.max) && condition.min <= condition.max,
      `${label}必须填写合法的整数区间`);
    requireValue((definition.min == null || condition.min >= definition.min) &&
      (definition.max == null || condition.max <= definition.max), `${label}超出特征定义允许的范围`);
  }
}

export function priceRulesMayOverlap(a: ApplicablePriceRule, b: ApplicablePriceRule): boolean {
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
    if (x.factor_version !== y.factor_version || x.op !== y.op) return false;
    if (x.op === "eq" && x.value !== y.value) return false;
    if (x.op === "range" && x.max != null && x.min != null && y.min != null && y.max != null &&
        (x.max < y.min || y.max < x.min)) return false;
  }
  return true;
}

import { requireValue } from "./errors.mjs";

// Price factors describe extra on-site facts, never duplicate equipment ledger fields.
export function validateFactorDefinition(definition, { allowLegacyAsset = false } = {}) {
  requireValue(definition && typeof definition === "object" && !Array.isArray(definition), "价格特征定义无效");
  requireValue(["enum", "number"].includes(definition.kind), "价格特征须选择选项或整数");
  requireValue(
    allowLegacyAsset || !Object.hasOwn(definition, "asset_field"),
    "台账属性应直接作为价格适用条件，不再建立重复价格特征",
  );
  if (definition.kind === "enum") {
    requireValue(
      Array.isArray(definition.values) && definition.values.length > 0,
      "选项类型至少配置一个可选值",
    );
    const keys = definition.values.map((item) => {
      const key = typeof item === "string" ? item : item?.value;
      requireValue(
        typeof key === "string" && key.trim() && key === key.trim() &&
          (typeof item === "string" ||
            (typeof item?.label === "string" && item.label.trim())),
        "价格特征选项不能为空，且不得包含首尾空格",
      );
      return key;
    });
    requireValue(new Set(keys).size === keys.length, "同一价格特征的可选值不能重复");
    requireValue(
      definition.min === undefined && definition.max === undefined &&
        !definition.unit_id && !definition.unit_version,
      "枚举特征不能配置整数范围或计量单位",
    );
  } else {
    requireValue(definition.values === undefined || (Array.isArray(definition.values) && !definition.values.length),
      "整数特征不能同时配置枚举选项");
    for (const key of ["min", "max"])
      if (definition[key] !== undefined && definition[key] !== null)
        requireValue(Number.isSafeInteger(definition[key]), `${key === "min" ? "最小值" : "最大值"}必须为整数`);
    requireValue(definition.min == null || definition.max == null || definition.min <= definition.max,
      "价格特征最小值不能大于最大值");
    requireValue(!definition.unit_version || definition.unit_id, "整数单位版本缺少对应单位");
    if (definition.unit_id)
      requireValue(
        typeof definition.unit_id === "string" &&
          Number.isSafeInteger(definition.unit_version) && definition.unit_version > 0,
        "请重新选择有效的整数计量单位",
      );
  }
  return definition;
}

export function validateFeatureValue(definition, value, label = "现场价格特征") {
  requireValue(definition && ["enum", "number"].includes(definition.kind), "现场特征定义版本无效");
  if (definition.kind === "number") {
    requireValue(Number.isSafeInteger(value), `${label}必须为整数`);
    requireValue(
      (definition.min == null || value >= definition.min) &&
        (definition.max == null || value <= definition.max),
      `${label}不在允许的数值范围内`,
    );
  } else {
    requireValue(typeof value === "string" && value.trim(), `${label}必须填写有效选项`);
    // Older historical versions may have free-form enums. New definitions never do.
    if (definition.values?.length)
      requireValue(definition.values.some((option) =>
        (typeof option === "string" ? option : option.value) === value),
        `${label}不在正式选项中`);
  }
  return value;
}

export function validateFactorCondition(definition, condition, label = "价格适用条件") {
  requireValue(condition && typeof condition === "object", `${label}无效`);
  if (definition.kind === "enum") {
    requireValue(condition.op === "eq", `${label}只能精确匹配选项`);
    validateFeatureValue(definition, condition.value, label);
  } else {
    requireValue(condition.op === "range" &&
      Number.isSafeInteger(condition.min) && Number.isSafeInteger(condition.max) &&
      condition.min <= condition.max, `${label}必须填写合法的整数区间`);
    requireValue(
      (definition.min == null || condition.min >= definition.min) &&
        (definition.max == null || condition.max <= definition.max),
      `${label}超出特征定义允许的范围`);
  }
}

export function priceRulesMayOverlap(a, b) {
  if (a.status !== "active" || b.status !== "active" ||
    a.operation_id !== b.operation_id ||
    a.operation_version !== b.operation_version ||
    a.pricing_scope !== b.pricing_scope ||
    a.unit_id !== b.unit_id || a.unit_version !== b.unit_version) return false;
  for (const field of ["voltage_level_id", "tower_type", "specification"]) {
    if (a[field] && b[field] && a[field] !== b[field]) return false;
  }
  if (a.work_mode !== "both" && b.work_mode !== "both" && a.work_mode !== b.work_mode)
    return false;
  const ca = typeof a.additional_conditions_json === "string"
    ? JSON.parse(a.additional_conditions_json) : (a.additional_conditions_json || {});
  const cb = typeof b.additional_conditions_json === "string"
    ? JSON.parse(b.additional_conditions_json) : (b.additional_conditions_json || {});
  for (const [key, x] of Object.entries(ca)) {
    const y = cb[key];
    if (!y) continue;
    if (x.factor_version !== y.factor_version || x.op !== y.op) return false;
    if (x.op === "eq" && x.value !== y.value) return false;
    if (x.op === "range" && (x.max < y.min || y.max < x.min)) return false;
  }
  return true;
}

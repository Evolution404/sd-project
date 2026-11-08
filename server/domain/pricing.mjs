import { requireValue, integer } from "./errors.mjs";
export const ENGINE_VERSION = "schema113-fixed-1";
export function safeAmount(value) {
  requireValue(
    value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER),
    "计价结果超出安全整数范围",
  );
  return Number(value);
}
export function roundRatio(numerator, denominator) {
  requireValue(denominator > 0n && numerator >= 0n, "计价分数无效");
  return (numerator + denominator / 2n) / denominator;
}
const big = (value, label = "计价参数") => BigInt(integer(value, label));
export function calculate(rule, quantityScaled, bases = {}) {
  const quantity = big(quantityScaled, "计价数量");
  requireValue(quantity > 0n, "计价数量必须大于0");
  const parameters =
    typeof rule.calculation_params_json === "string"
      ? JSON.parse(rule.calculation_params_json)
      : rule.parameters || rule.calculation_params_json || {};
  const mode = rule.pricing_mode || rule.formula_mode;
  let amount,
    trace = {
      engine_version: ENGINE_VERSION,
      rounding: "HALF_UP",
      quantity_scaled: quantityScaled,
      mode,
      parameters,
    };
  const unit = () => big(rule.unit_price_fen ?? parameters.unit_price_fen ?? 0);
  const base = () => big(rule.base_fee_fen ?? parameters.base_fee_fen ?? 0);
  switch (mode) {
    case "fixed":
      amount = unit();
      break;
    case "per_unit":
      amount = roundRatio(quantity * unit(), 10000n);
      break;
    case "base_plus_unit":
      amount = base() + roundRatio(quantity * unit(), 10000n);
      break;
    case "quantity_bracket": {
      const brackets = rule.quantity_brackets_json
        ? JSON.parse(rule.quantity_brackets_json)
        : parameters.brackets;
      requireValue(Array.isArray(brackets), "缺少整批阶梯");
      const selected = brackets.filter(
        (b) =>
          quantity >= big(b.min_quantity_scaled ?? 0) &&
          (b.max_quantity_scaled == null ||
            quantity <= big(b.max_quantity_scaled)),
      );
      requireValue(selected.length === 1, "数量阶梯无匹配或存在重叠");
      const bracket = selected[0];
      amount =
        big(bracket.base_fee_fen ?? 0) +
        roundRatio(quantity * big(bracket.unit_price_fen), 10000n);
      trace.bracket = bracket;
      break;
    }
    case "progressive_bracket": {
      requireValue(
        Array.isArray(parameters.tiers) && parameters.tiers.length > 0,
        "缺少累进阶梯",
      );
      let previous = 0n,
        numerator = 0n;
      for (const tier of parameters.tiers) {
        const upper =
          tier.up_to_quantity_scaled == null
            ? quantity
            : big(tier.up_to_quantity_scaled);
        requireValue(upper > previous, "累进阶梯必须连续递增");
        const end = quantity < upper ? quantity : upper;
        numerator += (end - previous) * big(tier.unit_price_fen);
        previous = end;
        if (previous === quantity) break;
      }
      requireValue(previous === quantity, "累进阶梯未覆盖数量");
      amount = roundRatio(numerator, 10000n);
      break;
    }
    case "group": {
      const size = big(parameters.group_size_scaled);
      requireValue(size > 0n, "组容量必须大于0");
      const groups = (quantity + size - 1n) / size;
      amount = groups * big(parameters.group_fee_fen);
      trace.groups = groups.toString();
      break;
    }
    case "rate": {
      const basis = parameters.rate_basis;
      requireValue(
        ["labor", "materials", "machinery", "approved_subtotal"].includes(
          basis,
        ),
        "费率基数类型无效",
      );
      requireValue(Object.hasOwn(bases, basis), "缺少有依据的费率基数");
      const rate = big(parameters.rate_basis_points);
      requireValue(rate <= 10000n, "费率超出万分比范围");
      amount = roundRatio(big(bases[basis]) * rate, 10000n);
      trace.basis_fen = bases[basis];
      break;
    }
    case "composite": {
      const components =
        typeof rule.fee_components_json === "string"
          ? JSON.parse(rule.fee_components_json)
          : rule.fee_components_json;
      requireValue(
        Array.isArray(components) && components.length > 0,
        "组合费用不能为空",
      );
      requireValue(
        new Set(components.map((x) => x.coverage_key)).size ===
          components.length,
        "组合费用覆盖重复",
      );
      trace.components = components.map((component) => ({
        coverage_key: component.coverage_key,
        ...calculate(component, quantityScaled, bases),
      }));
      amount = trace.components.reduce(
        (sum, item) => sum + BigInt(item.amount_fen),
        0n,
      );
      break;
    }
    default:
      requireValue(false, "不支持的计价模型");
  }
  if (parameters.min_amount_fen !== undefined) {
    const minimum = big(parameters.min_amount_fen);
    if (amount < minimum) amount = minimum;
  }
  if (parameters.max_amount_fen !== undefined) {
    const maximum = big(parameters.max_amount_fen);
    requireValue(
      parameters.min_amount_fen === undefined ||
        maximum >= big(parameters.min_amount_fen),
      "封顶金额小于最低金额",
    );
    if (amount > maximum) amount = maximum;
  }
  trace.amount_fen = safeAmount(amount);
  return { amount_fen: trace.amount_fen, trace };
}
export function matches(rule, operation, location, date) {
  if (
    rule.status !== "active" ||
    rule.operation_id !== operation.operation_id ||
    rule.operation_version !== operation.operation_version ||
    rule.unit_id !== operation.unit_id ||
    rule.unit_version !== operation.unit_version ||
    rule.effective_on > date
  )
    return false;
  const snapshot =
    typeof location.location_snapshot_json === "string"
      ? JSON.parse(location.location_snapshot_json)
      : location.location_snapshot_json;
  if (
    rule.voltage_level_id &&
    rule.voltage_level_id !== snapshot.voltage_level_id
  )
    return false;
  if (rule.tower_type && rule.tower_type !== snapshot.tower_type) return false;
  if (rule.specification && rule.specification !== snapshot.specification)
    return false;
  if (rule.work_mode !== "both" && rule.work_mode !== location.work_mode)
    return false;
  const actual =
    typeof location.site_features_json === "string"
      ? JSON.parse(location.site_features_json)
      : location.site_features_json;
  const conditions = JSON.parse(rule.additional_conditions_json || "{}");
  return Object.entries(conditions).every(([key, condition]) => {
    const feature = actual[key];
    if (!feature || feature.factor_version !== condition.factor_version)
      return false;
    return condition.op === "eq"
      ? feature.value === condition.value
      : condition.op === "range" &&
          Number.isSafeInteger(feature.value) &&
          feature.value >= condition.min &&
          feature.value <= condition.max;
  });
}

export function validatePricingRule(rule) {
  const parameters =
    typeof rule.calculation_params_json === "string"
      ? JSON.parse(rule.calculation_params_json)
      : rule.parameters || {};
  requireValue(
    parameters && typeof parameters === "object" && !Array.isArray(parameters),
    "计价参数必须为结构化对象",
  );
  const mode = rule.pricing_mode || rule.formula_mode;
  const nonnegative = (value, label) => integer(value, label);
  for (const key of ["min_amount_fen", "max_amount_fen"])
    if (parameters[key] !== undefined) nonnegative(parameters[key], key);
  requireValue(
    parameters.max_amount_fen === undefined ||
      parameters.min_amount_fen === undefined ||
      parameters.max_amount_fen >= parameters.min_amount_fen,
    "最低收费超过封顶金额",
  );
  if (["fixed", "per_unit", "base_plus_unit"].includes(mode))
    nonnegative(rule.unit_price_fen ?? parameters.unit_price_fen, "单价");
  if (mode === "base_plus_unit")
    nonnegative(rule.base_fee_fen ?? parameters.base_fee_fen, "基础费");
  if (mode === "quantity_bracket") {
    const bands = rule.quantity_brackets_json
      ? JSON.parse(rule.quantity_brackets_json)
      : parameters.brackets;
    requireValue(Array.isArray(bands) && bands.length > 0, "数量阶梯不能为空");
    let previousUpper = -1;
    for (const [index, band] of bands.entries()) {
      integer(band.min_quantity_scaled, "数量档起点", 1);
      requireValue(
        previousUpper !== null && band.min_quantity_scaled > previousUpper,
        "数量阶梯必须递增且互不重叠",
      );
      if (band.max_quantity_scaled !== null) {
        integer(band.max_quantity_scaled, "数量档终点", 1);
        requireValue(
          band.max_quantity_scaled >= band.min_quantity_scaled,
          "数量档终点小于起点",
        );
      } else
        requireValue(index === bands.length - 1, "无上限数量档必须为最后一档");
      nonnegative(band.base_fee_fen, "分档基础费");
      nonnegative(band.unit_price_fen, "分档单价");
      previousUpper = band.max_quantity_scaled;
    }
  }
  if (mode === "progressive_bracket") {
    requireValue(
      Array.isArray(parameters.tiers) && parameters.tiers.length > 0,
      "累进阶梯不能为空",
    );
    let previous = 0;
    for (const [index, tier] of parameters.tiers.entries()) {
      if (tier.up_to_quantity_scaled !== null) {
        integer(tier.up_to_quantity_scaled, "累进上限", 1);
        requireValue(
          tier.up_to_quantity_scaled > previous,
          "累进数量上限必须递增",
        );
        previous = tier.up_to_quantity_scaled;
      } else
        requireValue(
          index === parameters.tiers.length - 1,
          "开放上限必须为最后一个累进档",
        );
      nonnegative(tier.unit_price_fen, "累进单价");
    }
  }
  if (mode === "group") {
    integer(parameters.group_size_scaled, "每组容量", 1);
    nonnegative(parameters.group_fee_fen, "每组金额");
  }
  if (mode === "rate") {
    nonnegative(parameters.rate_basis_points, "费用比例");
    requireValue(
      parameters.rate_basis_points <= 10000,
      "费用比例超过万分比范围",
    );
    requireValue(
      ["labor", "materials", "machinery", "approved_subtotal"].includes(
        parameters.rate_basis,
      ),
      "计费基数类型无效",
    );
    requireValue(
      parameters.rate_basis !== "approved_subtotal" ||
        rule.pricing_scope !== "work_location",
      "批准范围小计只能用于批次或项目级费用",
    );
  }
  if (mode === "composite") {
    const components =
      typeof rule.fee_components_json === "string"
        ? JSON.parse(rule.fee_components_json)
        : rule.fee_components_json;
    requireValue(
      Array.isArray(components) && components.length > 0,
      "费用组成不能为空",
    );
    requireValue(
      new Set(components.map((component) => component.coverage_key)).size ===
        components.length,
      "费用组成覆盖不能重复",
    );
    requireValue(
      components.length === 1 ||
        !components.some((component) => component.coverage_key === "main"),
      "综合费用不能与其他费用组成重复叠加",
    );
    for (const component of components) {
      requireValue(
        typeof component.coverage_key === "string" &&
          component.coverage_key.trim(),
        "请明确费用覆盖编码",
      );
      requireValue(
        component.formula_mode !== "composite",
        "费用组成采用独立基础公式",
      );
      validatePricingRule({ ...component, pricing_scope: rule.pricing_scope });
    }
  }
  requireValue(
    [
      "fixed",
      "per_unit",
      "base_plus_unit",
      "quantity_bracket",
      "progressive_bracket",
      "group",
      "rate",
      "composite",
    ].includes(mode),
    "计价模型无效",
  );
}

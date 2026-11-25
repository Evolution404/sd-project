import type { FeeComponent, PricingParameters, PricingRule } from "../../../../server/shared/types/pricing-api";
import type { PricingMode } from "../../../../server/shared/types/price-rules";
import { exactScaledDecimalText, formatScaledDecimal } from "@/utils/business/fixed-scale";
import { fenToYuan, yuanToFen } from "./funding";

export const modelLabels: Record<PricingMode, string> = {
  fixed: "固定费用",
  per_unit: "按单位计价",
  base_plus_unit: "基础费加单位费",
  quantity_bracket: "整批阶梯",
  progressive_bracket: "累进阶梯",
  group: "按组计价",
  rate: "费率模型",
  composite: "复合计价",
};
export const modelOptions = Object.entries(modelLabels).map(([value, label]) => ({ value, label }));
export const rateBases = [
  { value: "labor", label: "人工费用" },
  { value: "materials", label: "材料费用" },
  { value: "machinery", label: "机械费用" },
  { value: "approved_subtotal", label: "批准范围参考费用小计" },
];
export interface PriceFormula {
  mode: PricingMode;
  amount: string;
  base: string;
  minimum: string;
  maximum: string;
  capacity: string;
  groupAmount: string;
  rateBasis: string;
  ratePoints?: number;
  brackets: { from: string; through: string; base: string; unit: string }[];
  tiers: { through: string; unit: string }[];
}
export interface PriceComponent {
  name: string;
  formula: PriceFormula;
}

const parse = <T>(value: T | string | null | undefined, fallback: T): T =>
  typeof value === "string" ? JSON.parse(value) as T : value ?? fallback;

export function readFormula(rule: PricingRule = {}): PriceFormula {
  const params = parse(rule.calculation_params_json, rule.parameters ?? {});
  return {
    mode: (rule.pricing_mode || rule.formula_mode || "per_unit") as PricingMode,
    amount: fenToYuan(rule.unit_price_fen ?? params.unit_price_fen ?? 0),
    base: fenToYuan(rule.base_fee_fen ?? params.base_fee_fen ?? 0),
    minimum: params.min_amount_fen === undefined ? "" : fenToYuan(params.min_amount_fen),
    maximum: params.max_amount_fen === undefined ? "" : fenToYuan(params.max_amount_fen),
    capacity: formatScaledDecimal(params.group_size_scaled, 4),
    groupAmount: fenToYuan(params.group_fee_fen ?? 0),
    rateBasis: params.rate_basis ?? "labor",
    ratePoints: params.rate_basis_points ?? 0,
    brackets: parse(rule.quantity_brackets_json, params.brackets ?? []).map(bracket => ({
      from: formatScaledDecimal(bracket.min_quantity_scaled, 4),
      through: formatScaledDecimal(bracket.max_quantity_scaled, 4),
      base: fenToYuan(bracket.base_fee_fen),
      unit: fenToYuan(bracket.unit_price_fen),
    })),
    tiers: (params.tiers ?? []).map(tier => ({
      through: formatScaledDecimal(tier.up_to_quantity_scaled, 4), unit: fenToYuan(tier.unit_price_fen),
    })),
  };
}

export function readComponents(rule: PricingRule): PriceComponent[] {
  return parse<FeeComponent[]>(rule.fee_components_json, []).map(component => ({
    name: component.coverage_key,
    formula: readFormula(component),
  }));
}

export function priceQuantity(value: string, label: string) {
  const quantity = exactScaledDecimalText(value.trim(), 4);
  if (quantity === null || quantity <= 0) throw Error(label + "须为最多四位小数的正数");
  return quantity;
}

export function formulaPayload(formula: PriceFormula) {
  const parameters: PricingParameters = {};
  if (formula.minimum.trim()) parameters.min_amount_fen = yuanToFen(formula.minimum);
  if (formula.maximum.trim()) parameters.max_amount_fen = yuanToFen(formula.maximum);
  if (formula.mode === "group") {
    parameters.group_size_scaled = priceQuantity(formula.capacity, "每组容量");
    parameters.group_fee_fen = yuanToFen(formula.groupAmount);
  }
  if (formula.mode === "rate") {
    parameters.rate_basis = formula.rateBasis;
    parameters.rate_basis_points = formula.ratePoints;
  }
  if (formula.mode === "progressive_bracket") {
    parameters.tiers = formula.tiers.map(tier => ({
      up_to_quantity_scaled: tier.through.trim() ? priceQuantity(tier.through, "累进上限") : null,
      unit_price_fen: yuanToFen(tier.unit),
    }));
  }
  const brackets = formula.mode === "quantity_bracket" ? formula.brackets.map(bracket => ({
    min_quantity_scaled: priceQuantity(bracket.from, "起始数量"),
    max_quantity_scaled: bracket.through.trim() ? priceQuantity(bracket.through, "结束数量") : null,
    base_fee_fen: yuanToFen(bracket.base),
    unit_price_fen: yuanToFen(bracket.unit),
  })) : [];
  return {
    unit: ["fixed", "per_unit", "base_plus_unit"].includes(formula.mode) ? yuanToFen(formula.amount) : 0,
    base: formula.mode === "base_plus_unit" ? yuanToFen(formula.base) : 0,
    parameters, brackets,
  };
}

export function componentPayload(component: PriceComponent): FeeComponent {
  const result = formulaPayload(component.formula);
  return {
    coverage_key: component.name.trim(),
    formula_mode: component.formula.mode,
    parameters: {
      ...result.parameters, unit_price_fen: result.unit, base_fee_fen: result.base,
      ...(result.brackets.length ? { brackets: result.brackets } : {}),
    },
  };
}

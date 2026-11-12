import type { AttributeCondition, AttributeValues, OperationAttribute } from "../../shared/types/operation-attributes.js";
export interface QuantityBracket {
  min_quantity_scaled: number;
  max_quantity_scaled: number | null;
  base_fee_fen: number;
  unit_price_fen: number;
}
export interface ProgressiveTier {
  up_to_quantity_scaled: number | null;
  unit_price_fen: number;
}
export interface PricingParameters {
  unit_price_fen?: number;
  base_fee_fen?: number;
  min_amount_fen?: number;
  max_amount_fen?: number;
  brackets?: QuantityBracket[];
  tiers?: ProgressiveTier[];
  group_size_scaled?: number;
  group_fee_fen?: number;
  rate_basis?: string;
  rate_basis_points?: number;
}
export interface PricingRule {
  pricing_mode?: string;
  formula_mode?: string;
  pricing_scope?: string;
  unit_price_fen?: number | null;
  base_fee_fen?: number | null;
  calculation_params_json?: string | PricingParameters;
  parameters?: PricingParameters;
  quantity_brackets_json?: string | null;
  fee_components_json?: string | FeeComponent[];
}
export interface FeeComponent extends PricingRule {
  coverage_key: string;
}
export interface PricingTrace {
  engine_version: string;
  rounding: string;
  quantity_scaled: number;
  mode: string;
  parameters: PricingParameters;
  bracket?: QuantityBracket;
  groups?: string;
  basis_fen?: number;
  components?: (CalculationResult & { coverage_key: string })[];
  amount_fen?: number;
}
export interface CalculationResult {
  amount_fen: number;
  trace: PricingTrace;
}
export type PriceCondition = AttributeCondition;
export interface OperationPricingIdentity {
  attributes?: AttributeValues;
  attribute_schema?: OperationAttribute[];
  operation_id: string;
  operation_version: number;
  unit_id: string;
  unit_version: number;
}
export interface ApplicablePriceRule extends PricingRule, OperationPricingIdentity {
  status: string;
  effective_on: string;
  voltage_level_id?: string | null;
  tower_material?: string | null;
  specification?: string | null;
  work_mode: string;
  additional_conditions_json?: string | Record<string, PriceCondition>;
}
export interface PricingLocation {
  work_mode: string;
  location_snapshot_json?: string | { voltage_level_id?: string; tower_material?: string; specification?: string };
  attributes?: string | AttributeValues;
  demand_attributes?: string | AttributeValues;
}

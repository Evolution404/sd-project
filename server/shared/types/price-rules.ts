import type { OperationPricingIdentity } from "../../modules/pricing/model.js";
import type { DefinitionStatus } from "./master-data.js";
export type PricingMode =
  | "fixed"
  | "per_unit"
  | "base_plus_unit"
  | "quantity_bracket"
  | "progressive_bracket"
  | "group"
  | "rate"
  | "composite";
export type PricingScope = "work_location" | "work_batch" | "project";
export interface PriceRuleVersion extends OperationPricingIdentity {
  id: string;
  catalog_id: string;
  version_no: number;
  title: string;
  voltage_level_id: string | null;
  tower_type: string | null;
  work_mode: "both" | "outage" | "non_outage";
  specification: string;
  additional_conditions_json: string;
  status: DefinitionStatus;
  pricing_mode: PricingMode;
  pricing_scope: PricingScope;
  calculation_params_json: string;
  fee_components_json: string;
  base_fee_fen: number;
  unit_price_fen: number;
  quantity_brackets_json: string;
  price_source: string;
  price_date: string;
  effective_on: string;
  basis: string;
  reason: string;
  created_by: string;
  created_at: string;
}
export interface PriceRuleRecord extends Omit<PriceRuleVersion, "id"> {
  id: string;
  code: string;
  current_version_id: string;
  version_created_at: string;
  version_created_by: string;
  operation_id_label: string;
  unit_id_label: string;
  voltage_level_id_label: string | null;
  label: string;
  deleted: boolean;
}
export interface PriceRulePreview {
  valid: boolean;
  operation_version: number;
  unit_version: number;
  sample: {
    quantity_scaled: number;
    amount_fen: number;
    calculation_trace: unknown;
  } | null;
  sample_error: string | null;
  overlaps: { id: string; title: string; effective_on: string }[];
  warning: string | null;
}

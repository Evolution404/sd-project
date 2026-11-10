import type {
  OperationPricingIdentity,
  PricingLocation,
} from "../../modules/pricing/model.js";

export interface PricingWorkLocation extends PricingLocation {
  item_no?: number;
  quantity_scaled: number;
}
export interface PricingDemand extends OperationPricingIdentity {
  id: string;
  current_version: number;
  work_locations: PricingWorkLocation[];
}
export interface PricingScope {
  id: string;
  approval_version_id: string;
  demand_id: string;
  demand_version: number;
}
export interface ApprovedPricingLocation {
  location_item_no: number;
  approved_quantity_scaled: number;
}
export interface ReferenceCharge {
  id: string;
  approval_version_id: string;
  reference_price_version_id: string;
  charge_scope_key: string;
  amount_fen: number;
  pricing_inputs_json: string;
  calculation_trace_json: string;
  created_by: string;
  created_at: string;
}
export interface EvaluationLine {
  location_item_no: number;
  coverage_key: string;
  reference_price_version_id: string;
  quantity_scaled: number;
  amount_fen: number;
  calculation_inputs_json: string;
  calculation_trace_json: string;
}
export interface EvaluationIdentity {
  id: string;
  demand_id: string;
  demand_version: number;
  approval_scope_version_id: string | null;
  pricing_date: string;
  status: "draft";
  engine_version: string;
  input_basis_json: string;
  created_by: string;
  created_at: string;
}
export interface QuoteLine extends EvaluationLine {
  rule_title: string;
  rule_version_no: number;
  pricing_mode: string;
}
export interface MissingPrice {
  location_item_no: number;
  reason: string;
  candidates: { id: string; title: string }[];
  diagnostics?: { title: string; reasons: string[] }[];
  needs_basis?: boolean;
}
export interface QuoteResult {
  complete: boolean;
  subtotal_fen: number;
  total_fen: number | null;
  missing: MissingPrice[];
  lines: QuoteLine[];
  engine_version: string;
  preview_hash: string;
  id?: string;
}

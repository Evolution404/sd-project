import type { QuantityPrecision } from "../quantity-precision.js";

export type AttributeScope = "demand" | "location";
export type AttributeRequirement = "optional" | "save" | "pricing";
export type AssetAttribute = "voltage_level_id" | "tower_type" | "tower_nature";
export type AttributeValue = string | number | boolean | string[];
export type AttributeValues = Record<string, AttributeValue>;
interface AttributeBase {
  key: string;
  label: string;
  scope: AttributeScope;
  source: "manual" | "asset";
  asset_field?: AssetAttribute;
  requirement: AttributeRequirement;
  pricing: boolean;
  enabled: boolean;
  sort_order: number;
  hint: string;
  default_value?: AttributeValue;
}
interface TextAttribute extends AttributeBase {
  type: "text" | "textarea" | "date";
}
interface ChoiceAttribute extends AttributeBase {
  type: "select" | "multiselect";
  options: { value: string; label: string }[];
}
interface BooleanAttribute extends AttributeBase {
  type: "boolean";
}
interface NumericAttribute extends AttributeBase {
  type: "integer" | "decimal";
  precision: QuantityPrecision;
  min?: string;
  max?: string;
  unit_id?: string;
  unit_version?: number;
}
export type OperationAttribute =
  | TextAttribute
  | ChoiceAttribute
  | BooleanAttribute
  | NumericAttribute;
export interface AttributeCondition {
  op: "eq" | "range";
  value?: string | number | boolean;
  min?: string | number;
  max?: string | number;
}

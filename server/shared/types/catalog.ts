import type { JsonValue } from "./contracts.js";

export type CatalogKind = "units" | "priorities" | "categories" | "objects" | "operations"
  | "materials" | "frameworks" | "agreements" | "organizations" | "voltages" | "lines" | "physical" | "towers" | "spans" | "prices";
export type CatalogFieldType = "text" | "select" | "ref" | "json" | "money" | "quantity" | "integer" | "boolean" | "length_m" | "decimal" | "date";
export interface CatalogField {
  key: string;
  label: string;
  type: CatalogFieldType;
  /** Explicit precision for dimensioned fixed-scale fields; units use formal versions. */
  quantityPrecision?: number;
  options?: string[];
  default?: JsonValue;
  reference?: CatalogKind;
  required?: boolean;
  nullable?: boolean;
  systemManaged?: boolean;
  immutable?: boolean;
}
export interface CatalogFormDefinition {
  title: string;
  rootFields: CatalogField[];
  fields: CatalogField[];
  sequence?: string;
}
export interface CatalogDefinition extends CatalogFormDefinition {
  root: string;
  view?: string;
  versions?: string;
  foreign?: string;
  typeId?: string;
  created_at?: boolean;
  created_by?: boolean;
  equipment?: boolean;
  plain?: boolean;
  history?: string;
  historyKey?: string;
}

import type {
  DemandLocationInput,
  DemandMaterialInput,
  DemandSourceInput,
} from "../../../../../server/shared/types/demands";
import type { AttributeValues } from "../../../../../server/shared/types/operation-attributes";
export interface LocationDraft extends DemandLocationInput {
  id: string;
  label: string;
  line_name: string;
  attributes: AttributeValues;
}
export interface MaterialDraft extends DemandMaterialInput {
  id: string;
  name: string;
  model: string;
  specification: string;
  unit: string;
  precision?: number;
  error?: string;
}
export interface SourceDraft extends DemandSourceInput {
  row_id: string;
  action?: "upsert" | "delete";
}
export interface DemandDraft {
  operation_id: string;
  operation_version?: number;
  problem_description: string;
  completion_standard: string;
  target_object: string;
  priority_id?: string | null;
  expected_on?: string | null;
  attributes: AttributeValues;
  work_locations: LocationDraft[];
  materials: MaterialDraft[];
  sources: SourceDraft[];
}

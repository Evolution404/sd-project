import { locationDisplayFields } from "./location-display.js";
/** Human-readable work location in the immutable signed approval snapshot.
 * Matching never relies on the current demand row order.
 */
export interface ApprovalPositionLabelSource {
  location_kind: string;
  location_object: string;
  location_item_no: number;
  frozen_location: string;
}
export function approvalPositionFields(position: ApprovalPositionLabelSource) {
  let frozen: Record<string, unknown> = {};
  try {
    const value: unknown = JSON.parse(position.frozen_location);
    if (value && typeof value === "object" && !Array.isArray(value))
      frozen = value as Record<string, unknown>;
  } catch {
    // An unavailable legacy label is displayed by immutable equipment identity.
  }
  return locationDisplayFields(position.location_kind, frozen);
}
export function approvalPositionLabel(position: ApprovalPositionLabelSource): string {
  return approvalPositionFields(position).location_label;
}

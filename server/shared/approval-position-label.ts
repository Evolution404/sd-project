/** Human-readable work location in the immutable signed approval snapshot.
 * Matching never relies on the current demand row order.
 */
export interface ApprovalPositionLabelSource {
  location_kind: string;
  location_object: string;
  location_item_no: number;
  frozen_location: string;
}
export function approvalPositionLabel(position: ApprovalPositionLabelSource): string {
  let frozen: Record<string, unknown> = {};
  try {
    const value: unknown = JSON.parse(position.frozen_location);
    if (value && typeof value === "object" && !Array.isArray(value))
      frozen = value as Record<string, unknown>;
  } catch {
    // An unavailable legacy label is displayed by immutable equipment identity.
  }
  const label = (value: unknown): string => typeof value === "string" ? value.trim() : "";
  const line = label(frozen.line_name);
  const object = label(frozen.location_label) || label(frozen.tower_no) ||
    label(frozen.asset_no) || label(frozen.physical_code) ||
    label(frozen.logical_code) || label(position.location_object);
  return [line, object].filter(Boolean).join(" · ") || position.location_object;
}

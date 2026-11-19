import type { ApprovedScope, ProjectApprovalHistory } from "../../../../../server/database/repositories/projects";

import type { DemandRecord } from "../../../../../server/shared/types/demands";

import { quantity } from "../../../shared/api/client";

interface ScopeFacts {
  id: string;
  name: string;
  version: number;
  quantity: number;
  unit: string;
  locations: Array<[string, number]>;
  materialSummary: string;
  materials: Array<[string, number, string]>;
}
export function approvalDifferences(
  current: ProjectApprovalHistory | undefined,
  draft: ProjectApprovalHistory,
) {
  function scopeFacts(scope: ApprovedScope): ScopeFacts {
    // Approval snapshots capture the demand as adopted, including its frozen locations and unit.
    const snapshot = JSON.parse(scope.snapshot_json) as DemandRecord;
    return {
      id: scope.demand_id, name: scope.demand_no, version: scope.demand_version,
      quantity: scope.quantity_scaled, unit: snapshot.unit_snapshot,
      locations: locationFacts(snapshot),
      materialSummary: scope.materials.map(row =>
        row.material_name + " " + quantity(row.approved_quantity_scaled) + " " + row.unit_snapshot).join("、"),
      materials: scope.materials.map(row => [row.material_id, row.approved_quantity_scaled, row.material_version_id] as [string, number, string])
        .sort(([a], [b]) => a.localeCompare(b)),
    };
  }
  function locationFacts(snapshot: DemandRecord): ScopeFacts["locations"] {
    return (snapshot.work_locations || []).map(row => [row.span_id || row.physical_tower_id || row.logical_tower_id || "", row.quantity_scaled] as [string, number])
      .sort(([a], [b]) => a.localeCompare(b));
  }
  const before = new Map((current?.scopes || []).map(scope => [scope.demand_id, scopeFacts(scope)]));
  const after = new Map(draft.scopes.map(scope => [scope.demand_id, scopeFacts(scope)]));
  for (const scope of draft.pending_scopes) {
    after.set(scope.demand_id, {
      id: scope.demand_id, name: scope.snapshot.demand_no, version: scope.demand_version,
      quantity: scope.snapshot.quantity_scaled, unit: scope.snapshot.unit_snapshot,
      locations: locationFacts(scope.snapshot),
      materialSummary: "",
      materials: (scope.materials || []).map(row => [row.material_id, row.quantity_scaled, scope.expected_material_versions[row.material_id] || ""]),
    });
  }
  return [...new Set([...before.keys(), ...after.keys()])].flatMap(id => {
    const old = before.get(id), next = after.get(id);
    const changes: string[] = [];
    if (!old) changes.push("新增需求");
    else if (!next) changes.push("移出需求");
    else {
      if (old.version !== next.version) changes.push("需求版本变化");
      if (old.quantity !== next.quantity || JSON.stringify(old.locations) !== JSON.stringify(next.locations))
        changes.push("作业位置或工作量变化");
      if (JSON.stringify(old.materials) !== JSON.stringify(next.materials)) changes.push("批准物资变化");
    }
    return changes.length ? [{ id, name: (next || old)!.name, changes: changes.join("、"), before: old, after: next }] : [];
  });
}

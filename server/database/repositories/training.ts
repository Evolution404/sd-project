import type { createStore } from "./store.js";

/**
 * Read-only evidence from committed Schema113 business facts. These counts are
 * never inferred from the help UI, localStorage, or unsubmitted drafts.
 */
export function trainingRepository(store: ReturnType<typeof createStore>) {
  function count(statement: string): number {
    const result = store.get<{ total: number }>(statement);
    return result?.total ?? 0;
  }
  return {
    facts() {
      return {
        unitVersions: count("SELECT COUNT(*) total FROM dictionary_item_versions v JOIN dictionary_items i ON i.id=v.item_id AND i.type_id='unit' WHERE v.status='active' AND json_type(v.fields_json,'$.quantity_precision')='integer' AND json_extract(v.fields_json,'$.quantity_precision') BETWEEN 0 AND 4"),
        workObjects: count("SELECT COUNT(*) total FROM v_work_object_current WHERE status='active'"),
        lines: count("SELECT COUNT(*) total FROM transmission_lines"),
        physicalTowers: count("SELECT COUNT(*) total FROM physical_towers"),
        logicalTowers: count("SELECT COUNT(*) total FROM logical_towers"),
        spans: count("SELECT COUNT(*) total FROM line_spans"),
        materials: count("SELECT COUNT(*) total FROM materials"),
        operations: count("SELECT COUNT(*) total FROM v_operation_current WHERE status='active'"),
        priceRules: count("SELECT COUNT(*) total FROM reference_price_versions WHERE status='active'"),
        multiLocationDemands: count("SELECT COUNT(*) total FROM (SELECT demand_id,demand_version FROM demand_version_work_locations GROUP BY demand_id,demand_version HAVING COUNT(*)>=2)"),
        demandVersions: count("SELECT COUNT(*) total FROM demand_versions"),
        activeDemands: count("SELECT COUNT(DISTINCT demand_id) total FROM demand_lifecycle_events WHERE to_status='active'"),
        frameworks: count("SELECT COUNT(*) total FROM framework_versions WHERE status='active'"),
        agreements: count("SELECT COUNT(*) total FROM agreement_versions WHERE status='active'"),
        linkedDemands: count("SELECT COUNT(*) total FROM v_project_demand_binding_current"),
        approvedProjects: count("SELECT COUNT(DISTINCT project_id) total FROM project_approval_versions WHERE status='approved'"),
        approvedChanges: count("SELECT COUNT(*) total FROM project_approval_versions WHERE status='approved' AND version_no>1"),
        actualCosts: count("SELECT COUNT(*) total FROM v_cost_current WHERE status='active'"),
        multiSettlementProjects: count("SELECT COUNT(*) total FROM (SELECT project_id FROM v_settlement_effective_versions GROUP BY project_id HAVING COUNT(DISTINCT settlement_id)>=2)"),
        reconciliations: count("SELECT COUNT(*) total FROM v_cost_reconciliation_current WHERE status='active'"),
        closures: count("SELECT COUNT(*) total FROM project_closures"),
        importedDemands: count("SELECT COUNT(*) total FROM demands WHERE batch_id IS NOT NULL"),
        auditEvents: count("SELECT COUNT(*) total FROM audit_events"),
      };
    },
  };
}

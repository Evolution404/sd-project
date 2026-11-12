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
        unitVersions: count("SELECT COUNT(*) total FROM v_dictionary_current v WHERE v.type_id='unit' AND v.status='active' AND json_type(v.fields_json,'$.quantity_precision')='integer' AND json_extract(v.fields_json,'$.quantity_precision') BETWEEN 0 AND 4"),
        workObjects: count("SELECT COUNT(*) total FROM v_work_object_current WHERE status='active'"),
        lines: count("SELECT COUNT(*) total FROM transmission_lines"),
        topologyConnected: count(`SELECT COUNT(*) total FROM line_spans span
          JOIN transmission_lines line ON line.id=span.line_id
          JOIN logical_towers start ON start.id=span.start_tower_id
          JOIN logical_towers ending ON ending.id=span.end_tower_id
          WHERE span.status='active' AND line.status='active'
          AND start.status<>'retired' AND ending.status<>'retired'
          AND EXISTS(SELECT 1 FROM physical_towers physical
            WHERE physical.id IN (start.physical_tower_id,ending.physical_tower_id)
            AND physical.status='active')`),
        materials: count("SELECT COUNT(*) total FROM v_material_current WHERE status='active'"),
        operations: count("SELECT COUNT(*) total FROM v_operation_current WHERE status='active'"),
        priceRules: count("SELECT COUNT(*) total FROM v_reference_price_current p JOIN v_operation_current o ON o.id=p.operation_id AND o.status='active' WHERE p.status='active'"),
        multiLocationDemands: count(`SELECT COUNT(*) total FROM (
          SELECT location.demand_id FROM demand_version_work_locations location
          JOIN demand_versions current ON current.demand_id=location.demand_id
            AND current.version=location.demand_version
            AND current.version=(SELECT MAX(recent.version) FROM demand_versions recent
              WHERE recent.demand_id=location.demand_id)
          GROUP BY location.demand_id HAVING COUNT(*)>=2)`),
        demandVersions: count("SELECT COUNT(*) total FROM demand_versions"),
        activeDemands: count(`SELECT COUNT(*) total FROM demand_lifecycle_events e
          WHERE e.to_status='active' AND e.event_seq=(
            SELECT MAX(last.event_seq) FROM demand_lifecycle_events last
            WHERE last.demand_id=e.demand_id)`),
        frameworks: count("SELECT COUNT(*) total FROM v_framework_current WHERE status='active'"),
        agreements: count("SELECT COUNT(*) total FROM v_agreement_current WHERE status='active'"),
        fundedLinkedDemands: count(`SELECT COUNT(*) total
          FROM v_project_demand_binding_current binding
          JOIN v_project_funding_current funding ON funding.project_id=binding.project_id
          JOIN v_agreement_current agreement ON agreement.id=funding.agreement_id
          WHERE agreement.status='active' AND agreement.framework_id=funding.framework_id`),
        approvedProjects: count("SELECT COUNT(DISTINCT project_id) total FROM project_approval_versions WHERE status='approved'"),
        approvedChanges: count("SELECT COUNT(*) total FROM project_approval_versions WHERE status='approved' AND version_no>1"),
        actualCosts: count("SELECT COUNT(*) total FROM v_cost_current WHERE status='active'"),
        multiSettlementProjects: count("SELECT COUNT(*) total FROM (SELECT project_id FROM v_settlement_effective_versions WHERE change_type<>'void' GROUP BY project_id HAVING COUNT(DISTINCT settlement_id)>=2)"),
        closedReconciledProjects: count(`SELECT COUNT(DISTINCT closure.project_id) total
          FROM project_closures closure
          JOIN v_cost_current cost ON cost.project_id=closure.project_id
            AND cost.status='active'
          JOIN v_cost_reconciliation_current recon ON recon.cost_version_id=cost.id
            AND recon.status='active'
          JOIN v_effective_settlement_items item
            ON item.settlement_item_version_id=recon.settlement_item_version_id
            AND item.project_id=closure.project_id`),
        importedDemands: count("SELECT COUNT(*) total FROM demands WHERE batch_id IS NOT NULL"),
        auditEvents: count("SELECT COUNT(*) total FROM audit_events"),
      };
    },
  };
}

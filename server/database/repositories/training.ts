import type { TrainingScenarioFacts, TrainingScenarioSetup } from "../../shared/types/training.js";
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

    scenarioFacts(setup: TrainingScenarioSetup): Omit<TrainingScenarioFacts, "actualCost" | "approvedAmount"> | null {
      const demand = store.get<Pick<TrainingScenarioFacts, "demandId"|"demandNumber"|"demandStatus"|"demandVersion"|"returnedDemand"|"correctedAfterReturn"|"projectId"|"projectNumber"|"projectStage">>(`
        SELECT d.id demandId,d.demand_no demandNumber,d.status demandStatus,d.current_version demandVersion,
          EXISTS(SELECT 1 FROM demand_lifecycle_events e WHERE e.demand_id=d.id AND e.to_status='returned') returnedDemand,
          EXISTS(SELECT 1 FROM demand_lifecycle_events e JOIN demand_versions v ON v.demand_id=e.demand_id
            AND v.version>1 AND v.recorded_at>=e.recorded_at WHERE e.demand_id=d.id AND e.to_status='returned') correctedAfterReturn,
          p.id projectId,p.code projectNumber,p.status projectStage
        FROM v_demand_current d
        LEFT JOIN v_project_demand_binding_current b ON b.demand_id=d.id
        LEFT JOIN projects p ON p.id=b.project_id AND p.framework_id=?
          AND NOT EXISTS(SELECT 1 FROM audit_events e WHERE e.entity='projects' AND e.entity_id=p.id AND e.action='delete')
        WHERE d.operation_id=? AND d.status<>'cancelled'
          AND NOT EXISTS(SELECT 1 FROM audit_events e WHERE e.entity='demands' AND e.entity_id=d.id AND e.action='delete')
        ORDER BY p.id IS NULL, d.definition_changed_at DESC,d.id LIMIT 1`, setup.frameworkId, setup.operationId);
      if (!demand) return null;
      const empty = { firstApproval:0,changedApproval:0,totalBillId:null,
        totalBillStatus:null,totalBillReturned:false,totalBillResubmitted:false,itemizedApproved:false,closed:false };
      if (!demand.projectId) return { ...demand, ...empty, returnedDemand:Boolean(demand.returnedDemand),
        correctedAfterReturn:Boolean(demand.correctedAfterReturn) };
      const result = store.get<Omit<TrainingScenarioFacts,keyof typeof demand | "actualCost" | "approvedAmount">>(`
        WITH input(project,demand) AS (VALUES (?,?)),
        approvals AS (
          SELECT ap.id,ap.version_no FROM project_approval_versions ap
          JOIN input ON ap.project_id=input.project
          WHERE ap.status='approved' AND EXISTS(SELECT 1 FROM project_approval_scope_versions sc
            WHERE sc.approval_version_id=ap.id AND sc.demand_id=input.demand)
        ),
        returned_bill AS (
          SELECT v.settlement_id,v.version_no, r.last_action,
            EXISTS(SELECT 1 FROM settlement_review_events e WHERE e.settlement_version_id=v.id AND e.action='return') returned,
            EXISTS(SELECT 1 FROM settlement_review_events back JOIN settlement_review_events again
              ON again.settlement_version_id=back.settlement_version_id AND again.event_seq>back.event_seq
              WHERE back.settlement_version_id=v.id AND back.action='return' AND again.action='submit') resubmitted
          FROM settlements s JOIN input ON s.project_id=input.project
          JOIN settlement_versions v ON v.settlement_id=s.id AND v.mode='project_total' AND v.change_type<>'void'
          JOIN approvals ap ON ap.id=v.approval_version_id AND ap.version_no>1
          JOIN v_settlement_review_status r ON r.settlement_version_id=v.id
          WHERE NOT EXISTS(SELECT 1 FROM audit_events e WHERE e.entity='settlements' AND e.entity_id=s.id AND e.action='delete')
          AND (r.last_action<>'approve' OR EXISTS(SELECT 1 FROM v_settlement_effective_versions active
            WHERE active.id=v.id))
          ORDER BY (r.last_action='approve' AND resubmitted) DESC,
            (r.last_action IN ('submit','return')) DESC, s.created_at DESC,v.version_no DESC LIMIT 1
        ),
        draft_bill AS (
          SELECT s.id FROM settlement_drafts d JOIN settlements s ON s.id=d.settlement_id
          JOIN input ON s.project_id=input.project WHERE json_extract(d.draft_json,'$.mode')='project_total'
          ORDER BY d.updated_at DESC LIMIT 1
        )
        SELECT
          COALESCE((SELECT MIN(version_no) FROM approvals WHERE version_no=1),0) firstApproval,
          COALESCE((SELECT MAX(version_no) FROM approvals WHERE version_no>1),0) changedApproval,
          COALESCE((SELECT settlement_id FROM returned_bill),(SELECT id FROM draft_bill)) totalBillId,
          COALESCE((SELECT last_action FROM returned_bill),(SELECT 'draft' FROM draft_bill)) totalBillStatus,
          EXISTS(SELECT 1 FROM returned_bill WHERE returned) totalBillReturned,
          EXISTS(SELECT 1 FROM returned_bill WHERE resubmitted) totalBillResubmitted,
          EXISTS(SELECT 1 FROM v_settlement_effective_versions s JOIN approvals ap ON ap.id=s.approval_version_id
            WHERE s.project_id=input.project AND s.mode='itemized' AND s.change_type<>'void' AND ap.version_no>1) itemizedApproved,
          EXISTS(SELECT 1 FROM project_closures c JOIN approvals ap ON ap.id=c.approval_version_id
            WHERE c.project_id=input.project AND ap.version_no>1) closed
        FROM input`,demand.projectId,demand.demandId) ?? empty;
      return { ...demand, ...result, returnedDemand:Boolean(demand.returnedDemand),
        correctedAfterReturn:Boolean(demand.correctedAfterReturn),
        totalBillReturned:Boolean(result.totalBillReturned), totalBillResubmitted:Boolean(result.totalBillResubmitted),
        itemizedApproved:Boolean(result.itemizedApproved), closed:Boolean(result.closed) };
    },
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
          FROM project_demand_scopes adopted
          JOIN projects project ON project.id=adopted.project_id
          JOIN v_project_funding_current funding ON funding.project_id=adopted.project_id
          JOIN v_agreement_current agreement ON agreement.id=funding.agreement_id
          WHERE agreement.status='active' AND agreement.framework_id=funding.framework_id
          AND (
            EXISTS (SELECT 1 FROM v_project_demand_binding_current binding
              WHERE binding.project_scope_id=adopted.id)
            OR (project.status='closed'
              AND EXISTS(SELECT 1 FROM project_closures closure
                WHERE closure.project_id=project.id)
              AND EXISTS(SELECT 1 FROM project_approval_scope_versions signed
                JOIN project_approval_versions version ON version.id=signed.approval_version_id
                WHERE signed.project_scope_id=adopted.id AND version.status='approved'))
          )`),
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

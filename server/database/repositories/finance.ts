import type { SettlementDemandLabel, SettlementVersion } from "../../shared/types/finance-workflows.js";
import type { createStore } from "./store.js";

type Store = Pick<ReturnType<typeof createStore>, "query" | "get">;

export interface FinanceTotals {
  actual_cost_fen: number;
  settlement_fen: number;
  project_total_settlement_fen: number;
  reconciled_cost_fen: number;
}
export interface FinanceDemandTotal {
  project_scope_id: string;
  demand_id: string;
  demand_no: string;
  approved_quantity_scaled: number;
  resolved_quantity_scaled: number;
}

export function financeReadRepository(store: Store) {
  function portfolioFinanceTotals(projectIds: string[]): (FinanceTotals & { project_id: string })[] {
    if (!projectIds.length) return [];
    return store.query(`WITH selected(id) AS (SELECT value FROM json_each(?))
      SELECT p.id AS project_id,
      COALESCE(actual.amount_fen,0) AS actual_cost_fen,
      COALESCE(settled.amount_fen,0) AS settlement_fen,
      COALESCE(settled.project_total_fen,0) AS project_total_settlement_fen,
      COALESCE(reconciled.amount_fen,0) AS reconciled_cost_fen
      FROM projects p
      LEFT JOIN (SELECT project_id,SUM(amount_fen) AS amount_fen
        FROM v_cost_current WHERE status='active' AND project_id IN (SELECT id FROM selected) GROUP BY project_id) actual
        ON actual.project_id=p.id
      LEFT JOIN (SELECT v.project_id,SUM(v.amount_fen) AS amount_fen,
        SUM(CASE WHEN v.mode='project_total' THEN v.amount_fen ELSE 0 END) AS project_total_fen
        FROM v_settlement_effective_versions v
        WHERE v.change_type<>'void' AND v.project_id IN (SELECT id FROM selected) GROUP BY v.project_id) settled
        ON settled.project_id=p.id
      LEFT JOIN (SELECT project_id,SUM(reconciled_cost_fen) AS amount_fen
        FROM v_effective_cost_reconciliations WHERE project_id IN (SELECT id FROM selected) GROUP BY project_id) reconciled
        ON reconciled.project_id=p.id
      WHERE p.id IN (SELECT id FROM selected)`,
      JSON.stringify(projectIds)) as (FinanceTotals & { project_id: string })[];
  }
  function portfolioFinanceDemands(approvalIds: string[]): (FinanceDemandTotal & { approval_version_id: string })[] {
    if (!approvalIds.length) return [];
    return store.query(`SELECT sc.approval_version_id,sc.project_scope_id,sc.demand_id,
      d.demand_no,sc.quantity_scaled AS approved_quantity_scaled,
      COALESCE(SUM(r.resolved_quantity_scaled),0) AS resolved_quantity_scaled
      FROM project_approval_scope_versions sc
      JOIN demands d ON d.id=sc.demand_id
      LEFT JOIN v_effective_demand_resolutions r
        ON r.project_scope_id=sc.project_scope_id
      WHERE sc.approval_version_id IN (SELECT value FROM json_each(?))
      GROUP BY sc.id ORDER BY sc.approval_version_id,sc.rowid`,
      JSON.stringify(approvalIds)) as (FinanceDemandTotal & { approval_version_id: string })[];
  }
  return {
    projectStage(projectId: string): string | undefined {
      return store.get<{status:string}>("SELECT status FROM projects WHERE id=?", projectId)?.status;
    },
    settlementApprovalLabels(projectId: string, approvalId: string) {
      const approval = store.get<{version_no: number}>(`SELECT version_no FROM project_approval_versions
        WHERE id=? AND project_id=? AND status='approved'`, approvalId, projectId);
      if (!approval) return null;
      const scopes = store.query<SettlementDemandLabel & {project_scope_id: string}>(`
        SELECT sc.project_scope_id,d.demand_no,
          json_extract(sc.snapshot_json,'$.problem_description') AS problem_description,
          json_extract(sc.snapshot_json,'$.unit_snapshot') AS unit
        FROM project_approval_scope_versions sc JOIN demands d ON d.id=sc.demand_id
        WHERE sc.approval_version_id=?`, approvalId);
      return { version_no: approval.version_no, scopes };
    },
    effectiveSettlementReport(ids: string[]) {
      const values = JSON.stringify(ids);
      const versions = store.query<SettlementVersion>(`SELECT * FROM v_settlement_effective_versions
        WHERE settlement_id IN (SELECT value FROM json_each(?))`, values);
      const resolutions = store.query<{settlement_id:string; demand_no:string; unit:string; resolved_quantity_scaled:number; evidence:string}>(`
        SELECT result.settlement_id, demand.demand_no,
          json_extract(original.snapshot_json,'$.unit_snapshot') AS unit,
          result.resolved_quantity_scaled,result.evidence
        FROM v_effective_demand_resolutions result
        JOIN project_approval_scope_versions scope ON scope.id=result.approval_scope_version_id
        JOIN demand_versions original ON original.demand_id=scope.demand_id AND original.version=scope.demand_version
        JOIN demands demand ON demand.id=scope.demand_id
        WHERE result.settlement_id IN (SELECT value FROM json_each(?))
        ORDER BY result.settlement_id,demand.demand_no`, values);
      return { versions: new Map(versions.map(version => [version.settlement_id, version])), resolutions };
    },
    settlementReconciliationImpact(settlementId: string) {
      return store.get<{count: number; cost_fen: number}>(`
        SELECT COUNT(*) AS count, COALESCE(SUM(applied.reconciled_cost_fen),0) AS cost_fen
        FROM v_effective_cost_reconciliations applied JOIN v_effective_settlement_items line
          ON line.settlement_item_version_id=applied.settlement_item_version_id
        WHERE line.settlement_id=?`, settlementId) ?? { count: 0, cost_fen: 0 };
    },
    activeCostReconciliation(entryId: string) {
      return store.get<{amount: number; count: number}>(`SELECT
        COALESCE(SUM(reconciled_cost_fen),0) AS amount,COUNT(*) AS count
        FROM v_effective_cost_reconciliations WHERE entry_id=?`, entryId) ?? { amount: 0, count: 0 };
    },
    closeApprovalBlockers(projectId: string): string[] {
      const rows = store.query<{reason: string}>(`SELECT '尚有未完成的立项或变更草稿' AS reason
        WHERE EXISTS(SELECT 1 FROM project_approval_versions WHERE project_id=? AND status='draft')
        UNION ALL SELECT '尚有未完成或未落实的项目变更'
        WHERE EXISTS(SELECT 1 FROM project_change_orders ch WHERE ch.project_id=? AND
          (ch.status IN ('draft','submitted') OR (ch.status='approved' AND NOT EXISTS(
            SELECT 1 FROM project_approval_versions ap WHERE ap.change_order_id=ch.id AND ap.status='approved'))))`,
        projectId, projectId);
      return rows.map(row => row.reason);
    },
    closeFinanceVersions(projectId: string): string[] {
      return store.query<{id: string}>(`SELECT id FROM v_cost_current WHERE project_id=? AND status='active'
        UNION ALL SELECT id FROM v_settlement_effective_versions WHERE project_id=?
        UNION ALL SELECT id FROM v_effective_cost_reconciliations WHERE project_id=? ORDER BY id`,
        projectId, projectId, projectId).map(row => row.id);
    },
    unfinishedSettlements(projectId: string): Array<{id: string; number: string; status: string}> {
      return store.query(`SELECT s.id,s.number,CASE
        WHEN d.settlement_id IS NOT NULL OR v.id IS NULL THEN 'draft'
        ELSE COALESCE(r.last_action,'draft') END AS status
        FROM settlements s
        LEFT JOIN settlement_drafts d ON d.settlement_id=s.id
        LEFT JOIN settlement_versions v ON v.id=(SELECT id FROM settlement_versions
          WHERE settlement_id=s.id ORDER BY version_no DESC LIMIT 1)
        LEFT JOIN v_settlement_review_status r ON r.settlement_version_id=v.id
        WHERE s.project_id=? AND (d.settlement_id IS NOT NULL
          OR (v.id IS NULL AND NOT EXISTS(SELECT 1 FROM audit_events a
            WHERE a.entity='settlements' AND a.entity_id=s.id AND a.action='delete'))
          OR (v.id IS NOT NULL AND COALESCE(r.last_action,'draft') IN ('draft','submit','return')))
        ORDER BY s.number`, projectId);
    },
    projectReconciliations(projectId?: string, includeDeleted = false) {
      const rows = store.query(`SELECT r.*,
        EXISTS(SELECT 1 FROM audit_events a
          WHERE a.entity='reconciliations' AND a.entity_id=r.record_id
          AND a.action='delete') AS deleted
        FROM v_cost_reconciliation_current r
        JOIN cost_versions cost ON cost.id=r.cost_version_id
        JOIN cost_entries entry ON entry.id=cost.entry_id
        WHERE (? IS NULL OR entry.project_id=?)
        AND (? OR NOT EXISTS(SELECT 1 FROM audit_events a
          WHERE a.entity='reconciliations' AND a.entity_id=r.record_id
          AND a.action='delete'))
        ORDER BY r.record_id`, projectId || null, projectId || null,
        Number(includeDeleted)) as { record_id: string; deleted: number; [key: string]: unknown }[];
      return rows.map(row => ({ ...row, deleted: Boolean(row.deleted) }));
    },
    settlementHistory(settlementId: string) {
      interface VersionRow extends Record<string, unknown> {
        id: string;
        version_no: number;
      }
      interface ItemRow extends Record<string, unknown> {
        settlement_version_id: string;
      }
      const versions = store.query(`SELECT v.*,a.version_no AS approved_project_version
        FROM settlement_versions v JOIN project_approval_versions a ON a.id=v.approval_version_id
        WHERE v.settlement_id=? ORDER BY v.version_no`, settlementId) as VersionRow[];
      if (!versions.length) return [];
      const items = store.query(`SELECT item.*,category.name AS cost_node_name,demand.demand_no,
        json_extract(sc.snapshot_json,'$.unit_snapshot') AS adopted_unit
        FROM settlement_item_versions item
        JOIN settlement_versions v ON v.id=item.settlement_version_id
        JOIN project_cost_node_versions category ON category.id=item.cost_node_version_id
        LEFT JOIN project_approval_scope_versions sc ON sc.id=item.approval_scope_version_id
        LEFT JOIN demands demand ON demand.id=sc.demand_id
        WHERE v.settlement_id=? ORDER BY item.rowid`, settlementId) as ItemRow[];
      const resolutions = store.query(`SELECT r.*,demand.demand_no,demand.id AS demand_id,sc.demand_version,
        json_extract(sc.snapshot_json,'$.unit_snapshot') AS adopted_unit
        FROM settlement_scope_results r
        JOIN settlement_versions v ON v.id=r.settlement_version_id
        JOIN project_approval_scope_versions sc ON sc.id=r.approval_scope_version_id
        JOIN demands demand ON demand.id=sc.demand_id
        WHERE v.settlement_id=? ORDER BY r.rowid`, settlementId) as ItemRow[];
      const events = store.query(`SELECT e.* FROM settlement_review_events e
        JOIN settlement_versions v ON v.id=e.settlement_version_id
        WHERE v.settlement_id=? ORDER BY v.version_no,e.event_seq`, settlementId) as ItemRow[];
      const byVersion = (rows: ItemRow[]) => {
        const grouped = new Map<string, ItemRow[]>();
        for (const row of rows) {
          const group = grouped.get(row.settlement_version_id) || [];
          group.push(row);
          grouped.set(row.settlement_version_id, group);
        }
        return grouped;
      };
      const materialGroups = byVersion(items);
      const resolutionGroups = byVersion(resolutions);
      const eventGroups = byVersion(events);
      return versions.map(version => ({
        ...version,
        items: materialGroups.get(version.id) || [],
        resolutions: resolutionGroups.get(version.id) || [],
        events: eventGroups.get(version.id) || [],
      }));
    },
    portfolioFinanceTotals,
    portfolioFinanceDemands,
    projectFinanceTotals(projectId: string): FinanceTotals {
      const result = portfolioFinanceTotals([projectId])[0];
      if (!result) throw Error("找不到项目财务汇总");
      return result;
    },
    projectFinanceDemands(approvalId: string): FinanceDemandTotal[] {
      return portfolioFinanceDemands([approvalId]);
    },
  };
}
export type FinanceReadRepository = ReturnType<typeof financeReadRepository>;

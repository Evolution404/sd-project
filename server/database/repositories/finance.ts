import type { createStore } from "./store.mjs";

type Store = Pick<ReturnType<typeof createStore>, "query" | "get">;

export interface FinanceTotals {
  actual_cost_fen: number;
  settlement_fen: number;
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
  return {
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
      const versions = store.query(`SELECT * FROM settlement_versions
        WHERE settlement_id=? ORDER BY version_no`, settlementId) as VersionRow[];
      if (!versions.length) return [];
      const items = store.query(`SELECT item.* FROM settlement_item_versions item
        JOIN settlement_versions v ON v.id=item.settlement_version_id
        WHERE v.settlement_id=? ORDER BY item.rowid`, settlementId) as ItemRow[];
      const resolutions = store.query(`SELECT r.* FROM settlement_scope_results r
        JOIN settlement_versions v ON v.id=r.settlement_version_id
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
    projectFinanceTotals(projectId: string): FinanceTotals {
      const row = store.get(`SELECT
        (SELECT COALESCE(SUM(c.amount_fen),0) FROM v_cost_current c
         WHERE c.project_id=? AND c.status='active') AS actual_cost_fen,
        (SELECT COALESCE(SUM(i.amount_fen),0) FROM settlement_item_versions i
         JOIN v_settlement_effective_versions v ON v.id=i.settlement_version_id
         WHERE v.project_id=? AND v.change_type<>'void') AS settlement_fen,
        (SELECT COALESCE(SUM(r.reconciled_cost_fen),0)
         FROM v_effective_cost_reconciliations r
         WHERE r.project_id=?) AS reconciled_cost_fen`,
        projectId, projectId, projectId) as FinanceTotals;
      return row;
    },
    projectFinanceDemands(approvalId: string): FinanceDemandTotal[] {
      return store.query(`SELECT sc.project_scope_id,sc.demand_id,d.demand_no,
        sc.quantity_scaled AS approved_quantity_scaled,
        COALESCE(SUM(r.resolved_quantity_scaled),0) AS resolved_quantity_scaled
        FROM project_approval_scope_versions sc
        JOIN demands d ON d.id=sc.demand_id
        LEFT JOIN v_effective_demand_resolutions r
          ON r.project_scope_id=sc.project_scope_id
        WHERE sc.approval_version_id=?
        GROUP BY sc.id ORDER BY sc.rowid`, approvalId) as FinanceDemandTotal[];
    },
  };
}
export type FinanceReadRepository = ReturnType<typeof financeReadRepository>;

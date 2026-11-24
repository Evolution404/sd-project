import { settlementStatusFilter } from "../../shared/types/finance-workflows.js";
import { settlementStatusSql } from "../queries/settlement-status-sql.js";
import type { Store } from "./store.js";
import { searchPage, type ListSource } from "../queries/business-lists.js";
import type { ListQuery } from "../../shared/types/contracts.js";
import type { CategoryCost } from "../../shared/types/trees.js";
import type {
  ActualCostVersion, NormalizedSettlementDraft, ReconciliationVersion,
  SettlementDraftRow, SettlementItemFact, SettlementResolutionInput, SettlementReviewEvent,
  SettlementRoot, SettlementVersion, SettlementWorkflow, SettlementListStatus, ReconciliationSettlementChoice,
} from "../../shared/types/finance-workflows.js";

type CostRow = ActualCostVersion & CategoryCost;
type SettlementListRoot = SettlementRoot & Pick<SettlementWorkflow, "effective_amount_fen" | "effective_mode"> & { deleted: boolean; status: SettlementListStatus; project_name: string; project_code: string };

/** SQL pagination keeps full workflow facts limited to the selected page. */
export function financeListRepository(store: Store) {
  return {
    searchProjectCosts(projectId: string, query: ListQuery) {
      const source: ListSource = {
        sql: `SELECT c.*, entry.cost_node_id, adopted.name AS cost_node_name,
          c.confirmed_at AS created_at
          FROM v_cost_current c JOIN cost_entries entry ON entry.id=c.entry_id
          JOIN project_cost_node_versions adopted ON adopted.id=c.cost_node_version_id
          WHERE c.project_id=?`,
        parameters: [projectId], deletionKey: "entry_id",
        columns: ["id", "title", "status", "amount_fen", "occurred_on", "version_no",
          "cost_node_name", "created_at"],
        search: ["title", "evidence", "invoice_number", "cost_node_name"],
      };
      const page = searchPage<CostRow>(store, "costs", source, query);
      return { ...page, items: page.items.map(row => ({ ...row, deleted: Boolean(row.deleted) })) };
    },
    searchSettlementWorkflows(projectId: string | undefined, query: ListQuery, selectedIds?: string[]) {
      const source: ListSource = {
        sql: `SELECT s.*,management.name AS project_name, root.code AS project_code, effective.amount_fen AS effective_amount_fen,
          CASE WHEN effective.change_type<>'void' THEN effective.mode END AS effective_mode,
          COALESCE(json_extract(draft.draft_json,'$.amount_fen'), latest.amount_fen) AS amount_fen,
          ${settlementStatusSql("draft", "latest", "review")} AS status
          FROM settlements s
          JOIN projects root ON root.id=s.project_id
          JOIN v_project_management_current management ON management.project_id=s.project_id
          LEFT JOIN settlement_drafts draft ON draft.settlement_id=s.id
          LEFT JOIN settlement_versions latest ON latest.id=(SELECT id FROM settlement_versions
             WHERE settlement_id=s.id ORDER BY version_no DESC LIMIT 1)
          LEFT JOIN v_settlement_review_status review ON review.settlement_version_id=latest.id
          LEFT JOIN v_settlement_effective_versions effective ON effective.settlement_id=s.id
          WHERE (? IS NULL OR s.project_id=?)
          AND (? IS NULL OR s.id IN (SELECT value FROM json_each(?)))`,
        parameters: [projectId ?? null, projectId ?? null, selectedIds ? JSON.stringify(selectedIds) : null, selectedIds ? JSON.stringify(selectedIds) : null],
        columns: ["id", "number", "project_name", "project_code", "created_at", "amount_fen", "effective_amount_fen", "status"], search: ["number", "project_name", "project_code", "status"],
      };
      const status = query.filters.status;
      const applied = status ? { ...query, filters: { ...query.filters, status: settlementStatusFilter(status) } } : query;
      const page = searchPage<SettlementListRoot>(store, "settlements", source, applied);
      if (!page.items.length) return { ...page, items: [] as SettlementWorkflow[] };
      const ids = JSON.stringify(page.items.map(row => row.id));
      const versions = store.query<SettlementVersion>(`SELECT v.* FROM settlement_versions v
        WHERE v.settlement_id IN (SELECT value FROM json_each(?)) AND v.version_no=(
          SELECT MAX(current.version_no) FROM settlement_versions current
          WHERE current.settlement_id=v.settlement_id)`, ids);
      const versionIds = JSON.stringify(versions.map(row => row.id));
      const drafts = store.query<SettlementDraftRow>(`SELECT * FROM settlement_drafts
        WHERE settlement_id IN (SELECT value FROM json_each(?))`, ids);
      const reviews = store.query<SettlementReviewEvent>(`SELECT review.* FROM settlement_review_events review
        WHERE review.settlement_version_id IN (SELECT value FROM json_each(?))
        AND review.event_seq=(SELECT MAX(current.event_seq) FROM settlement_review_events current
          WHERE current.settlement_version_id=review.settlement_version_id)`, versionIds);
      const items = store.query<SettlementItemFact & { settlement_version_id: string }>(
        `SELECT item.*, version.*, adopted.name AS cost_node_name
        FROM settlement_items item JOIN settlement_item_versions version ON version.settlement_item_id=item.id
        JOIN project_cost_node_versions adopted ON adopted.id=version.cost_node_version_id
        WHERE version.settlement_version_id IN (SELECT value FROM json_each(?)) ORDER BY item.id`, versionIds);
      const resolutions = store.query<SettlementResolutionInput & { settlement_version_id: string }>(
        `SELECT * FROM settlement_scope_results
        WHERE settlement_version_id IN (SELECT value FROM json_each(?)) ORDER BY rowid`, versionIds);
      const versionMap = new Map(versions.map(row => [row.settlement_id, row]));
      const draftMap = new Map(drafts.map(row => [row.settlement_id, {
        ...row, document: JSON.parse(row.draft_json) as NormalizedSettlementDraft,
      }]));
      const reviewMap = new Map(reviews.map(row => [row.settlement_version_id, row]));
      const itemMap = new Map<string, SettlementItemFact[]>();
      for (const row of items) {
        const group = itemMap.get(row.settlement_version_id) || [];
        group.push(row);
        itemMap.set(row.settlement_version_id, group);
      }
      const resolutionMap = new Map<string, SettlementResolutionInput[]>();
      for (const row of resolutions) {
        const group = resolutionMap.get(row.settlement_version_id) || [];
        group.push(row);
        resolutionMap.set(row.settlement_version_id, group);
      }
      return { ...page, items: page.items.map(row => {
        const version = versionMap.get(row.id) || null;
        return {
          ...row, deleted: Boolean(row.deleted), version, draft: draftMap.get(row.id) || null,
          review: version ? reviewMap.get(version.id) || null : null,
          items: version ? itemMap.get(version.id) || [] : [],
          resolutions: version ? resolutionMap.get(version.id) || [] : [],
        };
      }) };
    },
    searchReconciliationItems(projectId: string, query: ListQuery) {
      return searchPage<ReconciliationSettlementChoice>(store, "settlements", {
        sql: `SELECT line.settlement_item_version_id AS id, bill.id AS settlement_id,
          bill.number, bill.created_at, line.amount_fen, adopted.name AS cost_node_name,
          demand.demand_no
          FROM v_effective_settlement_items line
          JOIN settlements bill ON bill.id=line.settlement_id
          JOIN settlement_item_versions item ON item.id=line.settlement_item_version_id
          JOIN project_cost_node_versions adopted ON adopted.id=item.cost_node_version_id
          LEFT JOIN project_demand_scopes scope ON scope.id=line.project_scope_id
          LEFT JOIN demands demand ON demand.id=scope.demand_id
          WHERE line.project_id=?`,
        parameters: [projectId],
        deletionKey: "settlement_id",
        columns: ["id", "settlement_id", "number", "created_at", "amount_fen", "cost_node_name", "demand_no"],
        search: ["id", "number", "cost_node_name", "demand_no"],
      }, { ...query, deleted: false });
    },
    searchReconciliationVersions(projectId: string | undefined, query: ListQuery) {
      const source: ListSource = {
        sql: `SELECT reconciliation.*, bill.settlement_id, settlement.number AS settlement_number,
          cost.title AS cost_title, cost.version_no AS cost_version, cost.amount_fen AS cost_amount_fen,
          item.amount_fen AS item_amount_fen, adopted.name AS item_cost_node_name,
          EXISTS(SELECT 1 FROM v_effective_cost_reconciliations applied WHERE applied.id=reconciliation.id) AS effective
          FROM v_cost_reconciliation_current reconciliation
          JOIN cost_versions cost ON cost.id=reconciliation.cost_version_id
          JOIN cost_entries entry ON entry.id=cost.entry_id
          JOIN settlement_item_versions item ON item.id=reconciliation.settlement_item_version_id
          JOIN settlement_versions bill ON bill.id=item.settlement_version_id
          JOIN settlements settlement ON settlement.id=bill.settlement_id
          JOIN project_cost_node_versions adopted ON adopted.id=item.cost_node_version_id${projectId ? " WHERE entry.project_id=?" : ""}`,
        parameters: projectId ? [projectId] : [], deletionKey: "record_id",
        columns: ["id", "record_id", "settlement_id", "evidence", "status", "version_no", "reconciled_cost_fen",
          "reconciled_settlement_fen", "created_at", "effective"],
        search: ["evidence"],
      };
      const status = query.filters.status;
      const applied = status === "stale" || status === "active"
        ? { ...query, filters: { ...query.filters, status: "active", effective: status === "stale" ? "0" : "1" } }
        : query;
      const page = searchPage<ReconciliationVersion & { deleted: boolean; effective: number }>(store, "reconciliations", source, applied);
      return { ...page, items: page.items.map(row => ({ ...row, deleted: Boolean(row.deleted), effective: Boolean(row.effective) })) };
    },
  };
}

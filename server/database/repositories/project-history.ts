import type { createStore } from "./store.js";
type Store = Pick<ReturnType<typeof createStore>, "query">;
interface Identified { id: string; [field: string]: unknown }
interface Approval extends Identified { project_id: string }
interface ApprovedScope extends Identified { approval_version_id: string }
interface Cost extends Identified { project_id: string }
interface CostVersion extends Identified { entry_id: string }
interface Settlement extends Identified { project_id: string }
interface SettlementVersion extends Identified { settlement_id: string }
interface SettlementItem extends Identified { settlement_version_id: string }
interface SettlementResolution extends Identified { settlement_version_id: string }
interface SettlementReviewEvent extends Identified { settlement_version_id: string }
interface CostNode extends Identified { project_id: string }
interface CostNodeVersion extends Identified { node_id: string }

function groupBy<T extends object, K extends keyof T>(records: readonly T[], key: K):
    Map<T[K], T[]> {
  const index = new Map<T[K], T[]>();
  for (const record of records) {
    const value=record[key];
    const items=index.get(value) ?? [];
    items.push(record);
    index.set(value,items);
  }
  return index;
}

/** Exact project-owned formal history, with a bounded fixed SQL query count.
 * Business version and audit facts are not overwritten or rewritten.
 */
export function projectHistoryRepository(store: Store) {
  return {
    projectFullHistory(projectId: string) {
      const approvals = store.query<Approval>(
        "SELECT * FROM project_approval_versions WHERE project_id=? ORDER BY rowid", projectId);
      const approvalScopes = groupBy(store.query<ApprovedScope>(
        `SELECT scope.* FROM project_approval_scope_versions scope
         JOIN project_approval_versions approval ON approval.id=scope.approval_version_id
         WHERE approval.project_id=? ORDER BY scope.rowid`, projectId),
        "approval_version_id");
      const costs = store.query<Cost>(
        "SELECT * FROM cost_entries WHERE project_id=? ORDER BY rowid", projectId);
      const costVersions = groupBy(store.query<CostVersion>(
        `SELECT version.* FROM cost_versions version
         JOIN cost_entries entry ON entry.id=version.entry_id
         WHERE entry.project_id=? ORDER BY version.rowid`, projectId),
        "entry_id");
      const settlements = store.query<Settlement>(
        "SELECT * FROM settlements WHERE project_id=? ORDER BY rowid", projectId);
      const versions = store.query<SettlementVersion>(
        `SELECT v.* FROM settlement_versions v
         JOIN settlements doc ON doc.id=v.settlement_id
         WHERE doc.project_id=? ORDER BY v.rowid`, projectId);
      const items = groupBy(store.query<SettlementItem>(
        `SELECT item.* FROM settlement_item_versions item
         JOIN settlement_versions v ON v.id=item.settlement_version_id
         JOIN settlements doc ON doc.id=v.settlement_id
         WHERE doc.project_id=? ORDER BY item.rowid`, projectId), "settlement_version_id");
      const resolutions = groupBy(store.query<SettlementResolution>(
        `SELECT result.* FROM settlement_scope_results result
         JOIN settlement_versions v ON v.id=result.settlement_version_id
         JOIN settlements doc ON doc.id=v.settlement_id
         WHERE doc.project_id=? ORDER BY result.rowid`, projectId), "settlement_version_id");
      const events = groupBy(store.query<SettlementReviewEvent>(
        `SELECT event.* FROM settlement_review_events event
         JOIN settlement_versions v ON v.id=event.settlement_version_id
         JOIN settlements doc ON doc.id=v.settlement_id
         WHERE doc.project_id=? ORDER BY event.rowid`, projectId), "settlement_version_id");
      const settlementVersions = groupBy(versions.map(version=>({
        ...version,
        items:items.get(version.id) ?? [],
        resolutions:resolutions.get(version.id) ?? [],
        events:events.get(version.id) ?? [],
      })), "settlement_id");
      const nodes = store.query<CostNode>(
        "SELECT * FROM project_cost_nodes WHERE project_id=? ORDER BY rowid", projectId);
      const nodeVersions = groupBy(store.query<CostNodeVersion>(
        `SELECT version.* FROM project_cost_node_versions version
         JOIN project_cost_nodes node ON node.id=version.node_id
         WHERE node.project_id=? ORDER BY version.rowid`,projectId),"node_id");

      return {
        approvals:approvals.map(approval=>({
          ...approval,scopes:approvalScopes.get(approval.id) ?? [],
        })),
        costs:costs.map(cost=>({...cost, versions:costVersions.get(cost.id) ?? []})),
        settlements:settlements.map(doc=>({
          ...doc, versions:settlementVersions.get(doc.id) ?? [],
        })),
        profiles:store.query(
          "SELECT * FROM project_management_versions WHERE project_id=? ORDER BY rowid", projectId),
        funding:store.query(
          "SELECT * FROM project_funding_versions WHERE project_id=? ORDER BY rowid", projectId),
        stages:store.query(
          "SELECT * FROM project_stage_events WHERE project_id=? ORDER BY rowid", projectId),
        closures:store.query(
          "SELECT * FROM project_closures WHERE project_id=? ORDER BY rowid", projectId),
        cost_nodes:nodes.map(node=>({
          ...node,versions:nodeVersions.get(node.id) ?? [],
        })),
      };
    },
  };
}
export type ProjectHistoryRepository = ReturnType<typeof projectHistoryRepository>;

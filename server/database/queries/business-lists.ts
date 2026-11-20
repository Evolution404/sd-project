import { settlementStatusFilter } from "../../shared/types/finance-workflows.js";
import { settlementStatusSql } from "./settlement-status-sql.js";
import type { FinanceListItem, FinanceListKind } from "../../shared/types/finance.js";
import { PROJECT_DISPLAY_STATUS_SQL } from "./project-status-sql.js";
import type { SQLInputValue } from "node:sqlite";
import type { ListQuery, Page } from "../../shared/types/contracts.js";

interface QueryStore {
  query(sql: string, ...parameters: SQLInputValue[]): unknown[];
  get(sql: string, ...parameters: SQLInputValue[]): unknown;
}
export interface ListSource {
  sql: string;
  columns: readonly string[];
  search: readonly string[];
  defaultSort?: string;
  parameters?: SQLInputValue[];
  deletionKey?: "id" | "entry_id" | "record_id" | "settlement_id";
}
export interface DemandListRecord {
  id: string;
  demand_no: string;
  current_version: number;
  status: string;
  full_definition_json: string;
  binding_json: string | null;
  deleted: number;
}
export interface ProjectListRecord {
  id: string;
  code: string;
  name: string;
  status: string;
  version: number;
  profile_version: number;
  approval_json: string | null;
  scopes_json: string;
  funding_json: string | null;
  display_status: string;
  deleted: number;
}

const demandSource: ListSource = {
  sql: `SELECT v.*, d.created_at,
    json_extract(v.full_definition_json,'$.operation_snapshot') AS operation_snapshot,
    json_extract(v.full_definition_json,'$.unit_snapshot') AS unit_snapshot,
    (SELECT GROUP_CONCAT(DISTINCT json_extract(loc.value,'$.location_snapshot_json.line_name'))
      FROM json_each(v.full_definition_json,'$.work_locations') loc) AS line_summary,
    json_array_length(v.full_definition_json,'$.work_locations') AS location_count,
    (SELECT m.name FROM v_project_demand_binding_current b JOIN v_project_management_current m
      ON m.project_id=b.project_id WHERE b.demand_id=v.id) AS project_name,
    MAX(v.definition_changed_at, COALESCE((SELECT recorded_at FROM demand_lifecycle_events event
      WHERE event.demand_id=v.id ORDER BY event_seq DESC LIMIT 1),d.created_at),
      COALESCE((SELECT event.recorded_at FROM project_demand_link_events event
        JOIN project_demand_scopes scope ON scope.id=event.project_scope_id
        WHERE scope.demand_id=v.id ORDER BY event.recorded_at DESC LIMIT 1),d.created_at)) AS last_handled_at,
    CASE WHEN v.status='pending' THEN '待确认'
      WHEN v.status='returned' THEN '已退回'
      WHEN v.status='cancelled' THEN '已取消'
      WHEN v.status='active' AND EXISTS(SELECT 1 FROM v_project_demand_binding_current binding WHERE binding.demand_id=v.id) THEN '已承接'
      WHEN v.status='active' THEN '待承接'
      ELSE '待确认' END AS display_status,
    (SELECT json_object('project_id', b.project_id, 'project_scope_id', b.project_scope_id,
      'demand_id', b.demand_id) FROM v_project_demand_binding_current b WHERE b.demand_id=v.id) AS binding_json
    FROM v_demand_current v JOIN demands d ON d.id=v.id`,
  columns: ["id", "demand_no", "current_version", "quantity_scaled", "operation_id", "operation_version",
    "work_object_id", "unit_id", "unit_version", "target_object", "problem_description", "completion_standard",
    "object_position", "attribution_unit", "priority_id", "expected_on", "status", "operation_snapshot", "unit_snapshot", "line_summary", "location_count", "project_name", "last_handled_at", "display_status", "definition_changed_at", "created_at", "deleted"],
  search: ["demand_no", "full_definition_json", "status"],
};
const projectSource: ListSource = {
  sql: `SELECT p.*, ${PROJECT_DISPLAY_STATUS_SQL} AS display_status,
    m.name, m.version_no AS profile_version, m.category_id,
    m.managing_unit_id, m.owner_id, m.manager_id, m.planned_start_on, m.planned_end_on,
    m.preliminary_estimate_fen, category.name AS category_name, organization.name AS managing_unit_name,
    owner.username AS owner_username, manager.username AS manager_username,
    CASE WHEN approval.approval_version_id IS NOT NULL THEN json_object('id', approval.approval_version_id,
      'version_no', approval.approval_version_no, 'approved_budget_fen', approval.approved_budget_fen) END AS approval_json,
    (SELECT json_group_array(json_object('id', sc.id, 'project_id', sc.project_id, 'demand_id', sc.demand_id,
      'demand_no', d.demand_no, 'demand_status', dv.status, 'expected_on', dv.expected_on, 'binding',
      CASE WHEN b.project_scope_id IS NOT NULL THEN json_object('project_scope_id', b.project_scope_id,
        'project_id', b.project_id, 'demand_id', b.demand_id) END))
      FROM project_demand_scopes sc JOIN demands d ON d.id=sc.demand_id
      JOIN v_demand_current dv ON dv.id=d.id
      LEFT JOIN v_project_demand_binding_current b ON b.project_scope_id=sc.id
      WHERE sc.project_id=p.id) AS scopes_json,
    (SELECT json_object('id', f.id, 'version_no', f.version_no, 'agreement_id', f.agreement_id)
      FROM project_funding_versions f WHERE f.project_id=p.id ORDER BY f.version_no DESC LIMIT 1) AS funding_json
    FROM projects p JOIN v_project_management_current m ON m.project_id=p.id
    LEFT JOIN v_project_current_approval approval ON approval.project_id=p.id
    LEFT JOIN dictionary_item_versions category ON category.item_id=m.category_id AND category.version=m.category_version
    LEFT JOIN organizational_unit_versions organization ON organization.id=m.managing_unit_version_id
    LEFT JOIN users owner ON owner.id=m.owner_id LEFT JOIN users manager ON manager.id=m.manager_id`,
  columns: ["id", "code", "name", "status", "display_status", "framework_id", "category_name", "managing_unit_name",
    "planned_start_on", "planned_end_on", "preliminary_estimate_fen", "created_at", "deleted"],
  search: ["code", "name", "status", "category_name", "managing_unit_name"],
};

const financeSources: Record<FinanceListKind, ListSource> = {
  costs: {
    sql: `SELECT c.entry_id AS id, c.project_id, p.name AS project_name, root.code AS project_code,
      c.title AS label, c.amount_fen, c.occurred_on, c.status, c.version_no, c.confirmed_at AS created_at
      FROM v_cost_current c JOIN projects root ON root.id=c.project_id
      JOIN v_project_management_current p ON p.project_id=c.project_id`,
    columns: ["id", "project_id", "project_name", "project_code", "label", "amount_fen", "occurred_on", "status", "version_no", "created_at", "deleted"],
    search: ["label", "project_name", "project_code", "status"],
  },
  settlements: {
    sql: `SELECT s.id, s.project_id, p.name AS project_name, root.code AS project_code, s.number AS label,
      COALESCE(json_extract(draft.draft_json,'$.amount_fen'), v.amount_fen) AS amount_fen,
      effective.amount_fen AS effective_amount_fen,
      v.settlement_on AS occurred_on, v.version_no, s.created_at,
      ${settlementStatusSql("draft", "v", "r")} AS status
      FROM settlements s JOIN projects root ON root.id=s.project_id
      JOIN v_project_management_current p ON p.project_id=s.project_id
      LEFT JOIN settlement_versions v ON v.settlement_id=s.id AND v.version_no=(
        SELECT MAX(newer.version_no) FROM settlement_versions newer WHERE newer.settlement_id=s.id)
      LEFT JOIN v_settlement_review_status r ON r.settlement_version_id=v.id
      LEFT JOIN v_settlement_effective_versions effective ON effective.settlement_id=s.id
      LEFT JOIN settlement_drafts draft ON draft.settlement_id=s.id`,
    columns: ["id", "project_id", "project_name", "project_code", "label", "amount_fen", "occurred_on", "status", "version_no", "created_at", "deleted"],
    search: ["label", "project_name", "project_code", "status"],
  },
  reconciliations: {
    sql: `SELECT r.record_id AS id, entry.project_id, p.name AS project_name, root.code AS project_code,
      cost.title AS label, r.reconciled_settlement_fen AS amount_fen, cost.occurred_on,
      r.status, r.version_no, r.created_at FROM v_cost_reconciliation_current r
      JOIN cost_versions cost ON cost.id=r.cost_version_id JOIN cost_entries entry ON entry.id=cost.entry_id
      JOIN projects root ON root.id=entry.project_id
      JOIN v_project_management_current p ON p.project_id=entry.project_id`,
    columns: ["id", "project_id", "project_name", "project_code", "label", "amount_fen", "occurred_on", "status", "version_no", "created_at", "deleted"],
    search: ["label", "project_name", "project_code", "status"],
  },
};

export function searchPage<T>(store: QueryStore, entity: string, source: ListSource, query: ListQuery): Page<T> {
  const statement = `WITH list_rows AS (SELECT source.*, EXISTS(SELECT 1 FROM audit_events a
    WHERE a.entity=? AND a.entity_id=source.${source.deletionKey || "id"} AND a.action='delete') AS deleted FROM (${source.sql}) source) `;
  const predicates = query.deleted ? [] : ["deleted=0"];
  const parameters: SQLInputValue[] = [entity, ...(source.parameters ?? [])];
  if (query.q) {
    predicates.push("(" + source.search.map(key => `instr(lower(COALESCE(CAST("${key}" AS TEXT),'')), lower(?))>0`).join(" OR ") + ")");
    parameters.push(...source.search.map(() => query.q));
  }
  for (const [key, value] of Object.entries(query.filters)) {
    if (!source.columns.includes(key)) continue;
    // Status filters are exact enum decisions. Substring matching would
    // include "inactive" when the UI asks for "active".
    predicates.push(key === "status" || key === "display_status"
      ? `lower(COALESCE(CAST("${key}" AS TEXT),''))=lower(?)`
      : `instr(lower(COALESCE(CAST("${key}" AS TEXT),'')),lower(?))>0`);
    parameters.push(value);
  }
  const where = predicates.length ? " WHERE " + predicates.join(" AND ") : "";
  const count = store.get(statement + "SELECT COUNT(*) AS total FROM list_rows" + where, ...parameters) as { total: number };
  const sort = source.columns.includes(query.sort) ? query.sort : source.defaultSort || "created_at";
  const direction = query.direction === "asc" ? "ASC" : "DESC";
  const items = store.query(statement + `SELECT * FROM list_rows${where} ORDER BY "${sort}" ${direction}, id ASC LIMIT ? OFFSET ?`,
    ...parameters, query.page_size, (query.page - 1) * query.page_size) as T[];
  return { items, total: count.total, page: query.page, page_size: query.page_size };
}

export function businessLists(store: QueryStore) {
  return {
    finance: (kind: FinanceListKind, query: ListQuery): Page<FinanceListItem> => {
      const status = query.filters.status;
      const applied = kind === "settlements" && status
        ? { ...query, filters: { ...query.filters, status: settlementStatusFilter(status) } }
        : query;
      const result = searchPage<FinanceListItem>(store, kind, financeSources[kind], applied);
      return { ...result, items: result.items.map(row => ({ ...row, deleted: Boolean(row.deleted) })) };
    },
    demands: (query: ListQuery) => searchPage<DemandListRecord>(store, "demands", demandSource, query),
    selectedProjects: (ids: string[]) => searchPage<ProjectListRecord>(store, "projects", {
      ...projectSource,
      sql: projectSource.sql + " WHERE p.id IN (SELECT value FROM json_each(?))",
      parameters: [JSON.stringify(ids)],
    }, { page: 1, page_size: ids.length, q: "", sort: "name", direction: "asc", filters: {}, deleted: false }).items,
    projects: (query: ListQuery) => searchPage<ProjectListRecord>(store, "projects", projectSource, query),
  };
}

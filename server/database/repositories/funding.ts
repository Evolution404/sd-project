import { financeReadRepository } from "./finance.js";
import type { createStore } from "./store.js";
import { searchPage, type ListSource } from "../queries/business-lists.js";
import type { ListQuery, Page } from "../../shared/types/contracts.js";

import type { FundingKind, FundingRecord, FundingProject, FundingVersion } from "../../shared/types/funding.js";
import { PROJECT_DISPLAY_STATUS_SQL } from "../queries/project-status-sql.js";
export type { FundingKind, FundingRecord, FundingProject, FundingVersion } from "../../shared/types/funding.js";
const sources: Record<FundingKind, ListSource> = {
  frameworks: {
    sql: "SELECT f.* FROM v_framework_current f",
    columns: ["id", "name", "code", "fiscal_year", "limit_fen", "status", "version_no", "created_at", "deleted"],
    search: ["name", "code", "fiscal_year", "status"],
    defaultSort: "fiscal_year",
  },
  agreements: {
    sql: `SELECT a.*, f.name AS framework_id_label, f.fiscal_year AS fiscal_year
      FROM v_agreement_current a JOIN v_framework_current f ON f.id=a.framework_id`,
    columns: ["id", "name", "code", "framework_id_label", "fiscal_year", "limit_fen",
      "status", "contract_number", "counterparty_name", "effective_from", "effective_to", "created_at", "deleted"],
    search: ["name", "code", "framework_id_label", "contract_number", "counterparty_name", "status"],
  },
};
type Store = ReturnType<typeof createStore>;

export function fundingRepository(store: Store) {
  return {
    list(kind: FundingKind, includeDeleted = false): FundingRecord[] {
      const predicate = includeDeleted ? "" : "WHERE source.deleted=0";
      return store.query(`SELECT * FROM (
        SELECT c.*, EXISTS(SELECT 1 FROM audit_events e WHERE e.entity=?
          AND e.entity_id=c.id AND e.action='delete') AS deleted
        FROM (${sources[kind].sql}) c
      ) source ${predicate} ORDER BY source.created_at DESC`, kind) as FundingRecord[];
    },
    search(kind: FundingKind, query: ListQuery): Page<FundingRecord> {
      return searchPage<FundingRecord>(store, kind, sources[kind], query);
    },
    current(kind: FundingKind, key: string): FundingRecord | undefined {
      return store.get(`SELECT c.*, EXISTS(SELECT 1 FROM audit_events e WHERE e.entity=?
        AND e.entity_id=c.id AND e.action='delete') AS deleted FROM (${sources[kind].sql}) c
        WHERE c.id=?`, kind, key) as FundingRecord | undefined;
    },
    versions(kind: FundingKind, key: string): FundingVersion[] {
      const field = kind === "frameworks" ? "framework_id" : "agreement_id";
      const table = kind === "frameworks" ? "framework_versions" : "agreement_versions";
      return store.query(`SELECT * FROM ${table} WHERE ${field}=? ORDER BY version_no`, key) as FundingVersion[];
    },
    createFramework(row: { id: string; code: string; fiscal_year: number; created_at: string }) {
      store.run("INSERT INTO frameworks(id,code,fiscal_year,created_at) VALUES(?,?,?,?)",
        row.id, row.code, row.fiscal_year, row.created_at);
    },
    createAgreement(row: { id: string; code: string; framework_id: string; created_at: string }) {
      store.run("INSERT INTO agreements(id,code,framework_id,created_at) VALUES(?,?,?,?)",
        row.id, row.code, row.framework_id, row.created_at);
    },
    appendFrameworkVersion(row: {
      id: string; framework_id: string; version_no: number; name: string; status: string;
      limit_fen: number; reason: string; changed_by: string; recorded_at: string;
    }) {
      store.run(`INSERT INTO framework_versions(id,framework_id,version_no,name,status,limit_fen,reason,changed_by,recorded_at)
        VALUES(?,?,?,?,?,?,?,?,?)`, row.id, row.framework_id, row.version_no, row.name, row.status,
        row.limit_fen, row.reason, row.changed_by, row.recorded_at);
    },
    appendAgreementVersion(row: {
      id: string; agreement_id: string; version_no: number; name: string; status: string;
      limit_fen: number; contract_number: string | null; counterparty_name: string | null;
      signed_on: string | null; effective_from: string | null; effective_to: string | null;
      reason: string; changed_by: string; recorded_at: string;
    }) {
      store.run(`INSERT INTO agreement_versions(
        id,agreement_id,version_no,name,status,limit_fen,contract_number,counterparty_name,
        signed_on,effective_from,effective_to,reason,changed_by,recorded_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      row.id, row.agreement_id, row.version_no, row.name, row.status, row.limit_fen,
      row.contract_number, row.counterparty_name, row.signed_on, row.effective_from,
      row.effective_to, row.reason, row.changed_by, row.recorded_at);
    },
    /** One indexed set query for the current funding and approved/actual facts. */
    linkedProjects(kind: FundingKind, key: string): FundingProject[] {
      const scope = kind === "frameworks" ? "p.framework_id" : "fund.agreement_id";
      const projects = store.query(`SELECT p.id,p.code,m.name,p.status,
        ${PROJECT_DISPLAY_STATUS_SQL} AS display_status,p.framework_id,
        fund.agreement_id,approval.approved_budget_fen
        FROM projects p
        JOIN v_project_management_current m ON m.project_id=p.id
        JOIN v_project_funding_current fund ON fund.project_id=p.id
        LEFT JOIN v_project_current_approval approval ON approval.project_id=p.id
        WHERE ${scope}=?
        AND NOT EXISTS(SELECT 1 FROM audit_events a
          WHERE a.entity='projects' AND a.entity_id=p.id AND a.action='delete')
        ORDER BY p.created_at DESC`, key) as Omit<FundingProject, "actual_cost_fen" | "settlement_fen">[];
      const totals = new Map(financeReadRepository(store).portfolioFinanceTotals(projects.map(row => row.id))
        .map(row => [row.project_id, row]));
      return projects.map(row => ({
        ...row, actual_cost_fen: totals.get(row.id)?.actual_cost_fen ?? 0,
        settlement_fen: totals.get(row.id)?.settlement_fen ?? 0,
      }));
    },
  };
}
export type FundingRepository = ReturnType<typeof fundingRepository>;

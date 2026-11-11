import type { FundingRepository, FundingKind, FundingRecord } from "../../database/repositories/funding.js";
import type { Database } from "../../database/connection.js";
import type { AuditService } from "../../platform/audit/service.js";
import type { Actor, ListQuery } from "../../shared/types/contracts.js";
import { authorize, id, now } from "../../platform/auth/service.js";
import { requireValue, expectedVersion, text, integer } from "../../shared/errors/business-error.js";

function readable(row: FundingRecord): FundingRecord {
  return { ...row, deleted: Boolean(row.deleted),
    label: row.name + (row.fiscal_year && !row.framework_id ? " · " + row.fiscal_year : "") };
}
function optionalText(value: unknown, previous: string | null | undefined, label: string): string | null {
  const candidate = value === undefined ? previous : value;
  requireValue(candidate === null || candidate === undefined || typeof candidate === "string",
    label + "必须为文本");
  return candidate === null || candidate === undefined || candidate.trim() === ""
    ? null : candidate.trim();
}
function optionalDate(value: unknown, previous: string | null | undefined, label: string): string | null {
  const candidate = optionalText(value, previous, label);
  requireValue(candidate === null || (/^\d{4}-\d{2}-\d{2}$/.test(candidate) &&
    !Number.isNaN(Date.parse(candidate)) && new Date(candidate + "T00:00:00Z").toISOString().slice(0, 10) === candidate),
  label + "日期无效");
  return candidate;
}
export function createFunding(
  repository: FundingRepository,
  database: Pick<Database, "transaction">,
  audit: AuditService,
) {
  function get(kind: FundingKind, key: string, includeDeleted = false): FundingRecord {
    requireValue(typeof key === "string" && key.trim().length > 0, "请选择年度框架或执行协议");
    const found = repository.current(kind, key);
    requireValue(found && (includeDeleted || !found.deleted),
      (kind === "frameworks" ? "年度框架" : "执行协议") + "不存在或已删除", 404);
    return readable(found);
  }
  function save(actor: Actor, kind: FundingKind, input: Record<string, unknown>, key?: string): FundingRecord {
    authorize(actor, "write");
    return database.transaction(() => {
      const previous = key ? get(kind, key) : null;
      if (previous) {
        expectedVersion(previous.version_no, input.expected_version);
        requireValue(input.code === undefined || input.code === previous.code, "系统身份不能变更");
      }
      const name = text(input.name === undefined ? previous?.name : input.name,
        kind === "frameworks" ? "框架名称" : "协议名称");
      const limitFen = integer(input.limit_fen === undefined ? previous?.limit_fen : input.limit_fen,
        kind === "frameworks" ? "框架额度" : "协议额度");
      const state = input.status === undefined ? previous?.status || "active" : input.status;
      requireValue(state === "active" || state === "inactive", "状态必须是启用或停用");
      const newId = key || id();
      const timestamp = now();
      const version = (previous?.version_no || 0) + 1;
      const reason = typeof input.reason === "string" ? input.reason : "";
      if (kind === "frameworks") {
        const fiscalYear = integer(input.fiscal_year === undefined ? previous?.fiscal_year : input.fiscal_year, "年度", 2000);
        requireValue(fiscalYear <= 2100, "年度必须在2000至2100之间");
        requireValue(!previous || previous.fiscal_year === fiscalYear, "年度是框架稳定身份，不可修改");
        if (!previous) repository.createFramework({
          id: newId, code: "FRAMEWORKS-" + newId.replaceAll("-", ""),
          fiscal_year: fiscalYear, created_at: timestamp,
        });
        repository.appendFrameworkVersion({
          id: id(), framework_id: newId, version_no: version,
          name, status: state, limit_fen: limitFen, reason,
          changed_by: actor.id, recorded_at: timestamp,
        });
      } else {
        const frameworkId = input.framework_id === undefined ? previous?.framework_id : input.framework_id;
        requireValue(typeof frameworkId === "string" && frameworkId.length > 0, "请选择所属年度框架");
        requireValue(!previous || previous.framework_id === frameworkId, "所属年度框架是稳定归属，不能改挂");
        const framework = get("frameworks", frameworkId, Boolean(previous));
        requireValue(framework.status === "active" || Boolean(previous), "年度框架已停用，不能新增协议");
        const effectiveFrom = optionalDate(input.effective_from, previous?.effective_from, "生效日期");
        const effectiveTo = optionalDate(input.effective_to, previous?.effective_to, "截止日期");
        requireValue(!effectiveFrom || !effectiveTo || effectiveTo >= effectiveFrom, "截止日期不得早于生效日期");
        if (!previous) repository.createAgreement({
          id: newId, code: "AGREEMENTS-" + newId.replaceAll("-", ""),
          framework_id: frameworkId, created_at: timestamp,
        });
        repository.appendAgreementVersion({
          id: id(), agreement_id: newId, version_no: version,
          name, status: state, limit_fen: limitFen,
          contract_number: optionalText(input.contract_number, previous?.contract_number, "合同编号"),
          counterparty_name: optionalText(input.counterparty_name, previous?.counterparty_name, "合同对方"),
          signed_on: optionalDate(input.signed_on, previous?.signed_on, "签订日期"),
          effective_from: effectiveFrom, effective_to: effectiveTo, reason,
          changed_by: actor.id, recorded_at: timestamp,
        });
      }
      const result = get(kind, newId);
      audit.record(actor, kind, newId, previous ? "revise" : "create", previous, result);
      return result;
    });
  }
  function remove(actor: Actor, kind: FundingKind, key: string, version: unknown) {
    authorize(actor, "admin");
    return database.transaction(() => {
      const previous = get(kind, key);
      expectedVersion(previous.version_no, version);
      if (previous.status === "active")
        save(actor, kind, { status: "inactive", expected_version: version }, key);
      audit.record(actor, kind, key, "delete", previous, { logical: true });
      return { id: key, deleted: true };
    });
  }
  function details(kind: FundingKind, key: string) {
    const item = get(kind, key, true);
    const projects = repository.linkedProjects(kind, key);
    const approvedBudget = projects.reduce((sum, row) => sum + (row.approved_budget_fen ?? 0), 0);
    const actualCost = projects.reduce((sum, row) => sum + row.actual_cost_fen, 0);
    const approvedSettlement = projects.reduce((sum, row) => sum + row.settlement_fen, 0);
    requireValue(Number.isSafeInteger(approvedBudget) &&
      Number.isSafeInteger(actualCost) && Number.isSafeInteger(approvedSettlement),
      "资金关联汇总金额超出安全范围");
    return {
      item, projects,
      agreements: kind === "frameworks"
        ? repository.list("agreements", true).filter(agreement => agreement.framework_id === key).map(readable)
        : [],
      summary: {
        project_count: projects.length,
        approved_budget_fen: approvedBudget,
        actual_cost_fen: actualCost,
        settlement_fen: approvedSettlement,
        capacity_difference_fen: item.limit_fen - approvedBudget,
      },
    };
  }
  return {
    get,
    save,
    remove,
    details,
    list: (kind: FundingKind, includeDeleted = false) =>
      repository.list(kind, includeDeleted).map(readable),
    search(kind: FundingKind, query: ListQuery) {
      const page = repository.search(kind, query);
      return { ...page, items: page.items.map(readable) };
    },
    history(kind: FundingKind, key: string) {
      get(kind, key, true);
      return repository.versions(kind, key);
    },
  };
}
export type FundingService = ReturnType<typeof createFunding>;

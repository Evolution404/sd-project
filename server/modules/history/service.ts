import type { Actor } from "../../shared/types/contracts.js";
import type { HistoryEntry, HistoryPage, HistoryTarget } from "../../shared/types/history.js";
import type { CatalogKind } from "../../shared/types/catalog.js";
import type { IdentityRepository } from "../../database/repositories/identity.js";
import type { EvidenceOwner } from "../../database/repositories/evidence.js";
import type { AuditService } from "../../platform/audit/service.js";
import type { EvidenceService } from "../../platform/files/service.js";
import { authorize } from "../../platform/auth/service.js";
import { requireValue } from "../../shared/errors/business-error.js";
import { catalogDefinitions } from "../catalog/definitions.js";
import type { CatalogService } from "../catalog/service.js";
import type { createDemands } from "../demands/service.js";
import type { createProjects } from "../projects/service.js";
import type { createFinance } from "../finance/service.js";
import type { createOrganizations } from "../organizations/service.js";
import type { ManagementService } from "../management/service.js";
import type { WorkStandardService } from "../work-standards/service.js";
import { auditEntry, catalogHistory } from "./catalog.js";
import { demandHistory } from "./demands.js";
import { projectHistoryDetail } from "./projects.js";
import { actualCostHistory, reconciliationHistory, settlementHistory } from "./finance.js";
import { event, facts, historyPage, HISTORY_PAGE_SIZE, label, lifecycle, money, readVersions, record, rows, string, table, text,
  type HistoryQuery, type HistoryRecord, type ReadRow } from "./core.js";

interface HistoryReaders {
  identity: Pick<IdentityRepository, "actorNames">;
  audit: Pick<AuditService, "history">;
  evidence: Pick<EvidenceService, "list">;
  catalog: CatalogService;
  demands: ReturnType<typeof createDemands>;
  projects: ReturnType<typeof createProjects>;
  finance: ReturnType<typeof createFinance>;
  organizations: ReturnType<typeof createOrganizations>;
  management: ManagementService;
  standards: WorkStandardService;
}

export function createHistory(readers: HistoryReaders) {
  const { audit, catalog, demands, projects, finance, organizations, management, standards } = readers;

  function appendAudit(result: HistoryRecord, entity: string, key: string, actions: readonly string[]) {
    for (const row of audit.history(entity, key)) {
      if (actions.includes(row.action)) result.entries.push(auditEntry({ ...row }, entity));
    }
  }

  function attachments(actor: Actor, kind: EvidenceOwner, id: string) {
    return readers.evidence.list(actor, kind, id, true).map(file => ({
      id: file.id, name: file.filename, time: file.linked_at, removed: file.deleted,
    }));
  }

  function withAttachments(actor: Actor, kind: EvidenceOwner, id: string, selected: HistoryEntry | null) {
    if (selected && id) selected.files = attachments(actor, kind, id);
  }

  function select(actor: Actor, kind: string, key: string, project: string | undefined): HistoryRecord {
    switch (kind) {
      case "demands": {
        const input = demands.historyFacts(key);
        const result = demandHistory(input);
        for (const file of attachments(actor, "demand_id", key)) {
          result.entries.push(event(`attachment/${file.id}`, "登记需求附件", "资料", {}, {
            time: file.time, summary: file.name, badge: file.removed ? "已移除" : undefined, files: [file],
          }));
        }
        appendAudit(result, kind, key, ["delete"]);
        return result;
      }
      case "settlements": {
        const current = project ? finance.settlementForProject(project, key) : finance.settlement(key);
        const result = settlementHistory(current, finance.history(key));
        appendAudit(result, "settlement_drafts", key, ["withdraw"]);
        appendAudit(result, kind, key, ["delete"]);
        if (result.entries.some(entry => entry.title === "删除结算单")) result.status = "已删除";
        return result;
      }
      case "costs": {
        requireValue(project, "请选择实际费用所属项目", 422);
        const result = actualCostHistory(finance.costHistory(project, key), key);
        appendAudit(result, kind, key, ["delete"]);
        if (result.entries.some(entry => entry.title === "删除实际费用")) result.status = "已删除";
        return result;
      }
      case "reconciliations": {
        const versions = project ? finance.reconciliationHistoryForProject(project, key) : finance.reconciliationHistory(key);
        requireValue(versions.length, "费用核对记录不存在", 404);
        const result = reconciliationHistory(versions);
        appendAudit(result, kind, key, ["delete"]);
        return result;
      }
      case "cost_nodes": {
        requireValue(project, "请选择费用科目所属项目", 422);
        const content = finance.categoryDetail(actor, project, key);
        const versions = rows(content.versions).reverse();
        const current = versions.at(-1);
        return {
          name: string(current?.name) ?? "费用科目",
          status: content.audits.some(row => row.action === "delete") ? "已删除" : string(label(current?.status, lifecycle)),
          entries: [
            ...readVersions(versions, "费用科目", row => facts(["科目名称", text(row.name)], ["状态", label(row.status, lifecycle)]),
              (row, previous) => ({ title: previous && row.status !== previous.status
                ? row.status === "inactive" ? "停用费用科目" : "启用费用科目"
                : previous ? "修订费用科目" : "建立费用科目" })),
            ...rows(content.audits).filter(row => row.action === "delete").map(row => auditEntry(row, kind)),
          ],
        };
      }
      case "audit": {
        const content = management.audits(actor, true, key);
        const original = auditEntry({ ...content.original });
        return {
          name: original.title,
          status: content.decisions.some(event => event.action === "delete") ? "已移出常规审计列表" : undefined,
          entries: [original, ...rows(content.decisions).map(row => auditEntry(row, kind))],
        };
      }
      case "organizations": {
        const current = catalog.get(kind, key, true);
        const content = organizations.detail(actor, key);
        return catalogHistory(kind, current, content.versions, content.audits);
      }
      default: {
        requireValue(Object.hasOwn(catalogDefinitions, kind), "历史记录类型不存在", 404);
        const entity = kind as CatalogKind;
        const current = catalog.get(entity, key, true);
        const audits = audit.history(kind, key);
        const versions = kind === "voltages" ? [] : rows(catalog.history(entity, key));
        if (kind === "operations") {
          return operationHistory(current, versions, audits, standards.operationDetail(key));
        }
        return catalogHistory(entity, current, versions, audits);
      }
    }
  }

  function projectPage(id: string, query: HistoryQuery) {
    const {project, approval, timeline} = projects.historyTimeline(id,query,HISTORY_PAGE_SIZE);
    const {selection, ...page} = timeline;
    const item = page.items.find(row => row.id === selection?.entry_id);
    let selected: HistoryEntry | null = null;
    if (selection && item) {
      const detail = projects.historyDetail(id,selection.source,selection.row_id);
      const audit = detail.records.audit?.[0];
      const event = selection.source === "audit" && audit
        ? auditEntry(record(audit), "projects")
        : projectHistoryDetail(id,detail).find(row => row.id === item.id);
      selected = { ...event, ...item, summary: item.summary ?? event?.summary };
    }
    return { ...page, selected, name: project.name,
      status: project.deleted ? "已删除" : project.display_status,
      context: facts(["项目编号",project.code],["档案版本",`第 ${project.profile_version} 版`],
        ["当前批准版本",approval ? `第 ${approval.version_no} 版` : "尚未批准"],
        ["当前批准预算",money(approval?.approved_budget_fen)]),
    };
  }

  return {
    get(actor: Actor, target: HistoryTarget, query: HistoryQuery): HistoryPage {
      authorize(actor, "read");
      const { kind, id, project } = target;
      requireValue(id, "请选择要查看历史的记录", 404);
      if (kind === "projects") return projectPage(id,query);
      const result = select(actor, kind, id, project);
      const page = historyPage(result, query, readers.identity.actorNames);
      const selected = page.selected;
      if (!selected) return page;
      if (kind === "demands" && selected.id.startsWith("source/")) {
        withAttachments(actor, "source_id", selected.id.split("/")[1]!, selected);
      }
      if (kind === "costs" && selected.version && project) {
        const version = rows(finance.costHistory(project, id)).find(row => row.version_no === selected.version);
        if (version?.id) withAttachments(actor, "cost_version_id", String(version.id), selected);
      }
      if (kind === "settlements") {
        const versions = rows(finance.history(id));
        const version = versions.find(version => selected.id === `结算单/${version.version_no}`
          || rows(version.events).some(event => selected.id === `review/${event.id}`));
        if (version?.id) withAttachments(actor, "settlement_version_id", String(version.id), selected);
      }
      return page;
    },
  };
}

function operationHistory(current: unknown, versions: ReadRow[], audits: unknown,
  detail: ReturnType<WorkStandardService["operationDetail"]>): HistoryRecord {
  const result = catalogHistory("operations", current, versions, audits);
  for (const entry of result.entries) {
    if (entry.version === undefined) continue;
    const demands = detail.adoptions.demands.filter(row => row.operation_version === entry.version);
    const prices = detail.adoptions.prices.filter(row => row.operation_version === entry.version);
    entry.tables = [
      ...(entry.tables || []),
      ...table("采用该版本的需求", ["需求编号", "采用的需求版本"], demands.map(row => [row.demand_no, `第 ${row.demand_version} 版`])),
      ...table("引用该版本的价格规则", ["规则名称", "价格规则版本"], prices.map(row => [row.title, `第 ${row.version_no} 版`])),
    ];
    entry.links = demands.map(row => ({ label: `查看需求 ${row.demand_no}`, target: {
      kind: "demands", id: row.id, entry: `需求/${row.demand_version}`,
    } }));
    const version = versions.find(row => row.version === entry.version);
    if (version?.work_object_id && version.work_object_version_no) {
      entry.links.push({ label: "查看采用的作业对象正式版本", target: {
        kind: "objects", id: String(version.work_object_id), entry: `作业对象/${version.work_object_version_no}`,
      } });
    }
  }
  return result;
}

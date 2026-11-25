import { noSettlementBudgetText, portfolioSettlementProgress } from "../../shared/settlement-progress.js";
import { authorize } from "../../platform/auth/service.js";
import { safeAmount } from "../pricing/calculation.js";
import type { Actor } from "../../shared/types/contracts.js";
import type { ReportingReadRepository } from "../../database/repositories/reporting.js";
import type { ProjectDashboardBase } from "../../database/repositories/projects.js";
import type { FinanceSummary } from "../finance/summary.js";

interface ProjectPortfolioPort {
  dashboardPortfolio(): ProjectDashboardBase[];
}
interface FinancePortfolioPort {
  summariesForPortfolio(portfolio: ProjectDashboardBase[]): Map<string, FinanceSummary>;
}
interface DashboardProject extends Omit<ProjectDashboardBase, "approval_version_id" | "approved_budget_fen">, FinanceSummary {}
interface DashboardAlert {
  project_id: string;
  project: string;
  kind: string;
  difference_fen?: number;
  planned_end_on?: string;
}

function add<T>(totals: Map<T, bigint>, key: T, amount: number) {
  totals.set(key, (totals.get(key) || 0n) + BigInt(amount));
}

export function createReporting(
  repository: ReportingReadRepository,
  projects: ProjectPortfolioPort,
  finance: FinancePortfolioPort,
) {
  function dashboard(actor: Actor) {
    authorize(actor, "read");
    const portfolio = projects.dashboardPortfolio();
    const demandCounts = repository.dashboardDemandCounts();
    const costs = repository.dashboardActiveCosts(portfolio.map(project => project.id));
    const asOf = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai", year: "numeric",
      month: "2-digit", day: "2-digit",
    }).format(new Date());

    const summaries = finance.summariesForPortfolio(portfolio);
    const items: DashboardProject[] = portfolio.map(
      ({ approval_version_id: _approvalId, approved_budget_fen: _budget, ...project }) => ({
        ...project,
        ...requireSummary(summaries, project.id),
      }),
    );
    const projectsByFramework = new Map<string, DashboardProject[]>();
    const frameworkByProject = new Map<string, string>();
    for (const item of items) {
      frameworkByProject.set(item.id, item.framework_id);
      const group = projectsByFramework.get(item.framework_id) || [];
      group.push(item);
      projectsByFramework.set(item.framework_id, group);
    }
    const monthly = new Map<string, bigint>();
    const quarterCosts = new Map<string, bigint>();
    for (const cost of costs) {
      const month = cost.occurred_on.slice(0, 7);
      add(monthly, month, cost.amount_fen);
      const frameworkId = frameworkByProject.get(cost.project_id);
      if (!frameworkId) continue;
      const year = Number(cost.occurred_on.slice(0, 4));
      const quarter = Math.ceil(Number(cost.occurred_on.slice(5, 7)) / 3);
      add(quarterCosts, frameworkId + "/" + year + "/" + quarter, cost.amount_fen);
    }
    const frameworks = repository.dashboardFrameworks().map(framework => {
      const children = projectsByFramework.get(framework.id) || [];
      const actual = safeAmount(children.reduce((sum, item) => sum + BigInt(item.actual_cost_fen), 0n));
      return {
        ...framework,
        approved_budget_fen: safeAmount(children.reduce(
          (sum, item) => sum + BigInt(item.approved_budget_fen || 0), 0n)),
        actual_cost_fen: actual,
        settlement_fen: safeAmount(children.reduce((sum, item) => sum + BigInt(item.settlement_fen), 0n)),
        ...portfolioSettlementProgress(children),
        projects: children.length,
        difference_fen: actual - framework.limit_fen,
      };
    });
    const months = [...monthly.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, amount]) => ({ month, actual_cost_fen: safeAmount(amount) }));
    const quarters = frameworks.flatMap(framework => {
      let cumulative = 0n;
      return [1, 2, 3, 4].map(quarter => {
        cumulative += quarterCosts.get(
          framework.id + "/" + framework.fiscal_year + "/" + quarter) || 0n;
        return {
          framework: framework.name,
          fiscal_year: framework.fiscal_year,
          quarter,
          target_percent: quarter * 25,
          cumulative_actual_fen: safeAmount(cumulative),
          annual_limit_fen: framework.limit_fen,
        };
      });
    });
    const alerts: DashboardAlert[] = items.flatMap(project => {
      const issues: DashboardAlert[] = [];
      if (project.settlement_budget_difference_fen !== null && project.settlement_budget_difference_fen > 0)
        issues.push({ project_id: project.id, project: project.name, kind: "结算超出预算", difference_fen: project.settlement_budget_difference_fen });
      if (project.excess_settlement_fen)
        issues.push({ project_id: project.id, project: project.name, kind: "结算超出实际费用", difference_fen: project.excess_settlement_fen });
      if (project.settlement_fen && project.settlement_progress_percent === null)
        issues.push({ project_id: project.id, project: project.name, kind: noSettlementBudgetText });
      if (project.budget_difference_fen !== null && project.budget_difference_fen > 0)
        issues.push({
          project_id: project.id,
          project: project.name,
          kind: "费用超过批准预算",
          difference_fen: project.budget_difference_fen,
        });
      if (project.status !== "closed" && project.planned_end_on &&
          project.planned_end_on < asOf)
        issues.push({
          project_id: project.id,
          project: project.name,
          kind: "超过计划结束日期",
          planned_end_on: project.planned_end_on,
        });
      return issues;
    });
    return {
      demands: demandCounts.total,
      pending_demands: demandCounts.pending,
      pending_demand_items: repository.dashboardPendingDemands(),
      projects: portfolio.length,
      active_projects: portfolio.filter(project => project.status === "approved").length,
      portfolio: items, frameworks, months, quarters, alerts, as_of: asOf,
    };
  }
  return { dashboard };
}

function requireSummary(summaries: Map<string, FinanceSummary>, projectId: string): FinanceSummary {
  const summary = summaries.get(projectId);
  if (!summary) throw new Error("项目财务摘要缺失，拒绝展示不完整账目");
  return summary;
}
export type ReportingService = ReturnType<typeof createReporting>;

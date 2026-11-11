import { authorize } from "../../platform/auth/service.js";
import { safeAmount } from "../pricing/calculation.js";
export function createReporting(repo, projects, finance) {
  function sum(rows, key) {
    return safeAmount(
      rows.reduce((total, row) => total + BigInt(row[key] || 0), 0n),
    );
  }
  return {
    dashboard(actor) {
      authorize(actor, "read");
      const portfolio = projects.dashboardPortfolio(),
        demandCounts = repo.dashboardDemandCounts(),
        costs = repo.dashboardActiveCosts();
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      const portfolioSummaries = finance.summariesForPortfolio(portfolio);
      const items = portfolio.map(({ approval_version_id, approved_budget_fen, ...project }) => ({
        ...project,
        ...portfolioSummaries.get(project.id),
      }));
      const frameworks = repo.dashboardFrameworks().map((framework) => {
        const children = items.filter(
            (project) => project.framework_id === framework.id,
          ),
          ids = new Set(children.map((project) => project.id)),
          actual = costs.filter((cost) => ids.has(cost.project_id));
        return {
          id: framework.id,
          code: framework.code,
          name: framework.name,
          fiscal_year: framework.fiscal_year,
          limit_fen: framework.limit_fen,
          approved_budget_fen: sum(children, "approved_budget_fen"),
          actual_cost_fen: sum(actual, "amount_fen"),
          projects: children.length,
          difference_fen: sum(actual, "amount_fen") - framework.limit_fen,
        };
      });
      const months = [
        ...new Set(costs.map((cost) => cost.occurred_on.slice(0, 7))),
      ]
        .sort()
        .map((month) => ({
          month,
          actual_cost_fen: sum(
            costs.filter((cost) => cost.occurred_on.startsWith(month)),
            "amount_fen",
          ),
        }));
      const quarters = frameworks.flatMap((framework) =>
        [1, 2, 3, 4].map((quarter) => {
          const projectIds = new Set(
            items
              .filter((project) => project.framework_id === framework.id)
              .map((project) => project.id),
          );
          const actual = costs.filter(
            (cost) =>
              projectIds.has(cost.project_id) &&
              Number(cost.occurred_on.slice(0, 4)) === framework.fiscal_year &&
              Math.ceil(Number(cost.occurred_on.slice(5, 7)) / 3) <= quarter,
          );
          return {
            framework: framework.name,
            fiscal_year: framework.fiscal_year,
            quarter,
            target_percent: quarter * 25,
            cumulative_actual_fen: sum(actual, "amount_fen"),
            annual_limit_fen: framework.limit_fen,
          };
        }),
      );
      const alerts = items.flatMap((project) => {
        const messages = [];
        if (project.budget_difference_fen > 0)
          messages.push({
            project_id: project.id,
            project: project.name,
            kind: "费用超过批准预算",
            difference_fen: project.budget_difference_fen,
          });
        if (
          project.status !== "closed" &&
          project.planned_end_on &&
          project.planned_end_on < today
        )
          messages.push({
            project_id: project.id,
            project: project.name,
            kind: "超过计划结束日期",
            planned_end_on: project.planned_end_on,
          });
        return messages;
      });
      return {
        demands: demandCounts.total,
        pending_demands: demandCounts.pending,
        projects: portfolio.length,
        active_projects: portfolio.filter(
          (project) => project.status === "approved",
        ).length,
        portfolio: items,
        frameworks,
        months,
        quarters,
        alerts,
        as_of: today,
      };
    },
  };
}

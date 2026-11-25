import type { createStore } from "./store.js";

type Store = Pick<ReturnType<typeof createStore>, "query" | "get">;
export interface DashboardDemandCounts {
  total: number;
  pending: number;
}
export interface DashboardFramework {
  id: string;
  code: string;
  name: string;
  fiscal_year: number;
  limit_fen: number;
}
export interface DashboardActiveCost {
  project_id: string;
  amount_fen: number;
  occurred_on: string;
}

export function reportingReadRepository(store: Store) {
  return {
    dashboardDemandCounts(): DashboardDemandCounts {
      return store.get(`SELECT COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN d.status='pending' THEN 1 ELSE 0 END),0) AS pending
        FROM v_demand_current d WHERE NOT EXISTS(
          SELECT 1 FROM audit_events a WHERE a.entity='demands'
          AND a.entity_id=d.id AND a.action='delete')`) as DashboardDemandCounts;
    },
    dashboardPendingDemands(): {id:string;demand_no:string;problem_description:string}[] {
      return store.query(`SELECT d.id,d.demand_no,d.problem_description
        FROM v_demand_current d WHERE d.status='pending' AND NOT EXISTS(
          SELECT 1 FROM audit_events a WHERE a.entity='demands'
          AND a.entity_id=d.id AND a.action='delete')
        ORDER BY d.demand_no,d.id`) as {id:string;demand_no:string;problem_description:string}[];
    },
    dashboardFrameworks(): DashboardFramework[] {
      return store.query(`SELECT f.id,f.code,f.name,f.fiscal_year,f.limit_fen
        FROM v_framework_current f WHERE NOT EXISTS(
          SELECT 1 FROM audit_events a WHERE a.entity='frameworks'
          AND a.entity_id=f.id AND a.action='delete')
        ORDER BY f.fiscal_year,f.code`) as DashboardFramework[];
    },
    dashboardActiveCosts(projectIds: string[]): DashboardActiveCost[] {
      return store.query(`SELECT project_id,amount_fen,occurred_on
        FROM v_cost_current WHERE status='active'
        AND project_id IN (SELECT value FROM json_each(?))`, JSON.stringify(projectIds)) as DashboardActiveCost[];
    },
  };
}
export type ReportingReadRepository = ReturnType<typeof reportingReadRepository>;

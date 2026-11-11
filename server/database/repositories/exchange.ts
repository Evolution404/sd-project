import type { createStore } from "./store.js";

type Store = Pick<ReturnType<typeof createStore>, "query">;

export interface ExchangeProjectCandidate { id: string; name: string }
export interface ExchangeScopeCandidate {
  id: string;
  project_id: string;
  problem_description: string | null;
  [key: string]: unknown;
}
export interface ExchangeCostPath { id: string; full_path: string }

export function exchangeReferenceRepository(store: Store) {
  return {
    exchangeProjectCandidates(name: string): ExchangeProjectCandidate[] {
      return store.query(`SELECT p.id,m.name FROM projects p
        JOIN v_project_management_current m ON m.project_id=p.id
        WHERE m.name=? AND NOT EXISTS(SELECT 1 FROM audit_events a
          WHERE a.entity='projects' AND a.entity_id=p.id AND a.action='delete')
        ORDER BY p.created_at,p.id`, name) as ExchangeProjectCandidate[];
    },
    exchangeScopeCandidates(projectId: string): ExchangeScopeCandidate[] {
      return store.query(`SELECT sc.*,current.problem_description
        FROM project_demand_scopes sc
        JOIN v_demand_current current ON current.id=sc.demand_id
        WHERE sc.project_id=? ORDER BY sc.rowid`, projectId) as ExchangeScopeCandidate[];
    },
    exchangeCostPaths(projectId: string): ExchangeCostPath[] {
      return store.query(`WITH RECURSIVE paths(id,full_path) AS (
        SELECT n.id,current.name
        FROM project_cost_nodes n
        JOIN v_project_cost_node_current current ON current.id=n.id
        WHERE n.project_id=? AND n.parent_id IS NULL
        UNION ALL
        SELECT child.id,paths.full_path || '/' || current.name
        FROM paths JOIN project_cost_nodes child ON child.parent_id=paths.id
        JOIN v_project_cost_node_current current ON current.id=child.id
        WHERE child.project_id=?
      )
      SELECT id,full_path FROM paths`, projectId, projectId) as ExchangeCostPath[];
    },
  };
}
export type ExchangeReferenceRepository = ReturnType<typeof exchangeReferenceRepository>;

import type { Store } from "./store.js";
import { financeReadRepository } from "./finance.js";
import { projectCommandRepository } from "./project-commands.js";

interface ProjectClosureWrite {
  id: string;
  project_id: string;
  approval_version_id: string;
  reason: string;
  close_snapshot_json: string;
  closed_by: string;
  closed_at: string;
}

export function projectClosureRepository(store: Store) {
  const finance = financeReadRepository(store);
  return {
    transaction: store.transaction,
    unfinishedSettlements: finance.unfinishedSettlements,
    closeApprovalBlockers: finance.closeApprovalBlockers,
    closeFinanceVersions: finance.closeFinanceVersions,
    appendStage: projectCommandRepository(store).appendStage,
    appendDemandLink: projectCommandRepository(store).appendDemandLink,
    /** Snapshot each approved position, even when other positions are finished. */
    closureLocations(projectId: string): {
      project_scope_id: string; demand_id: string; demand_no: string;
      location_item_no: number; demand_location_id: string; location_name:string;
      approved_quantity_scaled: number; resolved_quantity_scaled: number;
      remaining_quantity_scaled: number; demand_remaining_quantity_scaled: number;
    }[] {
      return store.query(`SELECT scope.project_scope_id,scope.demand_id,d.demand_no,
        loc.location_item_no,work.demand_location_id,
        COALESCE(NULLIF(json_extract(work.location_snapshot_json,'$.location_label'),''),
          NULLIF(json_extract(work.location_snapshot_json,'$.tower_no'),''),
          NULLIF(json_extract(work.location_snapshot_json,'$.asset_no'),''),
          work.demand_location_id) AS location_name,
        loc.approved_quantity_scaled,
        COALESCE(done.resolved_quantity_scaled,0) AS resolved_quantity_scaled,
        MAX(0,loc.approved_quantity_scaled-COALESCE(done.resolved_quantity_scaled,0))
          AS remaining_quantity_scaled,
        COALESCE(balance.remaining_quantity_scaled,0) AS demand_remaining_quantity_scaled
        FROM v_approval_scope_current scope
        JOIN project_demand_scopes owner ON owner.id=scope.project_scope_id
        JOIN demands d ON d.id=scope.demand_id
        JOIN project_approval_work_locations loc ON loc.approval_scope_version_id=scope.id
        JOIN demand_version_work_locations work ON work.demand_id=scope.demand_id
          AND work.demand_version=scope.demand_version AND work.item_no=loc.location_item_no
        LEFT JOIN (
          SELECT project_scope_id,demand_location_id,
            SUM(resolved_quantity_scaled) AS resolved_quantity_scaled
          FROM v_effective_demand_resolutions GROUP BY project_scope_id,demand_location_id
        ) done ON done.project_scope_id=scope.project_scope_id
          AND done.demand_location_id=work.demand_location_id
        LEFT JOIN v_demand_current_location_progress balance
          ON balance.demand_id=scope.demand_id
          AND balance.demand_location_id=work.demand_location_id
        WHERE owner.project_id=? ORDER BY scope.project_scope_id,loc.location_item_no`,projectId);
    },
    /** Only active owner links with unfinished current demand may be released on closure. */
    closeReleases(projectId: string): {
      project_scope_id:string; demand_id:string; demand_no:string;
      remaining_quantity_scaled:number; event_seq:number;
    }[] {
      return store.query(`SELECT bind.project_scope_id,bind.demand_id,d.demand_no,
        SUM(balance.remaining_quantity_scaled) AS remaining_quantity_scaled,
        (SELECT MAX(event.event_seq) FROM project_demand_link_events event
          WHERE event.project_scope_id=bind.project_scope_id) AS event_seq
        FROM v_project_demand_binding_current bind
        JOIN demands d ON d.id=bind.demand_id
        JOIN v_demand_current_location_progress balance ON balance.demand_id=bind.demand_id
        WHERE bind.project_id=?
        GROUP BY bind.project_scope_id,bind.demand_id,d.demand_no
        HAVING SUM(balance.remaining_quantity_scaled)>0
        ORDER BY d.demand_no`,projectId);
    },
    createClosure(row: ProjectClosureWrite) {
      store.insert("project_closures", row);
    },
  };
}

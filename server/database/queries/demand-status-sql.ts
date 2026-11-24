/** User-facing projection for the v_demand_current alias v. */
export const DEMAND_DISPLAY_STATUS_SQL = `CASE WHEN v.status='pending' THEN '待确认'
      WHEN v.status='returned' THEN '已退回'
      WHEN v.status='cancelled' THEN '已取消'
      WHEN v.status='active' AND NOT EXISTS(
        SELECT 1 FROM v_demand_current_location_progress balance
        WHERE balance.demand_id=v.id AND balance.remaining_quantity_scaled>0) THEN '已解决'
      WHEN v.status='active' AND EXISTS(SELECT 1 FROM v_project_demand_binding_current binding WHERE binding.demand_id=v.id) THEN '已承接'
      WHEN v.status='active' THEN '待承接'
      ELSE '待确认' END`;

/** One SQL projection for the single user-visible project state in every portfolio. */
export const PROJECT_DISPLAY_STATUS_SQL = `CASE
  WHEN p.status='reserve' THEN '储备'
  WHEN p.status='closed' THEN '已结项'
  WHEN p.status='stocked' AND EXISTS (
    SELECT 1 FROM project_approval_versions ap
    WHERE ap.project_id=p.id AND ap.status='draft'
  ) THEN '立项中'
  WHEN p.status='stocked' THEN '已入库'
  WHEN p.status='approved' AND EXISTS (
    SELECT 1 FROM project_approval_versions ap
    WHERE ap.project_id=p.id AND ap.status='draft'
  ) THEN '变更中'
  WHEN p.status='approved' THEN '已批准'
  ELSE '储备'
END`;

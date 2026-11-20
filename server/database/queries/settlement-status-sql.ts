/** The list state is distinct from the last review action on a historical version. */
export function settlementStatusSql(draft: string, latest: string, review: string) {
  return `CASE WHEN ${draft}.settlement_id IS NOT NULL THEN 'draft'
    WHEN ${latest}.change_type='void' AND ${review}.last_action='approve' THEN 'voided'
    ELSE COALESCE(${review}.last_action,'draft') END`;
}

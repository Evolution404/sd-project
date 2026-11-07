import {db} from '../connection.mjs';

// An official settlement number remains reserved by its complete version history.
export function settlementNumberInUse(number,entryId=''){
 return !!db.prepare(`SELECT id FROM project_settlement_entries
  WHERE settlement_no=? AND id<>? UNION ALL
  SELECT entry_id FROM settlement_revisions WHERE settlement_no=? AND entry_id<>? LIMIT 1`)
  .get(number,entryId,number,entryId);
}

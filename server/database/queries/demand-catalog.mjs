import {db} from '../connection.mjs';
import {operationRows} from '../repositories/operation-profiles.mjs';
import {currentDictionaryRows} from '../repositories/dictionary-deletions.mjs';

// One batched read of each source table; never query per Excel row.
export function loadDemandCatalogRows(){
 const items=[...currentDictionaryRows(db,'dictionary_items',
  db.prepare("SELECT * FROM dictionary_items WHERE status='active'").all()),
  ...currentDictionaryRows(db,'operations',operationRows('active'))];
 const lines=db.prepare(`SELECT l.*,v.name AS voltage_name FROM transmission_lines l
  JOIN voltage_levels v ON v.id=l.voltage_level_id
  WHERE l.status='active' AND l.setup_status='ready'`).all();
 const towers=db.prepare(`SELECT t.*,l.name AS line_name,l.version AS line_version,
  p.tower_code,p.version AS physical_version
  FROM logical_towers t JOIN transmission_lines l ON l.id=t.line_id
  JOIN physical_towers p ON p.id=t.physical_tower_id
  WHERE t.status='active' AND l.status='active' AND l.setup_status='ready'
    AND p.status='active'`).all();
 const spans=db.prepare("SELECT * FROM line_spans WHERE status='active'").all();
 const existing=db.prepare(`SELECT id,demand_no,status,version,work_target_type,
  operation_id,target_object,problem_description,quantity_scaled,
  unit_snapshot,operation_snapshot,line_name_snapshot,tower_no_snapshot,
  created_at,observed_physical_tower_id,physical_tower_id,span_id,logical_tower_id
  FROM demands WHERE status IN ('pending','active')
  ORDER BY created_at DESC,id DESC`).all();
 const historicalSources=db.prepare(`SELECT ds.demand_id,s.type_snapshot,
  s.discovered_on,s.proposed_by,s.external_ref
  FROM demand_sources ds JOIN source_records s ON s.id=ds.source_id
  JOIN demands d ON d.id=ds.demand_id WHERE d.status IN ('pending','active')`).all();
 return {items,lines,towers,spans,existing,historicalSources};
}

import {all,one} from '../index.mjs';

// Read models: the domain/application decides whether an operation is allowed.
// SQL joins and projections belong exclusively to database/queries.
export function demandDetailRow(id){
 return one(`SELECT d.*,l.name AS current_line_name,
  COALESCE(t.tower_no,st.tower_no) AS current_tower_no,
  pt.tower_code AS current_physical_code
 FROM demands d
 LEFT JOIN logical_towers t ON t.id=d.logical_tower_id
 LEFT JOIN line_spans s ON s.id=d.span_id
 LEFT JOIN logical_towers st ON st.id=s.start_tower_id
 LEFT JOIN transmission_lines l ON l.id=COALESCE(t.line_id,s.line_id,d.context_line_id)
 LEFT JOIN physical_towers pt ON pt.id=COALESCE(d.physical_tower_id,t.physical_tower_id)
 WHERE d.id=?`,id);
}
export const demandSources=id=>all(`SELECT s.* FROM source_records s
 JOIN demand_sources ds ON ds.source_id=s.id WHERE ds.demand_id=?`,id);
export const demandRelatedTowers=id=>all(`SELECT t.*,l.name AS line_name
 FROM logical_towers t JOIN transmission_lines l ON l.id=t.line_id
 JOIN demand_related_logical_towers r ON r.logical_tower_id=t.id WHERE r.demand_id=?`,id);
export const demandRelatedIds=id=>all(
 'SELECT logical_tower_id FROM demand_related_logical_towers WHERE demand_id=?',id);
export const demandSourceTypeIds=id=>all(`SELECT s.type_id FROM source_records s
 JOIN demand_sources x ON x.source_id=s.id WHERE x.demand_id=?`,id);
export const demandRevisions=id=>all(
 'SELECT * FROM demand_revisions WHERE demand_id=? ORDER BY version DESC',id);
export const ownedDemandBatches=(status,userId,isAdmin)=>all(`SELECT * FROM demand_batches
 WHERE status=? AND (created_by=? OR ?=1) ORDER BY updated_at DESC`,status,userId,Number(isAdmin));
export function demandSpanChoices(lineId,page,search){
 const base=`FROM line_spans s JOIN transmission_lines l ON l.id=s.line_id
 JOIN logical_towers a ON a.id=s.start_tower_id
 JOIN logical_towers b ON b.id=s.end_tower_id
 JOIN physical_towers pa ON pa.id=a.physical_tower_id
 JOIN physical_towers pb ON pb.id=b.physical_tower_id
 WHERE s.line_id=? AND a.line_id=s.line_id AND b.line_id=s.line_id
 AND s.status='active' AND l.status='active' AND l.setup_status='ready'
 AND a.status='active' AND b.status='active' AND pa.status='active'
 AND pb.status='active' AND (a.tower_no LIKE ? OR b.tower_no LIKE ?)`;
 const args=[lineId,'%'+search+'%','%'+search+'%'];
 return {
  rows:all('SELECT s.*,a.tower_no start_tower_no,b.tower_no end_tower_no,l.name line_name '+base+
   ' ORDER BY a.sort_rank,b.sort_rank,s.id LIMIT 100 OFFSET ?',...args,(page-1)*100),
  total:one('SELECT COUNT(*) n '+base,...args).n
 };
}

export function listDemands(query){
 let sql=`SELECT d.id,d.demand_no,d.line_name_snapshot,d.tower_no_snapshot,
 d.physical_code_snapshot,d.operation_snapshot,d.target_object,d.quantity_scaled,
 d.unit_snapshot,d.status,d.version,d.created_at,d.work_target_type,
 d.problem_description,d.location_kind,
 COALESCE(t.line_id,s.line_id,d.context_line_id) AS location_line_id,
 d.span_id,d.span_version
 FROM demands d
 LEFT JOIN logical_towers t ON t.id=d.logical_tower_id
 LEFT JOIN line_spans s ON s.id=d.span_id WHERE 1=1`;
 const args=[];
 if(query.get('status')){sql+=' AND d.status=?';args.push(query.get('status'))}
 if(query.get('line_id')){
  // Three indexed locator paths; COALESCE in WHERE would force a demand scan.
  sql+=` AND (d.logical_tower_id IN (SELECT id FROM logical_towers WHERE line_id=?)
   OR d.span_id IN (SELECT id FROM line_spans WHERE line_id=?)
   OR d.context_line_id=?)`;
  args.push(query.get('line_id'),query.get('line_id'),query.get('line_id'));
 }
 if(query.get('search')){sql+=' AND (d.demand_no LIKE ? OR d.target_object LIKE ? OR d.problem_description LIKE ? OR d.line_name_snapshot LIKE ? OR d.tower_no_snapshot LIKE ?)';args.push(...Array(5).fill('%'+query.get('search')+'%'))}
 sql+=' ORDER BY d.created_at DESC,d.demand_no DESC';
 return all(sql,...args);
}

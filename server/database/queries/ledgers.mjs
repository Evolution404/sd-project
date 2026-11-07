import {db} from '../connection.mjs';

const read=id=>db.prepare('SELECT * FROM '+id.table+' WHERE id=?').get(id.key);
export const ledgerLine=id=>read({table:'transmission_lines',key:id});
export const ledgerTower=id=>read({table:'logical_towers',key:id});
export const ledgerPhysical=id=>read({table:'physical_towers',key:id});
export const ledgerSpan=id=>read({table:'line_spans',key:id});
export const ledgerPhysicalCoordinates=id=>db.prepare(`SELECT longitude,latitude
 FROM physical_towers WHERE id=?`).get(id);
export const ledgerRequest=key=>db.prepare(
 'SELECT * FROM ledger_requests WHERE request_key=?').get(key);
export const ledgerTopologyTowers=id=>db.prepare(`SELECT t.id,t.version,t.sort_rank,
 t.physical_tower_id,p.version AS pv FROM logical_towers t
 LEFT JOIN physical_towers p ON p.id=t.physical_tower_id
 WHERE t.line_id=? ORDER BY t.id`).all(id);
export const ledgerTopologySpans=id=>db.prepare(
 'SELECT * FROM line_spans WHERE line_id=? ORDER BY id').all(id);
export const ledgerLineRows=()=>db.prepare(`SELECT l.*,v.name AS voltage_name,
 p.name AS parent_name,t.tower_no AS junction_tower_no,
 COALESCE(tc.n,0) tower_count,COALESCE(sc.n,0) span_count
 FROM transmission_lines l JOIN voltage_levels v ON v.id=l.voltage_level_id
 LEFT JOIN transmission_lines p ON p.id=l.parent_line_id
 LEFT JOIN logical_towers t ON t.id=l.junction_tower_id
 LEFT JOIN (SELECT line_id,COUNT(*) n FROM logical_towers GROUP BY line_id)
 tc ON tc.line_id=l.id
 LEFT JOIN (SELECT line_id,COUNT(*) n FROM line_spans WHERE status<>'retired'
 GROUP BY line_id) sc ON sc.line_id=l.id ORDER BY l.name,l.id`).all();
export const ledgerVoltage=id=>db.prepare(
 'SELECT * FROM voltage_levels WHERE id=?').get(id);
export const lineUsageCounts=id=>[
 db.prepare('SELECT COUNT(*) n FROM logical_towers WHERE line_id=?').get(id).n,
 db.prepare('SELECT COUNT(*) n FROM line_spans WHERE line_id=?').get(id).n,
 db.prepare('SELECT COUNT(*) n FROM transmission_lines WHERE parent_line_id=?').get(id).n
].reduce((sum,n)=>sum+n,0);
export const activeLineReferences=id=>!!db.prepare(`SELECT 1 FROM logical_towers
 WHERE line_id=? AND status='active'`).get(id)
 ||!!db.prepare(`SELECT 1 FROM transmission_lines
 WHERE parent_line_id=? AND status='active'`).get(id);
export const lineDeletionReferences=id=>[
 'SELECT 1 FROM logical_towers WHERE line_id=?',
 'SELECT 1 FROM line_spans WHERE line_id=?',
 'SELECT 1 FROM transmission_lines WHERE parent_line_id=?',
 `SELECT 1 FROM demands d LEFT JOIN logical_towers t ON t.id=d.logical_tower_id
 LEFT JOIN line_spans sp ON sp.id=d.span_id
 WHERE COALESCE(t.line_id,sp.line_id,d.context_line_id)=?`
].some(sql=>!!db.prepare(sql).get(id));

const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
function page(query,sql,args){
 const raw=query.get('page');
 if(raw===null)return db.prepare(sql).all(...args);
 const p=Number(raw),size=Number(query.get('page_size')||30);
 if(!Number.isSafeInteger(p)||p<1||!Number.isSafeInteger(size)||size<1||size>200)
  fail(422,'分页参数无效');
 const total=db.prepare('SELECT COUNT(*) n FROM ('+
  sql.replace(/ ORDER BY [\s\S]*$/,'')+')').get(...args).n;
 const rows=db.prepare(sql+' LIMIT ? OFFSET ?').all(...args,size,(p-1)*size);
 return {rows,total,page:p,page_size:size};
}
export function queryLedgerTowers(query=new URLSearchParams()){
 const args=[],where=[];
 if(query.get('id')){where.push('t.id=?');args.push(query.get('id'))}
 if(query.get('line_id')){where.push('t.line_id=?');args.push(query.get('line_id'))}
 if(query.get('search')){
  where.push('(t.tower_no LIKE ? OR l.name LIKE ? OR p.tower_code LIKE ? OR p.model LIKE ? OR t.management_department LIKE ?)');
  args.push(...Array(5).fill('%'+query.get('search')+'%'));
 }
 return page(query,`SELECT t.*,l.name AS line_name,l.line_kind,l.status AS line_status,
 l.setup_status,v.name AS voltage_name,p.tower_code AS physical_code,p.tower_type,
 p.model,p.height_scaled,p.purpose,p.asset_no,p.longitude,p.latitude,p.commissioned_on,
 p.version AS physical_version,COALESCE(sc.n,0) shared_count
 FROM logical_towers t JOIN transmission_lines l ON l.id=t.line_id
 JOIN voltage_levels v ON v.id=l.voltage_level_id
 LEFT JOIN physical_towers p ON p.id=t.physical_tower_id
 LEFT JOIN (SELECT physical_tower_id,COUNT(*) n FROM logical_towers
 WHERE physical_tower_id IS NOT NULL GROUP BY physical_tower_id)
 sc ON sc.physical_tower_id=t.physical_tower_id
 `+(where.length?'WHERE '+where.join(' AND '):'')+
 ' ORDER BY l.name,t.sort_rank,t.id',args);
}
export function queryLedgerSpans(query=new URLSearchParams()){
 const args=[],where=[];
 if(query.get('tower_id')){
  where.push('(s.start_tower_id=? OR s.end_tower_id=?)');
  args.push(query.get('tower_id'),query.get('tower_id'));
 }
 if(query.get('line_id')){where.push('s.line_id=?');args.push(query.get('line_id'))}
 if(query.get('status')!=='all')where.push("s.status<>'retired'");
 if(query.get('search')){
  where.push('(l.name LIKE ? OR a.tower_no LIKE ? OR b.tower_no LIKE ?)');
  args.push(...Array(3).fill('%'+query.get('search')+'%'));
 }
 return page(query,`SELECT s.*,l.name AS line_name,a.tower_no AS start_tower_no,
 b.tower_no AS end_tower_no,pa.longitude AS lon_a,pa.latitude AS lat_a,
 pb.longitude AS lon_b,pb.latitude AS lat_b,COALESCE(dc.n,0) demand_count
 FROM line_spans s JOIN transmission_lines l ON l.id=s.line_id
 JOIN logical_towers a ON a.id=s.start_tower_id
 JOIN logical_towers b ON b.id=s.end_tower_id
 LEFT JOIN physical_towers pa ON pa.id=a.physical_tower_id
 LEFT JOIN physical_towers pb ON pb.id=b.physical_tower_id
 LEFT JOIN (SELECT span_id,COUNT(*) n FROM demands
 WHERE span_id IS NOT NULL GROUP BY span_id) dc ON dc.span_id=s.id
 `+(where.length?'WHERE '+where.join(' AND '):'')+
 ' ORDER BY l.name,a.sort_rank,s.created_at,s.id',args);
}
export const ledgerSharedCircuits=id=>db.prepare(`SELECT t.id,t.line_id,t.tower_no,
 t.status,t.version,t.circuit_position,l.name AS line_name
 FROM logical_towers t JOIN transmission_lines l ON l.id=t.line_id
 WHERE t.physical_tower_id=? ORDER BY l.name,t.tower_no`).all(id);
export const ledgerTowerDemandCount=id=>db.prepare(`SELECT COUNT(*) n FROM demands
 WHERE logical_tower_id=? OR span_id IN
 (SELECT id FROM line_spans WHERE start_tower_id=? OR end_tower_id=?)`)
 .get(id,id,id).n;
export const ledgerTowerNames=id=>db.prepare(`SELECT *
 FROM logical_tower_name_history WHERE logical_tower_id=?
 ORDER BY valid_from DESC`).all(id);
export const ledgerTowerBindings=id=>db.prepare(`SELECT *
 FROM logical_tower_physical_history WHERE logical_tower_id=?
 ORDER BY valid_from DESC`).all(id);
export const ledgerLineAudits=id=>db.prepare(`SELECT e.*,u.username AS actor_name
 FROM audit_events e LEFT JOIN users u ON u.id=e.actor_id
 WHERE e.entity='ledger_lines' AND e.entity_id=?
 ORDER BY e.created_at DESC,e.rowid DESC LIMIT 200`).all(id);
export const activeLedgerTowerNos=id=>db.prepare(`SELECT tower_no FROM logical_towers
 WHERE line_id=? AND status<>'inactive'`).all(id);
export const ledgerMaxRank=id=>db.prepare(`SELECT COALESCE(MAX(sort_rank),0) n
 FROM logical_towers WHERE line_id=?`).get(id).n;
export const ledgerOrderedTowerIds=id=>db.prepare(`SELECT id FROM logical_towers
 WHERE line_id=? AND status<>'inactive'
 ORDER BY sort_rank,id`).all(id).map(r=>r.id);
export const ledgerPhysicalReferences=id=>db.prepare(`SELECT id,line_id,tower_no
 FROM logical_towers WHERE physical_tower_id=?`).all(id);
export const duplicateActiveTower=(lineId,number,exceptId)=>!!db.prepare(`SELECT 1
 FROM logical_towers WHERE line_id=? AND tower_no=? AND id<>?
 AND status<>'inactive'`).get(lineId,number,exceptId);
export const towerHasActiveEdges=id=>!!db.prepare(`SELECT 1 FROM line_spans
 WHERE (start_tower_id=? OR end_tower_id=?) AND status<>'retired'`).get(id,id)
 ||!!db.prepare(`SELECT 1 FROM transmission_lines
 WHERE junction_tower_id=? AND status='active' AND setup_status='ready'`).get(id);
export const hasOtherActiveCircuit=(physicalId,towerId)=>!!db.prepare(`SELECT 1
 FROM logical_towers WHERE physical_tower_id=? AND id<>?
 AND status='active'`).get(physicalId,towerId);
export const towerDeletionReferences=(towerId,physicalId)=>[
 !!db.prepare(`SELECT 1 FROM demands WHERE logical_tower_id=?
 OR physical_tower_id=? OR observed_physical_tower_id=?`).get(towerId,physicalId),
 !!db.prepare(`SELECT 1 FROM line_spans WHERE start_tower_id=?
 OR end_tower_id=?`).get(towerId,towerId),
 !!db.prepare('SELECT 1 FROM transmission_lines WHERE junction_tower_id=?').get(towerId),
 !!db.prepare('SELECT 1 FROM demand_related_logical_towers WHERE logical_tower_id=?').get(towerId)
].some(Boolean);
export const linkedPeerTowers=id=>db.prepare(`SELECT id,line_id,tower_no
 FROM logical_towers WHERE physical_tower_id=? ORDER BY id`).all(id);
export const detachDemandCount=(logicalId,physicalId)=>db.prepare(`SELECT COUNT(DISTINCT d.id) n
 FROM demands d WHERE d.logical_tower_id=? OR d.physical_tower_id=? OR d.observed_physical_tower_id=?
 OR d.span_id IN (SELECT id FROM line_spans
 WHERE start_tower_id=? OR end_tower_id=?)
 OR d.id IN (SELECT demand_id FROM demand_related_logical_towers
 WHERE logical_tower_id=?)`).get(logicalId,physicalId,logicalId,logicalId,logicalId).n;
export const activeBindingFrom=id=>db.prepare(`SELECT valid_from
 FROM logical_tower_physical_history WHERE logical_tower_id=?
 AND valid_to IS NULL`).get(id);
export const directTowerDemandCount=id=>db.prepare(`SELECT COUNT(*) n FROM demands
 WHERE logical_tower_id=?`).get(id).n;
export const activeLineTowers=id=>db.prepare(`SELECT * FROM logical_towers
 WHERE line_id=? AND status='active' ORDER BY sort_rank,id`).all(id);
export const activeSpanBetween=(lineId,aId,bId)=>db.prepare(`SELECT * FROM line_spans
 WHERE line_id=? AND status<>'retired'
 AND ((start_tower_id=? AND end_tower_id=?)
 OR (start_tower_id=? AND end_tower_id=?))`)
 .get(lineId,aId,bId,bId,aId);
export const spanDemandReferenced=id=>!!db.prepare(
 'SELECT 1 FROM demands WHERE span_id=?').get(id);

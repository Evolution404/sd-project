import {db} from '../connection.mjs';
import {dictionaryDeleted} from './dictionary-deletions.mjs';
import {operationById} from './operation-profiles.mjs';

// Pricing storage, lookups and cross-domain joins are SQL-only here.
// Approval, compatibility and pricing decisions remain in application layer.
export function activePriceDictionaryItem(id,type){
 if(type==='operation'){
  const item=operationById(id);
  return item?.status==='active'&&!dictionaryDeleted(db,'operations',id)?item:null;
 }
 const item=db.prepare(`SELECT * FROM dictionary_items
  WHERE id=? AND type_id=? AND status='active'`).get(id,type);
 return item&&!dictionaryDeleted(db,'dictionary_items',id)?item:null;
}
export const catalogById=id=>db.prepare('SELECT * FROM reference_price_catalog WHERE id=?').get(id);
export const activeVoltage=id=>!!db.prepare(
 "SELECT id FROM voltage_levels WHERE id=? AND status='active'").get(id);
export function currentReferencePrice(id){
 return db.prepare(`SELECT c.*,v.id AS reference_price_version_id,v.version_no,v.unit_price_fen,
 v.price_source,v.price_date,v.tax_mode,v.effective_on,v.basis,v.reason AS revision_reason,
 op.name AS operation_name,un.name AS unit_name,vl.name AS voltage_name
 FROM reference_price_catalog c
 JOIN reference_price_versions v ON v.catalog_id=c.id AND v.version_no=c.version
 JOIN operations op ON op.id=c.operation_id
 JOIN dictionary_items un ON un.id=c.unit_id
 LEFT JOIN voltage_levels vl ON vl.id=c.voltage_level_id
 WHERE c.id=?`).get(id);
}
export function catalogPriceIds(options){
 return db.prepare(`SELECT c.id FROM reference_price_catalog c
 WHERE (? IS NULL OR c.operation_id=?) AND (? IS NULL OR c.unit_id=?)
 AND (? IS NULL OR c.status=?) ORDER BY c.updated_at DESC,c.code LIMIT 1000`).all(
 options.operation_id||null,options.operation_id||null,
 options.unit_id||null,options.unit_id||null,
 options.status||null,options.status||null);
}
export const priceVersions=id=>db.prepare(
 'SELECT * FROM reference_price_versions WHERE catalog_id=? ORDER BY version_no DESC').all(id);
export function insertPriceCatalog(item){
 const names=Object.keys(item);
 db.prepare('INSERT INTO reference_price_catalog('+names.join(',')+') VALUES('+
  names.map(()=>'?').join(',')+')').run(...Object.values(item));
}
export function insertPriceVersion(item){
 const names=Object.keys(item);
 db.prepare('INSERT INTO reference_price_versions('+names.join(',')+') VALUES('+
  names.map(()=>'?').join(',')+')').run(...Object.values(item));
}
export function setCatalogPriceVersion(id,version,timestamp){
 db.prepare(`UPDATE reference_price_catalog SET version=?,updated_at=? WHERE id=?`)
  .run(version,timestamp,id);
}
export function updatePriceCatalogStatus(id,status,timestamp){
 db.prepare('UPDATE reference_price_catalog SET status=?,updated_at=? WHERE id=?')
  .run(status,timestamp,id);
}
export function activePriceScope(projectId,scopeId){
 return db.prepare(`SELECT demand_id FROM project_demand_scopes
  WHERE id=? AND project_id=? AND status='active'`).get(scopeId,projectId);
}
export function projectPriceScope(projectId,scopeId){
 return db.prepare(`SELECT * FROM project_demand_scopes
  WHERE id=? AND project_id=? AND status='active'`).get(scopeId,projectId);
}
export const projectForPricing=id=>db.prepare('SELECT * FROM projects WHERE id=?').get(id);
export function demandForPricing(id){
 return db.prepare(`SELECT d.operation_id,d.unit_id,l.voltage_level_id FROM demands d
 LEFT JOIN logical_towers t ON t.id=d.logical_tower_id
 LEFT JOIN line_spans sp ON sp.id=d.span_id
 LEFT JOIN transmission_lines l ON l.id=COALESCE(t.line_id,sp.line_id,d.context_line_id)
 WHERE d.id=?`).get(id);
}
export function applyPriceToScope(projectId,scopeId,price,source,timestamp){
 db.prepare(`UPDATE project_demand_scopes
  SET unit_price_fen=?,price_source=?,price_date=?,tax_mode=?,
      reference_price_version_id=?,updated_at=? WHERE id=?`)
  .run(price.unit_price_fen,source,price.price_date,price.tax_mode,
    price.reference_price_version_id,timestamp,scopeId);
 db.prepare('UPDATE projects SET version=version+1,updated_at=? WHERE id=?')
  .run(timestamp,projectId);
}

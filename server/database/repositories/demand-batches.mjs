import {randomUUID} from 'node:crypto';
import {db} from '../connection.mjs';

// Domain and application decide what can be submitted; this is the only
// persistence contract for draft and bulk demand submission.
export const demandBatchById=id=>db.prepare('SELECT * FROM demand_batches WHERE id=?').get(id);
export const demandBatchByKey=key=>db.prepare(
 'SELECT * FROM demand_batches WHERE idempotency_key=?').get(key);

export function createDemandDraft(item){
 db.prepare(`INSERT INTO demand_batches
  (id,draft_json,status,version,idempotency_key,payload_sha256,source_id,
   created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
  .run(item.id,item.draft_json,item.status,item.version,
       item.idempotency_key,item.payload_sha256,item.source_id,
       item.created_by,item.created_at,item.updated_at);
}
export function updateDemandDraft(next){
 db.prepare(`UPDATE demand_batches SET draft_json=?,version=?,updated_at=? WHERE id=?`)
  .run(next.draft_json,next.version,next.updated_at,next.id);
}
export function deleteDemandDraft(id){
 db.prepare('DELETE FROM demand_batches WHERE id=?').run(id);
}
export function deletedDemandDraftAudits(userId,isAdmin){
 return db.prepare(`SELECT * FROM audit_events WHERE entity='demand_batches'
  AND action='delete_draft'
  AND (json_extract(before_json,'$.created_by')=? OR ?=1)
  ORDER BY created_at DESC`).all(userId,Number(isAdmin));
}
export function demandBatchResultFacts(id){
 return {
  batch:demandBatchById(id),
  tracked:db.prepare(`SELECT DISTINCT source_id AS id FROM batch_demand_sources
    WHERE batch_id=? ORDER BY source_id`).all(id),
  count:db.prepare('SELECT COUNT(*) n FROM demands WHERE batch_id=?').get(id).n,
  ids:db.prepare(`SELECT id FROM demands WHERE batch_id=?
    ORDER BY created_at,rowid`).all(id),
  linked:db.prepare(`SELECT matched_demand_id id FROM demand_duplicate_reviews
    WHERE batch_id=? AND decision='link'`).all(id)
 };
}

export function demandSubmissionWriter(){
 const source=db.prepare('INSERT INTO source_records VALUES(?,?,?,?,?,?,?,?,?)');
 const adoptDraft=db.prepare(`UPDATE demand_batches SET draft_json=?,status='submitted',
  version=version+1,idempotency_key=?,payload_sha256=?,source_id=?,updated_at=?
  WHERE id=?`);
 const bind=db.prepare('INSERT OR IGNORE INTO demand_sources VALUES(?,?)');
 const track=db.prepare('INSERT OR IGNORE INTO batch_demand_sources VALUES(?,?,?)');
 const review=db.prepare('INSERT INTO demand_duplicate_reviews VALUES(?,?,?,?,?,?,?,?)');
 const related=db.prepare('INSERT INTO demand_related_logical_towers VALUES(?,?)');
 const record=db.prepare('INSERT INTO audit_events VALUES(?,?,?,?,?,?,?,?,?)');
 const finalBatch=db.prepare('UPDATE demand_batches SET draft_json=? WHERE id=?');
 const existing=Number(db.prepare(`SELECT COALESCE(MAX(
  CAST(SUBSTR(demand_no,4) AS INTEGER)),0) n FROM demands
  WHERE demand_no GLOB 'XQ-[0-9]*'`).get().n);
 let insertDemand;
 return {
  startingDemandNo:existing,
  addSource(id,s,userId,time){
   source.run(id,s.src.id,s.src.name,s.proposer,s.discovered,
    s.description,s.external_ref,userId,time);
  },
  submitBatch({draft,batchId,body,key,digest,firstSource,userId,time}){
   if(draft)adoptDraft.run(JSON.stringify(body),key,digest,firstSource,time,batchId);
   else createDemandDraft({
    id:batchId,draft_json:JSON.stringify(body),status:'submitted',version:1,
    idempotency_key:key,payload_sha256:digest,source_id:firstSource,
    created_by:userId,created_at:time,updated_at:time
   });
  },
  bindSource(demandId,sourceId,batchId){
   bind.run(demandId,sourceId);track.run(batchId,demandId,sourceId);
  },
  recordReview(id,batchId,matchedId,createdId,decision,reason,userId,time){
   review.run(id,batchId,matchedId,createdId,decision,reason,userId,time);
  },
  insertDemand(demand){
   if(!insertDemand){
    const cols=Object.keys(demand);
    insertDemand=db.prepare('INSERT INTO demands('+cols.join(',')+') VALUES('+cols.map(()=>'?').join(',')+')');
   }
   insertDemand.run(...Object.values(demand));
  },
  linkRelatedTower(demandId,towerId){related.run(demandId,towerId)},
  audit({id,entity,entityId,action,after,reason='',userId,time}){
   record.run(id??randomUUID(),userId,entity,entityId,action,null,
    JSON.stringify(after),reason,time);
  },
  finish(batchId,body,rowResults){
   finalBatch.run(JSON.stringify({...body,submission_rows:rowResults}),batchId);
  }
 };
}

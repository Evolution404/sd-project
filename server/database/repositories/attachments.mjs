import {db} from '../connection.mjs';

// Ownership is relational: exactly one strong foreign key must be non-null.
export function attachmentOwnerExists(kind,id){
 if(kind==='demand')return !!db.prepare('SELECT id FROM demands WHERE id=?').get(id);
 if(kind==='source')return !!db.prepare('SELECT id FROM source_records WHERE id=?').get(id);
 return false;
}

export function insertAttachment({id,kind,ownerId,storageKey,filename,mime,bytes,sha256,actorId,createdAt}){
 if(kind!=='demand'&&kind!=='source')throw Error('未知附件归属');
 db.prepare(`INSERT INTO attachments
 (id,demand_id,source_id,storage_key,filename,mime,bytes,sha256,uploaded_by,created_at)
 VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
  id,kind==='demand'?ownerId:null,kind==='source'?ownerId:null,
  storageKey,filename,mime,bytes,sha256,actorId,createdAt);
}

export function attachmentById(id){
 return db.prepare('SELECT * FROM attachments WHERE id=?').get(id);
}

export function demandAttachments(id){
 return db.prepare(`SELECT id,filename,bytes,sha256,created_at FROM attachments
   WHERE demand_id=? ORDER BY created_at,id`).all(id);
}

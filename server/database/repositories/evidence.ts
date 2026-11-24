import type { createStore } from "./store.js";
export type EvidenceOwner = "demand_id" | "cost_version_id" | "settlement_version_id" | "source_id";
const targets: Record<EvidenceOwner,string> = {
  demand_id:"demands", cost_version_id:"cost_versions",
  settlement_version_id:"settlement_versions", source_id:"source_records",
};
export function isEvidenceOwner(value: unknown): value is EvidenceOwner {
  return typeof value === "string" && Object.hasOwn(targets,value);
}
export interface EvidenceFile {
  id:string; sha256:string; storage_key:string; filename:string;
  mime:string; bytes:number; uploaded_by:string; created_at:string;
}
export interface EvidenceLink {
  id:string; file_id:string; note:string; linked_by:string; linked_at:string;
}
type StoredEvidenceLink = EvidenceLink & { cost_version_id: string | null; settlement_version_id: string | null };
export interface EvidenceRecord extends EvidenceLink, Omit<EvidenceFile,"id"> {
  deleted:boolean;
}
/** All evidence SQL, ownership and indexed lookup stay inside the database module. */
export function evidenceRepository(store: ReturnType<typeof createStore>) {
  return {
    transaction: store.transaction,
    ownerExists(kind:EvidenceOwner,key:string):boolean {
      return Boolean(store.get(`SELECT 1 FROM ${targets[kind]} WHERE id=? LIMIT 1`,key));
    },
    canChangeCostEvidence(versionId:string):boolean {
      return Boolean(store.get(`SELECT 1 FROM v_cost_current cost
        JOIN projects project ON project.id=cost.project_id
        WHERE cost.id=? AND cost.status='active' AND project.status<>'closed'
        AND NOT EXISTS(SELECT 1 FROM audit_events event WHERE event.entity='costs'
          AND event.entity_id=cost.entry_id AND event.action='delete')`, versionId));
    },
    canChangeSettlementEvidence(versionId: string): boolean {
      return Boolean(store.get(`SELECT 1 FROM settlement_versions version
        JOIN settlements document ON document.id=version.settlement_id
        JOIN projects project ON project.id=document.project_id
        WHERE version.id=? AND project.status<>'closed'
        AND version.version_no=(SELECT MAX(recent.version_no) FROM settlement_versions recent
          WHERE recent.settlement_id=document.id)
        AND NOT EXISTS(SELECT 1 FROM audit_events event WHERE event.entity='settlements'
          AND event.entity_id=document.id AND event.action='delete')`, versionId));
    },
    list(kind:EvidenceOwner,key:string,includeDeleted:boolean):EvidenceRecord[] {
      const rows = store.query(`SELECT link.id,link.file_id,link.linked_by,link.linked_at,
       f.sha256,f.storage_key,f.filename,f.mime,f.bytes,f.uploaded_by,f.created_at,
       COALESCE((SELECT json_extract(a.after_json,'$.note')
         FROM audit_events a WHERE a.entity='evidence' AND a.entity_id=link.id
         AND a.action='correct' ORDER BY a.created_at DESC,a.id DESC LIMIT 1),link.note) AS note,
       EXISTS(SELECT 1 FROM audit_events d WHERE d.entity='evidence'
         AND d.entity_id=link.id AND d.action='delete') AS deleted
       FROM evidence_links link JOIN evidence_files f ON f.id=link.file_id
       WHERE link.${kind}=? ORDER BY link.linked_at,link.id`,key) as EvidenceRecord[];
      return rows.filter(row=>includeDeleted||!row.deleted)
        .map(row=>({...row,deleted:Boolean(row.deleted)}));
    },
    file(key:string):EvidenceFile|undefined {
      return store.get("SELECT * FROM evidence_files WHERE id=?",key) as EvidenceFile|undefined;
    },
    fileByHash(sha:string):EvidenceFile|undefined {
      return store.get("SELECT * FROM evidence_files WHERE sha256=?",sha) as EvidenceFile|undefined;
    },
    insertFile(row:EvidenceFile):void {
      store.run(`INSERT INTO evidence_files
       (id,sha256,storage_key,filename,mime,bytes,uploaded_by,created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
       row.id,row.sha256,row.storage_key,row.filename,row.mime,row.bytes,
       row.uploaded_by,row.created_at);
    },
    link(key:string):StoredEvidenceLink|undefined {
      return store.get(`SELECT id,file_id,note,linked_by,linked_at,cost_version_id,settlement_version_id
        FROM evidence_links WHERE id=?`, key) as StoredEvidenceLink|undefined;
    },
    existing(fileId:string,kind:EvidenceOwner,ownerId:string):EvidenceLink|undefined {
      return store.get(`SELECT id,file_id,note,linked_by,linked_at FROM evidence_links
       WHERE file_id=? AND ${kind}=?`,fileId,ownerId) as EvidenceLink|undefined;
    },
    insertLink(row:EvidenceLink,kind:EvidenceOwner,ownerId:string):void {
      store.run(`INSERT INTO evidence_links(id,file_id,${kind},note,linked_by,linked_at)
       VALUES(?,?,?,?,?,?)`,row.id,row.file_id,ownerId,row.note,row.linked_by,row.linked_at);
    },
    deleted(key:string):boolean {
      return Boolean(store.get(`SELECT 1 FROM audit_events WHERE entity='evidence'
       AND entity_id=? AND action='delete' LIMIT 1`,key));
    },
  };
}
export type EvidenceRepository=ReturnType<typeof evidenceRepository>;

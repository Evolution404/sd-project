import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { authorize, id, now, digest } from "../auth/service.js";
import { requireValue, text } from "../../shared/errors/business-error.js";
import { isObject, type Actor } from "../../shared/types/contracts.js";
import { isEvidenceOwner, type EvidenceRepository, type EvidenceOwner,
  type EvidenceFile, type EvidenceLink } from "../../database/repositories/evidence.js";
import type { Database } from "../../database/connection.js";
import type { AuditService } from "../audit/service.js";
interface EvidenceSystem {
  database:Database; audit:AuditService; evidenceStore:EvidenceRepository;
}
interface Upload {
  owner_kind:EvidenceOwner; owner_id:string; filename:string;
  base64:string; mime:string; note:string;
}
function parseUpload(raw:unknown):Upload {
  requireValue(isObject(raw),"附件上传必须为对象");
  requireValue(isEvidenceOwner(raw.owner_kind),"附件业务类型无效");
  requireValue(typeof raw.owner_id==="string" && !!raw.owner_id,"请选择附件归属");
  requireValue(typeof raw.base64==="string" && !!raw.base64,"请上传附件内容");
  requireValue(typeof raw.filename==="string" && !!raw.filename.trim(),"请填写文件名");
  requireValue(raw.mime===undefined || typeof raw.mime==="string","附件MIME类型必须为文字");
  requireValue(raw.note===undefined || typeof raw.note==="string","附件说明必须为文字");
  return {
    owner_kind:raw.owner_kind,owner_id:raw.owner_id,base64:raw.base64,
    filename:raw.filename,mime:(raw.mime as string|undefined)||"application/octet-stream",
    note:(raw.note as string|undefined)||"",
  };
}
/** Typed evidence application service: no generic SQL/table operations or catalog dispatcher. */
export function createEvidence({evidenceStore:repo,database,audit}:EvidenceSystem) {
  function checkOwner(kind:unknown,key:unknown):asserts kind is EvidenceOwner {
    requireValue(isEvidenceOwner(kind) && typeof key==="string" && !!key &&
      repo.ownerExists(kind,key),"附件业务归属不存在",404);
  }
  return {
    list(actor:Actor,kind:unknown,key:unknown,includeDeleted=false) {
      authorize(actor,"read"); checkOwner(kind,key);
      return repo.list(kind,key as string,includeDeleted);
    },
    upload(actor:Actor,raw:unknown) {
      authorize(actor,"write");
      const input=parseUpload(raw);
      checkOwner(input.owner_kind,input.owner_id);
      const bytes=Buffer.from(input.base64,"base64");
      requireValue(bytes.length>0 && bytes.length<=10*1024*1024,"附件须在10MB以内");
      const sha=digest(bytes),storageKey=`sha256/${sha.slice(0,2)}/${sha}`,
        path=join(database.directory,"objects",storageKey);
      mkdirSync(dirname(path),{recursive:true});
      try { writeFileSync(path,bytes,{flag:"wx"}); }
      catch(error:unknown) {
        if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;
        requireValue(digest(readFileSync(path))===sha,"附件存储校验失败");
      }
      return repo.transaction(()=>{
        let file=repo.fileByHash(sha);
        if(!file) {
          file={
            id:id(),sha256:sha,storage_key:storageKey,
            filename:basename(text(input.filename,"文件名")),
            mime:input.mime,bytes:bytes.length,uploaded_by:actor.id,created_at:now(),
          } satisfies EvidenceFile;
          repo.insertFile(file);
        }
        const existing=repo.existing(file.id,input.owner_kind,input.owner_id);
        if(existing)return existing;
        const link:EvidenceLink={
          id:id(),file_id:file.id,note:input.note,linked_by:actor.id,linked_at:now(),
        };
        repo.insertLink(link,input.owner_kind,input.owner_id);
        return link;
      });
    },
    download(actor:Actor,key:string) {
      authorize(actor,"read");
      const link=repo.link(key);requireValue(link,"附件不存在",404);
      const file=repo.file(link.file_id);requireValue(file,"附件文件不存在",404);
      const bytes=readFileSync(join(database.directory,"objects",file.storage_key));
      requireValue(digest(bytes)===file.sha256,"附件完整性校验失败");
      return {file,bytes};
    },
    remove(actor:Actor,key:string) {
      authorize(actor,"admin");
      const link=repo.link(key);requireValue(link,"附件不存在",404);
      audit.record(actor,"evidence",key,"delete",link,{logical:true});
      return {deleted:true};
    },
    revise(actor:Actor,key:string,note:unknown) {
      authorize(actor,"write");
      const link=repo.link(key);requireValue(link,"附件不存在",404);
      requireValue(!repo.deleted(key),"附件已删除",409);
      requireValue(typeof note==="string" && note.length<=2000,"附件说明不能超过2000字");
      audit.record(actor,"evidence",key,"correct",link,{note});
      return {id:key,note};
    },
  };
}
export type EvidenceService=ReturnType<typeof createEvidence>;

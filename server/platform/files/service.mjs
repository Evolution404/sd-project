import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { authorize, id, now, digest } from "../auth/service.js";
import { requireValue, text } from "../../shared/errors/business-error.js";
const owners = {
  demand_id: "demands",
  cost_version_id: "cost_versions",
  settlement_version_id: "settlement_versions",
  source_id: "source_records",
};
export function createEvidence(system) {
  const { repo, catalog, database } = system;
  function checkOwner(kind, key) {
    requireValue(
      owners[kind] && repo.find(owners[kind], "id", key),
      "附件业务归属不存在",
      404,
    );
  }
  function list(actor, kind, key, includeDeleted = false) {
    authorize(actor, "read");
    checkOwner(kind, key);
    const deleted = repo.deleted("evidence");
    return repo
      .where("evidence_links", { [kind]: key })
      .filter((link) => includeDeleted || !deleted.has(link.id))
      .map((link) => ({
        ...link,
        ...repo.find("evidence_files", "id", link.file_id),
        id: link.id,
        file_id: link.file_id,
        deleted: deleted.has(link.id),
        note:
          JSON.parse(
            repo
              .auditFor("evidence", link.id)
              .filter((event) => event.action === "correct")
              .at(-1)?.after_json || "{}",
          ).note ?? link.note,
      }));
  }
  return {
    list,
    upload(actor, input) {
      authorize(actor, "write");
      checkOwner(input.owner_kind, input.owner_id);
      const bytes = Buffer.from(input.base64 || "", "base64");
      requireValue(
        bytes.length > 0 && bytes.length <= 10 * 1024 * 1024,
        "附件须在10MB以内",
      );
      const sha = digest(bytes),
        storageKey = `sha256/${sha.slice(0, 2)}/${sha}`,
        path = join(database.directory, "objects", storageKey);
      mkdirSync(dirname(path), { recursive: true });
      try {
        writeFileSync(path, bytes, { flag: "wx" });
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        requireValue(digest(readFileSync(path)) === sha, "附件存储校验失败");
      }
      return repo.transaction(() => {
        let file = repo.find("evidence_files", "sha256", sha);
        if (!file) {
          file = {
            id: id(),
            sha256: sha,
            storage_key: storageKey,
            filename: basename(text(input.filename, "文件名")),
            mime: input.mime || "application/octet-stream",
            bytes: bytes.length,
            uploaded_by: actor.id,
            created_at: now(),
          };
          repo.insert("evidence_files", file);
        }
        const existing = repo.where("evidence_links", {
          file_id: file.id,
          [input.owner_kind]: input.owner_id,
        })[0];
        if (existing) return existing;
        const link = {
          id: id(),
          file_id: file.id,
          [input.owner_kind]: input.owner_id,
          note: input.note || "",
          linked_by: actor.id,
          linked_at: now(),
        };
        repo.insert("evidence_links", link);
        return link;
      });
    },
    download(actor, key) {
      authorize(actor, "read");
      const link = repo.find("evidence_links", "id", key);
      requireValue(link, "附件不存在", 404);
      const file = repo.find("evidence_files", "id", link.file_id),
        bytes = readFileSync(
          join(database.directory, "objects", file.storage_key),
        );
      requireValue(digest(bytes) === file.sha256, "附件完整性校验失败");
      return { file, bytes };
    },
    remove(actor, key) {
      authorize(actor, "admin");
      const link = repo.find("evidence_links", "id", key);
      requireValue(link, "附件不存在", 404);
      catalog.audit(actor, "evidence", key, "delete", link, { logical: true });
      return { deleted: true };
    },
    revise(actor, key, note) {
      authorize(actor, "write");
      const link = repo.find("evidence_links", "id", key);
      requireValue(link, "附件不存在", 404);
      requireValue(!repo.isDeleted("evidence", key), "附件已删除", 409);
      requireValue(
        typeof note === "string" && note.length <= 2000,
        "附件说明不能超过2000字",
      );
      catalog.audit(actor, "evidence", key, "correct", link, { note });
      return { id: key, note };
    },
  };
}

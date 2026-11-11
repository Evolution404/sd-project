import { DatabaseSync } from "node:sqlite";
import {
  readFileSync, existsSync, mkdirSync, copyFileSync, cpSync, mkdtempSync,
  renameSync, rmSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { assertCurrentSchema } from "./connection.js";

interface EvidenceBackupRow {
  storage_key: string;
  sha256: string;
  bytes: number;
}

/** Check a self-contained snapshot, including the exact CURRENT schema and every attachment. */
function verifySnapshot(directory: string): void {
  const db = new DatabaseSync(join(directory, "schema113.sqlite"), { readOnly: true });
  try {
    if (Number(db.prepare("PRAGMA user_version").get()?.user_version) !== 113)
      throw Error("备份结构版本无效");
    assertCurrentSchema(db);
    if (db.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok" ||
      db.prepare("PRAGMA foreign_key_check").all().length)
      throw Error("备份数据库完整性校验失败");
    const records = db.prepare("SELECT storage_key,sha256,bytes FROM evidence_files").all() as unknown as EvidenceBackupRow[];
    for (const file of records) {
      if (typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256) ||
        file.storage_key !== `sha256/${file.sha256.slice(0, 2)}/${file.sha256}` ||
        !Number.isSafeInteger(file.bytes) || file.bytes < 1)
        throw Error("附件路径无效");
      const bytes = readFileSync(join(directory, "objects", file.storage_key));
      if (bytes.length !== file.bytes ||
        createHash("sha256").update(bytes).digest("hex") !== file.sha256)
        throw Error("备份附件不完整");
    }
  } finally {
    db.close();
  }
}

/**
 * Restore to a previously nonexistent target atomically. The staging directory
 * is on the SAME volume as the target, so a failed copy never leaves a partial
 * application database at the requested destination.
 */
export function restoreBackup(sourceDirectory: string, destinationDirectory: string): string {
  const source = resolve(sourceDirectory), target = resolve(destinationDirectory);
  if (source === target || existsSync(target))
    throw Error("恢复目标必须为尚不存在的独立目录");
  verifySnapshot(source);
  const parent = dirname(target);
  mkdirSync(parent, { recursive: true });
  const staging = mkdtempSync(join(parent, ".sd-project-restore-"));
  try {
    copyFileSync(join(source, "schema113.sqlite"), join(staging, "schema113.sqlite"));
    if (existsSync(join(source, "objects")))
      cpSync(join(source, "objects"), join(staging, "objects"), { recursive: true });
    verifySnapshot(staging);
    if (existsSync(target)) throw Error("恢复目标必须为尚不存在的独立目录");
    renameSync(staging, target);
    return target;
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

import { DatabaseSync } from "node:sqlite";
import {
  readFileSync, existsSync, mkdirSync, copyFileSync, cpSync, mkdtempSync,
  renameSync, rmSync, statSync,
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
  const path = join(directory, "schema113.sqlite");
  const db = new DatabaseSync(path, { readOnly: true });
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
  // SQLite may create a shared-memory index and an empty WAL while checking
  // this isolated staging copy. The restored snapshot must remain portable.
  const wal = path + "-wal";
  if ((existsSync(wal) && statSync(wal).size !== 0) || existsSync(path + "-journal"))
    throw Error("恢复校验产生了意外的 SQLite 写入文件");
  rmSync(wal, { force: true });
  rmSync(path + "-shm", { force: true });
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
  const database = join(source, "schema113.sqlite");
  function stableInput() {
    if (["-wal", "-shm", "-journal"].some(suffix => existsSync(database + suffix)))
      throw Error("备份包含 SQLite 写入文件，请使用备份命令生成完整的独立快照");
    return statSync(database, { bigint: true });
  }
  const before = stableInput();
  const parent = dirname(target);
  mkdirSync(parent, { recursive: true });
  const staging = mkdtempSync(join(parent, ".sd-project-restore-"));
  try {
    copyFileSync(database, join(staging, "schema113.sqlite"));
    const after = stableInput();
    if (before.ino !== after.ino || before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs)
      throw Error("复制过程中备份数据库发生变化，请重新生成备份");
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

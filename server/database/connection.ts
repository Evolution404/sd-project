import { DatabaseSync, backup } from "node:sqlite";
import { mkdirSync, readFileSync, existsSync, cpSync } from "node:fs";
import { resolve, join, sep } from "node:path";
import {
  naturalTowerSortKey, naturalRelatedTowerSortKey,
} from "../shared/natural-tower-sort.js";

const canonicalSql = readFileSync(new URL("./schema/schema113.sql", import.meta.url), "utf8");
let expectedStructure: string | undefined;

function structure(connection: DatabaseSync): string {
  return JSON.stringify(connection.prepare(
    "SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY type,name",
  ).all());
}

function expected(): string {
  if (!expectedStructure) {
    const reference = new DatabaseSync(":memory:");
    try {
      reference.exec(canonicalSql);
      expectedStructure = structure(reference);
    } finally {
      reference.close();
    }
  }
  return expectedStructure;
}

/** The same single schema authority is used at startup and during backup restore. */
export function assertCurrentSchema(connection: DatabaseSync): void {
  if (structure(connection) !== expected())
    throw Error("Schema113结构与当前权威SQL不一致。请使用新独立目录或匹配的正式备份。");
}

export interface Database {
  directory: string;
  connection: DatabaseSync;
  transaction<T>(action: () => T): T;
  backupTo(destination: string): Promise<string>;
  verifyIntegrity(): boolean;
  checkpoint(): void;
  close(): void;
}

export function openDatabase(
  dataDir = process.env.DATA_DIR || resolve(import.meta.dirname, "../../../data"),
): Database {
  const directory = resolve(dataDir);
  mkdirSync(directory, { recursive: true });
  const connection = new DatabaseSync(join(directory, "schema113.sqlite"));
  try {
    // Runtime-only sorting function, not a persisted schema/trigger or stored field.
    connection.function("equipment_natural_key", { deterministic: true }, naturalTowerSortKey);
    connection.function("equipment_related_natural_key", { deterministic: true },
      naturalRelatedTowerSortKey);
    connection.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000; PRAGMA journal_mode=WAL;");
    const version = Number(connection.prepare("PRAGMA user_version").get()?.user_version);
    if (version !== 0 && version !== 113)
      throw Error(`数据库版本 ${version} 无法用于 Schema113，请使用独立数据目录`);
    if (version === 0) {
      const count = Number(connection.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get()?.n);
      if (count !== 0) throw Error("拒绝在已有未知结构的数据库中初始化");
      connection.exec("BEGIN IMMEDIATE");
      try {
        connection.exec(canonicalSql);
        connection.exec("COMMIT");
      } catch (error) {
        connection.exec("ROLLBACK");
        throw error;
      }
    }
    assertCurrentSchema(connection);
  } catch (error) {
    connection.close();
    throw error;
  }

  let depth = 0;
  return {
    directory,
    connection,
    transaction<T>(action: () => T): T {
      const savepoint = `nested_${depth}`;
      connection.exec(depth === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${savepoint}`);
      const initialDepth = depth++;
      try {
        const result = action();
        if (result !== null && (typeof result === "object" || typeof result === "function") &&
            "then" in result && typeof result.then === "function")
          throw Error("事务回调必须同步");
        connection.exec(initialDepth === 0 ? "COMMIT" : `RELEASE ${savepoint}`);
        return result;
      } catch (error) {
        connection.exec(initialDepth === 0 ? "ROLLBACK" : `ROLLBACK TO ${savepoint}`);
        if (initialDepth > 0) connection.exec(`RELEASE ${savepoint}`);
        throw error;
      } finally {
        depth = initialDepth;
      }
    },
    async backupTo(destination: string): Promise<string> {
      const target = resolve(destination);
      if (target === directory || target === join(directory, "objects") ||
          target.startsWith(join(directory, "objects") + sep)) throw Error("备份目录无效");
      if (existsSync(target)) throw Error("备份目标已存在，请使用新的独立目录");
      mkdirSync(target, { recursive: true });
      await backup(connection, join(target, "schema113.sqlite"));
      const objects = join(directory, "objects");
      if (existsSync(objects)) cpSync(objects, join(target, "objects"), { recursive: true });
      return target;
    },
    verifyIntegrity() {
      return connection.prepare("PRAGMA foreign_key_check").all().length === 0 &&
        connection.prepare("PRAGMA integrity_check").get()?.integrity_check === "ok";
    },
    checkpoint() {
      const result = connection.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
      if (result?.busy !== 0) throw Error("数据库检查点未完成，请停止其他数据库连接后重试");
    },
    close() { connection.close(); },
  };
}

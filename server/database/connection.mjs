import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, readFileSync, existsSync, cpSync } from 'node:fs';
import { resolve, join } from 'node:path';

export function openDatabase(dataDir = process.env.DATA_DIR || resolve(import.meta.dirname, '../../data')) {
  const directory = resolve(dataDir);
  mkdirSync(directory, { recursive: true });
  const path = join(directory, 'schema113.sqlite');
  const connection = new DatabaseSync(path);
  connection.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000; PRAGMA journal_mode=WAL;');
  const version = connection.prepare('PRAGMA user_version').get().user_version;
  if (version !== 0 && version !== 113) {
    connection.close();
    throw Error(`数据库版本 ${version} 无法用于 Schema113，请使用独立数据目录`);
  }
  if (version === 0) {
    const count = connection.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get().n;
    if (count !== 0) { connection.close(); throw Error('拒绝在已有未知结构的数据库中初始化'); }
    connection.exec('BEGIN IMMEDIATE');
    try {
      connection.exec(readFileSync(new URL('./schema/schema113.sql', import.meta.url), 'utf8'));
      connection.exec('COMMIT');
    } catch (error) { connection.exec('ROLLBACK'); connection.close(); throw error; }
  }
  let depth = 0;
  return {
    directory, connection,
    transaction(action) {
      const savepoint = `nested_${depth}`;
      connection.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`);
      const initialDepth = depth;
      depth++;
      try {
        const result = action();
        if (result && typeof result.then === 'function') throw Error('事务回调必须同步');
        connection.exec(initialDepth === 0 ? 'COMMIT' : `RELEASE ${savepoint}`);
        return result;
      } catch (error) {
        connection.exec(initialDepth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}`);
        if (initialDepth > 0) connection.exec(`RELEASE ${savepoint}`);
        throw error;
      } finally {
        depth = initialDepth;
      }
    },
    async backupTo(destination) {
      const target = resolve(destination);
      if (target === directory || target.startsWith(directory + '/objects')) throw Error('备份目录无效');
      mkdirSync(target, { recursive: true });
      await backup(connection, join(target, 'schema113.sqlite'));
      const objects = join(directory, 'objects');
      if (existsSync(objects)) cpSync(objects, join(target, 'objects'), { recursive: true });
      return target;
    },
    close() { connection.close(); }
  };
}

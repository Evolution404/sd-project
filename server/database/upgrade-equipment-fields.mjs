import { DatabaseSync, backup } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { restoreBackup } from "./restore.mjs";

const previousEquipmentStructure = "40d3e66bafacce2385c5a1f6e211e90d1810796cf8e736e0ff1cfd82ee108b13";
// Strict fingerprint of Schema113 before the archived work-object guard fix.
// Existing data never changes automatically on startup; explicit maintenance
// only accepts this exact source structure and makes a verified backup first.
const previousObjectGuardStructure = "8e71a39712302e90d5d6248ffda7f7816a8aaf5cf146b42fb78d9b799ceec5e5";
const previousPriceLifecycleStructure = "c666bc3dbd3392af5bcac585147a9920ed897c0c7ef641ae692815b692d4f044";
const equipmentTables = new Set(["transmission_lines", "line_history", "physical_towers", "physical_tower_history"]);
const quote = name => '"' + name.replaceAll('"', '""') + '"';
const digest = value => createHash("sha256").update(value).digest("hex");
function inventory(db) {
  return db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY type,name").all();
}
function checkIntegrity(db) {
  if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok" || db.prepare("PRAGMA foreign_key_check").all().length)
    throw Error("数据库完整性校验失败，升级已停止");
}
function cleanLineJson(value) {
  if (typeof value === "string") {
    if (!/^[\s]*[\[{]/.test(value)) return value;
    try {
      const parsed = JSON.parse(value), cleaned = cleanLineJson(parsed);
      return cleaned === parsed ? value : JSON.stringify(cleaned);
    } catch { return value; }
  }
  if (!value || typeof value !== "object") return value;
  let changed = false;
  const line = Object.hasOwn(value, "line_code") && Object.hasOwn(value, "voltage_level_id") && Object.hasOwn(value, "name");
  const entries = [];
  for (const [key, item] of Object.entries(value)) {
    if (line && key === "erection_type") { changed = true; continue; }
    const cleaned = cleanLineJson(item);
    if (cleaned !== item) changed = true;
    entries.push([key, cleaned]);
  }
  if (!changed) return value;
  return Array.isArray(value) ? entries.map(([, item]) => item) : Object.fromEntries(entries);
}
function cleanStoredJson(db, columns, apply) {
  let changedFields = 0;
  for (const [table, fields] of columns) {
    const jsonFields = fields.filter(field => field.endsWith("_json"));
    if (!jsonFields.length) continue;
    const rows = db.prepare(`SELECT rowid AS __maintenance_row,${jsonFields.map(quote).join(",")} FROM ${quote(table)}`).all();
    for (const row of rows) {
      const changes = jsonFields.map(field => [field, cleanLineJson(row[field])]).filter(([field, value]) => value !== row[field]);
      changedFields += changes.length;
      if (apply && changes.length) db.prepare(`UPDATE ${quote(table)} SET ${changes.map(([field]) => quote(field) + "=?").join(",")} WHERE rowid=?`)
        .run(...changes.map(([, value]) => value), row.__maintenance_row);
    }
  }
  return changedFields;
}
function facts(db, columns) {
  return Object.fromEntries([...columns].map(([table, fields]) => {
    const rows = db.prepare(`SELECT ${fields.map(quote).join(",")} FROM ${quote(table)}`).all().map(row =>
      JSON.stringify(Object.fromEntries(fields.map(field => [field, field.endsWith("_json") ? cleanLineJson(row[field]) : row[field]])))).sort();
    return [table, { count: rows.length, sha256: digest(JSON.stringify(rows)) }];
  }));
}
function rebuild(db, target, columns, expectedFacts, sourceStructure) {
  db.exec("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE");
  try {
    if (digest(JSON.stringify(inventory(db))) !== sourceStructure || JSON.stringify(facts(db, columns)) !== JSON.stringify(expectedFacts))
      throw Error("备份后数据库发生变化，请停止服务后重新执行升级");
    for (const item of inventory(db).filter(item => item.type !== "table"))
      db.exec(`DROP ${item.type.toUpperCase()} ${quote(item.name)}`);
    for (const table of sourceStructure === previousEquipmentStructure ? equipmentTables : []) {
      const fields = columns.get(table).map(quote).join(",");
      db.exec(`CREATE TEMP TABLE ${quote("upgrade_" + table)} AS SELECT ${fields} FROM ${quote(table)}`);
      db.exec(`DROP TABLE ${quote(table)}`);
      db.exec(target.find(item => item.type === "table" && item.name === table).sql);
      db.exec(`INSERT INTO ${quote(table)} (${fields}) SELECT ${fields} FROM ${quote("upgrade_" + table)}`);
      db.exec(`DROP TABLE temp.${quote("upgrade_" + table)}`);
    }
    const cleanedJsonFields = [previousObjectGuardStructure, previousPriceLifecycleStructure]
      .includes(sourceStructure) ? 0 : cleanStoredJson(db, columns, true);
    for (const type of ["view", "index", "trigger"])
      for (const item of target.filter(item => item.type === type)) db.exec(item.sql);
    if (JSON.stringify(inventory(db)) !== JSON.stringify(target)) throw Error("升级结构与唯一权威SQL不一致");
    if (JSON.stringify(facts(db, columns)) !== JSON.stringify(expectedFacts)) throw Error("升级事实复核失败");
    checkIntegrity(db);
    db.exec("COMMIT");
    return cleanedJsonFields;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.exec("PRAGMA foreign_keys=ON");
  }
}

// Explicit, fingerprint-bound maintenance action. The normal startup path
// continues to reject unmatched structures and never invokes this operation.
export async function upgradeSchema113(dataDirectory, backupDirectory) {
  const directory = resolve(dataDirectory), destination = resolve(backupDirectory);
  if (!existsSync(join(directory, "schema113.sqlite"))) throw Error("现有数据库不存在");
  if (destination === directory || destination === join(directory, "objects") || destination.startsWith(join(directory, "objects") + sep) || existsSync(destination))
    throw Error("备份目标必须是新的独立目录");
  const db = new DatabaseSync(join(directory, "schema113.sqlite"));
  const reference = new DatabaseSync(":memory:");
  let temporary;
  try {
    reference.exec(readFileSync(new URL("./schema/schema113.sql", import.meta.url), "utf8"));
    const target = inventory(reference), current = inventory(db);
    const sourceStructure = digest(JSON.stringify(current)), targetStructure = digest(JSON.stringify(target));
    if (sourceStructure !== targetStructure &&
      ![previousEquipmentStructure, previousObjectGuardStructure, previousPriceLifecycleStructure].includes(sourceStructure))
      throw Error("数据库不匹配本次已批准的升级基线");
    checkIntegrity(db);
    const columns = new Map(target.filter(item => item.type === "table").map(item => {
      const oldFields = new Set(db.prepare(`PRAGMA table_info(${quote(item.name)})`).all().map(field => field.name));
      const shared = reference.prepare(`PRAGMA table_info(${quote(item.name)})`).all().map(field => field.name).filter(name => oldFields.has(name));
      return [item.name, shared];
    }));
    if (sourceStructure === targetStructure && !cleanStoredJson(db, columns, false)) return { status: "already_current" };
    const expectedFacts = facts(db, columns);
    mkdirSync(destination, { recursive: true });
    await backup(db, join(destination, "schema113.sqlite"));
    if (existsSync(join(directory, "objects"))) cpSync(join(directory, "objects"), join(destination, "objects"), { recursive: true });
    temporary = mkdtempSync(join(tmpdir(), "sd-equipment-upgrade-"));
    const rehearsalDirectory = join(temporary, "data");
    restoreBackup(destination, rehearsalDirectory);
    const rehearsal = new DatabaseSync(join(rehearsalDirectory, "schema113.sqlite"));
    try { rebuild(rehearsal, target, columns, expectedFacts, sourceStructure); }
    finally { rehearsal.close(); }
    const cleanedJsonFields = rebuild(db, target, columns, expectedFacts, sourceStructure);
    const receipt = {
      status: "completed", completed_at: new Date().toISOString(), database: directory, backup: destination,
      previous_structure_sha256: sourceStructure, structure_sha256: targetStructure, cleaned_json_fields: cleanedJsonFields,
      tables: expectedFacts, preserved_facts_sha256: digest(JSON.stringify(expectedFacts)),
      backup_sha256: digest(readFileSync(join(destination, "schema113.sqlite"))),
    };
    writeFileSync(join(destination, "UPGRADE-RECEIPT.json"), JSON.stringify(receipt, null, 2) + "\n");
    return receipt;
  } finally {
    if (temporary) rmSync(temporary, { recursive: true, force: true });
    reference.close();
    db.close();
  }
}

// Preserve the documented earlier entrypoint for the equipment cleanup release.
export const upgradeEquipmentFields = upgradeSchema113;

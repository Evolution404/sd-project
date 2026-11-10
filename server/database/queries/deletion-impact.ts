import type { createStore } from "../repositories/store.mjs";
type Store = ReturnType<typeof createStore>;
type Target = "dictionary_items" | "materials";
interface ReferenceColumn {
  source_table: string;
  source_column: string;
}
const plans = new WeakMap<Store, Map<Target, string>>();
// Only canonical schema identifiers enter the query plan. Facts are counted afresh.
function identifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw Error("未知数据库引用对象");
  return '"' + value + '"';
}
export function countBusinessReferences(
  store: Store,
  target: Target,
  id: string,
): number {
  let cache = plans.get(store);
  if (!cache) {
    cache = new Map();
    plans.set(store, cache);
  }
  let sql = cache.get(target);
  if (!sql) {
    const owned =
      target === "dictionary_items"
        ? "dictionary_item_versions"
        : "material_versions";
    const references = store.query(
      `SELECT m.name AS source_table,f."from" AS source_column
      FROM sqlite_master m JOIN pragma_foreign_key_list(m.name) f
      WHERE m.type='table' AND f."table"=? AND f."to"='id' AND m.name<>?`,
      target,
      owned,
    ) as ReferenceColumn[];
    const probes = references.map(
      (reference) =>
        `SELECT COUNT(*) AS total FROM ${identifier(reference.source_table)} WHERE ${identifier(reference.source_column)}=(SELECT value FROM identity)`,
    );
    sql =
      "WITH identity(value) AS (VALUES (?)) SELECT COALESCE(SUM(total),0) AS total FROM (" +
      probes.join(" UNION ALL ") +
      ")";
    cache.set(target, sql);
  }
  return (store.get(sql, id) as { total: number }).total;
}

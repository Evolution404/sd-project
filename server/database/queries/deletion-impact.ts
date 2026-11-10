import type { createStore } from "../repositories/store.mjs";
type Store = ReturnType<typeof createStore>;
type Target =
  | "dictionary_items"
  | "materials"
  | "work_objects"
  | "operations"
  | "reference_price_catalog";
const definitions: Record<
  Target,
  { versions: string; foreign: string; adopted: string }
> = {
  dictionary_items: {
    versions: "dictionary_item_versions",
    foreign: "item_id",
    adopted: "item_id",
  },
  materials: {
    versions: "material_versions",
    foreign: "material_id",
    adopted: "id",
  },
  work_objects: {
    versions: "work_object_versions",
    foreign: "work_object_id",
    adopted: "work_object_id",
  },
  operations: {
    versions: "operation_versions",
    foreign: "operation_id",
    adopted: "operation_id",
  },
  reference_price_catalog: {
    versions: "reference_price_versions",
    foreign: "catalog_id",
    adopted: "id",
  },
};
interface ReferenceColumn {
  source_table: string;
  source_column: string;
  target_table: string;
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
    const definition = definitions[target];
    const references = store.query(
      `SELECT DISTINCT m.name AS source_table,f."from" AS source_column,f."table" AS target_table
      FROM sqlite_master m JOIN pragma_foreign_key_list(m.name) f
      WHERE m.type='table' AND m.name<>? AND
      ((f."table"=? AND f."to"='id') OR (f."table"=? AND f."to"=?))`,
      definition.versions,
      target,
      definition.versions,
      definition.adopted,
    ) as ReferenceColumn[];
    const unique = references.filter(
      (reference, index) =>
        references.findIndex(
          (other) =>
            other.source_table === reference.source_table &&
            other.source_column === reference.source_column,
        ) === index,
    );
    const probes = unique.map((reference) => {
      const selection =
        reference.target_table === target || definition.adopted !== "id"
          ? "(SELECT value FROM identity)"
          : `(SELECT id FROM ${identifier(definition.versions)} WHERE ${identifier(definition.foreign)}=(SELECT value FROM identity))`;
      return `SELECT COUNT(*) AS total FROM ${identifier(reference.source_table)} WHERE ${identifier(reference.source_column)} IN ${selection}`;
    });
    sql =
      "WITH identity(value) AS (VALUES (?)) SELECT COALESCE(SUM(total),0) AS total FROM (" +
      (probes.length ? probes.join(" UNION ALL ") : "SELECT 0 AS total") +
      ")";
    cache.set(target, sql);
  }
  return (store.get(sql, id) as { total: number }).total;
}

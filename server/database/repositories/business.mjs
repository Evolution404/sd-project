export function businessRepository(store) {
  return {
    ...store,
    where(table, values) {
      return store.where(table, values);
    },
    latest(table, key, value, sequence = "version_no") {
      return store.where(table, { [key]: value }, sequence, 1)[0];
    },
    deleted(entity) {
      return new Set(
        store
          .query(
            "SELECT entity_id FROM audit_events WHERE entity=? AND action='delete'",
            entity,
          )
          .map((row) => row.entity_id),
      );
    },
    auditFor(entity, entityId) {
      return store.query(
        "SELECT * FROM audit_events WHERE entity=? AND entity_id=? ORDER BY created_at,id",
        entity,
        entityId,
      );
    },
    demandDuplicates(operationId, locations, exceptId) {
      // The former query UNIONed 3 subqueries even when 2 position kinds were
      // empty (the usual case for tower work). Compile only relevant indexed
      // probes, and request the exact two fields used by callers.
      const conditions = ["logical_tower_id", "physical_tower_id", "span_id"]
        .map((key) => ({
          key,
          values: [...new Set(locations.map((loc) => loc[key]).filter(Boolean))],
        }))
        .filter((part) => part.values.length);
      if (!conditions.length) return [];
      const statements = conditions.map(
        ({ key }) => `SELECT DISTINCT d.id,d.demand_no FROM demand_version_work_locations loc
         JOIN demand_versions current
           ON current.demand_id=loc.demand_id AND current.version=loc.demand_version
         JOIN demands d ON d.id=current.demand_id
         WHERE loc.${key} IN (SELECT value FROM json_each(?))
           AND current.operation_id=? AND d.id<>?
           AND NOT EXISTS (SELECT 1 FROM demand_versions newer
             WHERE newer.demand_id=current.demand_id AND newer.version>current.version)
           AND NOT EXISTS (SELECT 1 FROM demand_lifecycle_events cancelled
             WHERE cancelled.demand_id=d.id AND cancelled.to_status='cancelled')`,
      );
      const matches = store.query(
        statements.join(" UNION "),
        ...conditions.flatMap(({ values }) => [
          JSON.stringify(values), operationId, exceptId || "",
        ]),
      );
      return matches;
    },
    integrity() {
      return {
        integrity: store.query("PRAGMA integrity_check"),
        foreignKeys: store.query("PRAGMA foreign_key_check"),
      };
    },
  };
}

export function businessRepository(store) {
  return {
    ...store,
    where(table, values) {
      return store.where(table,values);
    },
    latest(table, key, value, sequence = 'version_no') {
      return store.where(table,{[key]:value},sequence,1)[0];
    },
    deleted(entity) {
      return new Set(store.query("SELECT entity_id FROM audit_events WHERE entity=? AND action='delete'", entity).map(row => row.entity_id));
    },
    auditFor(entity, entityId) {
      return store.query('SELECT * FROM audit_events WHERE entity=? AND entity_id=? ORDER BY created_at,id', entity, entityId);
    },
    demandDuplicates(operationId, locations, exceptId) {
      const keys=['logical_tower_id','physical_tower_id','span_id'];
      const identities=keys.map(key=>JSON.stringify(locations.map(loc=>loc[key]).filter(Boolean)));
      const statements=keys.map(key=>`SELECT d.* FROM demand_version_work_locations loc
        JOIN v_demand_current d ON d.id=loc.demand_id AND d.current_version=loc.demand_version
        WHERE loc.${key} IN (SELECT value FROM json_each(?))
          AND d.operation_id=? AND d.id<>? AND d.status<>'cancelled'`);
      return store.query(statements.join(' UNION '),...identities.flatMap(value=>[value,operationId,exceptId||'']));
    },
    integrity() {
      return { integrity: store.query('PRAGMA integrity_check'), foreignKeys: store.query('PRAGMA foreign_key_check') };
    }
  };
}

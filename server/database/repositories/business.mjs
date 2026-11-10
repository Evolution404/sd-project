import { businessLists } from "../queries/business-lists.js";
export function businessRepository(store) {
  return {
    ...store,
    // One indexed project scan replaces four lookups for every demand scope.
    // Keep the full historical scope row and current binding projection intact.
    projectScopes(projectId) {
      return store.query(`SELECT sc.*, d.demand_no,
        COALESCE(dc.status, 'pending') AS demand_status,
        CASE WHEN b.project_scope_id IS NULL THEN NULL ELSE json_object(
          'project_scope_id', b.project_scope_id,
          'project_id', b.project_id,
          'demand_id', b.demand_id,
          'link_event_id', b.link_event_id,
          'linked_by', b.linked_by,
          'linked_at', b.linked_at) END AS binding_json
        FROM project_demand_scopes sc
        JOIN demands d ON d.id=sc.demand_id
        LEFT JOIN v_demand_current dc ON dc.id=sc.demand_id
        LEFT JOIN v_project_demand_binding_current b ON b.project_scope_id=sc.id
        WHERE sc.project_id=?`, projectId).map(({ binding_json, ...scope }) => ({
          ...scope,
          binding: binding_json ? JSON.parse(binding_json) : null,
        }));
    },
    projectApprovalHistory(projectId) {
      const approvals = store.query(`SELECT * FROM project_approval_versions
        WHERE project_id=? AND status<>'withdrawn' ORDER BY version_no`, projectId);
      if (!approvals.length) return [];
      const scopes = store.query(`SELECT sc.*, d.demand_no FROM project_approval_scope_versions sc
        JOIN project_approval_versions ap ON ap.id=sc.approval_version_id
        JOIN demands d ON d.id=sc.demand_id WHERE ap.project_id=? AND ap.status<>'withdrawn'`, projectId);
      const materials = store.query(`SELECT item.*, pm.material_id FROM project_approval_material_items item
        JOIN project_approval_versions ap ON ap.id=item.approval_version_id
        JOIN project_scope_materials pm ON pm.id=item.project_material_id
        WHERE ap.project_id=? AND ap.status<>'withdrawn'`, projectId);
      const locations = store.query(`SELECT loc.* FROM project_approval_work_locations loc
        JOIN project_approval_scope_versions sc ON sc.id=loc.approval_scope_version_id
        JOIN project_approval_versions ap ON ap.id=sc.approval_version_id
        WHERE ap.project_id=? AND ap.status<>'withdrawn'`, projectId);
      const materialGroups = new Map();
      for (const item of materials) {
        const key = `${item.approval_version_id}:${item.project_scope_id}`;
        if (!materialGroups.has(key)) materialGroups.set(key, []);
        materialGroups.get(key).push(item);
      }
      const locationGroups = new Map();
      for (const loc of locations) {
        if (!locationGroups.has(loc.approval_scope_version_id)) locationGroups.set(loc.approval_scope_version_id, []);
        locationGroups.get(loc.approval_scope_version_id).push(loc);
      }
      const scopeGroups = new Map();
      for (const sc of scopes) {
        if (!scopeGroups.has(sc.approval_version_id)) scopeGroups.set(sc.approval_version_id, []);
        scopeGroups.get(sc.approval_version_id).push({ ...sc,
          materials: materialGroups.get(`${sc.approval_version_id}:${sc.project_scope_id}`) || [],
          locations: locationGroups.get(sc.id) || [],
        });
      }
      return approvals.map(ap => ({ ...ap, scopes: scopeGroups.get(ap.id) || [] }));
    },
    projectCostNodes(projectId) {
      return store.query("SELECT n.*, EXISTS(SELECT 1 FROM audit_events a WHERE a.entity='cost_nodes' AND a.entity_id=n.id AND a.action='delete') AS deleted FROM v_project_cost_node_current n WHERE n.project_id=?", projectId)
        .map(node => ({ ...node, deleted: Boolean(node.deleted) }));
    },
    searchFinance: businessLists(store).finance,
    searchDemands: businessLists(store).demands,
    searchProjects: businessLists(store).projects,
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
    isDeleted(entity, entityId) {
      return Boolean(
        store.get(
          "SELECT 1 AS found FROM audit_events WHERE entity=? AND entity_id=? AND action='delete' LIMIT 1",
          entity,
          entityId,
        ),
      );
    },
    demandSources(demandId, includeHistorical = false) {
      return store
        .query(
          `SELECT src.*,
          EXISTS(SELECT 1 FROM audit_events a WHERE a.entity='sources' AND a.entity_id=src.id AND a.action='delete') AS deleted,
          EXISTS(SELECT 1 FROM audit_events a WHERE a.entity='sources' AND a.entity_id=src.id AND a.action='correct') AS superseded
         FROM demand_sources link JOIN source_records src ON src.id=link.source_id
         WHERE link.demand_id=?`,
          demandId,
        )
        .filter(
          (source) =>
            includeHistorical || (!source.deleted && !source.superseded),
        )
        .map((source) => ({
          ...source,
          deleted: Boolean(source.deleted),
          superseded: Boolean(source.superseded),
        }));
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
          values: [
            ...new Set(locations.map((loc) => loc[key]).filter(Boolean)),
          ],
        }))
        .filter((part) => part.values.length);
      if (!conditions.length) return [];
      const statements = conditions.map(
        ({
          key,
        }) => `SELECT DISTINCT d.id,d.demand_no FROM demand_version_work_locations loc
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
          JSON.stringify(values),
          operationId,
          exceptId || "",
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

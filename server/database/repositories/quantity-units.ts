import type { createStore } from "./store.js";

/** Only the database layer knows how formal unit versions and material identities are stored. */
export interface AdoptedQuantityUnit {
  unit_id: string;
  unit_version: number;
  name: string;
  fields_json: string;
}
export interface MaterialQuantityUnit extends AdoptedQuantityUnit {
  material_id: string;
  material_version_id: string;
  material_code: string;
  material_name: string;
  material_model: string;
  material_specification: string;
}
export interface DemandQuantityUnit extends AdoptedQuantityUnit {
  demand_id: string;
  demand_version: number;
}
export interface ApprovedScopeQuantityUnit extends AdoptedQuantityUnit {
  project_scope_id: string;
}
export interface UnitVersionKey {
  unit_id: string;
  unit_version: number;
}
export const unitVersionKey = ({ unit_id, unit_version }: UnitVersionKey): string =>
  unit_id + "@" + unit_version;

export function quantityUnitRepository(store: ReturnType<typeof createStore>) {
  return {
    /**
     * One read for all adopted versions, including old formal business versions.
     * No current-unit fallback: the requesting business fact chooses its own version.
     */
    adoptedUnits(keys: readonly UnitVersionKey[]): Map<string, AdoptedQuantityUnit> {
      if (!keys.length) return new Map();
      const unique = [...new Map(keys.map(key => [unitVersionKey(key), key])).values()];
      const rows = store.query(`SELECT v.item_id AS unit_id,v.version AS unit_version,
          v.name,v.fields_json
          FROM dictionary_item_versions v
          JOIN json_each(?) keys ON v.item_id=json_extract(keys.value,'$.unit_id')
           AND v.version=json_extract(keys.value,'$.unit_version')
          JOIN dictionary_items identity ON identity.id=v.item_id AND identity.type_id='unit'`,
        JSON.stringify(unique)) as AdoptedQuantityUnit[];
      return new Map(rows.map(row => [unitVersionKey(row), row]));
    },

    /** Approval drafts resolve all selected formal demand quantities in one SQL read. */
    demandUnits(refs: readonly { demand_id: string; version: number }[]): Map<string, DemandQuantityUnit> {
      if (!refs.length) return new Map();
      const rows = store.query(`SELECT v.demand_id,v.version AS demand_version,
          unit.item_id AS unit_id,unit.version AS unit_version,unit.name,unit.fields_json
        FROM json_each(?) selected
        JOIN demand_versions v ON v.demand_id=json_extract(selected.value,'$.demand_id')
          AND v.version=json_extract(selected.value,'$.version')
        JOIN dictionary_item_versions unit ON unit.item_id=v.unit_id AND unit.version=v.unit_version
        JOIN dictionary_items identity ON identity.id=unit.item_id AND identity.type_id='unit'`,
        JSON.stringify(refs)) as DemandQuantityUnit[];
      return new Map(rows.map(row => [row.demand_id + ":" + row.demand_version, row]));
    },
    /** Settlement quantity resolution is always based on the adopted approval scope's frozen demand version. */
    approvedScopeUnits(approvalId: string): Map<string, ApprovedScopeQuantityUnit> {
      const rows = store.query(`SELECT sc.project_scope_id,unit.item_id AS unit_id,
          unit.version AS unit_version,unit.name,unit.fields_json
        FROM project_approval_scope_versions sc
        JOIN demand_versions demand ON demand.demand_id=sc.demand_id AND demand.version=sc.demand_version
        JOIN dictionary_item_versions unit ON unit.item_id=demand.unit_id AND unit.version=demand.unit_version
        JOIN dictionary_items identity ON identity.id=unit.item_id AND identity.type_id='unit'
        WHERE sc.approval_version_id=?`, approvalId) as ApprovedScopeQuantityUnit[];
      return new Map(rows.map(row => [row.project_scope_id, row]));
    },
    /** Material quantities not yet formally adopted use the current unit version, in one read. */
    materialUnits(ids: readonly string[]): Map<string, MaterialQuantityUnit> {
      if (!ids.length) return new Map();
      const rows = store.query(`SELECT m.id AS material_id,m.material_version_id,
          m.code AS material_code,m.name AS material_name,
          m.model AS material_model,m.specification AS material_specification,
          u.id AS unit_id,u.version AS unit_version,u.name,u.fields_json
          FROM v_material_current m
          JOIN v_dictionary_current u ON u.id=m.unit_id
          WHERE m.id IN (SELECT value FROM json_each(?)) AND u.type_id='unit'
            AND NOT EXISTS(SELECT 1 FROM audit_events audit
              WHERE audit.entity='materials' AND audit.entity_id=m.id AND audit.action='delete')`,
        JSON.stringify([...new Set(ids)])) as MaterialQuantityUnit[];
      return new Map(rows.map(row => [row.material_id, row]));
    },
  };
}
export type QuantityUnitRepository = ReturnType<typeof quantityUnitRepository>;

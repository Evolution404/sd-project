import type { createStore } from "./store.mjs";
import { equipmentSources, searchEquipment } from "./equipment-search.js";
import type {
  EquipmentCatalogKind,
  EquipmentKind,
  EquipmentRecord,
  EquipmentFields,
  EquipmentHistory,
  EquipmentSearchOptions,
  PhysicalBinding,
} from "../../shared/types/equipment.js";

const tables = {
  voltages: "voltage_levels",
  lines: "transmission_lines",
  physical: "physical_towers",
  towers: "logical_towers",
  spans: "line_spans",
} as const;
const histories = {
  lines: ["line_history", "line_id"],
  physical: ["physical_tower_history", "physical_tower_id"],
  towers: ["logical_tower_history", "logical_tower_id"],
  spans: ["line_span_history", "span_id"],
} as const;
const lineLabel = (alias: string, voltage: string) =>
  `${alias}.name || ' · ' || COALESCE(${voltage}.name,'电压待确认')`;
const line = lineLabel("l", "v");
const sources: Record<EquipmentCatalogKind, string> = {
  voltages: `SELECT c.*,(SELECT COUNT(*)+1 FROM audit_events a WHERE a.entity='voltages' AND a.entity_id=c.id AND a.action='revise') AS version FROM voltage_levels c`,
  lines: `SELECT c.*,v.name AS voltage_level_name,v.name AS voltage_level_id_label,
    p.name AS parent_line_name,j.tower_no AS junction_tower_no,
    ${lineLabel("p", "pv")} AS parent_line_id_label,
    ${lineLabel("jl", "jv")} || ' · ' || j.tower_no AS junction_tower_id_label
    FROM transmission_lines c LEFT JOIN voltage_levels v ON v.id=c.voltage_level_id
    LEFT JOIN transmission_lines p ON p.id=c.parent_line_id LEFT JOIN voltage_levels pv ON pv.id=p.voltage_level_id
    LEFT JOIN logical_towers j ON j.id=c.junction_tower_id LEFT JOIN transmission_lines jl ON jl.id=j.line_id
    LEFT JOIN voltage_levels jv ON jv.id=jl.voltage_level_id`,
  towers: `SELECT c.*,p.tower_nature,l.name AS line_name,v.name AS voltage_level_name,
    ${line} AS line_id_label,
    COALESCE(NULLIF(p.asset_no,''),NULLIF(TRIM(COALESCE(p.tower_type,'') || ' · ' || p.model,' · '),''),'独立物理杆塔') AS physical_tower_id_label
    FROM logical_towers c JOIN transmission_lines l ON l.id=c.line_id
    LEFT JOIN voltage_levels v ON v.id=l.voltage_level_id LEFT JOIN physical_towers p ON p.id=c.physical_tower_id`,
  physical: equipmentSources.physical.sql,
  spans: `SELECT c.*,l.name AS line_name,${line} AS line_id_label,
    start.tower_no AS start_tower_no,ending.tower_no AS end_tower_no,
    ${lineLabel("sl", "sv")} || ' · ' || start.tower_no AS start_tower_id_label,
    ${lineLabel("el", "ev")} || ' · ' || ending.tower_no AS end_tower_id_label
    FROM line_spans c JOIN transmission_lines l ON l.id=c.line_id LEFT JOIN voltage_levels v ON v.id=l.voltage_level_id
    LEFT JOIN logical_towers start ON start.id=c.start_tower_id LEFT JOIN transmission_lines sl ON sl.id=start.line_id
    LEFT JOIN voltage_levels sv ON sv.id=sl.voltage_level_id
    LEFT JOIN logical_towers ending ON ending.id=c.end_tower_id LEFT JOIN transmission_lines el ON el.id=ending.line_id
    LEFT JOIN voltage_levels ev ON ev.id=el.voltage_level_id`,
};

export function equipmentRepository(store: ReturnType<typeof createStore>) {
  function rows(
    kind: EquipmentCatalogKind,
    condition = "",
    parameters: string[] = [],
  ): EquipmentRecord[] {
    return store.query(
      `SELECT source.*,EXISTS(SELECT 1 FROM audit_events a WHERE a.entity=?
      AND a.entity_id=source.id AND a.action='delete') AS deleted FROM (${sources[kind]}) source ${condition}`,
      kind,
      ...parameters,
    ) as EquipmentRecord[];
  }
  return {
    current: (kind: EquipmentCatalogKind, id: string) =>
      rows(kind, "WHERE source.id=?", [id])[0],
    all: (kind: EquipmentCatalogKind, includeDeleted: boolean) =>
      rows(kind).filter((row) => includeDeleted || !row.deleted),
    search(kind: EquipmentKind, options: EquipmentSearchOptions) {
      const page = searchEquipment(store, kind, options);
      // The pagination query already owns identity selection and whitelisted ordering.
      // Fetch display relationships together for only that page, preserving its order.
      if (!page.items.length) return page;
      const loaded = rows(
        kind,
        "WHERE source.id IN (SELECT value FROM json_each(?))",
        [JSON.stringify(page.items.map((row) => row.id))],
      );
      const byId = new Map(loaded.map((row) => [row.id, row]));
      return { ...page, items: page.items.map((row) => byId.get(row.id)!) };
    },
    towersInLine: (lineId: string) =>
      rows("towers", "WHERE source.line_id=?", [lineId]),
    boundTowers: (physicalId: string) =>
      rows(
        "towers",
        "WHERE source.physical_tower_id=? AND source.status<>'retired'",
        [physicalId],
      ),
    bindings(ids: string[]): PhysicalBinding[] {
      if (!ids.length) return [];
      return (
        store.query(
          `SELECT t.physical_tower_id,t.id AS logical_tower_id,t.tower_no,
        t.status AS logical_status,EXISTS(SELECT 1 FROM audit_events a WHERE a.entity='towers'
        AND a.entity_id=t.id AND a.action='delete') AS logical_deleted,
        l.id AS line_id,l.name AS line_name,l.status AS line_status,v.name AS voltage_name
        FROM logical_towers t JOIN transmission_lines l ON l.id=t.line_id
        LEFT JOIN voltage_levels v ON v.id=l.voltage_level_id
        WHERE t.physical_tower_id IN (SELECT value FROM json_each(?)) ORDER BY l.name,t.tower_no`,
          JSON.stringify(ids),
        ) as PhysicalBinding[]
      ).map((row) => ({
        ...row,
        logical_deleted: Boolean(row.logical_deleted),
      }));
    },
    createAsset(
      kind: EquipmentCatalogKind,
      id: string,
      fields: EquipmentFields,
    ): void {
      store.insert(tables[kind], { id, ...fields });
    },
    reviseAsset(
      kind: EquipmentCatalogKind,
      id: string,
      fields: EquipmentFields,
    ): void {
      store.update(tables[kind], "id", id, fields);
    },
    history(kind: EquipmentKind, id: string): EquipmentHistory[] {
      const [table, foreignKey] = histories[kind];
      return store.where(table, { [foreignKey]: id }) as EquipmentHistory[];
    },
  };
}
export type EquipmentRepository = ReturnType<typeof equipmentRepository>;

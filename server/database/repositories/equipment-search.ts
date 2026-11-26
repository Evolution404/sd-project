import type { createStore } from "./store.js";
import type {
  EquipmentCatalogKind,
  EquipmentSearchOptions,
  EquipmentRecord,
} from "../../shared/types/equipment.js";
import type { Page } from "../../shared/types/contracts.js";
import { fixedListValue, listDisplayScale } from "../../shared/list-filter-values.js";
import { requireValue } from "../../shared/errors/business-error.js";
// Indexed, parameterized pagination for the high-volume equipment catalogs.
// SQL stays in the Repository layer; client-controlled identifiers are never interpolated.
function searchableColumn(key: string) {
  const column = JSON.stringify(key);
  return key === "transmission_center_length_mm"
    ? `(CASE WHEN ${column} IS NULL THEN '' ELSE printf('%.3f', ${column} / 1000.0) END)`
    : key === "tower_nature"
      ? `(${column} || ' ' || CASE ${column} WHEN 'straight' THEN '直线' WHEN 'tension' THEN '耐张' ELSE '' END)`
      : column;
}
export const voltageCatalogSql = `SELECT c.*, (SELECT COUNT(*)+1 FROM audit_events a
  WHERE a.entity='voltages' AND a.entity_id=c.id AND a.action='revise') AS version FROM voltage_levels c`;
export const equipmentSources: Record<
  EquipmentCatalogKind,
  { sql: string; columns: string[] }
> = {
  voltages: { sql: voltageCatalogSql, columns: ["code", "name", "status", "sort_order"] },
  lines: {
    sql:
      "SELECT c.*, v.name AS voltage_level_name, p.name AS parent_line_name, " +
      "junction.tower_no AS junction_tower_no FROM transmission_lines c " +
      "LEFT JOIN voltage_levels v ON v.id=c.voltage_level_id " +
      "LEFT JOIN transmission_lines p ON p.id=c.parent_line_id " +
      "LEFT JOIN logical_towers junction ON junction.id=c.junction_tower_id",
    columns: [
      "name",
      "voltage_level_name",
      "voltage_level_id",
      "line_kind",
      "parent_line_name",
      "junction_tower_no",
      "status",
      "line_code",
    ],
  },
  physical: {
    sql:
      "SELECT c.*, COALESCE(rel.related_lines,'') AS related_lines, " +
      "COALESCE(rel.related_towers,'') AS related_towers, " +
      "COALESCE(rel.current_circuits,0) AS current_circuits " +
      "FROM physical_towers c LEFT JOIN ( " +
      " SELECT t.physical_tower_id, GROUP_CONCAT(DISTINCT l.name) AS related_lines, " +
      " GROUP_CONCAT(DISTINCT t.tower_no) AS related_towers, " +
      " COUNT(*) AS current_circuits FROM logical_towers t " +
      " JOIN transmission_lines l ON l.id=t.line_id " +
      " WHERE t.physical_tower_id IS NOT NULL AND t.status<>'retired' " +
      " AND NOT EXISTS(SELECT 1 FROM audit_events a WHERE a.entity='towers' " +
      " AND a.entity_id=t.id AND a.action='delete') " +
      " GROUP BY t.physical_tower_id) rel ON rel.physical_tower_id=c.id",
    columns: [
      "tower_code",
      "asset_no",
      "tower_material",
      "tower_nature",
      "model",
      "height_scaled",
      "commissioned_on",
      "related_lines",
      "related_towers",
      "current_circuits",
      "purpose",
      "status",
    ],
  },
  towers: {
    sql:
      "SELECT c.*, p.tower_nature, l.name AS line_name, l.voltage_level_id, v.name AS voltage_level_name " +
      "FROM logical_towers c JOIN transmission_lines l ON l.id=c.line_id " +
      "LEFT JOIN physical_towers p ON p.id=c.physical_tower_id " +
      "LEFT JOIN voltage_levels v ON v.id=l.voltage_level_id",
    columns: [
      "line_name",
      "voltage_level_name",
      "voltage_level_id",
      "tower_no",
      "operations_team",
      "management_department",
      "tower_nature",
      "status",
      "logical_code",
    ],
  },
  spans: {
    sql:
      "SELECT c.*, l.name AS line_name, l.voltage_level_id, start.tower_no AS start_tower_no, " +
      "ending.tower_no AS end_tower_no FROM line_spans c " +
      "JOIN transmission_lines l ON l.id=c.line_id " +
      "LEFT JOIN logical_towers start ON start.id=c.start_tower_id " +
      "LEFT JOIN logical_towers ending ON ending.id=c.end_tower_id",
    columns: [
      "line_name",
      "voltage_level_id",
      "start_tower_no",
      "end_tower_no",
      "transmission_center_length_mm",
      "status",
    ],
  },
};
export function searchEquipment(
  store: ReturnType<typeof createStore>,
  kind: EquipmentCatalogKind,
  options: EquipmentSearchOptions = {},
): Page<EquipmentRecord> {
  const definition = equipmentSources[kind];
  if (!definition) throw new Error("未知设备目录");
  const allowed = new Set([
    ...definition.columns,
    "id",
    "created_at",
    "updated_at",
    "version",
    "deleted",
  ]);
  const page = Math.max(1, Math.min(1000000, Number(options.page) || 1)),
    pageSize = Math.max(1, Math.min(200, Number(options.page_size) || 30));
  const statement =
    "WITH catalog_rows AS (SELECT source.*, " +
    "EXISTS(SELECT 1 FROM audit_events a WHERE a.entity=? " +
    "AND a.entity_id=source.id AND a.action='delete') AS deleted FROM (" +
    definition.sql +
    ") source) ";
  const where = [options.deleted ? "1=1" : "deleted=0"];
  const parameters: (string | number | null)[] = [];
  const q = String(options.q || "")
    .slice(0, 160)
    .trim();
  if (q) {
    where.push(
      "(" +
        definition.columns.filter(key => !key.endsWith("_id"))
          .map(
            (key) =>
              "instr(lower(COALESCE(CAST(" +
              searchableColumn(key) +
              " AS TEXT),'')),lower(?))>0",
          )
          .join(" OR ") +
        ")",
    );
    parameters.push(...definition.columns.filter(key => !key.endsWith("_id")).map(() => q));
  }
  let filters: Record<string, unknown> = {};
  try {
    const value =
      typeof options.filters === "string"
        ? JSON.parse(options.filters)
        : options.filters;
    if (value && typeof value === "object" && !Array.isArray(value))
      filters = value;
  } catch {
    /* malformed client filter is not a query modifier */
  }
  if (kind === "spans") {
    const bound = (key: string) => {
      const raw = filters[key];
      if (typeof raw !== "string" || !raw.trim()) return null;
      const value = fixedListValue(raw, 3);
      requireValue(value !== null && value >= 0, "管辖长度须为非负米数，最多三位小数", 400);
      return value;
    };
    const min = bound("length_min");
    const max = bound("length_max");
    requireValue(min === null || max === null || min <= max, "最短管辖长度不能超过最长管辖长度", 400);
    if (min !== null) { where.push("transmission_center_length_mm>=?"); parameters.push(min); }
    if (max !== null) { where.push("transmission_center_length_mm<=?"); parameters.push(max); }
  }
  for (const [key, value] of Object.entries(filters).slice(0, 20)) {
    if (!allowed.has(key) || typeof value !== "string") continue;
    if (["status", "line_kind", "voltage_level_id", "tower_material", "start_tower_no", "end_tower_no"].includes(key)) {
      where.push(key + "=?");
      parameters.push(value.slice(0, 128));
      continue;
    }
    const places = listDisplayScale(key);
    if (places !== null) {
      where.push(key + "=?");
      parameters.push(fixedListValue(value.slice(0, 128), places));
      continue;
    }
    where.push(
      "instr(lower(COALESCE(CAST(" +
        searchableColumn(key) +
        " AS TEXT),'')),lower(?))>0",
    );
    parameters.push(value.slice(0, 128));
  }
  if (kind === "lines" && options.lineKind) {
    where.push("line_kind=?");
    parameters.push(options.lineKind);
  }
  if (kind === "towers" && options.lineId) {
    const line = store.find("transmission_lines", "id", options.lineId);
    where.push("(line_id=? OR id=?)");
    parameters.push(
      options.lineId,
      line?.line_kind === "branch" && typeof line.junction_tower_id === "string" ? line.junction_tower_id : "",
    );
  }
  if (kind === "spans" && options.lineId) {
    where.push("line_id=?");
    parameters.push(options.lineId);
  }
  if (kind === "physical" && options.lineId) {
    where.push(
      "EXISTS(SELECT 1 FROM logical_towers t WHERE " +
        "t.physical_tower_id=catalog_rows.id AND t.line_id=? " +
        "AND t.status<>'retired' " +
        "AND NOT EXISTS(SELECT 1 FROM audit_events a WHERE a.entity='towers' " +
        "AND a.entity_id=t.id AND a.action='delete'))",
    );
    parameters.push(options.lineId);
  }
  if (options.excludeId) {
    where.push("id<>?");
    parameters.push(options.excludeId);
  }
  const predicate = " WHERE " + where.join(" AND ");
  const total = Number(store.get(
    statement + "SELECT COUNT(*) AS n FROM catalog_rows" + predicate,
    kind,
    ...parameters,
  )?.n ?? 0);
  const sort =
    kind === "voltages" && (!options.sort || options.sort === "created_at") ? "sort_order"
      : options.sort && allowed.has(options.sort) ? options.sort : "created_at";
  const direction = options.direction === "asc" || kind === "voltages" && sort === "sort_order" ? "ASC" : "DESC";
  // Natural numeric-aware ordering is evaluated in SQLite *before* pagination.
  // The identifier is a whitelist-validated field, never a raw client SQL value.
  const towerNumber = ["tower_no", "start_tower_no", "end_tower_no"].includes(sort);
  const relatedTowerNumbers = kind === "physical" && sort === "related_towers";
  const expression = relatedTowerNumbers
    ? "equipment_related_natural_key(" + JSON.stringify(sort) + ")"
    : towerNumber ? "equipment_natural_key(" + JSON.stringify(sort) + ")"
      : JSON.stringify(sort);
  const order = expression + " " + direction +
    (towerNumber ? ", " + JSON.stringify(sort) + " " + direction : "") +
    ", id ASC";
  const items = store.query(
    statement +
      "SELECT * FROM catalog_rows" +
      predicate +
      " ORDER BY " + order + " LIMIT ? OFFSET ?",
    kind,
    ...parameters,
    pageSize,
    (page - 1) * pageSize,
  ) as EquipmentRecord[];
  return { items, total, page, page_size: pageSize };
}

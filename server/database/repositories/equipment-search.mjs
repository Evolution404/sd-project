// Indexed, parameterized pagination for the high-volume equipment catalogs.
// SQL stays in the Repository layer; client-controlled identifiers are never interpolated.
function searchableColumn(key) {
  const column = JSON.stringify(key);
  return key === "tower_nature"
    ? `(${column} || ' ' || CASE ${column} WHEN 'straight' THEN '直线' WHEN 'tension' THEN '耐张' ELSE '' END)`
    : column;
}
const sources = {
  lines: {
    sql: "SELECT c.*, v.name AS voltage_level_name, p.name AS parent_line_name, "
      + "junction.tower_no AS junction_tower_no FROM transmission_lines c "
      + "LEFT JOIN voltage_levels v ON v.id=c.voltage_level_id "
      + "LEFT JOIN transmission_lines p ON p.id=c.parent_line_id "
      + "LEFT JOIN logical_towers junction ON junction.id=c.junction_tower_id",
    columns: ["name", "voltage_level_name", "line_kind", "parent_line_name",
      "junction_tower_no", "status", "line_code"],
  },
  physical: {
    sql: "SELECT c.*, COALESCE(rel.related_lines,'') AS related_lines, "
      + "COALESCE(rel.related_towers,'') AS related_towers, "
      + "COALESCE(rel.current_circuits,0) AS current_circuits "
      + "FROM physical_towers c LEFT JOIN ( "
      + " SELECT t.physical_tower_id, GROUP_CONCAT(DISTINCT l.name) AS related_lines, "
      + " GROUP_CONCAT(DISTINCT t.tower_no) AS related_towers, "
      + " COUNT(*) AS current_circuits FROM logical_towers t "
      + " JOIN transmission_lines l ON l.id=t.line_id "
      + " WHERE t.physical_tower_id IS NOT NULL AND t.status<>'retired' "
      + " AND NOT EXISTS(SELECT 1 FROM audit_events a WHERE a.entity='towers' "
      + " AND a.entity_id=t.id AND a.action='delete') "
      + " GROUP BY t.physical_tower_id) rel ON rel.physical_tower_id=c.id",
    columns: ["tower_code", "asset_no", "tower_type", "tower_nature", "model", "height_scaled",
      "commissioned_on", "related_lines", "related_towers", "current_circuits",
      "purpose", "status"],
  },
  towers: {
    sql: "SELECT c.*, p.tower_nature, l.name AS line_name, v.name AS voltage_level_name "
      + "FROM logical_towers c JOIN transmission_lines l ON l.id=c.line_id "
      + "LEFT JOIN physical_towers p ON p.id=c.physical_tower_id "
      + "LEFT JOIN voltage_levels v ON v.id=l.voltage_level_id",
    columns: ["line_name", "voltage_level_name", "tower_no", "operations_team",
      "management_department", "tower_nature", "status", "logical_code"],
  },
  spans: {
    sql: "SELECT c.*, l.name AS line_name, start.tower_no AS start_tower_no, "
      + "ending.tower_no AS end_tower_no FROM line_spans c "
      + "JOIN transmission_lines l ON l.id=c.line_id "
      + "LEFT JOIN logical_towers start ON start.id=c.start_tower_id "
      + "LEFT JOIN logical_towers ending ON ending.id=c.end_tower_id",
    columns: ["line_name", "start_tower_no", "end_tower_no",
      "transmission_center_length_mm", "status"],
  },
};
export function searchEquipment(store, kind, options = {}) {
  const definition = sources[kind];
  if (!definition) throw new Error("未知设备目录");
  const allowed = new Set([...definition.columns, "id", "created_at",
    "updated_at", "version", "deleted"]);
  const page = Math.max(1, Math.min(1000000, Number(options.page) || 1)),
    pageSize = Math.max(1, Math.min(200, Number(options.page_size) || 30));
  const statement = "WITH catalog_rows AS (SELECT source.*, "
    + "EXISTS(SELECT 1 FROM audit_events a WHERE a.entity=? "
    + "AND a.entity_id=source.id AND a.action='delete') AS deleted FROM ("
    + definition.sql + ") source) ";
  const where = [options.deleted ? "1=1" : "deleted=0"];
  const parameters = [];
  const q = String(options.q || "").slice(0, 160).trim();
  if (q) {
    where.push("(" + definition.columns.map(
      key => "instr(lower(COALESCE(CAST(" + searchableColumn(key) + " AS TEXT),'')),lower(?))>0",
    ).join(" OR ") + ")");
    parameters.push(...definition.columns.map(() => q));
  }
  let filters = {};
  try {
    const value = typeof options.filters === "string"
      ? JSON.parse(options.filters) : options.filters;
    if (value && typeof value === "object" && !Array.isArray(value))
      filters = value;
  } catch { /* malformed client filter is not a query modifier */ }
  for (const [key, value] of Object.entries(filters).slice(0, 20)) {
    if (!allowed.has(key) || typeof value !== "string") continue;
    where.push("instr(lower(COALESCE(CAST(" + searchableColumn(key)
      + " AS TEXT),'')),lower(?))>0");
    parameters.push(value.slice(0, 128));
  }
  if (kind === "lines" && options.lineKind) {
    where.push("line_kind=?");
    parameters.push(options.lineKind);
  }
  if (kind === "towers" && options.lineId) {
    const line = store.find("transmission_lines", "id", options.lineId);
    where.push("(line_id=? OR id=?)");
    parameters.push(options.lineId,
      line?.line_kind === "branch" ? line.junction_tower_id || "" : "");
  }
  if (kind === "spans" && options.lineId) {
    where.push("line_id=?");
    parameters.push(options.lineId);
  }
  if (kind === "physical" && options.lineId) {
    where.push("EXISTS(SELECT 1 FROM logical_towers t WHERE "
      + "t.physical_tower_id=catalog_rows.id AND t.line_id=? "
      + "AND t.status<>'retired' "
      + "AND NOT EXISTS(SELECT 1 FROM audit_events a WHERE a.entity='towers' "
      + "AND a.entity_id=t.id AND a.action='delete'))");
    parameters.push(options.lineId);
  }
  if (options.excludeId) {
    where.push("id<>?");
    parameters.push(options.excludeId);
  }
  const predicate = " WHERE " + where.join(" AND ");
  const total = store.get(statement + "SELECT COUNT(*) AS n FROM catalog_rows"
    + predicate, kind, ...parameters).n;
  const sort = allowed.has(options.sort) ? options.sort : "created_at";
  const direction = options.direction === "asc" ? "ASC" : "DESC";
  const items = store.query(statement + "SELECT * FROM catalog_rows"
    + predicate + " ORDER BY " + JSON.stringify(sort) + " " + direction
    + ", id ASC LIMIT ? OFFSET ?",
    kind, ...parameters, pageSize, (page - 1) * pageSize);
  return { items, total, page, page_size: pageSize };
}

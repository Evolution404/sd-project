import type { Database } from "../connection.js";

export function readLineImportAudit({ connection }: Database) {
  return connection.prepare(`SELECT
    (SELECT count(*) FROM voltage_levels) AS voltages,
    (SELECT count(*) FROM transmission_lines) AS lines,
    (SELECT count(*) FROM physical_towers) AS physical_towers,
    (SELECT count(*) FROM logical_towers) AS logical_towers,
    (SELECT count(*) FROM line_spans) AS spans,
    (SELECT count(*) FROM logical_towers WHERE status='draft') AS draft_logical_towers,
    (SELECT count(*) FROM line_spans WHERE status='draft') AS draft_spans,
    (SELECT count(*) FROM line_spans WHERE transmission_center_length_mm IS NULL) AS unknown_managed_length,
    (SELECT coalesce(sum(transmission_center_length_mm), 0) FROM line_spans) AS managed_length_mm,
    (SELECT count(*) FROM demands) AS demands,
    (SELECT count(*) FROM projects) AS projects,
    (SELECT count(*) FROM users) AS users,
    (SELECT count(*) FROM roles) AS roles,
    (SELECT count(*) FROM line_history) AS line_versions,
    (SELECT count(*) FROM physical_tower_history) AS physical_tower_versions,
    (SELECT count(*) FROM logical_tower_history) AS logical_tower_versions,
    (SELECT count(*) FROM line_span_history) AS span_versions`).get()!;
}

import { DatabaseSync } from "node:sqlite";

export interface EquipmentAuditRow {
  id: string;
  line_name: string;
  voltage_name: string;
  tower_no: string;
  status: string;
  physical_tower_id: string;
}

/** Read-only equipment facts for an explicitly selected audit source database. */
export function readEquipmentAudit(path: string): EquipmentAuditRow[] {
  const connection = new DatabaseSync(path, { readOnly: true });
  try {
    return connection.prepare(`SELECT tower.id,line.name AS line_name,voltage.name AS voltage_name,
      tower.tower_no,tower.status,tower.physical_tower_id
      FROM logical_towers tower JOIN transmission_lines line ON line.id=tower.line_id
      JOIN voltage_levels voltage ON voltage.id=line.voltage_level_id
      WHERE NOT EXISTS(SELECT 1 FROM audit_events a WHERE a.entity='towers' AND a.entity_id=tower.id AND a.action='delete')
      ORDER BY line.name,tower.tower_no`).all() as unknown as EquipmentAuditRow[];
  } finally {
    connection.close();
  }
}

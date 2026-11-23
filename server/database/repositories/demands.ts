import { nextBusinessNumber } from "./business-numbers.js";
import type { createStore } from "./store.js";
import { businessLists, searchPage, type DemandListRecord, type ListSource } from "../queries/business-lists.js";
import type { ListQuery, Page } from "../../shared/types/contracts.js";
import type { DictionaryVersion } from "../../shared/types/master-data.js";
import type { OperationVersion } from "../../shared/types/work-standards.js";
import type { EquipmentStatus } from "../../shared/types/equipment.js";
import type { DemandCurrentRow, DemandMaterialRow, SourceRow, DemandLocationKey } from "../../shared/types/demands.js";
interface CircuitIdentity { line_id: string; tower_no: string; status: EquipmentStatus; }
interface SpanHistory {
  span_id: string;
  line_id: string;
  version_no: number;
  start_tower_id: string;
  end_tower_id: string;
  status: EquipmentStatus;
  transmission_center_length_mm: number | null;
}
const candidateListSource: ListSource = {
  sql: "SELECT v.*, d.created_at, " +
    "json_extract(v.full_definition_json,'$.operation_snapshot') AS operation_snapshot, " +
    "json_extract(v.full_definition_json,'$.line_name_snapshot') AS line_name_snapshot " +
    "FROM v_demand_current v JOIN demands d ON d.id=v.id " +
    "WHERE v.status IN ('active','pending') " +
    "AND NOT EXISTS (SELECT 1 FROM v_project_demand_binding_current b WHERE b.demand_id=v.id) " +
    "AND EXISTS (SELECT 1 FROM v_demand_current_location_progress balance WHERE balance.demand_id=v.id AND balance.remaining_quantity_scaled>0)",
  columns: ["id","demand_no","operation_snapshot","problem_description","line_name_snapshot",
    "status","current_version","quantity_scaled","expected_on","created_at","deleted"],
  search: ["demand_no","operation_snapshot","problem_description","line_name_snapshot"],
  defaultSort: "created_at"
};

/** Persistence for demand definitions, adopted versions, provenance and immutable history.
 * No arbitrary table or column name escapes this database module.
 */
export interface DemandLifecycleRow {
  id: string;
  demand_id: string;
  event_seq: number;
  from_status: DemandCurrentRow["status"] | null;
  to_status: DemandCurrentRow["status"];
  actor_id: string;
  recorded_at: string;
  reason: string;
}
export function demandRepository(store: ReturnType<typeof createStore>) {
  const listed = businessLists(store).demands;
  const deletedDemand = (key: string) => Boolean(store.get(
    "SELECT 1 FROM audit_events WHERE entity='demands' AND entity_id=? AND action='delete' LIMIT 1", key));
  const deletedSource = (key: string) => store.query(
    "SELECT * FROM audit_events WHERE entity='sources' AND entity_id=? ORDER BY created_at,id", key);
  const sources = (key: string, includeHistorical = false): SourceRow[] => {
    const rows = store.query(
      "SELECT src.*, EXISTS(SELECT 1 FROM audit_events a WHERE a.entity='sources' AND a.entity_id=src.id AND a.action='delete') AS deleted, " +
      "EXISTS(SELECT 1 FROM audit_events a WHERE a.entity='sources' AND a.entity_id=src.id AND a.action='correct') AS superseded " +
      "FROM demand_sources link JOIN source_records src ON src.id=link.source_id WHERE link.demand_id=? ORDER BY src.created_at,src.id", key) as SourceRow[];
    return rows.filter(row => includeHistorical || (!row.deleted && !row.superseded))
      .map(row => ({ ...row, deleted: Boolean(row.deleted), superseded: Boolean(row.superseded) }));
  };
  return {
    nextNumber: () => nextBusinessNumber(store, "demands"),
    current(key: string): DemandCurrentRow | undefined {
      return store.get("SELECT * FROM v_demand_current WHERE id=?", key) as DemandCurrentRow | undefined;
    },
    locationProgress(key: string): {item_no:number;remaining_quantity_scaled:number;
      resolved_quantity_scaled:number;demand_location_id:string}[] {
      return store.query(`SELECT item_no,remaining_quantity_scaled,resolved_quantity_scaled,demand_location_id
        FROM v_demand_current_location_progress WHERE demand_id=? ORDER BY item_no`,key);
    },
    isDeleted: deletedDemand,
    materials(key: string, version: number): DemandMaterialRow[] {
      return store.query(
        "SELECT item.*,COALESCE(def.name,'历史物资待核对') AS material_name, " +
        "COALESCE(def.model,'') AS model,COALESCE(def.specification,'') AS specification " +
        "FROM demand_material_version_items item LEFT JOIN material_versions def ON def.id=item.material_version_id " +
        "WHERE item.demand_id=? AND item.demand_version=? ORDER BY item.item_no",
        key, version) as DemandMaterialRow[];
    },
    sources,
    boundProjectStage(key:string):"reserve"|"stocked"|"approved"|"closed"|null {
      const row=store.get<{status:"reserve"|"stocked"|"approved"|"closed"}>(
        "SELECT p.status FROM v_project_demand_binding_current b JOIN projects p ON p.id=b.project_id WHERE b.demand_id=?",
        key);
      return row?.status ?? null;
    },
    binding(key: string): { project_id: string; project_scope_id: string; demand_id: string } | undefined {
      return store.get("SELECT * FROM v_project_demand_binding_current WHERE demand_id=?", key) as
        { project_id: string; project_scope_id: string; demand_id: string } | undefined;
    },
    currentAll(): (DemandCurrentRow & { binding_json: string | null; deleted: number; remaining_quantity_scaled:number })[] {
      return store.query(
        "SELECT v.*, (SELECT COALESCE(SUM(balance.remaining_quantity_scaled),0) FROM v_demand_current_location_progress balance WHERE balance.demand_id=v.id) AS remaining_quantity_scaled, " +
        "EXISTS(SELECT 1 FROM audit_events a WHERE a.entity='demands' AND a.entity_id=v.id AND a.action='delete') AS deleted," +
        "(SELECT json_object('project_id',b.project_id,'project_scope_id',b.project_scope_id,'demand_id',b.demand_id) " +
        "FROM v_project_demand_binding_current b WHERE b.demand_id=v.id) AS binding_json FROM v_demand_current v"
      ) as (DemandCurrentRow & { binding_json: string | null; deleted: number; remaining_quantity_scaled:number })[];
    },
    search: listed,
    eligibleCandidates(query: ListQuery, includePending: boolean): Page<DemandListRecord> {
      return searchPage<DemandListRecord>(store, "demands", candidateListSource, {
        ...query,
        deleted: false,
        filters: includePending ? {...query.filters} : {...query.filters, status: "active"}
      });
    },
    workObjectVersion(id: string, version: number): {object_position: "body"|"corridor"; attribution_unit: "physical_tower"|"logical_tower"; name:string; version_no:number} | undefined {
      return store.get("SELECT object_position,attribution_unit,name,version_no FROM work_object_versions WHERE work_object_id=? AND version_no=?",id,version) as
        {object_position:"body"|"corridor";attribution_unit:"physical_tower"|"logical_tower";name:string;version_no:number} | undefined;
    },
    operationVersion(id: string, version: number): OperationVersion | undefined {
      return store.get("SELECT * FROM operation_versions WHERE operation_id=? AND version=?", id, version) as OperationVersion | undefined;
    },
    unitVersion(id: string, version: number): DictionaryVersion | undefined {
      return store.get("SELECT * FROM dictionary_item_versions WHERE item_id=? AND version=?", id, version) as DictionaryVersion | undefined;
    },
    activePhysicalCircuits(id: string): CircuitIdentity[] {
      return store.query("SELECT * FROM logical_towers WHERE physical_tower_id=? AND status='active'", id) as CircuitIdentity[];
    },
    spanVersion(id: string, version: number): SpanHistory | undefined {
      return store.get("SELECT * FROM line_span_history WHERE span_id=? AND version_no=?", id, version) as SpanHistory | undefined;
    },
    duplicates(operationId: string, locations: DemandLocationKey[], exceptId?: string) {
      const probes = (["logical_tower_id","physical_tower_id","span_id"] as const)
        .map(key => ({ key, ids: [...new Set(locations.map(loc => loc[key]).filter((value): value is string => Boolean(value)))] }))
        .filter(probe => probe.ids.length);
      if (!probes.length) return [] as { id: string; demand_no: string }[];
      const statement = probes.map(({key}) =>
        "SELECT DISTINCT d.id,d.demand_no FROM demand_version_work_locations loc " +
        "JOIN demand_versions current ON current.demand_id=loc.demand_id AND current.version=loc.demand_version " +
        "JOIN demands d ON d.id=current.demand_id WHERE loc."+key+" IN (SELECT value FROM json_each(?)) " +
        "AND current.operation_id=? AND d.id<>? " +
        "AND NOT EXISTS(SELECT 1 FROM demand_versions newer WHERE newer.demand_id=current.demand_id AND newer.version>current.version) " +
        "AND NOT EXISTS(SELECT 1 FROM demand_lifecycle_events cancelled WHERE cancelled.demand_id=d.id AND cancelled.to_status='cancelled')"
      ).join(" UNION ");
      return store.query(statement, ...probes.flatMap(({ids}) => [JSON.stringify(ids),operationId,exceptId||""])) as
        { id: string; demand_no: string }[];
    },
    appendRevision(value: {
      id: string; demand_id: string; version: number; snapshot_json: string;
      changed_by: string; changed_at: string; reason: string;
    }): void { store.insert("demand_revisions", value); },
    createDemand(value: Record<string, unknown>): void { store.insert("demands", value); },
    appendExpectedMaterial(value: {
      id: string; demand_id: string; material_id: string; item_no: number;
      quantity_scaled: number; note: string; created_at: string; updated_at: string;
    }): void { store.insert("demand_material_items", value); },
    source(key: string): SourceRow | undefined {
      return store.get("SELECT * FROM source_records WHERE id=?", key) as SourceRow | undefined;
    },
    createSource(value: Record<string, unknown>): void { store.insert("source_records", value); },
    linkedSource(demandId: string, sourceId: string): boolean {
      return Boolean(store.get("SELECT 1 FROM demand_sources WHERE demand_id=? AND source_id=?", demandId, sourceId));
    },
    linkSource(demandId: string, sourceId: string): void {
      store.insert("demand_sources", { demand_id: demandId, source_id: sourceId });
    },
    sourceLinks(sourceId: string): { demand_id: string; source_id: string }[] {
      return store.query("SELECT * FROM demand_sources WHERE source_id=?",sourceId) as { demand_id: string; source_id: string }[];
    },
    sourceDecisions: (key: string): { action: string; created_at: string; id: string }[] => deletedSource(key) as { action: string; created_at: string; id: string }[],
    createDuplicateBatch(value: {
      id: string; draft_json: string; created_by: string; created_at: string; updated_at: string;
    }): void { store.insert("demand_batches",value); },
    appendDuplicateReview(value: {
      id: string; batch_id: string; matched_demand_id: string; new_demand_id: string;
      decision: "separate"; reason: string; actor_id: string; created_at: string;
    }): void { store.insert("demand_duplicate_reviews",value); },
    finalizeDuplicateBatch(key: string, updatedAt: string): void {
      store.update("demand_batches","id",key,{ status:"submitted", version:2, updated_at:updatedAt });
    },
    lastLifecycle(key: string): DemandLifecycleRow | undefined {
      return store.get("SELECT * FROM demand_lifecycle_events WHERE demand_id=? ORDER BY event_seq DESC LIMIT 1",key) as DemandLifecycleRow | undefined;
    },
    appendLifecycle(value: DemandLifecycleRow): void { store.insert("demand_lifecycle_events",value); },
    history(key: string, presentation = false) {
      const versions = store.query("SELECT * FROM demand_versions WHERE demand_id=? ORDER BY version",key);
      const quotes = store.query("SELECT * FROM reference_price_evaluations WHERE demand_id=? ORDER BY created_at,id",key) as
        {id:string;[field:string]:unknown}[];
      const lines = store.query("SELECT l.*" +
        (presentation ? ",p.title AS rule_title,p.version_no AS rule_version_no,p.catalog_id AS rule_id,p.pricing_mode,p.unit_price_fen,p.base_fee_fen" : "") +
        " FROM reference_price_evaluation_lines l " +
        "JOIN reference_price_evaluations q ON q.id=l.evaluation_id " +
        (presentation ? "JOIN reference_price_versions p ON p.id=l.reference_price_version_id " : "") +
        "WHERE q.demand_id=? " +
        "ORDER BY l.evaluation_id,l.location_item_no",key) as {evaluation_id:string;[field:string]:unknown}[];
      const grouped = new Map<string,typeof lines>();
      for (const line of lines) {
        if (!grouped.has(line.evaluation_id)) grouped.set(line.evaluation_id,[]);
        grouped.get(line.evaluation_id)!.push(line);
      }
      const events = store.query("SELECT * FROM demand_lifecycle_events WHERE demand_id=? ORDER BY event_seq",key);
      const scopes = store.query(presentation
        ? `SELECT sc.*,p.code AS project_no,
              (SELECT pv.name FROM project_management_versions pv
               WHERE pv.project_id=sc.project_id AND pv.recorded_at<=sc.created_at
               ORDER BY pv.version_no DESC LIMIT 1) AS project_name
            FROM project_demand_scopes sc JOIN projects p ON p.id=sc.project_id WHERE sc.demand_id=?`
        : "SELECT * FROM project_demand_scopes WHERE demand_id=?",key) as
        {id:string;[field:string]:unknown}[];
      const links = store.query("SELECT evt.* FROM project_demand_link_events evt " +
        "JOIN project_demand_scopes scope ON scope.id=evt.project_scope_id WHERE scope.demand_id=? ORDER BY evt.event_seq",key) as
        {project_scope_id:string;[field:string]:unknown}[];
      const linked = new Map<string,typeof links>();
      for (const event of links) {
        if (!linked.has(event.project_scope_id)) linked.set(event.project_scope_id,[]);
        linked.get(event.project_scope_id)!.push(event);
      }
      return {
        versions,
        reference_quotes: quotes.map(quote => ({...quote,lines:grouped.get(quote.id)||[]})),
        sources: sources(key,true),
        events,
        bindings: scopes.map(scope => ({...scope,events:linked.get(scope.id)||[]})),
        ...(presentation ? {
          revisions: store.query("SELECT version,reason FROM demand_revisions WHERE demand_id=?", key),
          attributes: store.query(`SELECT DISTINCT d.operation_id,d.operation_version,o.attributes_schema_json
            FROM demand_versions d JOIN operation_versions o ON o.operation_id=d.operation_id AND o.version=d.operation_version
            WHERE d.demand_id=?`,key),
          sourceActions: store.query(`SELECT a.id,a.entity_id AS source_id,a.action,a.actor_id,a.created_at
            FROM demand_sources link JOIN audit_events a ON a.entity='sources' AND a.entity_id=link.source_id
            WHERE link.demand_id=? AND a.action IN ('correct','delete') ORDER BY a.created_at,a.rowid`,key),
          materials: store.query(`SELECT i.*,m.name AS material_name,m.specification
            FROM demand_material_version_items i
            JOIN material_versions m ON m.id=i.material_version_id
            WHERE i.demand_id=? ORDER BY i.demand_version,i.item_no`,key),
        } : {}),
      };
    }
  };
}
export type DemandRepository = ReturnType<typeof demandRepository>;

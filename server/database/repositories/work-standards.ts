import { countBusinessReferences } from "../queries/deletion-impact.js";
import type { createStore } from "./store.js";
import type { ListQuery } from "../../shared/types/contracts.js";
import type {
  OperationRecord,
  OperationVersion,
  WorkObjectRecord,
  WorkObjectVersion,
  OperationAdoptions,
} from "../../shared/types/work-standards.js";
import { searchPage, type ListSource } from "../queries/business-lists.js";
const objectSql = `SELECT c.*,v.work_object_id,v.reason,v.changed_by,v.recorded_at FROM v_work_object_current c
 JOIN work_object_versions v ON v.id=c.current_version_id`;
const operationSql = `SELECT o.id,o.code,o.created_at,v.operation_id,v.version,v.name,v.status,v.sort_order,
 v.work_object_id,v.work_object_version_no,adopted.object_position,adopted.attribution_unit,
 v.default_unit_id,v.default_unit_version,v.default_quantity_scaled,
 v.completion_standard,v.attributes_schema_json,
 v.default_target_object,v.entry_hint,v.reason,v.changed_by,v.changed_at,v.id AS current_version_id,v.changed_at AS updated_at,
 COALESCE(unit.name,'历史计量单位待核对') AS default_unit_id_label,COALESCE(object.name,'历史作业对象待核对') AS work_object_id_label
 FROM operations o JOIN operation_versions v ON v.operation_id=o.id
 JOIN work_object_versions adopted ON adopted.work_object_id=v.work_object_id
  AND adopted.version_no=v.work_object_version_no
 LEFT JOIN dictionary_item_versions unit ON unit.item_id=v.default_unit_id AND unit.version=v.default_unit_version
 LEFT JOIN v_work_object_current object ON object.id=v.work_object_id`;
const currentOperationSql =
  operationSql +
  ` WHERE v.version=(SELECT MAX(n.version) FROM operation_versions n WHERE n.operation_id=o.id)`;
const operationSource: ListSource = {
  sql: currentOperationSql,
  columns: [
    "id",
    "code",
    "name",
    "status",
    "object_position",
    "attribution_unit",
    "default_target_object",
    "completion_standard",
    "entry_hint",
    "default_quantity_scaled",
    "work_object_id_label",
    "default_unit_id_label",
    "version",
    "sort_order",
    "created_at",
    "updated_at",
    "deleted",
  ],
  search: [
    "name",
    "code",
    "status",
    "work_object_id_label",
    "default_unit_id_label",
  ],
};
const objectSource: ListSource = {
  sql: objectSql,
  columns: [
    "id",
    "code",
    "name",
    "status",
    "object_position",
    "attribution_unit",
    "version_no",
    "sort_order",
    "created_at",
    "deleted",
  ],
  search: ["name", "code", "status", "object_position", "attribution_unit"],
};
export function workStandardRepository(store: ReturnType<typeof createStore>) {
  function rows<T>(
    kind: "operations" | "objects",
    sql: string,
    parameters: (string | number)[] = [],
  ): T[] {
    return store.query(
      `SELECT source.*,EXISTS(SELECT 1 FROM audit_events a WHERE a.entity=? AND a.entity_id=source.id AND a.action='delete') AS deleted FROM (${sql}) source`,
      kind,
      ...parameters,
    ) as T[];
  }
  return {
    object: (id: string) =>
      rows<WorkObjectRecord>("objects", objectSql + " WHERE c.id=?", [id])[0],
    operation: (id: string) =>
      rows<OperationRecord>("operations", currentOperationSql + " AND o.id=?", [
        id,
      ])[0],
    operationVersion: (id: string, version: number) =>
      rows<OperationRecord>(
        "operations",
        operationSql + " WHERE o.id=? AND v.version=?",
        [id, version],
      )[0],
    objectVersion: (id: string, version: number) =>
      store.get("SELECT * FROM work_object_versions WHERE work_object_id=? AND version_no=?", id, version) as
        WorkObjectVersion | undefined,
    unitVersion: (id: string, version: number) =>
      store.get("SELECT name,fields_json FROM dictionary_item_versions WHERE item_id=? AND version=?", id, version) as
        { name: string; fields_json: string } | undefined,
    objectReferences: (id: string) =>
      countBusinessReferences(store, "work_objects", id),
    operationReferences: (id: string) =>
      countBusinessReferences(store, "operations", id),
    objects: () => rows<WorkObjectRecord>("objects", objectSql),
    operations: () => rows<OperationRecord>("operations", currentOperationSql),
    searchObjects: (query: ListQuery) =>
      searchPage<WorkObjectRecord>(store, "objects", objectSource, query),
    searchOperations: (query: ListQuery) =>
      searchPage<OperationRecord>(store, "operations", operationSource, {
        ...query,
        sort:
          query.sort === "default_unit_id"
            ? "default_unit_id_label"
            : query.sort === "work_object_id"
              ? "work_object_id_label"
              : query.sort,
        filters: Object.fromEntries(
          Object.entries(query.filters).map(([key, value]) => [
            key === "default_unit_id"
              ? "default_unit_id_label"
              : key === "work_object_id"
                ? "work_object_id_label"
                : key,
            value,
          ]),
        ),
      }),
    createObject: (identity: {
      id: string;
      code: string;
      created_at: string;
    }): void => {
      store.insert("work_objects", identity);
    },
    createOperation: (identity: {
      id: string;
      code: string;
      created_at: string;
    }): void => {
      store.insert("operations", identity);
    },
    appendObject: (version: WorkObjectVersion): void => {
      store.insert("work_object_versions", version);
    },
    appendOperation: (version: OperationVersion): void => {
      store.insert("operation_versions", version);
    },
    objectHistory: (id: string) =>
      store.where("work_object_versions", {
        work_object_id: id,
      }) as WorkObjectVersion[],
    operationHistory: (id: string) =>
      store.where("operation_versions", {
        operation_id: id,
      }) as OperationVersion[],
    operationAdoptions(id: string): OperationAdoptions {
      return {
        demands: store.query(`SELECT d.id,d.demand_no,v.version AS demand_version,v.operation_version
          FROM demand_versions v JOIN demands d ON d.id=v.demand_id
          WHERE v.operation_id=? ORDER BY d.demand_no,v.version`, id) as OperationAdoptions["demands"],
        prices: store.query(`SELECT catalog_id AS id,title,version_no,operation_version
          FROM reference_price_versions WHERE operation_id=? ORDER BY title,version_no`, id) as OperationAdoptions["prices"],
      };
    },

  };
}
export type WorkStandardRepository = ReturnType<typeof workStandardRepository>;

import { nextBusinessNumber } from "./business-numbers.js";
import { countBusinessReferences } from "../queries/deletion-impact.js";
import type { createStore } from "./store.js";
import type { GridFilter, ListQuery } from "../../shared/types/contracts.js";
import type {
  MaterialRecord,
  MaterialVersion,
} from "../../shared/types/master-data.js";
import { searchFacets, searchPage, type ListSource } from "../queries/business-lists.js";
const sql = `SELECT c.*,v.material_id,v.reason,v.recorded_at,COALESCE(unit.name,'历史计量单位待核对') AS unit_id_label
  FROM v_material_current c JOIN material_versions v ON v.id=c.material_version_id
  LEFT JOIN v_dictionary_current unit ON unit.id=c.unit_id`;
const source: ListSource = {
  sql,
  projection: "CASE WHEN deleted THEN '已删除' WHEN status='active' THEN '有效' ELSE '停用' END AS status_label",
  columns: [
    "id",
    "name",
    "status",
    "status_label",
    "model",
    "specification",
    "unit_id_label",
    "code",
    "note",
    "created_at",
    "updated_at",
    "version_no",
    "deleted",
  ],
  search: ["name", "model", "specification", "unit_id_label", "status", "code"],
};
export function materialRepository(store: ReturnType<typeof createStore>) {
  function rows(id?: string): MaterialRecord[] {
    return store.query(
      `SELECT source.*,EXISTS(SELECT 1 FROM audit_events a WHERE a.entity='materials'
      AND a.entity_id=source.id AND a.action='delete') AS deleted FROM (${sql}) source ${id ? "WHERE source.id=?" : ""}`,
      ...(id ? [id] : []),
    ) as MaterialRecord[];
  }
  return {
    nextNumber: () => nextBusinessNumber(store, "materials"),
    references: (key: string) =>
      countBusinessReferences(store, "materials", key),
    current: (id: string) => rows(id)[0],
    all: () => rows(),
    facets(query: ListQuery, key: string, search: string, offset: number, limit: number, selection?: GridFilter) {
      return searchFacets(store, "materials", source, query, key === "unit_id" ? "unit_id_label" : key, search, offset, limit, selection);
    },
    search(query: ListQuery) {
      const columns = Object.fromEntries(
        Object.entries(query.filters).map(([key, value]) => [
          key === "unit_id" ? "unit_id_label" : key,
          value,
        ]),
      );
      return searchPage<MaterialRecord>(store, "materials", source, {
        ...query,
        sort: query.sort === "unit_id" ? "unit_id_label" : query.sort,
        filters: columns,
        grid_filters: Object.fromEntries(Object.entries(query.grid_filters ?? {}).map(([key, values]) =>
          [key === "unit_id" ? "unit_id_label" : key, values])),
      });
    },
    create(identity: {
      id: string;
      code: string;
      unit_id: string;
      created_by: string;
      created_at: string;
    }): void {
      store.insert("materials", identity);
    },
    appendVersion: (version: MaterialVersion): void => {
      store.insert("material_versions", version);
    },
    history: (id: string) =>
      store.where("material_versions", {
        material_id: id,
      }) as MaterialVersion[],
  };
}
export type MaterialRepository = ReturnType<typeof materialRepository>;

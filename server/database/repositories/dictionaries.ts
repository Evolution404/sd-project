import { countBusinessReferences } from "../queries/deletion-impact.js";
import type { createStore } from "./store.js";
import type {
  DictionaryKind,
  FoundationKind,
  DictionaryItem,
  DictionaryVersion,
  OrganizationDefinition,
  OrganizationVersion,
} from "../../shared/types/master-data.js";
import type { ListQuery } from "../../shared/types/contracts.js";
import { searchPage, type ListSource } from "../queries/business-lists.js";
const types: Record<DictionaryKind, { id: string; title: string }> = {
  units: { id: "unit", title: "计量单位" },
  priorities: { id: "priority", title: "优先级" },
  categories: { id: "project_category", title: "项目类别" },
};
const dictionarySql = `SELECT c.*,v.item_id,v.changed_by,v.changed_at,v.reason
  FROM v_dictionary_current c JOIN dictionary_item_versions v ON v.id=c.current_version_id`;
const organizationSql = `SELECT c.*,v.unit_id,v.actor_id,v.reason,parent.name AS parent_unit_id_label
  FROM v_organizational_unit_current c JOIN organizational_unit_versions v ON v.id=c.unit_version_id
  LEFT JOIN v_organizational_unit_current parent ON parent.id=c.parent_unit_id`;
function source(kind: FoundationKind): ListSource {
  return kind === "organizations"
    ? {
        sql: organizationSql,
        columns: [
          "id",
          "name",
          "status",
          "code",
          "parent_unit_id_label",
          "version_no",
          "recorded_at",
          "deleted",
        ],
        search: ["name", "status", "parent_unit_id_label"],
        defaultSort: "recorded_at",
      }
    : {
        sql: dictionarySql + " WHERE c.type_id='" + types[kind].id + "'",
        columns: [
          "id",
          "name",
          "status",
          "code",
          "version",
          "sort_order",
          "created_at",
          "updated_at",
          "deleted",
        ],
        search: ["name", "status", "code"],
      };
}
export function dictionaryRepository(store: ReturnType<typeof createStore>) {
  function rows<T>(kind: FoundationKind, id?: string): T[] {
    return store.query(
      `SELECT source.*,EXISTS(SELECT 1 FROM audit_events a WHERE a.entity=? AND a.entity_id=source.id AND a.action='delete') AS deleted
      FROM (${source(kind).sql}) source ${id ? "WHERE source.id=?" : ""}`,
      kind,
      ...(id ? [id] : []),
    ) as T[];
  }
  return {
    references: (key: string) =>
      countBusinessReferences(store, "dictionary_items", key) +
      (
        store.get(
          `SELECT COUNT(*) AS total FROM dictionary_item_versions v JOIN dictionary_items i ON i.id=v.item_id WHERE i.type_id='price_factor' AND json_extract(v.fields_json,'$.unit_id')=?`,
          key,
        ) as { total: number }
      ).total,
    dictionary: (kind: DictionaryKind, id: string) =>
      rows<DictionaryItem>(kind, id)[0],
    organization: (id: string) =>
      rows<OrganizationDefinition>("organizations", id)[0],
    dictionaryItems: (kind: DictionaryKind) => rows<DictionaryItem>(kind),
    organizations: () => rows<OrganizationDefinition>("organizations"),
    searchDictionary: (kind: DictionaryKind, query: ListQuery) =>
      searchPage<DictionaryItem>(store, kind, source(kind), query),
    searchOrganizations: (query: ListQuery) =>
      searchPage<OrganizationDefinition>(
        store,
        "organizations",
        source("organizations"),
        query,
      ),
    createDictionary(
      kind: DictionaryKind,
      identity: { id: string; code: string; created_at: string },
    ): void {
      const type = types[kind];
      if (!store.find("dictionary_types", "id", type.id))
        store.insert("dictionary_types", { id: type.id, title: type.title });
      store.insert("dictionary_items", { ...identity, type_id: type.id });
    },
    appendDictionaryVersion: (version: DictionaryVersion): void => {
      store.insert("dictionary_item_versions", version);
    },
    dictionaryHistory: (id: string) =>
      store.where("dictionary_item_versions", {
        item_id: id,
      }) as DictionaryVersion[],
    createOrganization: (identity: { id: string; code: string }): void => {
      store.insert("organizational_units", identity);
    },
    appendOrganizationVersion: (version: OrganizationVersion): void => {
      store.insert("organizational_unit_versions", version);
    },
    organizationHistory: (id: string) =>
      store.where("organizational_unit_versions", {
        unit_id: id,
      }) as OrganizationVersion[],
  };
}
export type DictionaryRepository = ReturnType<typeof dictionaryRepository>;

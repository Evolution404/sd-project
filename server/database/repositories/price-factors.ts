import { countBusinessReferences } from "../queries/deletion-impact.js";
import type { createStore } from "./store.js";
import type {
  PriceFactorRecord,
  PriceFactorVersion,
} from "../../shared/types/work-standards.js";
import type { DictionaryVersion } from "../../shared/types/master-data.js";
import type { ListQuery } from "../../shared/types/contracts.js";
import { searchPage, type ListSource } from "../queries/business-lists.js";
const sql = `SELECT c.*,v.item_id,v.changed_at,v.changed_by,v.reason FROM v_dictionary_current c
  JOIN dictionary_item_versions v ON v.id=c.current_version_id WHERE c.type_id='price_factor'`;
const source: ListSource = {
  sql,
  columns: [
    "id",
    "code",
    "name",
    "status",
    "sort_order",
    "version",
    "created_at",
    "updated_at",
    "deleted",
  ],
  search: ["name", "code", "status"],
};
export function priceFactorRepository(store: ReturnType<typeof createStore>) {
  return {
    references: (id: string) =>
      countBusinessReferences(store, "dictionary_items", id) +
      Number(
        store.get(
          `SELECT COUNT(*) AS total FROM operation_versions v, json_each(v.pricing_features_json) feature WHERE json_extract(feature.value,'$.factor_id')=?`,
          id,
        )?.total ?? 0,
      ),
    current: (id: string) =>
      store.get(
        `SELECT source.*,EXISTS(SELECT 1 FROM audit_events a WHERE a.entity='factors' AND a.entity_id=source.id AND a.action='delete') AS deleted FROM (${sql}) source WHERE source.id=?`,
        id,
      ) as PriceFactorRecord | undefined,
    all: () =>
      store.query(
        `SELECT source.*,EXISTS(SELECT 1 FROM audit_events a WHERE a.entity='factors' AND a.entity_id=source.id AND a.action='delete') AS deleted FROM (${sql}) source`,
      ) as PriceFactorRecord[],
    search: (query: ListQuery) =>
      searchPage<PriceFactorRecord>(store, "factors", source, query),
    version: (id: string, version: number) =>
      store.get(
        `SELECT v.* FROM dictionary_item_versions v JOIN dictionary_items i ON i.id=v.item_id WHERE i.type_id='price_factor' AND v.item_id=? AND v.version=?`,
        id,
        version,
      ) as PriceFactorVersion | undefined,
    unitVersion: (id: string, version: number) =>
      store.get(
        `SELECT v.* FROM dictionary_item_versions v JOIN dictionary_items i ON i.id=v.item_id WHERE i.type_id='unit' AND v.item_id=? AND v.version=?`,
        id,
        version,
      ) as DictionaryVersion | undefined,
    create(identity: { id: string; code: string; created_at: string }): void {
      if (!store.find("dictionary_types", "id", "price_factor"))
        store.insert("dictionary_types", {
          id: "price_factor",
          title: "价格特征",
        });
      store.insert("dictionary_items", {
        ...identity,
        type_id: "price_factor",
      });
    },
    append: (version: PriceFactorVersion): void => {
      store.insert("dictionary_item_versions", version);
    },
    history: (id: string) =>
      store.where("dictionary_item_versions", {
        item_id: id,
      }) as PriceFactorVersion[],
  };
}
export type PriceFactorRepository = ReturnType<typeof priceFactorRepository>;

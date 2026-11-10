import { countBusinessReferences } from "../queries/deletion-impact.js";
import type { createStore } from "./store.mjs";
import type {
  PriceRuleRecord,
  PriceRuleVersion,
} from "../../shared/types/price-rules.js";
import type { ListQuery } from "../../shared/types/contracts.js";
import { searchPage, type ListSource } from "../queries/business-lists.js";
const sql = `SELECT c.id,c.code,c.created_by,c.created_at,c.current_version_id,c.version_no,c.title,c.operation_id,c.operation_version,
 c.unit_id,c.unit_version,c.voltage_level_id,c.tower_type,c.work_mode,c.specification,c.additional_conditions_json,c.status,
 c.pricing_mode,c.pricing_scope,c.calculation_params_json,c.fee_components_json,c.base_fee_fen,c.unit_price_fen,c.quantity_brackets_json,
 c.effective_on,c.price_source,c.price_date,c.basis,v.catalog_id,v.reason,v.created_at AS version_created_at,v.created_by AS version_created_by,
 COALESCE(operation.name,'历史操作定义待核对') AS operation_id_label,COALESCE(unit.name,'历史计量单位待核对') AS unit_id_label,
 voltage.name AS voltage_level_id_label
 FROM v_reference_price_current c JOIN reference_price_versions v ON v.id=c.current_version_id
 LEFT JOIN operation_versions operation ON operation.operation_id=c.operation_id AND operation.version=c.operation_version
 LEFT JOIN dictionary_item_versions unit ON unit.item_id=c.unit_id AND unit.version=c.unit_version
 LEFT JOIN voltage_levels voltage ON voltage.id=c.voltage_level_id`;
const source: ListSource = {
  sql,
  columns: [
    "id",
    "code",
    "title",
    "status",
    "operation_id_label",
    "voltage_level_id_label",
    "tower_type",
    "work_mode",
    "specification",
    "pricing_mode",
    "pricing_scope",
    "base_fee_fen",
    "unit_price_fen",
    "price_source",
    "price_date",
    "effective_on",
    "basis",
    "created_at",
    "version_no",
    "deleted",
  ],
  search: [
    "title",
    "code",
    "status",
    "operation_id_label",
    "voltage_level_id_label",
    "tower_type",
    "specification",
    "price_source",
    "basis",
  ],
};
export function priceRuleRepository(store: ReturnType<typeof createStore>) {
  function rows(id?: string): PriceRuleRecord[] {
    return store.query(
      `SELECT source.*,EXISTS(SELECT 1 FROM audit_events a WHERE a.entity='prices' AND a.entity_id=source.id AND a.action='delete') AS deleted FROM (${sql}) source ${id ? "WHERE source.id=?" : ""}`,
      ...(id ? [id] : []),
    ) as PriceRuleRecord[];
  }
  return {
    references: (id: string) =>
      countBusinessReferences(store, "reference_price_catalog", id),
    current: (id: string) => rows(id)[0],
    all: () => rows(),
    search: (query: ListQuery) =>
      searchPage<PriceRuleRecord>(store, "prices", source, {
        ...query,
        sort:
          query.sort === "operation_id"
            ? "operation_id_label"
            : query.sort === "voltage_level_id"
              ? "voltage_level_id_label"
              : query.sort,
        filters: Object.fromEntries(
          Object.entries(query.filters).map(([key, value]) => [
            key === "operation_id"
              ? "operation_id_label"
              : key === "voltage_level_id"
                ? "voltage_level_id_label"
                : key,
            value,
          ]),
        ),
      }),
    create: (identity: {
      id: string;
      code: string;
      created_by: string;
      created_at: string;
    }): void => {
      store.insert("reference_price_catalog", identity);
    },
    append: (version: PriceRuleVersion): void => {
      store.insert("reference_price_versions", version);
    },
    history: (id: string) =>
      store.where("reference_price_versions", {
        catalog_id: id,
      }) as PriceRuleVersion[],
    effectiveLocationRules(date: string): PriceRuleVersion[] {
      return store.query(
        `SELECT v.* FROM reference_price_versions v WHERE v.pricing_scope='work_location'
   AND v.effective_on<=? AND v.version_no=(SELECT MAX(n.version_no) FROM reference_price_versions n WHERE n.catalog_id=v.catalog_id AND n.effective_on<=?)
   AND NOT EXISTS(SELECT 1 FROM audit_events a WHERE a.entity='prices' AND a.entity_id=v.catalog_id AND a.action='delete')`,
        date,
        date,
      ) as PriceRuleVersion[];
    },
    latestLocationRules: () =>
      store.query(`SELECT v.* FROM reference_price_versions v WHERE v.pricing_scope='work_location' AND v.version_no=(SELECT MAX(n.version_no) FROM reference_price_versions n WHERE n.catalog_id=v.catalog_id)
   AND NOT EXISTS(SELECT 1 FROM audit_events a WHERE a.entity='prices' AND a.entity_id=v.catalog_id AND a.action='delete')`) as PriceRuleVersion[],
  };
}
export type PriceRuleRepository = ReturnType<typeof priceRuleRepository>;

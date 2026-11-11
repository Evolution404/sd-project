import type { createStore } from "./store.js";

interface FactorVersionLabel {
  code: string;
  version: number;
  name: string;
}
interface OperationLabelRow { fields_json: string }

type Store = ReturnType<typeof createStore>;

/** One dedicated, read-only query boundary for cross-domain historical labels. */
export function catalogLabelRepository(store: Store) {
  return {
    displayLabels(): Record<string, string> {
      const labels: Record<string, string> = {};
      const factors = store.query(
        "SELECT d.code, v.version, v.name FROM dictionary_item_versions v " +
        "JOIN dictionary_items d ON d.id=v.item_id " +
        "WHERE d.type_id='price_factor' ORDER BY v.version",
      ) as FactorVersionLabel[];
      for (const factor of factors) {
        labels[factor.code] = factor.name;
        labels[factor.code + "@" + factor.version] = factor.name;
      }
      const operations = store.query(
        "SELECT fields_json FROM operation_versions ORDER BY version",
      ) as OperationLabelRow[];
      for (const operation of operations) {
        const parsed: unknown = JSON.parse(operation.fields_json || "[]");
        if (!Array.isArray(parsed)) continue;
        for (const item of parsed) {
          if (item === null || typeof item !== "object" ||
              !("key" in item) || !("label" in item) ||
              typeof item.key !== "string" || typeof item.label !== "string") continue;
          labels[item.key] = item.label;
        }
      }
      return labels;
    },
  };
}
export type CatalogLabelRepository = ReturnType<typeof catalogLabelRepository>;

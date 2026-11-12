import type { createStore } from "./store.js";

interface OperationLabelRow { operation_id:string; version:number; attributes_schema_json: string }

type Store = ReturnType<typeof createStore>;

/** One dedicated, read-only query boundary for cross-domain historical labels. */
export function catalogLabelRepository(store: Store) {
  return {
    displayLabels(): Record<string, string> {
      const labels: Record<string, string> = {};
      const operations = store.query(
        "SELECT operation_id,version,attributes_schema_json FROM operation_versions ORDER BY version",
      ) as OperationLabelRow[];
      for (const operation of operations) {
        const parsed: unknown = JSON.parse(operation.attributes_schema_json || "[]");
        if (!Array.isArray(parsed)) continue;
        for (const item of parsed) {
          if (item === null || typeof item !== "object" ||
              !("key" in item) || !("label" in item) ||
              typeof item.key !== "string" || typeof item.label !== "string") continue;
          labels[item.key] = item.label;
          labels[item.key+"@"+operation.version] = item.label;
        }
      }
      return labels;
    },
  };
}
export type CatalogLabelRepository = ReturnType<typeof catalogLabelRepository>;

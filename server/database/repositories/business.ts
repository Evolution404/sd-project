import { businessLists } from "../queries/business-lists.js";
import { projectReadRepository } from "./projects.js";
import { financeReadRepository } from "./finance.js";
import { exchangeReferenceRepository } from "./exchange.js";
import { reportingReadRepository } from "./reporting.js";
import type { Store, SqlRow } from "./store.js";
import type { AuditRecord } from "../../shared/types/contracts.js";

interface DuplicateLocation {
  logical_tower_id?: string | null;
  physical_tower_id?: string | null;
  span_id?: string | null;
}
interface DuplicateDemand { id: string; demand_no: string; }

/** Temporary typed assembly while the remaining project/finance/exchange services adopt dedicated DB ports.
 * This is NOT a backward-compatibility layer or a separate SQL implementation.
 */
export function businessRepository(store: Store) {
  const lists=businessLists(store);
  return {
    ...store,
    ...projectReadRepository(store),
    ...financeReadRepository(store),
    ...exchangeReferenceRepository(store),
    ...reportingReadRepository(store),
    searchFinance:lists.finance,
    searchProjects:lists.projects,
    latest<T extends object=SqlRow>(table:string,key:string,value:unknown,
      sequence="version_no"):T|undefined {
      return store.where<T>(table,{[key]:value},sequence,1)[0];
    },
    deleted(entity:string):Set<string> {
      return new Set(store.query<{entity_id:string}>(
        "SELECT entity_id FROM audit_events WHERE entity=? AND action='delete'",
        entity).map(row=>row.entity_id));
    },
    isDeleted(entity:string,entityId:string):boolean {
      return Boolean(store.get("SELECT 1 FROM audit_events WHERE entity=? AND entity_id=? AND action='delete' LIMIT 1",
        entity,entityId));
    },
    auditFor(entity:string,entityId:string):AuditRecord[] {
      return store.query<AuditRecord>("SELECT * FROM audit_events WHERE entity=? AND entity_id=? ORDER BY created_at,id",
        entity,entityId);
    },
    demandDuplicates(operationId:string,locations:readonly DuplicateLocation[],exceptId?:string):DuplicateDemand[] {
      const keys=["logical_tower_id","physical_tower_id","span_id"] as const;
      const conditions=keys.map(key=>({
        key,values:[...new Set(locations.map(location=>location[key])
          .filter((value):value is string=>typeof value==="string"&&value.length>0))],
      })).filter(part=>part.values.length);
      if(!conditions.length)return [];
      const queries=conditions.map(({key})=>`SELECT DISTINCT d.id,d.demand_no
        FROM demand_version_work_locations loc
        JOIN demand_versions current ON current.demand_id=loc.demand_id AND current.version=loc.demand_version
        JOIN demands d ON d.id=current.demand_id
        WHERE loc.${key} IN (SELECT value FROM json_each(?))
          AND current.operation_id=? AND d.id<>?
          AND NOT EXISTS(SELECT 1 FROM demand_versions newer
            WHERE newer.demand_id=current.demand_id AND newer.version>current.version)
          AND NOT EXISTS(SELECT 1 FROM demand_lifecycle_events cancelled
            WHERE cancelled.demand_id=d.id AND cancelled.to_status='cancelled')`);
      return store.query<DuplicateDemand>(queries.join(" UNION "),
        ...conditions.flatMap(({values})=>[JSON.stringify(values),operationId,exceptId??""]));
    },
    integrity():{integrity:Array<{integrity_check:string}>;foreignKeys:SqlRow[]} {
      return {
        integrity:store.query("PRAGMA integrity_check"),
        foreignKeys:store.query("PRAGMA foreign_key_check"),
      };
    },
  };
}
export type BusinessRepository = ReturnType<typeof businessRepository>;

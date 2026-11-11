import type { Store } from "./store.js";
import type {
  CostNodeCurrent, ActualCostVersion, CostEntry,
  SettlementRoot, SettlementVersion, SettlementDraftRow,
  SettlementReviewEvent, ReconciliationVersion
} from "../../shared/types/finance-workflows.js";

export interface CostNodeIdentity {
  id:string; project_id:string; parent_id:string|null; created_by:string; created_at:string;
}
export interface CostNodeVersion {
  id:string; node_id:string; version_no:number; name:string; status:"active"|"inactive";
  actor_id:string; recorded_at:string; reason:string;
}
export interface SettlementItemIdentity {
  id:string; settlement_id:string; cost_node_id:string;
  project_scope_id:string|null; created_at:string;
}
export interface SettlementScopeIdentity {
  id:string; approval_version_id:string; project_scope_id:string;
}
export interface SettlementItemVersionWrite {
  id:string; settlement_version_id:string; settlement_item_id:string;
  cost_node_version_id:string; approval_scope_version_id:string|null;
  quantity_scaled:number; amount_fen:number; unit_price_fen:number|null;
  work_mode:string|null; evidence:string; scope_snapshot_json:string;
}
export interface SettlementResultWrite {
  id:string; settlement_version_id:string; project_scope_id:string;
  approval_scope_version_id:string; resolved_quantity_scaled:number; evidence:string;
}
export interface ProjectClosureWrite {
  id:string; project_id:string; approval_version_id:string; reason:string;
  close_snapshot_json:string; closed_by:string; closed_at:string;
}
export interface ApprovalReference { id:string; project_id:string; }
export interface SettlementItemRef { id:string; settlement_item_id:string; }
export interface ReconciliationOwnership {cost_project_id:string;settlement_project_id:string;}


/** Finance domain persistence. Table names and SQL do not cross this boundary. */
export function financeCommandRepository(store:Store) {
  function deleted(entity:"cost_nodes"|"costs"|"settlements"|"reconciliations",key:string):boolean {
    return Boolean(store.get("SELECT 1 FROM audit_events WHERE entity=? AND entity_id=? AND action='delete' LIMIT 1",
      entity,key));
  }
  return {
    costNodeDeleted(id:string):boolean {return deleted("cost_nodes",id);},
    actualCostDeleted(id:string):boolean {return deleted("costs",id);},
    settlementDeleted(id:string):boolean {return deleted("settlements",id);},
    reconciliationDeleted(id:string):boolean {return deleted("reconciliations",id);},
    currentCostNode(id:string):CostNodeCurrent|undefined {
      return store.find<CostNodeCurrent>("v_project_cost_node_current","id",id);
    },
    costEntry(id:string):CostEntry|undefined {
      return store.find<CostEntry>("cost_entries","id",id);
    },
    latestCostVersion(entryId:string):ActualCostVersion|undefined {
      return store.where<ActualCostVersion>("cost_versions",{entry_id:entryId},"version_no",1)[0];
    },
    costVersions(entryId:string):ActualCostVersion[] {
      return store.where<ActualCostVersion>("cost_versions",{entry_id:entryId});
    },
    createCostNode(row:CostNodeIdentity):void { store.insert("project_cost_nodes",row); },
    appendCostNodeVersion(row:CostNodeVersion):void { store.insert("project_cost_node_versions",row); },
    createCostEntry(row:CostEntry):void { store.insert("cost_entries",row); },
    appendActualCost(row:ActualCostVersion):void { store.insert("cost_versions",row); },
    settlementRoot(id:string):SettlementRoot|undefined {
      return store.find<SettlementRoot>("settlements","id",id);
    },
    latestSettlementVersion(id:string):SettlementVersion|undefined {
      return store.where<SettlementVersion>("settlement_versions",{settlement_id:id},"version_no",1)[0];
    },
    settlementDraft(id:string):SettlementDraftRow|undefined {
      return store.find<SettlementDraftRow>("settlement_drafts","settlement_id",id);
    },
    settlementResults(versionId:string):SettlementResultWrite[] {
      return store.where<SettlementResultWrite>("settlement_scope_results",{settlement_version_id:versionId});
    },
    latestReview(versionId:string):SettlementReviewEvent|undefined {
      return store.where<SettlementReviewEvent>("settlement_review_events",
        {settlement_version_id:versionId},"event_seq",1)[0];
    },
    approvalReference(id:string):ApprovalReference|undefined {
      return store.find<ApprovalReference>("project_approval_versions","id",id);
    },
    projectSettlements(projectId:string):SettlementRoot[] {
      return store.where<SettlementRoot>("settlements",{project_id:projectId});
    },
    settlements():SettlementRoot[] { return store.list<SettlementRoot>("settlements"); },
    createSettlement(row:SettlementRoot):void { store.insert("settlements",row); },
    replaceSettlementDraft(row:SettlementDraftRow):void {
      store.update("settlement_drafts","settlement_id",row.settlement_id,{
        based_on_version_id:row.based_on_version_id,
        draft_json:row.draft_json,edit_version:row.edit_version,
        updated_by:row.updated_by,updated_at:row.updated_at
      });
    },
    createSettlementDraft(row:SettlementDraftRow):void { store.insert("settlement_drafts",row); },
    deleteSettlementDraft(id:string):void { store.remove("settlement_drafts","settlement_id",id); },
    appendSettlementVersion(row:SettlementVersion):void { store.insert("settlement_versions",row); },
    settlementItems(settlementId:string):SettlementItemIdentity[] {
      return store.where<SettlementItemIdentity>("settlement_items",{settlement_id:settlementId});
    },
    approvalScopes(approvalId:string):SettlementScopeIdentity[] {
      return store.where<SettlementScopeIdentity>("project_approval_scope_versions",
        {approval_version_id:approvalId});
    },
    createSettlementItem(row:SettlementItemIdentity):void { store.insert("settlement_items",row); },
    appendSettlementItem(row:SettlementItemVersionWrite):void {
      store.insert("settlement_item_versions",row);
    },
    appendResolvedScope(row:SettlementResultWrite):void {
      store.insert("settlement_scope_results",row);
    },
    appendReview(row:SettlementReviewEvent):void {
      store.insert("settlement_review_events",row);
    },
    settlementVersionItems(versionId:string): SettlementItemVersionWrite[] {
      return store.where<SettlementItemVersionWrite>("settlement_item_versions",
        {settlement_version_id:versionId});
    },
    settlementItemVersion(id:string):SettlementItemRef|undefined {
      return store.find<SettlementItemRef>("settlement_item_versions","id",id);
    },
    costVersion(id:string):ActualCostVersion|undefined {
      return store.find<ActualCostVersion>("cost_versions","id",id);
    },
    reconciliationOwnership(costVersionId:string,settlementItemVersionId:string):ReconciliationOwnership|undefined {
      return store.get<ReconciliationOwnership>(`SELECT entry.project_id AS cost_project_id,
        document.project_id AS settlement_project_id
        FROM cost_versions cost
        JOIN cost_entries entry ON entry.id=cost.entry_id
        JOIN settlement_item_versions item ON item.id=?
        JOIN settlement_versions version ON version.id=item.settlement_version_id
        JOIN settlements document ON document.id=version.settlement_id
        WHERE cost.id=?`, settlementItemVersionId,costVersionId);
    },
    latestReconciliationVersion(id:string):ReconciliationVersion|undefined {
      return store.where<ReconciliationVersion>("cost_reconciliation_versions",
        {record_id:id},"version_no",1)[0];
    },
    reconciliationVersions(id:string):ReconciliationVersion[] {
      return store.where<ReconciliationVersion>("cost_reconciliation_versions",{record_id:id});
    },
    appendReconciliation(row:ReconciliationVersion):void {
      store.insert("cost_reconciliation_versions",row);
    },
    createClosure(row:ProjectClosureWrite):void {
      store.insert("project_closures",row);
    },
    effectiveSettlement(id:string):SettlementVersion|undefined {
      return store.where<SettlementVersion>("v_settlement_effective_versions",{settlement_id:id})[0];
    },
  };
}
export type FinanceCommandRepository=ReturnType<typeof financeCommandRepository>;

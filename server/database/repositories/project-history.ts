import type { HistoryItem, HistoryPage, HistoryQuery } from "../../shared/types/history.js";
import type { createStore } from "./store.js";
type Store = Pick<ReturnType<typeof createStore>, "query">;
interface Identified { id: string; [field: string]: unknown }
interface Approval extends Identified { project_id: string }
interface ApprovedScope extends Identified { approval_version_id: string }
interface Cost extends Identified { project_id: string }
interface CostVersion extends Identified { entry_id: string }
interface Settlement extends Identified { project_id: string }
interface SettlementVersion extends Identified { settlement_id: string }
interface SettlementItem extends Identified { settlement_version_id: string }
interface SettlementResolution extends Identified { settlement_version_id: string }
interface SettlementReviewEvent extends Identified { settlement_version_id: string }
interface CostNode extends Identified { project_id: string }
interface CostNodeVersion extends Identified { node_id: string }

function groupBy<T extends object, K extends keyof T>(records: readonly T[], key: K):
    Map<T[K], T[]> {
  const index = new Map<T[K], T[]>();
  for (const record of records) {
    const value=record[key];
    const items=index.get(value) ?? [];
    items.push(record);
    index.set(value,items);
  }
  return index;
}

/** Exact project-owned formal history, with a bounded fixed SQL query count.
 * Business version and audit facts are not overwritten or rewritten.
 */
export function projectHistoryRepository(store: Store) {
  return {
    projectTimelineBasis(projectId: string) {
      const approval = store.query<{version_no:number; approved_budget_fen:number}>(
        "SELECT version_no,approved_budget_fen FROM project_approval_versions WHERE project_id=? AND status='approved' ORDER BY version_no DESC LIMIT 1",
        projectId)[0];
      const draft = store.query<{present:number}>(
        "SELECT 1 present FROM project_approval_versions WHERE project_id=? AND status='draft' LIMIT 1",projectId)[0];
      return { approval, draft: Boolean(draft) };
    },
    projectTimeline(projectId: string, query: HistoryQuery, pageSize: number) {
      return timeline(store, projectId, query, pageSize);
    },

    projectTimelineDetails(projectId: string, source: EventKind, rowId: string) {
      const result: Partial<Record<"profiles"|"funding"|"stages"|"links"|"withdrawals"|"closures"|
        "costs"|"settlements"|"cost_nodes"|"audit", unknown[]>> = {};
      const approvalIds: string[] = [];
      switch (source) {
        case "profile":
          result.profiles = store.query(`
            SELECT p.*,category.name category_name,org.name organization_name,
              owner.username owner_name, manager.username manager_name,
              (SELECT v.name FROM framework_versions v WHERE v.framework_id=p.framework_id
                AND v.recorded_at<=p.recorded_at ORDER BY v.version_no DESC LIMIT 1) framework_name
            FROM project_management_versions selected
            JOIN project_management_versions p ON p.project_id=selected.project_id
              AND p.version_no BETWEEN selected.version_no-1 AND selected.version_no
            LEFT JOIN dictionary_item_versions category ON category.item_id=p.category_id AND category.version=p.category_version
            LEFT JOIN organizational_unit_versions org ON org.id=p.managing_unit_version_id
            LEFT JOIN users owner ON owner.id=p.owner_id LEFT JOIN users manager ON manager.id=p.manager_id
            WHERE selected.project_id=? AND selected.id=? ORDER BY p.version_no`,projectId,rowId);
          break;
        case "funding":
          result.funding = store.query(`SELECT f.*,(SELECT v.name FROM agreement_versions v WHERE v.agreement_id=f.agreement_id
              AND v.recorded_at<=f.recorded_at ORDER BY v.version_no DESC LIMIT 1) agreement_name
            FROM project_funding_versions selected JOIN project_funding_versions f ON f.project_id=selected.project_id
              AND f.version_no BETWEEN selected.version_no-1 AND selected.version_no
            WHERE selected.project_id=? AND selected.id=? ORDER BY f.version_no`,projectId,rowId);
          break;
        case "stage":
          result.stages = store.query("SELECT * FROM project_stage_events WHERE project_id=? AND id=?",projectId,rowId);
          break;
        case "link":
          result.links = store.query(`SELECT e.*,d.id demand_id,d.demand_no
            FROM project_demand_link_events e JOIN project_demand_scopes sc ON sc.id=e.project_scope_id
            JOIN demands d ON d.id=sc.demand_id WHERE sc.project_id=? AND e.id=?`,projectId,rowId);
          break;
        case "withdrawal":
          result.withdrawals = store.query(`SELECT e.id,e.actor_id,e.created_at recorded_at,p.version_no,p.approved_budget_fen
            FROM project_approval_versions p JOIN audit_events e ON e.entity='approval_drafts'
              AND e.entity_id=p.id AND e.action='delete' WHERE p.project_id=? AND e.id=?`,projectId,rowId);
          break;
        case "approval":
        case "draft":
          approvalIds.push(...store.query<{id:string}>(`SELECT ap.id FROM project_approval_versions selected
            JOIN project_approval_versions ap ON ap.project_id=selected.project_id
            WHERE selected.project_id=? AND selected.id=? AND (ap.id=selected.id OR
              (selected.status='approved' AND ap.status='approved' AND ap.version_no=(
                SELECT MAX(p.version_no) FROM project_approval_versions p
                WHERE p.project_id=selected.project_id AND p.status='approved' AND p.version_no<selected.version_no)))
            ORDER BY ap.version_no`,projectId,rowId).map(row=>row.id));
          break;
        case "closure":
          result.closures = store.query(`SELECT c.*,ap.version_no approval_no
            FROM project_closures c JOIN project_approval_versions ap ON ap.id=c.approval_version_id
            WHERE c.project_id=? AND c.id=?`,projectId,rowId);
          break;
        case "cost": {
          const versions = store.query<CostVersion>(`SELECT v.*,n.name cost_node_name FROM cost_versions selected
            JOIN cost_entries c ON c.id=selected.entry_id JOIN cost_versions v ON v.entry_id=c.id
              AND v.version_no BETWEEN selected.version_no-1 AND selected.version_no
            JOIN project_cost_node_versions n ON n.id=v.cost_node_version_id
            WHERE c.project_id=? AND selected.id=? ORDER BY v.version_no`,projectId,rowId);
          result.costs = versions.length ? [{id:versions[0]!.entry_id,versions}] : [];
          break;
        }
        case "settlement": {
          const records = store.query<Identified & { settlement_id:string; number:string; version_no:number; amount_fen:number }>(
            `SELECT e.*,s.id settlement_id,s.number,v.version_no,v.amount_fen
             FROM settlement_review_events e JOIN settlement_versions v ON v.id=e.settlement_version_id
             JOIN settlements s ON s.id=v.settlement_id WHERE s.project_id=? AND e.id=?`,projectId,rowId);
          result.settlements = records.map(e=>({
            id:e.settlement_id,number:e.number,versions:[{version_no:e.version_no,amount_fen:e.amount_fen,events:[e]}],
          }));
          break;
        }
        case "node": {
          const versions=store.query<CostNodeVersion>(`SELECT v.* FROM project_cost_node_versions selected
            JOIN project_cost_nodes n ON n.id=selected.node_id JOIN project_cost_node_versions v ON v.node_id=n.id
              AND v.version_no BETWEEN selected.version_no-1 AND selected.version_no
            WHERE n.project_id=? AND selected.id=? ORDER BY v.version_no`,projectId,rowId);
          result.cost_nodes = versions.length ? [{id:versions[0]!.node_id,versions}] : [];
          break;
        }
        case "audit":
          result.audit = store.query("SELECT * FROM audit_events WHERE entity='projects' AND entity_id=? AND id=?",projectId,rowId);
          break;
      }
      return { records:result,approvalIds };
    },
    projectFullHistory(projectId: string) {
      const approvals = store.query<Approval>(
        "SELECT * FROM project_approval_versions WHERE project_id=? ORDER BY rowid", projectId);
      const approvalScopes = groupBy(store.query<ApprovedScope>(
        `SELECT scope.* FROM project_approval_scope_versions scope
         JOIN project_approval_versions approval ON approval.id=scope.approval_version_id
         WHERE approval.project_id=? ORDER BY scope.rowid`, projectId),
        "approval_version_id");
      const costs = store.query<Cost>(
        "SELECT * FROM cost_entries WHERE project_id=? ORDER BY rowid", projectId);
      const costVersions = groupBy(store.query<CostVersion>(
        `SELECT version.* FROM cost_versions version
         JOIN cost_entries entry ON entry.id=version.entry_id
         WHERE entry.project_id=? ORDER BY version.rowid`, projectId),
        "entry_id");
      const settlements = store.query<Settlement>(
        "SELECT * FROM settlements WHERE project_id=? ORDER BY rowid", projectId);
      const versions = store.query<SettlementVersion>(
        `SELECT v.* FROM settlement_versions v
         JOIN settlements doc ON doc.id=v.settlement_id
         WHERE doc.project_id=? ORDER BY v.rowid`, projectId);
      const items = groupBy(store.query<SettlementItem>(
        `SELECT item.* FROM settlement_item_versions item
         JOIN settlement_versions v ON v.id=item.settlement_version_id
         JOIN settlements doc ON doc.id=v.settlement_id
         WHERE doc.project_id=? ORDER BY item.rowid`, projectId), "settlement_version_id");
      const resolutions = groupBy(store.query<SettlementResolution>(
        `SELECT result.* FROM settlement_scope_results result
         JOIN settlement_versions v ON v.id=result.settlement_version_id
         JOIN settlements doc ON doc.id=v.settlement_id
         WHERE doc.project_id=? ORDER BY result.rowid`, projectId), "settlement_version_id");
      const events = groupBy(store.query<SettlementReviewEvent>(
        `SELECT event.* FROM settlement_review_events event
         JOIN settlement_versions v ON v.id=event.settlement_version_id
         JOIN settlements doc ON doc.id=v.settlement_id
         WHERE doc.project_id=? ORDER BY event.rowid`, projectId), "settlement_version_id");
      const settlementVersions = groupBy(versions.map(version=>({
        ...version,
        items:items.get(version.id) ?? [],
        resolutions:resolutions.get(version.id) ?? [],
        events:events.get(version.id) ?? [],
      })), "settlement_id");
      const nodes = store.query<CostNode>(
        "SELECT * FROM project_cost_nodes WHERE project_id=? ORDER BY rowid", projectId);
      const nodeVersions = groupBy(store.query<CostNodeVersion>(
        `SELECT version.* FROM project_cost_node_versions version
         JOIN project_cost_nodes node ON node.id=version.node_id
         WHERE node.project_id=? ORDER BY version.rowid`,projectId),"node_id");

      return {
        approvals:approvals.map(approval=>({
          ...approval,scopes:approvalScopes.get(approval.id) ?? [],
        })),
        costs:costs.map(cost=>({...cost, versions:costVersions.get(cost.id) ?? []})),
        settlements:settlements.map(doc=>({
          ...doc, versions:settlementVersions.get(doc.id) ?? [],
        })),
        profiles:store.query(
          `SELECT profile.*,category.name AS category_name,org.name AS organization_name,
            responsible.username AS owner_name,manager.username AS manager_name,
            (SELECT v.name FROM framework_versions v WHERE v.framework_id=profile.framework_id
              AND v.recorded_at<=profile.recorded_at ORDER BY v.version_no DESC LIMIT 1) AS framework_name
            FROM project_management_versions profile
            LEFT JOIN dictionary_item_versions category ON category.item_id=profile.category_id AND category.version=profile.category_version
            LEFT JOIN organizational_unit_versions org ON org.id=profile.managing_unit_version_id
            LEFT JOIN users responsible ON responsible.id=profile.owner_id
            LEFT JOIN users manager ON manager.id=profile.manager_id
            WHERE profile.project_id=? ORDER BY profile.version_no`, projectId),
        funding:store.query(
          `SELECT funding.*, (SELECT v.name FROM agreement_versions v WHERE v.agreement_id=funding.agreement_id
              AND v.recorded_at<=funding.recorded_at ORDER BY v.version_no DESC LIMIT 1) AS agreement_name
            FROM project_funding_versions funding WHERE funding.project_id=? ORDER BY funding.version_no`, projectId),
        stages:store.query(
          "SELECT * FROM project_stage_events WHERE project_id=? ORDER BY rowid", projectId),
        closures:store.query(
          "SELECT * FROM project_closures WHERE project_id=? ORDER BY rowid", projectId),
        cost_nodes:nodes.map(node=>({
          ...node,versions:nodeVersions.get(node.id) ?? [],
        })),
      };
    },
  };
}
export type ProjectHistoryRepository = ReturnType<typeof projectHistoryRepository>;

type EventKind = "profile" | "funding" | "stage" | "link" | "approval" | "draft" | "withdrawal" | "closure" | "cost" | "settlement" | "node" | "audit";
interface TimelineRow {
  entry_id: string;
  source: EventKind;
  row_id: string;
  title: string;
  category: HistoryPage["categories"][number];
  time: string | null;
  actor: string | null;
  summary: string | null;
  badge: string | null;
  tone: HistoryItem["tone"] | null;
  version: number | null;
  version_group: string | null;
}

const timelineSql = `
  WITH input AS (SELECT ? project),
  latest_approved AS (
    SELECT MAX(version_no) version FROM project_approval_versions
    WHERE project_id=(SELECT project FROM input) AND status='approved'
  ),
  events(entry_id,source,row_id,title,category,time,actor_id,summary,badge,tone,version,version_group,priority,tie) AS (
    SELECT '项目档案/'||version_no,'profile',id,IIF(version_no=1,'建立项目档案','修订项目档案'),
      '版本',recorded_at,actor_id,NULL,NULL,NULL,version_no,'项目档案',1,rowid
    FROM project_management_versions WHERE project_id=(SELECT project FROM input)
    UNION ALL
    SELECT '资金归属/'||version_no,'funding',id,IIF(version_no=1,'建立资金归属','修订资金归属'),
      '版本',recorded_at,actor_id,NULL,NULL,NULL,version_no,'资金归属',2,rowid
    FROM project_funding_versions WHERE project_id=(SELECT project FROM input)
    UNION ALL
    SELECT 'stage/'||id,'stage',id,'项目入库','办理',created_at,actor_id,NULL,NULL,NULL,NULL,NULL,3,rowid
    FROM project_stage_events WHERE project_id=(SELECT project FROM input) AND stage='stocked'
    UNION ALL
    SELECT 'link/'||event.id,'link',event.id,IIF(event.action='linked','承接专业需求','解除需求承接'),
      '关联',event.recorded_at,event.actor_id,d.demand_no,NULL,NULL,NULL,NULL,4,event.rowid
    FROM project_demand_scopes sc JOIN project_demand_link_events event ON event.project_scope_id=sc.id
    JOIN demands d ON d.id=sc.demand_id WHERE sc.project_id=(SELECT project FROM input)
    UNION ALL
    SELECT '项目批准/'||ap.version_no,'approval',ap.id,IIF(ap.version_no=1,'首次批准项目','批准项目变更'),
      '办理',ap.approved_at,ap.approved_by,'第 '||ap.version_no||' 版包含 '||
      (SELECT COUNT(*) FROM project_approval_scope_versions sc WHERE sc.approval_version_id=ap.id)||' 条批准需求',
      IIF(ap.version_no=(SELECT version FROM latest_approved),'当前生效',NULL),'success',ap.version_no,'项目批准',5,ap.rowid
    FROM project_approval_versions ap WHERE ap.project_id=(SELECT project FROM input) AND ap.status='approved'
    UNION ALL
    SELECT 'approval-withdrawal/'||e.id,'withdrawal',e.id,IIF(ap.version_no=1,'撤回立项草稿','撤回项目变更草稿'),
      '办理',e.created_at,e.actor_id,NULL,NULL,NULL,NULL,NULL,6,e.rowid
    FROM project_approval_versions ap JOIN audit_events e
      ON e.entity='approval_drafts' AND e.entity_id=ap.id AND e.action='delete'
    WHERE ap.project_id=(SELECT project FROM input) AND ap.status='withdrawn'
    UNION ALL
    SELECT 'draft/'||id,'draft',id,IIF(version_no=1,'编制立项草稿','编制项目变更草稿'),
      '办理',created_at,NULL,NULL,'尚未批准',NULL,NULL,NULL,7,rowid
    FROM project_approval_versions WHERE project_id=(SELECT project FROM input) AND status='draft'
    UNION ALL
    SELECT '结项结果','closure',id,'确认项目结项','办理',closed_at,closed_by,NULL,NULL,'success',NULL,NULL,8,rowid
    FROM project_closures WHERE project_id=(SELECT project FROM input)
    UNION ALL
    SELECT '实际费用/'||v.version_no||'/'||c.id,'cost',v.id,
      CASE WHEN v.status='voided' THEN '作废实际费用' WHEN v.version_no=1 THEN '核定实际费用' ELSE '更正实际费用' END,
      '金额',v.confirmed_at,v.confirmed_by,
      (SELECT last.title FROM cost_versions last WHERE last.entry_id=c.id ORDER BY last.version_no DESC LIMIT 1),
      IIF(v.version_no=(SELECT MAX(last.version_no) FROM cost_versions last WHERE last.entry_id=c.id),'当前正式版本',NULL),
      NULL,NULL,NULL,9,v.rowid
    FROM cost_entries c JOIN cost_versions v ON v.entry_id=c.id WHERE c.project_id=(SELECT project FROM input)
    UNION ALL
    SELECT 'settlement/'||e.id,'settlement',e.id,
      CASE e.action WHEN 'approve' THEN '批准结算' WHEN 'return' THEN '退回结算申请' WHEN 'reject' THEN '驳回结算申请'
        ELSE IIF(e.event_seq=1,'提交结算审核','原版本重新送审') END,
      '金额',e.recorded_at,e.actor_id,'结算单 '||s.number||' 的第 '||v.version_no||' 版',NULL,NULL,NULL,NULL,10,e.rowid
    FROM settlements s JOIN settlement_versions v ON v.settlement_id=s.id
    JOIN settlement_review_events e ON e.settlement_version_id=v.id WHERE s.project_id=(SELECT project FROM input)
    UNION ALL
    SELECT '费用科目/'||v.version_no||'/'||n.id,'node',v.id,IIF(v.version_no=1,'建立费用科目','修订费用科目'),
      '版本',v.recorded_at,v.actor_id,
      (SELECT last.name FROM project_cost_node_versions last WHERE last.node_id=n.id ORDER BY last.version_no DESC LIMIT 1),
      NULL,NULL,NULL,NULL,11,v.rowid
    FROM project_cost_nodes n JOIN project_cost_node_versions v ON v.node_id=n.id WHERE n.project_id=(SELECT project FROM input)
    UNION ALL
    SELECT 'audit/'||id,'audit',id,'删除子项目','办理',created_at,actor_id,NULL,'','warning',NULL,NULL,12,rowid
    FROM audit_events WHERE entity='projects' AND entity_id=(SELECT project FROM input) AND action='delete'
  ),
  named AS (
    SELECT events.*, CASE WHEN actor_id IS NOT NULL THEN COALESCE(u.username,'历史账户（名称未记载）') END actor
    FROM events LEFT JOIN users u ON u.id=events.actor_id
  )`;
const timelineOrder = "time DESC,priority DESC,tie DESC,entry_id DESC";
const summarizeEvent = (row:TimelineRow): HistoryItem => ({
  id:row.entry_id,title:row.title,category:row.category,time:row.time,
  actor:row.actor ?? undefined,summary:row.summary ?? undefined,badge:row.badge || undefined,tone:row.tone ?? undefined,
  version:row.version ?? undefined,versionGroup:row.version_group ?? undefined,
});

// Only small event headers participate in SQL filtering, counting and paging.
function timeline(store:Store, projectId:string, query:HistoryQuery, pageSize:number) {
  const filters = `, filtered AS (
    SELECT *, row_number() OVER (ORDER BY ${timelineOrder}) number FROM named
    WHERE (? IS NULL OR category=?)
      AND (? IS NULL OR instr(lower(actor),lower(?))>0)
      AND (? IS NULL OR date(time,'+8 hours')>=?)
      AND (? IS NULL OR date(time,'+8 hours')<=?)
  )`;
  const bindings = [projectId,query.category ?? null,query.category ?? null,query.actor ?? null,query.actor ?? null,
    query.start ?? null,query.start ?? null,query.end ?? null,query.end ?? null];
  const counts = store.query<{total:number; selected:number|null}>(`${timelineSql}${filters}
    SELECT COUNT(*) total,MAX(CASE WHEN entry_id=? THEN number END) selected FROM filtered`,
    ...bindings,query.entry ?? null)[0]!;
  const page = counts.selected ? Math.floor((counts.selected - 1)/pageSize)+1
    : Math.max(1,Math.min(query.page,Math.ceil(counts.total/pageSize)));
  const window = store.query<TimelineRow>(`${timelineSql}${filters}
    SELECT * FROM filtered WHERE number BETWEEN ? AND ? ORDER BY number`,
    ...bindings,(page-1)*pageSize+1,page*pageSize);
  const categories = store.query<{category:TimelineRow["category"]}>(`${timelineSql}
    SELECT DISTINCT category FROM events ORDER BY category`,projectId).map(row=>row.category);
  const versions = store.query<TimelineRow>(`${timelineSql}
    SELECT * FROM named WHERE version IS NOT NULL ORDER BY ${timelineOrder}`, projectId)
    .map(({entry_id,title,version,version_group,badge})=>({
      id:entry_id,title,version:version ?? undefined,versionGroup:version_group ?? undefined,badge:badge || undefined,
    }));
  return { total:counts.total,page,categories,versions,items:window.map(summarizeEvent),
    selection:window.find(row=>row.entry_id===query.entry) ?? window[0] };
}

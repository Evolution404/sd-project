import type { SettlementItemFact } from "../../shared/types/finance-workflows.js";
import type { createStore } from "./store.js";
import type {
  CostCategoryNode,
  OrganizationNode,
  CategoryCost,
  NodeVersion,
  OrganizationDetail,
  TreeAudit,
} from "../../shared/types/trees.js";
import { integer } from "../../shared/errors/business-error.js";
import { PROJECT_DISPLAY_STATUS_SQL } from "../queries/project-status-sql.js";

export function hierarchyRepository(store: ReturnType<typeof createStore>) {
  const costRowsSql = `SELECT c.*, e.cost_node_id, adopted.name AS cost_node_name,
    EXISTS(SELECT 1 FROM audit_events a WHERE a.entity='costs' AND a.entity_id=c.entry_id AND a.action='delete') AS deleted
    FROM v_cost_current c JOIN cost_entries e ON e.id=c.entry_id
    JOIN project_cost_node_versions adopted ON adopted.id=c.cost_node_version_id`;
  return {
    projectExists: (id: string, includeDeleted = false): boolean =>
      Boolean(
        store.get(
          "SELECT p.id FROM projects p WHERE p.id=? AND (? OR NOT EXISTS(SELECT 1 FROM audit_events a WHERE a.entity='projects' AND a.entity_id=p.id AND a.action='delete'))",
          id,
          Number(includeDeleted),
        ),
      ),
    costNodeExists(projectId: string, nodeId: string): boolean {
      return Boolean(
        store.get(
          "SELECT id FROM project_cost_nodes WHERE project_id=? AND id=?",
          projectId,
          nodeId,
        ),
      );
    },
    organizationExists(id: string): boolean {
      return Boolean(
        store.get("SELECT id FROM organizational_units WHERE id=?", id),
      );
    },
    organizationProjectCount(ids: string[]): number {
      return Number(store.get(
        "SELECT COUNT(*) AS total FROM v_project_management_current m WHERE m.managing_unit_id IN (SELECT value FROM json_each(?)) AND NOT EXISTS(SELECT 1 FROM audit_events a WHERE a.entity='projects' AND a.entity_id=m.project_id AND a.action='delete')",
        JSON.stringify(ids),
      )?.total ?? 0);
    },
    costTree(projectId: string): CostCategoryNode[] {
      const rows = store.query(
        `WITH RECURSIVE descendants(ancestor,id) AS (
        SELECT id,id FROM project_cost_nodes WHERE project_id=?
        UNION SELECT d.ancestor,n.id FROM descendants d JOIN project_cost_nodes n ON n.parent_id=d.id WHERE n.project_id=?
      ), direct_cost AS (
        SELECT e.cost_node_id,SUM(c.amount_fen) amount FROM v_cost_current c JOIN cost_entries e ON e.id=c.entry_id
        WHERE e.project_id=? AND c.status='active' AND NOT EXISTS(SELECT 1 FROM audit_events a
          WHERE a.entity='costs' AND a.entity_id=c.entry_id AND a.action='delete') GROUP BY e.cost_node_id
      ), direct_settlement AS (
        SELECT item.cost_node_id,SUM(v.amount_fen) amount FROM v_settlement_effective_versions s
        JOIN settlement_item_versions v ON v.settlement_version_id=s.id
        JOIN settlement_items item ON item.id=v.settlement_item_id
        WHERE s.project_id=? AND s.change_type<>'void' AND NOT EXISTS(SELECT 1 FROM audit_events a
          WHERE a.entity='settlements' AND a.entity_id=s.settlement_id AND a.action='delete') GROUP BY item.cost_node_id
      ) SELECT n.*, definition.name,definition.status,definition.version_no,
        definition.id AS current_version_id,definition.recorded_at,
        EXISTS(SELECT 1 FROM audit_events a WHERE a.entity='cost_nodes' AND a.entity_id=n.id AND a.action='delete') AS deleted,
        COALESCE(own.amount,0) AS direct_cost_fen,
        (SELECT COALESCE(SUM(c.amount),0) FROM descendants d LEFT JOIN direct_cost c ON c.cost_node_id=d.id WHERE d.ancestor=n.id) AS actual_cost_fen,
        (SELECT COALESCE(SUM(s.amount),0) FROM descendants d LEFT JOIN direct_settlement s ON s.cost_node_id=d.id WHERE d.ancestor=n.id) AS settlement_fen,
        (SELECT COUNT(*) FROM project_cost_nodes child WHERE child.parent_id=n.id) AS child_count,
        (SELECT COUNT(*) FROM descendants d WHERE d.ancestor=n.id AND NOT EXISTS(SELECT 1 FROM project_cost_nodes child WHERE child.parent_id=d.id)) AS leaf_count,
        ((SELECT COUNT(*) FROM cost_entries e WHERE e.cost_node_id=n.id)+(SELECT COUNT(*) FROM settlement_items i WHERE i.cost_node_id=n.id)) AS reference_count,
        NOT EXISTS(SELECT 1 FROM descendants d JOIN v_project_cost_node_current parent ON parent.id=d.ancestor
          WHERE d.id=n.id AND (parent.status<>'active' OR EXISTS(SELECT 1 FROM audit_events a
            WHERE a.entity='cost_nodes' AND a.entity_id=parent.id AND a.action='delete'))) AS enabled_path
        FROM project_cost_nodes n JOIN v_project_cost_node_current current ON current.id=n.id
        JOIN project_cost_node_versions definition ON definition.id=current.current_version_id
        LEFT JOIN direct_cost own ON own.cost_node_id=n.id WHERE n.project_id=? ORDER BY n.created_at,n.id`,
        projectId,
        projectId,
        projectId,
        projectId,
        projectId,
      ) as (CostCategoryNode & { enabled_path: number })[];
      return rows.map((row) => {
        for (const key of [
          "direct_cost_fen",
          "actual_cost_fen",
          "settlement_fen",
        ] as const)
          integer(row[key], "费用汇总金额");
        const { enabled_path, ...node } = row;
        return {
          ...node,
          deleted: Boolean(node.deleted),
          selectable: Boolean(enabled_path && !node.child_count),
          can_add_child: Boolean(enabled_path && !node.reference_count),
          disabled_reason: !enabled_path ? "本科目或上级已停用、删除" : "",
        };
      });
    },
    categoryDetail(projectId: string, nodeId: string, page = 1) {
      const descendants = `WITH RECURSIVE subtree(id) AS (SELECT id FROM project_cost_nodes WHERE project_id=? AND id=?
        UNION SELECT n.id FROM project_cost_nodes n JOIN subtree s ON n.parent_id=s.id WHERE n.project_id=?) `;
      const parameters = [projectId, nodeId, projectId];
      const predicate =
        " WHERE c.project_id=? AND e.cost_node_id IN (SELECT id FROM subtree)";
      const total = Number(store.get(
        descendants +
          "SELECT COUNT(*) AS total FROM v_cost_current c JOIN cost_entries e ON e.id=c.entry_id" +
          predicate,
        ...parameters,
        projectId,
      )?.total ?? 0);
      const items = store.query(
        descendants +
          costRowsSql +
          predicate +
          " ORDER BY c.confirmed_at DESC,c.id LIMIT 30 OFFSET ?",
        ...parameters,
        projectId,
        (page - 1) * 30,
      ) as CategoryCost[];
      return {
        items: items.map((row) => ({ ...row, deleted: Boolean(row.deleted) })),
        total,
        page,
        page_size: 30,
        versions: store.query(
          "SELECT v.*,u.username AS actor_name FROM project_cost_node_versions v JOIN users u ON u.id=v.actor_id WHERE v.node_id=? ORDER BY v.version_no DESC",
          nodeId,
        ) as NodeVersion[],
        audits: store.query(
          "SELECT a.*,u.username AS actor_name FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id WHERE a.entity='cost_nodes' AND a.entity_id=? ORDER BY a.created_at DESC,a.id",
          nodeId,
        ) as TreeAudit[],
      };
    },
    settlementItems(versionId: string): SettlementItemFact[] {
      return store.query<SettlementItemFact>(
        "SELECT i.*,v.*,adopted.name AS cost_node_name FROM settlement_items i JOIN settlement_item_versions v ON v.settlement_item_id=i.id JOIN project_cost_node_versions adopted ON adopted.id=v.cost_node_version_id WHERE v.settlement_version_id=? ORDER BY i.id",
        versionId,
      );
    },
    costs(projectId: string, includeDeleted: boolean) {
      return (
        store.query(
          costRowsSql + " WHERE c.project_id=? ORDER BY c.confirmed_at,c.id",
          projectId,
        ) as CategoryCost[]
      )
        .map((row) => ({ ...row, deleted: Boolean(row.deleted) }))
        .filter((row) => includeDeleted || !row.deleted);
    },
    organizations(): OrganizationNode[] {
      return (
        store.query(`SELECT v.*,v.parent_unit_id AS parent_id,
        EXISTS(SELECT 1 FROM audit_events a WHERE a.entity='organizations' AND a.entity_id=v.id AND a.action='delete') AS deleted
        FROM v_organizational_unit_current v ORDER BY v.name,v.id`) as OrganizationNode[]
      ).map((row) => ({
        ...row,
        deleted: Boolean(row.deleted),
        selectable: row.status === "active" && !row.deleted,
        disabled_reason: row.deleted
          ? "单位已删除，仅供历史查看"
          : row.status !== "active"
            ? "单位已停用"
            : "",
      }));
    },
    organizationDetail(id: string): OrganizationDetail {
      const projects = store.query(
        `SELECT p.id,p.code,p.status,${PROJECT_DISPLAY_STATUS_SQL} AS display_status,m.name,adopted.name AS adopted_name,
        adopted.version_no AS adopted_version FROM v_project_management_current m JOIN projects p ON p.id=m.project_id
        JOIN organizational_unit_versions adopted ON adopted.id=m.managing_unit_version_id
        WHERE m.managing_unit_id=? AND NOT EXISTS(SELECT 1 FROM audit_events a
          WHERE a.entity='projects' AND a.entity_id=p.id AND a.action='delete') ORDER BY m.name,p.id`,
        id,
      ) as OrganizationDetail["projects"];
      const versions = store.query(
        `WITH RECURSIVE history AS (
        SELECT v.*,(SELECT a.rowid FROM audit_events a WHERE a.entity='organizations' AND a.entity_id=v.unit_id
          AND json_extract(a.after_json,'$.unit_version_id')=v.id ORDER BY a.rowid LIMIT 1) AS audit_order
        FROM organizational_unit_versions v
      ), ancestry(version_id,unit_id,name,parent_id,snapshot_order,depth,visited) AS (
        SELECT id,unit_id,name,parent_unit_id,audit_order,0,'|'||unit_id||'|' FROM history WHERE unit_id=?
        UNION ALL SELECT child.version_id,parent.unit_id,parent.name,parent.parent_unit_id,child.snapshot_order,
          child.depth+1,child.visited||parent.unit_id||'|' FROM ancestry child JOIN history parent ON parent.unit_id=child.parent_id
        WHERE parent.audit_order=(SELECT MAX(candidate.audit_order) FROM history candidate
          WHERE candidate.unit_id=child.parent_id AND candidate.audit_order<=child.snapshot_order)
          AND instr(child.visited,'|'||parent.unit_id||'|')=0
      ) SELECT v.*,u.username AS actor_name,
        (SELECT name FROM ancestry WHERE version_id=v.id AND depth=1) AS parent_name,
        (SELECT GROUP_CONCAT(name,' / ') FROM (SELECT name FROM ancestry WHERE version_id=v.id ORDER BY depth DESC)) AS historical_path,
        (SELECT parent_id IS NULL FROM ancestry WHERE version_id=v.id ORDER BY depth DESC LIMIT 1) AS path_complete
        FROM organizational_unit_versions v JOIN users u ON u.id=v.actor_id WHERE v.unit_id=? ORDER BY v.version_no DESC`,
        id,
        id,
      ) as NodeVersion[];
      const counts = store.get(
        `SELECT
        (SELECT COUNT(*) FROM v_organizational_unit_current child WHERE child.parent_unit_id=?) AS children,
        (SELECT COUNT(*) FROM project_management_versions m WHERE m.managing_unit_id=?) AS historical_projects`,
        id,
        id,
      ) as { children: number; historical_projects: number };
      const audits = store.query(
        "SELECT a.*,u.username AS actor_name FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id WHERE a.entity='organizations' AND a.entity_id=? ORDER BY a.created_at DESC,a.id",
        id,
      ) as TreeAudit[];
      return {
        projects,
        versions,
        audits,
        references: { ...counts, projects: projects.length },
      };
    },
  };
}
export type HierarchyRepository = ReturnType<typeof hierarchyRepository>;

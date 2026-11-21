import type { createProjects } from "../projects/service.js";
import type { HistoryEntry } from "../../shared/types/history.js";
import { document, event, facts, label, lifecycle, money, percent, quantity, readVersions,
  rows, string, table, text } from "./core.js";
import { actualCostHistory } from "./finance.js";

type Projects = ReturnType<typeof createProjects>;
type Approval = ReturnType<Projects["approvalHistory"]>[number];
type Detail = ReturnType<Projects["historyDetail"]>;
type Scope = Approval["scopes"][number];

function approvedTables(scopes: Scope[]) {
  const definitions = new Map(scopes.map(scope => [scope.project_scope_id, document(scope.snapshot_json)]));
  return [
    ...table("批准需求范围", ["需求编号", "作业内容", "采用版本", "批准工作量"], scopes.map(scope => {
      const snapshot = definitions.get(scope.project_scope_id)!;
      return [scope.demand_no, text(snapshot.problem_description),
        `第 ${scope.demand_version} 版`, quantity(scope.quantity_scaled, string(snapshot.unit_snapshot))];
    }), scopes.map(scope => scope.project_scope_id)),
    ...table("批准作业位置", ["需求编号", "作业位置", "批准工作量"], scopes.flatMap(scope => {
      const snapshot = definitions.get(scope.project_scope_id)!;
      return scope.locations.map(location => {
        const detail = document(location.frozen_location);
        return [scope.demand_no, text(detail.location_label ?? detail.tower_no),
          quantity(location.approved_quantity_scaled, string(snapshot.unit_snapshot))];
      });
    }), scopes.flatMap(scope => scope.locations.map(location =>
      `${scope.project_scope_id}/${location.location_kind}/${location.location_object}`))),
    ...table("批准物资", ["需求编号", "物资", "批准数量"], scopes.flatMap(scope => scope.materials.map(material => [
      scope.demand_no, material.material_name, quantity(material.approved_quantity_scaled, material.unit_snapshot),
    ])), scopes.flatMap(scope => scope.materials.map(material => `${scope.project_scope_id}/${material.material_id}`))),
  ];
}

export function projectHistoryDetail(id: string, { records: raw, approvals }: Detail): HistoryEntry[] {
  const approved = approvals.filter(approval => approval.status === "approved");
  const currentApproval = approved.at(-1);
  const profileVersions = rows(raw.profiles);
  const entries: HistoryEntry[] = readVersions(profileVersions, "项目档案", row => facts(
    ["项目名称", text(row.name)], ["年度框架", text(row.framework_name)], ["项目类别", text(row.category_name)],
    ["归口单位", text(row.organization_name)], ["项目负责人", text(row.owner_name)], ["项目管理人员", text(row.manager_name)],
    ["计划开始日期", text(row.planned_start_on)], ["计划结束日期", text(row.planned_end_on)],
    ["初步估算", money(row.preliminary_estimate_fen)], ["估算依据", text(row.preliminary_estimate_basis)],
  ));
  entries.push(...readVersions(rows(raw.funding), "资金归属", row => facts(
    ["归属方式", row.agreement_id ? "执行协议承接" : "直接归属年度框架"],
    ["执行协议", text(row.agreement_name)],
  ), row => ({
    links: string(row.agreement_id) ? [{
      label: "查看执行协议历史", target: { kind: "agreements", id: String(row.agreement_id) },
    }] : [],
  })));
  for (const row of rows(raw.stages)) {
    if (row.stage === "stocked") entries.push(event(`stage/${row.id}`, "项目入库", "办理", row, {
      facts: facts(["项目状态", "已入库"]),
    }));
  }
  for (const row of rows(raw.links)) {
    const linked = row.action === "linked";
    const demandId = string(row.demand_id);
    entries.push(event(`link/${row.id}`, linked ? "承接专业需求" : "解除需求承接", "关联", row, {
      summary: string(row.demand_no), facts: facts(["需求编号", text(row.demand_no)]),
      links: demandId ? [{ label: "查看专业需求", target: { kind: "demands", id: demandId } }] : [],
    }));
  }
  for (const [index, approval] of approved.entries()) {
    const previous = approved[index - 1];
    const currentScopes = new Map(approval.scopes.map(scope => [scope.project_scope_id, scope]));
    const oldScopes = new Map(previous?.scopes.map(scope => [scope.project_scope_id, scope]));
    const changes = [
      ...approval.scopes.flatMap(scope => {
        const old = oldScopes.get(scope.project_scope_id);
        if (!old) return [[scope.demand_no, "纳入范围", null, `第 ${scope.demand_version} 版`]];
        return old.demand_version !== scope.demand_version || old.quantity_scaled !== scope.quantity_scaled
          ? [[scope.demand_no, "采用新版需求", `第 ${old.demand_version} 版`, `第 ${scope.demand_version} 版`]] : [];
      }),
      ...(previous?.scopes || []).filter(scope => !currentScopes.has(scope.project_scope_id)).map(scope =>
        [scope.demand_no, "移出范围", `第 ${scope.demand_version} 版`, null]),
    ];
    const basis = document(approval.snapshot_json);
    entries.push(event(`项目批准/${approval.version_no}`, previous ? "批准项目变更" : "首次批准项目", "办理", {}, {
      time: approval.approved_at, actor: approval.approved_by ?? undefined, tone: "success",
      summary: `第 ${approval.version_no} 版 · ${approval.scopes.length} 条批准需求`,
      badge: approval === currentApproval ? "当前生效" : undefined,
      versionGroup: "项目批准", version: approval.version_no,
      reason: string(approval.change_reason ?? basis.basis),
      facts: facts(["批准预算", money(approval.approved_budget_fen)],
        ["批准需求数", approval.scopes.length], ["批准依据", text(basis.basis)],
        ["参考报价", approval.reference.complete ? money(approval.reference.total_fen) : "未完整计价"],
        ["已计价小计", !approval.reference.complete ? money(approval.reference.subtotal_fen) : null]),
      changes: previous && previous.approved_budget_fen !== approval.approved_budget_fen ? [
        { label: "批准预算", before: money(previous.approved_budget_fen), after: money(approval.approved_budget_fen) },
      ] : undefined,
      tables: [...table("本次范围变化", ["需求编号", "变化", "原采用版本", "新采用版本"], changes)
        .map(details => ({ ...details, compare: false as const })),
        ...approvedTables(approval.scopes)],
      links: approval.scopes.map(scope => ({ label: `查看 ${scope.demand_no} 第 ${scope.demand_version} 版`,
        target: { kind: "demands", id: scope.demand_id, entry: `需求/${scope.demand_version}` } })),
    }));
  }
  for (const withdrawal of rows(raw.withdrawals)) {
    entries.push(event(`approval-withdrawal/${withdrawal.id}`,
      withdrawal.version_no === 1 ? "撤回立项草稿" : "撤回项目变更草稿", "办理", withdrawal, {
        facts: facts(["原拟申请预算", money(withdrawal.approved_budget_fen)]),
      }));
  }
  for (const approval of approvals) {
    if (approval.status === "draft") entries.push(event(`draft/${approval.id}`, approval.version_no === 1
      ? "编制立项草稿" : "编制项目变更草稿", "办理", {}, {
      time: approval.created_at, badge: "尚未批准",
      facts: facts(["拟申请预算", money(approval.approved_budget_fen)], ["范围内需求数",
        approval.scopes.length + approval.pending_scopes.length]),
      tables: approvedTables(approval.scopes),
    }));
  }
  for (const record of rows(raw.closures)) {
    const snapshot = document(record.close_snapshot_json);
    entries.push(event("结项结果", "确认项目结项", "办理", record, {
      time: string(record.closed_at) ?? null, actor: string(record.closed_by), tone: "success",
      facts: facts(["实际费用", money(snapshot.actual_cost_fen)], ["已批准结算", money(snapshot.settlement_fen)],
        ["结算进度", percent(snapshot.settlement_progress_percent) ?? "待核定费用基数"],
        ["预算差额", money(snapshot.budget_difference_fen)], ["超结算差额", money(snapshot.excess_settlement_fen)],
        ["待核对费用", money(snapshot.unreconciled_cost_fen)]),
      tables: table("结项时需求解决情况", ["需求编号", "已解决工作量", "未解决工作量", "超出批准工作量"], rows(snapshot.demands).map(demand => [
        text(demand.demand_no), quantity(demand.resolved_quantity_scaled, string(demand.unit)),
        quantity(demand.remaining_quantity_scaled, string(demand.unit)), quantity(demand.excess_quantity_scaled, string(demand.unit)),
      ])),
      links: record.approval_no ? [{
        label: "查看结项采用的批准版本", target: {
          kind: "projects", id, entry: `项目批准/${record.approval_no}`,
        },
      }] : [],
    }));
  }
  for (const cost of rows(raw.costs)) {
    const costId = string(cost.id);
    if (!costId) continue;
    const projected = actualCostHistory(cost.versions, costId);
    entries.push(...projected.entries.map(entry => ({
      ...entry, version: undefined, versionGroup: undefined, category: "金额" as const, summary: projected.name,
      links: [{ label: "查看该费用的正式版本", target: { kind: "costs" as const, id: costId, project: id, entry: entry.id } }],
    })));
  }
  for (const settlement of rows(raw.settlements)) {
    const settlementId = string(settlement.id);
    if (!settlementId) continue;
    for (const version of rows(settlement.versions)) {
      for (const row of rows(version.events)) {
        const initial = row.event_seq === 1;
        const title = row.action === "approve" ? "批准结算" : row.action === "return" ? "退回结算申请"
          : row.action === "reject" ? "驳回结算申请" : initial ? "提交结算审核" : "原版本重新送审";
        entries.push(event(`settlement/${row.id}`, title, "金额", row, {
          summary: `结算单 ${settlement.number} · 第 ${version.version_no} 版`,
          facts: facts(["本期申请金额", money(version.amount_fen)]),
          links: [{ label: "查看结算单历史", target: { kind: "settlements", id: settlementId, project: id,
            entry: initial ? `结算单/${version.version_no}` : `review/${row.id}` } }],
        }));
      }
    }
  }
  for (const node of rows(raw.cost_nodes)) {
    const nodeId = string(node.id);
    if (!nodeId) continue;
    const title = string(rows(node.versions).at(-1)?.name) ?? "费用科目";
    entries.push(...readVersions(rows(node.versions), "费用科目", row => facts(
      ["科目名称", text(row.name)], ["状态", label(row.status, lifecycle)],
    )).map(entry => ({
      ...entry, id: `${entry.id}/${nodeId}`, version: undefined, versionGroup: undefined,
      summary: title, links: [{ label: "查看费用科目历史", target: { kind: "cost_nodes" as const, id: nodeId, project: id, entry: entry.id } }],
    })));
  }
  return entries;
}

import type { SettlementWorkflow } from "../../shared/types/finance-workflows.js";
import { settlementModeLabels, settlementStatusLabels } from "../../shared/types/finance-workflows.js";
import type { HistoryEntry, HistoryLink } from "../../shared/types/history.js";
import { event, facts, label, lifecycle, money, number, quantity, readVersions, rows, string, table, text,
  type HistoryRecord, type ReadRow } from "./core.js";

const reviewLabels = { submit: "提交结算审核", approve: "批准结算", return: "退回结算申请", reject: "驳回结算申请" };

export function settlementHistory(workflow: SettlementWorkflow, history: unknown): HistoryRecord {
  const versions = rows(history);
  const latest = versions.at(-1);
  const effective = versions.findLast(version => rows(version.events).at(-1)?.action === "approve");
  const entries: HistoryEntry[] = [];
  let effectiveBefore = 0;
  for (const version of versions) {
    const events = rows(version.events);
    const amount = number(version.amount_fen) ?? 0;
    const labelVersion = `第 ${version.version_no} 版`;
    const details = rows(version.items);
    const resolutions = rows(version.resolutions);
    const tables = [
      ...table("子费用结算明细", ["子费用", "对应需求", "结算金额", "依据"], details.map(line => [
        text(line.cost_node_name), text(line.demand_no), money(line.amount_fen), text(line.evidence),
      ]), details.map(line => String(line.settlement_item_id))),
      ...table("本期需求解决量", ["需求编号", "本期解决量", "依据"], resolutions.map(line => [
        text(line.demand_no), quantity(line.resolved_quantity_scaled, string(line.adopted_unit)), text(line.evidence),
      ]), resolutions.map(line => String(line.project_scope_id))),
    ];
    const links: HistoryLink[] = [
      ...((workflow.project_id && version.approved_project_version) ? [{
        label: `查看项目批准第 ${version.approved_project_version} 版`,
        target: { kind: "projects" as const, id: workflow.project_id,
          entry: `项目批准/${version.approved_project_version}` },
      }] : []),
      ...resolutions.flatMap(line => {
        const id = string(line.demand_id);
        return id ? [{ label: `查看需求 ${line.demand_no} 第 ${line.demand_version} 版`,
          target: { kind: "demands" as const, id, entry: `需求/${line.demand_version}` } }] : [];
      }),
    ];
    const versionFacts = facts(["结算方式", label(version.mode, settlementModeLabels)],
      ["申请金额", money(amount)], ["结算日期", text(version.settlement_on)],
      ["结算依据", text(version.basis)]);
    for (const [index, review] of events.entries()) {
      const approved = review.action === "approve";
      const current = version === effective && approved;
      const resultingAmount = approved ? amount : effectiveBefore;
      const title = review.action === "submit" && index > 0 ? "原版本重新送审"
        : version.change_type === "void" && approved ? "批准注销结算"
          : String(label(review.action, reviewLabels));
      entries.push(event(index === 0 ? `结算单/${version.version_no}` : `review/${review.id}`, title,
        approved ? "金额" : "办理", review, {
          summary: `${labelVersion}，结算方式：${label(version.mode, settlementModeLabels)}`,
          badge: current ? "当前生效"
            : version === latest && review === events.at(-1) ? settlementStatusLabels[workflow.status] : undefined,
          tone: approved ? "success" : review.action === "return" ? "warning" : "info",
          ...(index === 0 ? { version: number(version.version_no), versionGroup: "结算单" } : {}),
          reason: string(review.reason) ?? string(version.reason),
          facts: [...versionFacts,
            ...facts([approved ? "批准前生效金额" : "当时生效金额", money(effectiveBefore)],
              ...(approved ? [
                ["批准后生效金额", money(resultingAmount)],
                ["对项目已批准结算的净影响", money(resultingAmount - effectiveBefore)],
                ["生效日期", text(review.effective_on)],
              ] as Parameters<typeof facts> : [])),
          ],
          changes: approved ? [{
            label: "本单生效金额", before: money(effectiveBefore), after: money(resultingAmount),
          } ] : undefined,
          tables, links,
        }));
      if (approved) effectiveBefore = resultingAmount;
    }
    if (!events.length) entries.push(event(`结算单/${version.version_no}`, "登记结算版本", "版本", version, {
      version: number(version.version_no), versionGroup: "结算单", facts: versionFacts, tables, links,
    }));
  }
  const draft = workflow.draft;
  if (draft) {
    entries.push(event("current-draft", effective ? "编制结算修订草稿" : "编制结算草稿", "办理", {
      recorded_at: draft.updated_at, actor_id: draft.updated_by,
    }, {
      badge: "尚未提交", facts: facts(["结算方式", label(draft.document.mode, settlementModeLabels)],
        ["草稿金额", money(draft.document.amount_fen)], ["当前生效金额", money(workflow.effective_amount_fen)]),
    }));
  }
  return { name: `结算单 ${workflow.number}`, status: settlementStatusLabels[workflow.status],
    context: facts(["当前生效版本", effective ? `第 ${effective.version_no} 版` : "尚未批准"],
      ["当前生效金额", money(workflow.effective_amount_fen)],
      ["最近提交版本", latest ? `第 ${latest.version_no} 版` : "尚未提交"]),
    entries,
  };
}

export function actualCostHistory(input: unknown, id: string): HistoryRecord {
  const versions = rows(input);
  const current = versions.at(-1);
  const entries = readVersions(versions, "实际费用", row => facts(
    ["费用事项", text(row.title)], ["采用科目", text(row.cost_node_name)], ["发生日期", text(row.occurred_on)],
    ["金额", money(row.amount_fen)], ["计入实际费用", money(row.status === "voided" ? 0 : row.amount_fen)],
    ["票据编号", text(row.invoice_number)], ["核定依据", text(row.evidence)], ["状态", label(row.status, lifecycle)],
  ), (row, previous) => ({
    title: row.status === "voided" ? "作废实际费用" : previous ? "更正实际费用" : "核定实际费用",
    time: string(row.confirmed_at) ?? null, actor: string(row.confirmed_by),
    badge: row === current ? "当前正式版本" : undefined,
  }));
  return { name: string(current?.title) ?? "实际费用", status: current?.status === "voided" ? "已作废" : undefined,
    context: facts(["当前计入实际费用", current ? money(current.status === "voided" ? 0 : current.amount_fen) : null]),
    entries: entries.map(entry => ({ ...entry, id: `${entry.id}/${id}` })) };
}

export function reconciliationHistory(input: unknown): HistoryRecord {
  const versions = rows(input);
  const current = versions.at(-1);
  return { name: string(current?.cost_title) ? `费用核对：${current?.cost_title}` : "费用核对",
    entries: readVersions(versions, "核对", row => facts(
      ["费用事项", text(row.cost_title)], ["结算编号", text(row.settlement_number)],
      ["实际费用份额", money(row.reconciled_cost_fen)], ["核对结算金额", money(row.reconciled_settlement_fen)],
      ["核对结果", row.status === "voided" ? "已撤销" : row.is_final ? "最终核对" : "部分核对"],
      ["核对依据", text(row.evidence)],
    ), (row, previous) => ({
      title: row.status === "voided" ? "撤销费用核对" : previous ? "更正费用核对" : "确认费用核对",
      badge: row === current ? "当前正式版本" : undefined,
      links: reconciliationLinks(row),
    })),
  };
}

function reconciliationLinks(row: ReadRow): HistoryLink[] {
  const cost = string(row.entry_id);
  const project = string(row.project_id);
  const settlement = string(row.settlement_id);
  return [
    ...(cost && project ? [{ label: "核对采用的费用版本", target: {
      kind: "costs" as const, id: cost, project, entry: `实际费用/${row.cost_version}/${cost}`,
    } }] : []),
    ...(settlement ? [{ label: "核对采用的结算版本", target: {
      kind: "settlements" as const, id: settlement, project, entry: `结算单/${row.settlement_version}`,
    } }] : []),
  ];
}

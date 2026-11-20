import type { HistoryFact, HistoryLink, HistoryTable, HistoryValue } from "../../shared/types/history.js";
import type { createDemands } from "../demands/service.js";
import { differences, document, event, facts, feeName, json, label, methods, money, number, pricingModels,
  quantity, readVersions, record, rows, string, table, text, type HistoryRecord, type ReadRow } from "./core.js";

const statuses = { pending: "待确认", active: "待承接", returned: "已退回", cancelled: "已取消" };
const decisions = { pending: "提交需求", active: "确认需求", returned: "退回需求", cancelled: "取消需求" };

function attributeValues(value: unknown, definitions: ReadRow[]) {
  return definitions.flatMap(definition => {
    const name = string(definition.label);
    const key = string(definition.key);
    if (!name || !key || !Object.hasOwn(record(value), key)) return [];
    const selected = record(value)[key];
    const format = (value: unknown): HistoryValue => {
      if (typeof value === "boolean") return value ? "是" : "否";
      const option = rows(definition.options).find(option => option.value === value);
      return text(option?.label ?? value);
    };
    return [{ label: name, value: Array.isArray(selected)
      ? selected.map(format).filter(item => item != null).join("、") : format(selected) }];
  });
}

function locationLabel(location: unknown): HistoryValue {
  const snapshot = document(record(location).location_snapshot_json);
  return text(snapshot.location_label ?? snapshot.tower_no) ?? "原位置名称未记载";
}

function workLocations(snapshot: ReadRow, definitions: ReadRow[]): HistoryTable[] {
  const list = rows(snapshot.work_locations);
  return table("作业位置及工作量", ["作业位置", "工作量", "作业方式", "现场属性"], list.map(location => [
    locationLabel(location), quantity(location.quantity_scaled, string(snapshot.unit_snapshot)),
    label(location.work_mode, methods),
    attributeValues(location.attributes, definitions).map(field => `${field.label} ${field.value ?? "未填写"}`).join("、") || null,
  ]), list.map(location => JSON.stringify([location.location_kind,
    location.logical_tower_id ?? location.physical_tower_id ?? location.span_id, location.context_line_id ?? null])));
}

function quoteMethod(line: ReadRow): HistoryValue {
  return label(line.pricing_mode, pricingModels);
}

function calculationDetails(list: ReadRow[], unit?: string): HistoryTable[] {
  const details = list.flatMap(line => {
    const inputs = document(line.calculation_inputs_json), trace = document(line.calculation_trace_json);
    const params = record(trace.parameters);
    const location = locationLabel(inputs.location);
    const perUnit = new Set(["per_unit", "base_plus_unit", "fixed"]);
    const figures = facts(
      ["确认数量", quantity(line.quantity_scaled, unit)],
      ["单价或定额", perUnit.has(String(line.pricing_mode)) ? money(line.unit_price_fen) : null],
      ["基础费", line.pricing_mode === "base_plus_unit" ? money(line.base_fee_fen) : null],
      ["组数", text(trace.groups)], ["每组金额", money(params.group_fee_fen)],
      ["计费基数", money(trace.basis_fen)], ["费率", number(params.rate_basis_points) === undefined ? null
        : `${Number(params.rate_basis_points) / 100}%`], ["最低金额", money(params.min_amount_fen)],
      ["封顶金额", money(params.max_amount_fen)], ["选价依据", text(inputs.selection_basis)],
      ["基数依据", text(record(inputs.bases).evidence)],
    );
    const bracket = record(trace.bracket);
    if (Object.keys(bracket).length) {
      figures.push(...facts(["阶梯最低数量", quantity(bracket.min_quantity_scaled, unit)],
        ["阶梯最高数量", quantity(bracket.max_quantity_scaled, unit)],
        ["阶梯单价", money(bracket.unit_price_fen)], ["阶梯基础费", money(bracket.base_fee_fen)]));
    }
    for (const tier of rows(params.tiers)) {
      const boundary = number(tier.up_to_quantity_scaled);
      const limit = boundary === undefined ? "剩余数量" : `至 ${boundary / 10000} ${unit ?? ""}`.trim();
      figures.push({ label: `累进单价（${limit}）`, value: money(tier.unit_price_fen) });
    }
    for (const [index, component] of rows(trace.components).entries()) {
      figures.push({ label: feeName(component.coverage_key, index), value: money(component.amount_fen) });
    }
    return figures.filter(field => field.value !== null).map(field => [location, field.label, field.value]);
  });
  return table("计价依据", ["作业位置", "依据", "当时采用"], details);
}

export function demandHistory(input: ReturnType<ReturnType<typeof createDemands>["historyFacts"]>): HistoryRecord {
  const { current } = input;
  const versions = rows(input.versions);
  const definitions = new Map(rows(input.attributes).map(row => [
    `${row.operation_id}/${row.operation_version}`, rows(json(row.attributes_schema_json)),
  ]));
  const adoptedAttributes = (row: ReadRow) => definitions.get(`${row.operation_id}/${row.operation_version}`) ?? [];
  const revisions = new Map(rows(input.revisions).map(row => [row.version, string(row.reason)]));
  const frozen = new Map(versions.map(version => [version.version, document(version.snapshot_json)]));
  const versionFacts = (row: ReadRow): HistoryFact[] => {
    const snapshot = frozen.get(row.version) ?? {};
    const operation = string(snapshot.operation_snapshot);
    return [...facts(
      ["操作类型", operation ? `${operation} · 第 ${row.operation_version} 版` : null],
      ["问题描述", text(snapshot.problem_description)], ["处理部位", text(snapshot.target_object)],
      ["验收标准", text(snapshot.completion_standard)], ["优先级", text(snapshot.priority_snapshot)],
      ["预计解决时间", text(snapshot.expected_on)],
      ["工作量", quantity(row.quantity_scaled, string(snapshot.unit_snapshot))],
    ), ...attributeValues(snapshot.attributes, adoptedAttributes(row))];
  };
  const materialsByVersion = new Map<unknown, ReadRow[]>();
  for (const item of rows(input.materials)) {
    const group = materialsByVersion.get(item.demand_version) ?? [];
    group.push(item);
    materialsByVersion.set(item.demand_version, group);
  }
  const entries = readVersions(versions, "需求", versionFacts, (row, before) => {
    const snapshot = frozen.get(row.version) ?? {};
    const materials = materialsByVersion.get(row.version) ?? [];
    const changes = before ? differences(versionFacts(before), versionFacts(row)) : [];
    return {
      title: before ? "修订需求" : "登记需求",
      summary: changes.length ? changes.slice(0, 2).map(change => change.label).join("、") : undefined,
      badge: row.version === current.current_version ? "当前正式版本" : undefined,
      reason: revisions.get(row.version),
      tables: [
        ...workLocations(snapshot, adoptedAttributes(row)),
        ...table("预计物资", ["物资", "规格", "数量", "备注"], materials.map(item => [
          text(item.material_name), text(item.specification), quantity(item.quantity_scaled, string(item.unit_snapshot)), text(item.note),
        ]), materials.map(item => String(item.material_id))),
      ],
    };
  });

  for (const row of rows(input.events)) {
    // The initial submission is recorded alongside the initial official content.
    if (row.from_status == null) continue;
    entries.push(event(`decision/${row.id}`, String(label(row.to_status, decisions)), "办理", row, {
      tone: row.to_status === "returned" ? "warning" : row.to_status === "active" ? "success" : "info",
      changes: [{ label: "需求状态", before: label(row.from_status, statuses), after: label(row.to_status, statuses) }],
    }));
  }
  for (const scope of rows(input.bindings)) {
    const project = string(scope.project_name ?? scope.project_no);
    const links: HistoryLink[] = scope.project_id && project ? [
      { label: `查看项目 · ${project}`, target: { kind: "projects", id: String(scope.project_id) } },
    ] : [];
    for (const row of rows(scope.events)) {
      const linked = row.action === "linked";
      entries.push(event(`binding/${row.id}`, linked ? "子项目承接需求" : "解除项目承接", "关联", row, {
        summary: project, links,
        facts: facts(["子项目", project], ["需求承接状态", linked ? "已承接" : "待承接"]),
      }));
    }
  }
  for (const quote of rows(input.reference_quotes)) {
    if (quote.status !== "final") continue;
    const list = rows(quote.lines);
    const snapshot = frozen.get(quote.demand_version) ?? {};
    const unit = string(snapshot.unit_snapshot);
    const locations = new Map(rows(snapshot.work_locations).map(location => [location.item_no, location]));
    const total = list.reduce((sum, line) => sum + (number(line.amount_fen) ?? 0), 0);
    const links: HistoryLink[] = [{
      label: `查看需求第 ${quote.demand_version} 版`,
      target: { kind: "demands", id: current.id, entry: `需求/${quote.demand_version}` },
    }];
    const seenRules = new Set<string>();
    for (const line of list) {
      const rule = string(line.rule_id);
      const version = number(line.rule_version_no);
      const identity = `${rule}/${version}`;
      if (!rule || version === undefined || seenRules.has(identity)) continue;
      seenRules.add(identity);
      links.push({
        label: `查看计价规则 · ${line.rule_title}（第 ${version} 版）`,
        target: { kind: "prices", id: rule, entry: `参考价格规则/${version}` },
      });
    }
    entries.push(event(`quote/${quote.id}`, "确认参考报价", "金额", quote, {
      time: string(quote.finalized_at) ?? null, actor: string(quote.finalized_by), tone: "success",
      summary: `采用需求第 ${quote.demand_version} 版`,
      facts: facts(["正式参考报价", list.length ? money(total) : null], ["价格适用日期", text(quote.pricing_date)],
        ["需求正式版本", `第 ${quote.demand_version} 版`]),
      tables: [
        ...table("报价明细", ["作业位置", "采用规则", "计价方式", "数量", "金额"], list.map(line => [
          locationLabel(locations.get(line.location_item_no)),
          string(line.rule_title) ? `${line.rule_title} · 第 ${line.rule_version_no} 版` : null,
          quoteMethod(line), quantity(line.quantity_scaled, unit), money(line.amount_fen),
        ])),
        ...calculationDetails(list, unit),
      ],
      links,
    }));
  }
  for (const source of rows(input.sources)) {
    entries.push(event(`source/${source.id}`, "登记需求来源", "资料", source, {
      badge: source.deleted ? "已删除" : source.superseded ? "已更正" : undefined,
      facts: facts(["来源类别", text(source.type_snapshot)],
        ["来源渠道", label(source.source_system, { manual: "在线登记", excel: "Excel 导入", workbook: "Excel 导入" })],
        ["来源说明", text(source.description)], ["提出人", text(source.proposed_by)],
        ["提出日期", text(source.discovered_on)], ["原始记录编号", text(source.external_record_id)]),
    }));
  }
  const sourceById = new Map(rows(input.sources).map(source => [source.id, source]));
  for (const row of rows(input.sourceActions)) {
    const source = sourceById.get(row.source_id);
    entries.push(event(`source-action/${row.id}`, row.action === "delete" ? "移除需求来源" : "更正需求来源", "资料", row, {
      summary: string(source?.description), facts: facts(["原始记录编号", text(source?.external_record_id)],
        ["原来源说明", text(source?.description)]),
    }));
  }
  return {
    name: current.problem_description,
    status: current.deleted ? "已删除" : current.status === "active" && current.binding ? "已承接" : statuses[current.status],
    context: facts(["需求编号", current.demand_no], ["当前正式版本", `第 ${current.current_version} 版`]),
    entries,
  };
}

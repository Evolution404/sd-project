import { definitionTables } from "../../shared/catalog-definition-display.js";
import { auditActions, auditObjects } from "../../shared/audit-display.js";
import type { CatalogKind } from "../../shared/types/catalog.js";
import type { HistoryEntry, HistoryFact, HistoryValue } from "../../shared/types/history.js";
import { catalogDefinitions } from "../catalog/definitions.js";
import { differences, document, event, facts, label, lifecycle, methods, metres, money, number, pricingModels,
  quantity, readVersions, record, rows, string, table, text, type HistoryRecord, type ReadRow } from "./core.js";

const assetStates = { ...lifecycle, active: "在运", draft: "待完善" };
const objectPositions = { body: "本体", corridor: "通道" };
const attributionUnits = { physical_tower: "物理杆塔", logical_tower: "逻辑杆塔" };
const priceScopes = { work_location: "逐作业位置", work_batch: "批次", project: "项目" };

function reference(row: ReadRow, key: string, ...names: string[]): HistoryValue {
  for (const name of [...names, key + "_label", key.replace(/_id$/, "") + "_name"]) {
    const found = string(row[name]);
    if (found) return found;
  }
  return !row[key] ? null : "原名称未记载";
}

export function catalogFacts(kind: CatalogKind, row: ReadRow): HistoryFact[] {
  const name = facts(["名称", text(row.name)], ["状态", label(row.status, lifecycle)]);
  switch (kind) {
    case "units": {
      const precision = number(row.quantity_precision ?? document(row.fields_json).quantity_precision);
      return [...name, ...facts(["数量格式", precision === undefined ? null
        : precision === 0 ? "只能填写整数" : `最多 ${precision} 位小数`])];
    }
    case "frameworks":
    case "agreements":
      return [...name, ...facts([kind === "agreements" ? "协议额度" : "年度框架额度", money(row.limit_fen)],
        ...(kind === "agreements" ? [
          ["合同编号", text(row.contract_number)], ["合同对方", text(row.counterparty_name)],
          ["签订日期", text(row.signed_on)], ["生效日期", text(row.effective_from)], ["截止日期", text(row.effective_to)],
        ] as Parameters<typeof facts> : []))];
    case "materials":
      return [...name, ...facts(["型号", text(row.model)], ["规格", text(row.specification)],
        ["计量单位", reference(row, "unit_id", "unit_snapshot")], ["备注", text(row.note)])];
    case "objects":
      return [...name, ...facts(["对象位置", label(row.object_position, objectPositions)],
        ["归属单元", label(row.attribution_unit, attributionUnits)])];
    case "operations": {
      const object = reference(row, "work_object_id");
      const unit = reference(row, "default_unit_id");
      return [...name, ...facts(["作业对象", object], ["作业对象正式版本", number(row.work_object_version_no)],
        ["计量单位", unit], ["计量单位正式版本", number(row.default_unit_version)],
        ["建议工作量", quantity(row.default_quantity_scaled, typeof unit === "string" ? unit : undefined)],
        ["默认处理部位", text(row.default_target_object)], ["录入提示", text(row.entry_hint)],
        ["验收标准", text(row.completion_standard)])];
    }
    case "prices":
      return facts(["规则名称", text(row.title)], ["状态", label(row.status, lifecycle)],
        ["计价方式", label(row.pricing_mode, pricingModels)], ["计价范围", label(row.pricing_scope, priceScopes)],
        ["操作类型", reference(row, "operation_id")], ["采用操作正式版本", number(row.operation_version)],
        ["计量单位", reference(row, "unit_id", "unit_snapshot")], ["计量单位正式版本", number(row.unit_version)],
        ["适用电压", reference(row, "voltage_level_id")], ["适用杆塔材质", reference(row, "tower_material")],
        ["适用作业方式", label(row.work_mode, methods)], ["适用规格", text(row.specification)],
        ["基础费", money(row.base_fee_fen)], ["单价或定额", money(row.unit_price_fen)],
        ["价格来源", text(row.price_source)], ["价格日期", text(row.price_date)], ["生效日期", text(row.effective_on)],
        ["定价依据", text(row.basis)]);
    case "lines":
      return facts(["线路名称", text(row.name)], ["状态", label(row.status, assetStates)],
        ["线路类型", label(row.line_kind, { main: "主线", branch: "支线" })],
        ["电压等级", reference(row, "voltage_level_id")], ["主线路", reference(row, "parent_line_id")],
        ["分支接入塔", reference(row, "junction_tower_id")]);
    case "physical":
      return facts(["现场铭牌号", text(row.asset_no)], ["状态", label(row.status, assetStates)],
        ["杆塔材质", reference(row, "tower_material")], ["杆塔性质", reference(row, "tower_nature")],
        ["型号", text(row.model)], ["高度", quantity(row.height_scaled, "米")], ["用途", text(row.purpose)],
        ["经度", text(row.longitude)], ["纬度", text(row.latitude)], ["投运日期", text(row.commissioned_on)]);
    case "towers":
      return facts(["杆塔号", text(row.tower_no)], ["状态", label(row.status, assetStates)],
        ["显示名称", text(row.display_name)], ["所属线路", reference(row, "line_id", "line_name")],
        ["关联实物", reference(row, "physical_tower_id")], ["运维班组", text(row.operations_team)],
        ["管辖部门", text(row.management_department)], ["线路内排序", text(row.sort_rank)]);
    case "spans":
      return facts(["所属线路", reference(row, "line_id", "line_name")], ["起点杆塔", reference(row, "start_tower_id", "start_tower_no")],
        ["终点杆塔", reference(row, "end_tower_id", "end_tower_no")],
        ["输电中心管辖长度", metres(row.transmission_center_length_mm) ?? "未核定"], ["状态", label(row.status, assetStates)]);
    case "organizations":
      return [...name, ...facts(["上级单位", row.parent_unit_id ? reference(row, "parent_unit_id", "parent_name") : "根单位"],
        ["当时组织路径", text(row.historical_path)], ["路径记录", row.path_complete === 0 || row.path_complete === false ? "部分上级待核对" : null])];
    default:
      return name;
  }
}

export function auditTitle(action: unknown, entity?: unknown): string {
  const object = string(label(entity, auditObjects)) ?? "业务记录";
  return (string(label(action, auditActions)) ?? "记录") + object;
}

function auditFacts(type: string | undefined, row: ReadRow): HistoryFact[] {
  if (type === "users") return facts(["账号", text(row.username)],
    ["角色", label(row.role, { admin: "管理员", editor: "编辑人员", verifier: "审核人员", viewer: "只读人员" })],
    ["登录状态", label(row.status, { active: "有效", disabled: "已禁用" })]);
  if (type === "ips") return facts(["授权 IP", text(row.ip)], ["授权说明", text(row.note)]);
  if (type === "access_policy") return facts(["访问限制", typeof row.ip_restriction_enabled === "boolean"
    ? row.ip_restriction_enabled ? "已开启" : "已关闭" : null]);
  return type && Object.hasOwn(catalogDefinitions, type) ? catalogFacts(type as CatalogKind, row) : [];
}

export function auditEntry(row: ReadRow, entity?: string): HistoryEntry {
  const after = document(row.after_json);
  const before = document(row.before_json);
  const action = row.action;
  const objectName = string(after.title ?? after.name ?? after.label ?? after.username ?? after.problem_description
    ?? before.title ?? before.name ?? before.label ?? before.username ?? before.problem_description);
  const type = entity ?? string(row.entity);
  const affected = auditFacts(type, after);
  const previous = auditFacts(type, before);
  const title = type === "access_policy" && typeof after.ip_restriction_enabled === "boolean"
    ? after.ip_restriction_enabled ? "开启访问限制" : "关闭访问限制" : auditTitle(action, type);
  return event(`audit/${row.id}`, title, action === "delete" ? "办理" : "资料", row, {
    summary: objectName, tone: action === "delete" ? "warning" : undefined,
    reason: string(row.reason ?? after.message ?? after.reason),
    facts: [
      ...facts(["业务对象", objectName], ["金额", money(after.amount_fen)], ["说明", text(after.message ?? after.note)]),
      ...(action === "delete" ? previous : affected).filter(field => field.value !== null),
    ],
    changes: previous.length && affected.length && Object.keys(after).some(key => !["logical", "reason"].includes(key))
      ? differences(previous, affected) : undefined,
  });
}

export function catalogHistory(kind: CatalogKind, current: unknown, list: unknown, audits: unknown): HistoryRecord {
  const selected = record(current);
  const auditRows = rows(audits);
  const frozen = new Map(auditRows.filter(row => row.action === "create" || row.action === "revise").flatMap(row => {
    const after = document(row.after_json);
    const version = number(after.version_no ?? after.version);
    return version === undefined ? [] : [[version, after] as const];
  }));
  const kindName = catalogDefinitions[kind].title;
  const versionRows = rows(list).map(row => ({ ...frozen.get(number(row.version_no ?? row.version) ?? 0), ...row }))
    .sort((a, b) => Number(a.version_no ?? a.version) - Number(b.version_no ?? b.version));
  const entries = readVersions(versionRows, kindName, row => catalogFacts(kind, row), (row, previous) => ({
    title: previous && row.status !== previous.status && ["active", "inactive", "retired"].includes(String(row.status))
      ? (row.status === "inactive" ? "停用" : row.status === "retired" ? "退役" : "启用") + kindName
      : previous && kind === "organizations" && row.parent_unit_id !== previous.parent_unit_id
        ? "调整组织上级" : previous ? "修订" + kindName : "建立" + kindName,
    badge: row === versionRows.at(-1) ? "当前正式版本" : undefined,
    tables: kind === "operations" || kind === "prices" ? definitionTables(kind, row) : [],
  }));
  entries.push(...auditRows.filter(row => kind === "voltages"
    || !["revise", "create", "update", "move"].includes(String(row.action)))
    .map(row => auditEntry(row, kind)));
  for (const row of rows(selected.identity_decisions)) {
    const decision = document(row.after_json);
    const shared = decision.decision === "shared";
    entries.push(event(`tower-decision/${row.id}`, shared ? "确认共用实物" : "确认建立独立实物", "关联", row, {
      facts: facts(["关联回路", text(decision.label)], ["实物关系", shared ? "共用已有实物" : "独立实物"]),
      links: string(decision.physical_tower_id) ? [{
        label: "查看关联实物历史", target: { kind: "physical", id: String(decision.physical_tower_id) },
      }] : [],
    }));
  }
  for (const row of rows(selected.replacements)) {
    const decision = document(row.after_json);
    const prior = document(row.before_json);
    const before = record(prior.physical);
    const related = rows(decision.bindings);
    entries.push(event(`replacement/${row.id}`, "完成整基更换", "关联", row, {
      tone: "success", summary: `${related.length} 条关联回路`,
      facts: facts(["原实物", text(before.label ?? before.asset_no)], ["关联回路数量", related.length]),
      tables: table("受影响回路", ["线路及杆号", "原回路版本", "更换后回路版本"], related.map(binding => [
        text(binding.label), text(binding.old_version), text(binding.new_version),
      ])),
      links: [
        ...[["查看原实物历史", decision.old_physical_id], ["查看新实物历史", decision.new_physical_id]]
          .flatMap(([label, id]) => string(id) && id !== selected.id ? [{ label: String(label), target: {
            kind: "physical" as const, id: String(id),
          } }] : []),
        ...related.flatMap(binding => string(binding.logical_tower_id) ? [{
          label: `查看关联回路 · ${binding.label}`, target: { kind: "towers" as const, id: String(binding.logical_tower_id) },
        }] : []),
      ],
    }));
  }
  const name = string(selected.label ?? selected.name ?? selected.title ?? versionRows.at(-1)?.name) ?? kindName;
  const state = kind === "physical" || kind === "lines" || kind === "towers" || kind === "spans" ? assetStates : lifecycle;
  return { name, status: selected.deleted || auditRows.some(row => row.action === "delete") ? "已删除"
    : string(label(selected.status ?? versionRows.at(-1)?.status, state)),
    context: facts(["对象类型", kindName], ["正式版本", versionRows.length ? Number(versionRows.at(-1)?.version_no ?? versionRows.at(-1)?.version) : null]),
    entries,
  };
}

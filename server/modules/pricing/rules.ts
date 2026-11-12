import type { PriceRuleRepository } from "../../database/repositories/price-rules.js";
import type { Database } from "../../database/connection.js";
import type { AuditService } from "../../platform/audit/service.js";
import type { Actor, ListQuery } from "../../shared/types/contracts.js";
import { isObject } from "../../shared/types/contracts.js";
import type {
  PriceRuleRecord,
  PriceRuleVersion,
  PricingMode,
  PricingScope,
} from "../../shared/types/price-rules.js";
import type { WorkStandardService } from "../work-standards/service.js";
import type { EquipmentService } from "../equipment/service.js";
import { definitionStatus } from "../dictionaries/service.js";
import { jsonDocument } from "../../shared/json.js";
import { calculate, validatePricingRule } from "./calculation.js";
import { priceRulesMayOverlap } from "./features.js";
import { validateAttributeCondition } from "../../shared/operation-attributes.js";
import { authorize, id, now } from "../../platform/auth/service.js";
import {
  requireValue,
  expectedVersion,
  integer,
  text,
} from "../../shared/errors/business-error.js";
const modes: PricingMode[] = [
  "fixed",
  "per_unit",
  "base_plus_unit",
  "quantity_bracket",
  "progressive_bracket",
  "group",
  "rate",
  "composite",
];
const scopes: PricingScope[] = ["work_location", "work_batch", "project"];
const definitionFields = [
  "title",
  "operation_id",
  "operation_version",
  "unit_id",
  "unit_version",
  "voltage_level_id",
  "tower_type",
  "work_mode",
  "specification",
  "additional_conditions_json",
  "pricing_mode",
  "pricing_scope",
  "calculation_params_json",
  "fee_components_json",
  "base_fee_fen",
  "unit_price_fen",
  "quantity_brackets_json",
  "price_source",
  "price_date",
  "effective_on",
  "basis",
] as const;
const jsonFields = new Set<string>([
  "additional_conditions_json",
  "calculation_params_json",
  "fee_components_json",
  "quantity_brackets_json",
]);
const decorate = (row: PriceRuleRecord): PriceRuleRecord => ({
  ...row,
  label: row.title,
  deleted: Boolean(row.deleted),
});
function sameDefinition(a: PriceRuleRecord, b: PriceRuleVersion): boolean {
  return definitionFields.every((key) =>
    jsonFields.has(key)
      ? jsonDocument(a[key], "原价格定义").text ===
        jsonDocument(b[key], "价格定义").text
      : a[key] === b[key],
  );
}
function optionalText(value: unknown, label: string): string {
  requireValue(
    value === null || typeof value === "string",
    `${label}必须为文本`,
  );
  return value || "";
}
function requiredText(value: unknown, label: string): string {
  requireValue(typeof value === "string" && value.trim(), "请填写" + label);
  return value;
}
function dateFact(value: unknown, label: string): string {
  const date = requiredText(value, label);
  requireValue(
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      Number.isFinite(Date.parse(date)) &&
      new Date(date).toISOString().slice(0, 10) === date,
    label + "必须为有效日期",
  );
  return date;
}
export function createPriceRules(
  repository: PriceRuleRepository,
  standards: WorkStandardService,
  equipment: EquipmentService,
  database: Pick<Database, "transaction">,
  audit: AuditService,
) {
  function get(key: string, includeDeleted = false): PriceRuleRecord {
    requireValue(typeof key === "string" && key.trim(), "请选择参考价格规则");
    const row = repository.current(key);
    requireValue(
      row && (includeDeleted || !row.deleted),
      "参考价格规则不存在或已删除",
      404,
    );
    return decorate(row);
  }
  function build(
    input: Record<string, unknown>,
    previous: PriceRuleRecord | null,
  ): PriceRuleVersion {
    requireValue(
      input.adopt_latest_operation_version === undefined ||
        typeof input.adopt_latest_operation_version === "boolean",
      "请明确是否采用最新操作版本",
    );
    const operationId = text(
      input.operation_id === undefined
        ? previous?.operation_id
        : input.operation_id,
      "操作类型",
    );
    const existing = previous?.operation_id === operationId,
      operation = standards.getOperation(operationId, existing);
    const keep = existing && !input.adopt_latest_operation_version;
    const number = keep ? previous.operation_version : operation.version;
    const adopted = keep
      ? standards.operationVersion(operationId, number)
      : operation;
    for (const [key, actual] of [
      ["operation_version", number],
      ["unit_id", adopted.default_unit_id],
      ["unit_version", adopted.default_unit_version],
    ] as const)
      requireValue(
        input[key] == null ||
          input[key] === actual ||
          (existing &&
            input.adopt_latest_operation_version &&
            input[key] === previous[key]),
        "参考价格的操作版本和固定计量单位必须与所采用作业标准一致",
        422,
        { [key]: "请采用所选操作类型的正式定义" },
      );
    function value(key: (typeof definitionFields)[number], fallback: unknown) {
      return input[key] === undefined
        ? (previous?.[key] ?? fallback)
        : input[key];
    }
    const status = definitionStatus(
      input.status === undefined ? previous?.status || "active" : input.status,
    );
    requireValue(
      status === "inactive" || operation.status === "active",
      "操作类型已停用，请更换操作类型或停用参考价格规则",
      409,
    );
    const mode = value("pricing_mode", "per_unit"),
      scope = value("pricing_scope", "work_location"),
      workMode = value("work_mode", "both");
    requireValue(
      typeof mode === "string" && modes.includes(mode as PricingMode),
      "请选择合法计价模型",
    );
    requireValue(
      typeof scope === "string" && scopes.includes(scope as PricingScope),
      "请选择合法计价作用域",
    );
    requireValue(
      workMode === "both" || workMode === "outage" || workMode === "non_outage",
      "请选择合法作业方式",
    );
    const rawVoltage = value("voltage_level_id", null),
      rawTower = value("tower_type", null);
    const voltage =
        rawVoltage === null || rawVoltage === "" ? null : rawVoltage,
      tower = rawTower === null || rawTower === "" ? null : rawTower;
    requireValue(
      voltage === null || typeof voltage === "string",
      "请选择有效适用电压",
    );
    requireValue(
      tower === null || typeof tower === "string",
      "适用塔型必须为文本",
    );
    if (tower) requireValue(tower === tower.trim(), "适用塔型不得包含首尾空格");
    if (voltage) {
      const selected = equipment.get(
        "voltages",
        voltage,
        previous?.voltage_level_id === voltage,
      );
      requireValue(
        selected.status === "active" || previous?.voltage_level_id === voltage,
        "适用电压已停用",
      );
    }
    const conditions = jsonDocument(
        value("additional_conditions_json", {}),
        "适用特征条件",
      ),
      parameters = jsonDocument(
        value("calculation_params_json", {}),
        "计价参数",
      ),
      components = jsonDocument(value("fee_components_json", []), "组合费用"),
      brackets = jsonDocument(value("quantity_brackets_json", []), "整批阶梯");
    requireValue(
      isObject(conditions.value) &&
        isObject(parameters.value) &&
        Array.isArray(components.value) &&
        Array.isArray(brackets.value),
      "请填写正确的价格条件及计价参数结构",
    );
    const definition: PriceRuleVersion = {
      id: id(),
      catalog_id: previous?.id || "",
      version_no: (previous?.version_no || 0) + 1,
      title: requiredText(value("title", null), "规则名称"),
      status,
      operation_id: operationId,
      operation_version: number,
      unit_id: adopted.default_unit_id,
      unit_version: adopted.default_unit_version,
      voltage_level_id: voltage,
      tower_type: tower,
      work_mode: workMode,
      specification: optionalText(value("specification", ""), "适用规格"),
      pricing_mode: mode as PricingMode,
      pricing_scope: scope as PricingScope,
      additional_conditions_json: conditions.text,
      calculation_params_json: parameters.text,
      fee_components_json: components.text,
      quantity_brackets_json: brackets.text,
      base_fee_fen: integer(value("base_fee_fen", 0), "基础费"),
      unit_price_fen: integer(value("unit_price_fen", 0), "单价/固定价"),
      price_source: requiredText(value("price_source", null), "价格来源"),
      price_date: dateFact(value("price_date", null), "价格日期"),
      effective_on: dateFact(value("effective_on", null), "生效日期"),
      basis: requiredText(value("basis", null), "计价依据"),
      reason: typeof input.reason === "string" ? input.reason : "",
      created_by: "",
      created_at: now(),
    };
    validatePricingRule(definition);
    const retiring = Boolean(
      previous &&
        previous.status === "active" &&
        status === "inactive" &&
        sameDefinition(previous, definition),
    );
    const attributes = standards.operationAttributes(operationId, number).items;
    for (const [key, condition] of Object.entries(conditions.value)) {
      const field = attributes.find((item) => item.key === key);
      requireValue(field, "价格适用条件必须属于所采用操作类型的统一属性定义");
      // Withdrawing a price preserves its previously validated predicates.
      if (!retiring) validateAttributeCondition(field, condition);
    }
    return definition;
  }
  function overlaps(definition: PriceRuleVersion, excluded?: string) {
    const schema = standards.operationAttributes(definition.operation_id, definition.operation_version).items;
    return repository
      .all()
      .filter(
        (row) =>
          !row.deleted &&
          row.id !== excluded &&
          priceRulesMayOverlap(definition, row, schema),
      );
  }
  return {
    detail(key: string) {
      return {
        item: get(key, true),
        versions: repository.history(key),
        audits: audit.history("prices", key),
      };
    },
    impact(key: string) {
      const row = get(key);
      return {
        references: repository.references(key),
        expected_version: row.version_no,
      };
    },
    get,
    list: (includeDeleted = false) =>
      repository
        .all()
        .filter((row) => includeDeleted || !row.deleted)
        .map(decorate),
    search: (query: ListQuery) => {
      const page = repository.search(query);
      return { ...page, items: page.items.map(decorate) };
    },
    history: (key: string) => {
      get(key, true);
      return repository.history(key);
    },
    effectiveLocationRules: repository.effectiveLocationRules,
    latestLocationRules: repository.latestLocationRules,
    save(
      actor: Actor,
      input: Record<string, unknown>,
      key?: string,
    ): PriceRuleRecord & { warnings?: string[] } {
      authorize(actor, "admin");
      return database.transaction(() => {
        const previous = key ? get(key) : null;
        if (previous) {
          expectedVersion(previous.version_no, input.expected_version);
          requireValue(
            input.code === undefined || input.code === previous.code,
            "系统身份不可修改",
          );
        }
        const definition = build(input, previous),
          catalogId = key || id();
        definition.catalog_id = catalogId;
        definition.created_by = actor.id;
        requireValue(
          !previous ||
            definition.status !== previous.status ||
            !sameDefinition(previous, definition),
          "内容没有变化",
        );
        if (!previous)
          repository.create({
            id: catalogId,
            code: "PRICES-" + catalogId.replaceAll("-", ""),
            created_by: actor.id,
            created_at: definition.created_at,
          });
        const conflicts =
          definition.status === "active" ? overlaps(definition, catalogId) : [];
        repository.append(definition);
        const result = get(catalogId);
        audit.record(
          actor,
          "prices",
          catalogId,
          previous ? "revise" : "create",
          previous,
          result,
        );
        return conflicts.length
          ? {
              ...result,
              warnings: [
                `可能与以下参考价格规则重叠：${conflicts.map((rule) => rule.title).join("、")}；正式报价须明确选择及依据`,
              ],
            }
          : result;
      });
    },
    preview(actor: Actor, input: Record<string, unknown>) {
      authorize(actor, "admin");
      const previous = input.existing_id
        ? get(text(input.existing_id, "原规则"))
        : null;
      const definition = build(input, previous),
        conflicts =
          definition.status === "active"
            ? overlaps(definition, previous?.id)
            : [];
      let sample: ReturnType<typeof calculate> | null = null,
        sampleError: string | null = null;
      const quantity =
        input.sample_quantity_scaled === undefined
          ? 10000
          : input.sample_quantity_scaled;
      let sampleQuantity = 10000;
      requireValue(
        input.sample_bases === undefined || isObject(input.sample_bases),
        "示例费用基数必须为对象",
      );
      try {
        sampleQuantity = integer(quantity, "示例工作量", 1);
        sample = calculate(
          definition,
          sampleQuantity,
          input.sample_bases as Record<string, number> | undefined,
        );
      } catch (error) {
        if (!(error instanceof Error) || !("status" in error)) throw error;
        sampleError = error.message;
      }
      return {
        valid: true,
        operation_version: definition.operation_version,
        unit_version: definition.unit_version,
        sample: sample
          ? {
              quantity_scaled: sampleQuantity,
              amount_fen: sample.amount_fen,
              calculation_trace: sample.trace,
            }
          : null,
        sample_error: sampleError,
        overlaps: conflicts.map((rule) => ({
          id: rule.id,
          title: rule.title,
          effective_on: rule.effective_on,
        })),
        warning: conflicts.length
          ? "规则适用范围可能重叠，正式报价须人工选择并记录依据"
          : null,
      };
    },
    remove(actor: Actor, key: string, version: unknown, references?: unknown) {
      authorize(actor, "admin");
      return database.transaction(() => {
        const previous = get(key);
        expectedVersion(previous.version_no, version);
        const count = repository.references(key);
        requireValue(
          references === undefined || references === count,
          "引用关系已变化，请重新检查后删除",
          409,
        );
        audit.record(actor, "prices", key, "delete", previous, {
          logical: true,
        });
        return { id: key, deleted: true };
      });
    },
  };
}
export type PriceRuleService = ReturnType<typeof createPriceRules>;

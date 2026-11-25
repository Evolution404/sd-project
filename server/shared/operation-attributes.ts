import { requireValue } from "./errors/business-error.js";
import { isObject } from "./types/contracts.js";
import type {
  AttributeCondition,
  AttributeScope,
  AttributeValue,
  AttributeValues,
  OperationAttribute,
} from "./types/operation-attributes.js";

/** Numeric attributes and conditions use exact signed fixed-point parsing. */
export function attributeNumber(
  value: unknown,
  precision: number,
  label: string,
): bigint {
  requireValue(
    typeof value === "string" ||
      (typeof value === "number" && Number.isSafeInteger(value)),
    `${label}须使用精确十进制数值`,
  );
  // At precision 0..4, numbers longer than 32 characters cannot be a
  // meaningful exact business quantity. Reject before regex/BigInt parsing.
  requireValue(Number.isInteger(precision) && precision >= 0 && precision <= 4,
    `${label}数值精度无效`);
  const raw = String(value);
  requireValue(raw.length <= 32, `${label}超出安全数值范围`);
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(raw);
  requireValue(
    match && (match[3]?.length || 0) <= precision,
    `${label}最多保留${precision}位小数`,
  );
  const scaled =
    BigInt(match[2]) * 10n ** BigInt(precision) +
    BigInt((match[3] || "").padEnd(precision, "0") || "0");
  requireValue(
    scaled <= BigInt(Number.MAX_SAFE_INTEGER),
    `${label}超出安全数值范围`,
  );
  return match[1] ? -scaled : scaled;
}
export function validateAttributeValue(
  field: OperationAttribute,
  value: unknown,
): AttributeValue {
  const label = field.label;
  switch (field.type) {
    case "integer":
    case "decimal": {
      requireValue(
        field.type === "decimal"
          ? typeof value === "string"
          : typeof value === "number" && Number.isSafeInteger(value),
        `${label}须为${field.type === "integer" ? "整数" : "精确小数文本"}`,
      );
      const number = attributeNumber(value, field.precision, label);
      requireValue(
        (field.min === undefined ||
          number >= attributeNumber(field.min, field.precision, label)) &&
          (field.max === undefined ||
            number <= attributeNumber(field.max, field.precision, label)),
        `${label}不在允许的数值范围内`,
      );
      return value as string | number;
    }
    case "boolean":
      requireValue(typeof value === "boolean", `${label}须选择是或否`);
      return value;
    case "multiselect":
      requireValue(
        Array.isArray(value) &&
          value.length <= 100 &&
          value.every(
            (item) =>
              typeof item === "string" &&
              field.options.some((option) => option.value === item),
          ) &&
          new Set(value).size === value.length,
        `${label}须选择不重复的正式选项`,
      );
      return value as string[];
    case "select":
      requireValue(
        typeof value === "string" &&
          field.options.some((option) => option.value === value),
        `${label}不在正式选项中`,
      );
      return value;
    case "date":
      requireValue(
        typeof value === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(value) &&
          Number.isFinite(Date.parse(value)) &&
          new Date(value).toISOString().slice(0, 10) === value,
        `${label}日期无效`,
      );
      return value;
    default:
      requireValue(
        typeof value === "string" && value.length <= 20000,
        `${label}须为20000字以内的文字`,
      );
      return value;
  }
}
export function validateAttributeSchema(raw: unknown): OperationAttribute[] {
  requireValue(
    Array.isArray(raw) && raw.length <= 100,
    "附加属性须为最多100项的定义清单",
  );
  const keys = new Set<string>();
  const labels = new Set<string>();
  for (const field of raw) {
    requireValue(
      isObject(field) &&
        typeof field.key === "string" &&
        /^[A-Za-z0-9_-]{1,100}$/.test(field.key) &&
        typeof field.label === "string" &&
        field.label.trim() &&
        field.label.length <= 100 &&
        ["demand", "location"].includes(String(field.scope)) &&
        ["manual", "asset"].includes(String(field.source)) &&
        [
          "text",
          "textarea",
          "integer",
          "decimal",
          "select",
          "multiselect",
          "boolean",
          "date",
        ].includes(String(field.type)) &&
        ["optional", "save", "pricing"].includes(String(field.requirement)) &&
        typeof field.pricing === "boolean" &&
        typeof field.enabled === "boolean" &&
        Number.isSafeInteger(field.sort_order) &&
        typeof field.hint === "string" &&
        field.hint.length <= 2000,
      "请完整配置属性身份、名称、层级、来源、类型和必填规则",
    );
    requireValue(
      !keys.has(field.key) &&
        !labels.has(`${field.scope}/${field.label.trim()}`),
      "同一操作的属性身份及同层级名称不能重复",
    );
    keys.add(field.key);
    labels.add(`${field.scope}/${field.label.trim()}`);
    requireValue(
      !field.pricing ||
        ["select", "boolean", "integer", "decimal"].includes(
          String(field.type),
        ),
      `${field.label}的类型不支持参与计价`,
    );
    requireValue(
      field.requirement !== "pricing" || field.pricing,
      `${field.label}计价必需须启用参与计价`,
    );
    if (field.source === "asset") {
      requireValue(
        field.scope === "location" &&
          ["voltage_level_id", "tower_material", "tower_nature"].includes(
            String(field.asset_field),
          ) &&
          field.type === "select" &&
          field.default_value === undefined,
        "台账属性须引用位置台账正式字段，不能配置手填默认值",
      );
    } else {
      requireValue(
        field.asset_field === undefined,
        "手工属性不能同时引用台账字段",
      );
      requireValue(
        !["电压等级", "杆塔材质", "杆塔性质", "塔型"].includes(field.label.trim()),
        "设备已有正式业务字段须通过台账引用",
      );
    }
    if (field.type === "select" || field.type === "multiselect") {
      requireValue(
        Array.isArray(field.options) &&
          field.options.length <= 100 &&
          (field.source === "asset" || field.options.length > 0),
        "选项类型至少配置一个可选值",
      );
      const values = new Set<string>();
      for (const option of field.options) {
        requireValue(
          isObject(option) &&
            typeof option.value === "string" &&
            option.value.trim() === option.value &&
            option.value.length > 0 &&
            option.value.length <= 100 &&
            typeof option.label === "string" &&
            option.label.trim() &&
            option.label.length <= 100 &&
            !values.has(option.value),
          "选项须有稳定编码和名称，编码不能重复",
        );
        values.add(option.value);
      }
    }
    if (field.type === "integer" || field.type === "decimal") {
      requireValue(
        typeof field.precision === "number" &&
          Number.isInteger(field.precision) &&
          field.precision >= 0 &&
          field.precision <= 4 &&
          (field.type !== "integer" || field.precision === 0),
        `${field.label}精度须为0至4位，整数为0位`,
      );
      requireValue(
        (field.unit_id === undefined && field.unit_version === undefined) ||
          (typeof field.unit_id === "string" &&
            field.unit_id &&
            Number.isSafeInteger(field.unit_version) &&
            Number(field.unit_version) > 0),
        "数值单位须引用完整正式版本",
      );
      const min =
        field.min === undefined
          ? undefined
          : attributeNumber(field.min, field.precision, field.label);
      const max =
        field.max === undefined
          ? undefined
          : attributeNumber(field.max, field.precision, field.label);
      requireValue(
        min === undefined || max === undefined || min <= max,
        "最小值不能大于最大值",
      );
    }
    if (field.default_value !== undefined)
      validateAttributeValue(
        field as unknown as OperationAttribute,
        field.default_value,
      );
  }
  return raw as OperationAttribute[];
}
export function validateWorksheetOptionLabels(schema: OperationAttribute[], previous: readonly OperationAttribute[]) {
  const before = new Map(previous.map(field => [field.key, field]));
  for (const field of schema) {
    if (field.source !== "manual" || (field.type !== "select" && field.type !== "multiselect")) continue;
    const prior = before.get(field.key);
    const old = prior && "options" in prior ? prior.options : [];
    const counts = new Map<string, number>(), previousCounts = new Map<string, number>();
    for (const option of field.options) counts.set(option.label.trim(), (counts.get(option.label.trim()) || 0) + 1);
    for (const option of old) previousCounts.set(option.label.trim(), (previousCounts.get(option.label.trim()) || 0) + 1);
    for (const option of field.options) {
      const label = option.label.trim(), count = counts.get(label) || 0;
      const unchanged = prior?.type === field.type && old.some(item => item.value === option.value && item.label === option.label);
      requireValue(
        (count === 1 && !label.includes(",") && (field.type !== "multiselect" || !label.includes("/"))) ||
          (unchanged && count <= (previousCounts.get(label) || 0)),
        field.label + "的选项名称须唯一，且不可使用工作表保留的分隔符",
      );
    }
  }
}

export function normalizeAttributeValues(
  schema: OperationAttribute[],
  scope: AttributeScope,
  raw: unknown,
  path: string,
  asset: Record<string, string | null> = {},
): AttributeValues {
  requireValue(isObject(raw), "附加属性须为具名值对象");
  const definitions = schema.filter((field) => field.scope === scope && field.enabled);
  requireValue(Object.keys(raw).length <= 100, "附加属性值最多100项");
  const values: AttributeValues = {};
  requireValue(
    Object.keys(raw).every((key) =>
      definitions.some((field) => field.key === key),
    ),
    "附加属性必须属于采用的正式操作定义、正确层级且已启用",
  );
  for (const field of definitions) {
    const actual =
      field.source === "asset"
        ? asset[field.asset_field || ""]
        : raw[field.key];
    if (field.source === "asset" && raw[field.key] !== undefined)
      requireValue(raw[field.key] === actual, `${field.label}须从真实台账取得`);
    const missing =
      actual === undefined ||
      actual === null ||
      actual === "" ||
      (Array.isArray(actual) && !actual.length);
    const error = `${path}.${field.key}`;
    requireValue(
      !missing || !field.enabled || field.requirement !== "save",
      `请填写${field.label}`,
      422,
      { [error]: `请填写${field.label}` },
    );
    if (missing) continue;
    if (field.source === "asset") {
      values[field.key] = String(actual);
      continue;
    }
    try {
      values[field.key] = validateAttributeValue(field, actual);
    } catch (failure) {
      requireValue(false, (failure as Error).message, 422, {
        [error]: (failure as Error).message,
      });
    }
  }
  return values;
}
export function validateAttributeCondition(
  field: OperationAttribute,
  condition: unknown,
): asserts condition is AttributeCondition {
  requireValue(
    field.enabled && field.pricing && isObject(condition),
    `${field.label}未启用计价或条件无效`,
  );
  if (condition.op === "eq") {
    if (field.source === "asset")
      requireValue(
        typeof condition.value === "string" && condition.value,
        `${field.label}须填写正式台账取值`,
      );
    else validateAttributeValue(field, condition.value);
    return;
  }
  requireValue(
    condition.op === "range" &&
      (field.type === "integer" || field.type === "decimal"),
    `${field.label}只支持精确匹配或数值区间`,
  );
  const min = attributeNumber(condition.min, field.precision, field.label);
  const max = attributeNumber(condition.max, field.precision, field.label);
  requireValue(
    min <= max &&
      (field.min === undefined ||
        min >= attributeNumber(field.min, field.precision, field.label)) &&
      (field.max === undefined ||
        max <= attributeNumber(field.max, field.precision, field.label)),
    `${field.label}适用区间超出定义范围`,
  );
}

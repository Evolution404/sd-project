import { validatePricingRule } from "../domain/pricing.mjs";
import { authorize, id, now } from "./auth.mjs";
import {
  requireValue,
  expectedVersion,
  text,
  integer,
} from "../domain/errors.mjs";
const field = (key, label, type = "text", extra = {}) => ({
  key,
  label,
  type,
  ...extra,
});
const status = field("status", "状态", "select", {
  options: ["active", "inactive"],
  default: "active",
  required: true,
});
const name = field("name", "名称", "text", { required: true });
const code = field("code", "编码", "text", { required: true, immutable: true });
const ref = (key, label, reference, required = false) =>
  field(key, label, "ref", { reference, required });
const json = (key, label, defaultValue) =>
  field(key, label, "json", { default: defaultValue });
const amount = (key, label) =>
  field(key, label, "money", { required: true, default: 0 });
const rootTime = { created_at: true };
export const catalogDefinitions = {
  units: {
    title: "计量单位",
    root: "dictionary_items",
    view: "v_dictionary_current",
    versions: "dictionary_item_versions",
    foreign: "item_id",
    sequence: "version",
    typeId: "unit",
    rootFields: [code],
    fields: [name, status],
    ...rootTime,
  },
  priorities: {
    title: "优先级",
    root: "dictionary_items",
    view: "v_dictionary_current",
    versions: "dictionary_item_versions",
    foreign: "item_id",
    sequence: "version",
    typeId: "priority",
    rootFields: [code],
    fields: [name, status],
    ...rootTime,
  },
  categories: {
    title: "项目类别",
    root: "dictionary_items",
    view: "v_dictionary_current",
    versions: "dictionary_item_versions",
    foreign: "item_id",
    sequence: "version",
    typeId: "project_category",
    rootFields: [code],
    fields: [name, status],
    ...rootTime,
  },
  factors: {
    title: "价格特征",
    root: "dictionary_items",
    view: "v_dictionary_current",
    versions: "dictionary_item_versions",
    foreign: "item_id",
    sequence: "version",
    typeId: "price_factor",
    rootFields: [code],
    fields: [
      name,
      status,
      json("fields_json", "特征定义（kind及枚举值）", {
        kind: "enum",
        values: [],
      }),
    ],
    ...rootTime,
  },
  objects: {
    title: "标准作业对象",
    root: "work_objects",
    view: "v_work_object_current",
    versions: "work_object_versions",
    foreign: "work_object_id",
    rootFields: [code],
    fields: [
      name,
      status,
      field("work_target_type", "设备对象", "select", {
        options: ["line", "physical"],
        default: "line",
        required: true,
      }),
    ],
    ...rootTime,
  },
  operations: {
    title: "操作类型",
    root: "operations",
    view: "v_operation_current",
    versions: "operation_versions",
    foreign: "operation_id",
    sequence: "version",
    rootFields: [code],
    fields: [
      name,
      status,
      ref("work_object_id", "标准作业对象", "objects", true),
      ref("default_unit_id", "固定计量单位", "units", true),
      field("work_target_type", "设备对象", "select", {
        options: ["line", "physical"],
        default: "line",
        required: true,
      }),
      field("allow_tower", "允许杆塔", "boolean", { default: 1 }),
      field("allow_span", "允许档距", "boolean", { default: 0 }),
      field("default_location_kind", "默认位置", "select", {
        options: ["tower", "span"],
        default: "tower",
      }),
      field("default_target_object", "默认部位"),
      field("completion_standard", "默认验收标准", "text", { nullable: true }),
      field("entry_hint", "录入提示"),
      field("default_quantity_scaled", "建议数量", "quantity"),
      json("fields_json", "附加字段定义", []),
      json("pricing_features_json", "价格特征声明", []),
    ],
    ...rootTime,
  },
  materials: {
    title: "物资",
    root: "materials",
    view: "v_material_current",
    versions: "material_versions",
    foreign: "material_id",
    rootFields: [code, ref("unit_id", "计量单位", "units", true)],
    fields: [
      name,
      status,
      field("model", "型号"),
      field("specification", "规格"),
      field("note", "备注"),
    ],
    created_at: true,
    created_by: true,
  },
  frameworks: {
    title: "年度框架",
    root: "frameworks",
    view: "v_framework_current",
    versions: "framework_versions",
    foreign: "framework_id",
    rootFields: [
      code,
      field("fiscal_year", "年度", "integer", {
        required: true,
        default: 2026,
      }),
    ],
    fields: [name, status, amount("limit_fen", "框架额度")],
    ...rootTime,
  },
  agreements: {
    title: "执行协议",
    root: "agreements",
    view: "v_agreement_current",
    versions: "agreement_versions",
    foreign: "agreement_id",
    rootFields: [code, ref("framework_id", "年度框架", "frameworks", true)],
    fields: [
      name,
      status,
      amount("limit_fen", "协议额度"),
      field("contract_number", "合同编号", "text", { nullable: true }),
      field("counterparty_name", "合同对方", "text", { nullable: true }),
      field("signed_on", "签订日期", "date"),
      field("effective_from", "生效日期", "date"),
      field("effective_to", "截止日期", "date"),
    ],
    ...rootTime,
  },
  organizations: {
    title: "归口单位",
    root: "organizational_units",
    view: "v_organizational_unit_current",
    versions: "organizational_unit_versions",
    foreign: "unit_id",
    rootFields: [code],
    fields: [name, status, ref("parent_unit_id", "上级单位", "organizations")],
  },
  voltages: {
    title: "电压等级",
    root: "voltage_levels",
    rootFields: [code],
    fields: [name, status],
    plain: true,
  },
  lines: {
    title: "线路",
    root: "transmission_lines",
    rootFields: [
      field("line_code", "线路编码", "text", {
        required: true,
        immutable: true,
      }),
    ],
    fields: [
      name,
      ref("voltage_level_id", "电压等级", "voltages", true),
      field("status", "状态", "select", {
        options: ["active", "inactive", "retired"],
        default: "active",
      }),
      field("line_kind", "线路类型", "select", {
        options: ["main", "branch"],
        default: "main",
      }),
      ref("parent_line_id", "主线路", "lines"),
      ref("junction_tower_id", "分支接入塔", "towers"),
      field("erection_type", "架设方式"),
    ],
    equipment: true,
    history: "line_history",
    historyKey: "line_id",
  },
  physical: {
    title: "物理杆塔",
    root: "physical_towers",
    rootFields: [
      field("tower_code", "物理塔编码", "text", {
        required: true,
        immutable: true,
      }),
    ],
    fields: [
      field("asset_no", "资产编号", "text", { nullable: true }),
      field("tower_type", "塔型", "text", { nullable: true }),
      field("model", "型号"),
      field("height_scaled", "杆塔高度（米）", "quantity"),
      field("purpose", "用途"),
      field("longitude", "经度", "decimal"),
      field("latitude", "纬度", "decimal"),
      field("commissioned_on", "投运日期", "date"),
      field("status", "状态", "select", {
        options: ["active", "inactive", "retired"],
        default: "active",
      }),
    ],
    equipment: true,
    history: "physical_tower_history",
    historyKey: "physical_tower_id",
  },
  towers: {
    title: "逻辑杆塔",
    root: "logical_towers",
    rootFields: [
      field("logical_code", "逻辑塔编码", "text", {
        required: true,
        immutable: true,
      }),
    ],
    fields: [
      ref("line_id", "所属线路", "lines", true),
      ref("physical_tower_id", "物理杆塔", "physical"),
      field("tower_no", "杆塔号", "text", { required: true }),
      field("display_name", "显示名称", "text", { nullable: true }),
      field("sort_rank", "线路排序", "integer", { required: true, default: 1 }),
      field("operations_team", "运维班组"),
      field("management_department", "管辖部门"),
      field("status", "状态", "select", {
        options: ["draft", "active", "inactive", "retired"],
        default: "draft",
      }),
    ],
    equipment: true,
    history: "logical_tower_history",
    historyKey: "logical_tower_id",
  },
  spans: {
    title: "档距",
    root: "line_spans",
    rootFields: [],
    fields: [
      ref("line_id", "所属线路", "lines", true),
      ref("start_tower_id", "起点杆塔", "towers", true),
      ref("end_tower_id", "终点杆塔", "towers", true),
      field("transmission_center_length_mm", "输电中心管辖毫米数", "integer"),
      field("status", "状态", "select", {
        options: ["draft", "active", "retired"],
        default: "draft",
      }),
    ],
    equipment: true,
    history: "line_span_history",
    historyKey: "span_id",
  },
  prices: {
    title: "参考价格规则",
    root: "reference_price_catalog",
    view: "v_reference_price_current",
    versions: "reference_price_versions",
    foreign: "catalog_id",
    rootFields: [code],
    fields: [
      field("title", "规则名称", "text", { required: true }),
      status,
      ref("operation_id", "操作类型", "operations", true),
      ref("voltage_level_id", "适用电压", "voltages"),
      field("tower_type", "适用塔型", "text", { nullable: true }),
      field("work_mode", "作业方式", "select", {
        options: ["both", "outage", "non_outage"],
        default: "both",
      }),
      field("specification", "适用规格"),
      field("pricing_scope", "计价作用域", "select", {
        options: ["work_location", "work_batch", "project"],
        default: "work_location",
      }),
      field("pricing_mode", "计价模型", "select", {
        options: [
          "fixed",
          "per_unit",
          "base_plus_unit",
          "quantity_bracket",
          "progressive_bracket",
          "group",
          "rate",
          "composite",
        ],
        default: "per_unit",
      }),
      amount("base_fee_fen", "基础费"),
      amount("unit_price_fen", "单价/固定价"),
      json("quantity_brackets_json", "整批阶梯", []),
      json("calculation_params_json", "计价参数", {}),
      json("fee_components_json", "组合费用", []),
      json("additional_conditions_json", "适用特征条件", {}),
      field("price_source", "价格来源", "text", { required: true }),
      field("price_date", "价格日期", "date", { required: true }),
      field("effective_on", "生效日期", "date", { required: true }),
      field("basis", "计价依据", "text", { required: true }),
    ],
    created_at: true,
    created_by: true,
  },
};
export function createCatalog(repo) {
  const definitions = catalogDefinitions;
  function config(kind) {
    const value = definitions[kind];
    requireValue(value, "未知业务目录", 404);
    return value;
  }
  function list(kind, includeDeleted = false) {
    const c = config(kind),
      deleted = repo.deleted(kind);
    return repo
      .list(c.view || c.root)
      .filter(
        (row) =>
          (!c.typeId || row.type_id === c.typeId) &&
          (includeDeleted || !deleted.has(row.id)),
      )
      .map((row) => {
        const version = c.versions
          ? repo.latest(
              c.versions,
              c.foreign,
              row.id,
              c.sequence || "version_no",
            )
          : null;
        return {
          ...version,
          ...row,
          id: row.id,
          deleted: deleted.has(row.id),
          ...(c.plain
            ? {
                version:
                  repo
                    .auditFor(kind, row.id)
                    .filter((event) => event.action === "revise").length + 1,
              }
            : {}),
        };
      });
  }
  function get(kind, key, includeDeleted = false) {
    requireValue(
      typeof key === "string" && key.trim(),
      `请选择${config(kind).title}`,
      422,
    );
    const c = config(kind),
      row = repo.find(c.view || c.root, "id", key),
      deleted = repo.deleted(kind).has(key);
    requireValue(
      row &&
        (!c.typeId || row.type_id === c.typeId) &&
        (!deleted || includeDeleted),
      `${c.title}不存在或已删除`,
      404,
    );
    const version = c.versions
      ? repo.latest(c.versions, c.foreign, key, c.sequence || "version_no")
      : null;
    return {
      ...version,
      ...row,
      id: row.id,
      deleted,
      ...(c.plain
        ? {
            version:
              repo
                .auditFor(kind, key)
                .filter((event) => event.action === "revise").length + 1,
          }
        : {}),
    };
  }
  function audit(actor, entity, entityId, action, before, after) {
    repo.insert("audit_events", {
      id: id(),
      actor_id: actor.id,
      entity,
      entity_id: entityId,
      action,
      before_json: before ? JSON.stringify(before) : null,
      after_json: after ? JSON.stringify(after) : null,
      created_at: now(),
    });
  }
  function save(actor, kind, input, key) {
    authorize(
      actor,
      kind === "frameworks" || kind === "agreements" ? "write" : "admin",
    );
    return repo.transaction(() => {
      const c = config(kind),
        previous = key
          ? get(
              kind,
              key,
              Boolean(
                input.historical_update &&
                  c.equipment &&
                  actor.role === "admin",
              ),
            )
          : null,
        sequence = c.sequence || "version_no";
      if (previous)
        expectedVersion(
          previous[sequence] || previous.version || 1,
          input.expected_version,
        );
      const root = {},
        values = {};
      for (const f of [...c.rootFields, ...c.fields]) {
        let value = input[f.key];
        if (value === undefined) value = previous?.[f.key] ?? f.default;
        if (value === undefined) value = ["text"].includes(f.type) ? "" : null;
        if (f.required)
          requireValue(
            value !== null && value !== "",
            `请填写${f.label}`,
            422,
            { [f.key]: `请填写${f.label}` },
          );
        if (
          value !== null &&
          ["money", "quantity", "integer", "boolean"].includes(f.type)
        )
          integer(value, f.label);
        if (f.type === "json") {
          try {
            value =
              typeof value === "string"
                ? JSON.stringify(JSON.parse(value))
                : JSON.stringify(value);
          } catch {
            requireValue(false, `${f.label}JSON格式错误`);
          }
        }
        if (
          f.type === "text" &&
          (value === null || (value === "" && f.nullable))
        )
          value = f.nullable ? null : "";
        if (f.type === "date" && value === "") value = null;
        if (f.type === "ref" && value) {
          const selected = get(f.reference, value, previous?.[f.key] === value);
          requireValue(
            !["inactive", "retired"].includes(selected.status) ||
              previous?.[f.key] === value,
            `${f.label}已停用`,
          );
        }
        if (c.rootFields.includes(f)) {
          if (previous)
            requireValue(
              value === previous[f.key],
              `${f.label}是稳定身份，不能改挂`,
            );
          root[f.key] = value;
        } else values[f.key] = value;
      }
      if (kind === "factors") {
        const definition = JSON.parse(values.fields_json);
        requireValue(
          definition && ["enum", "number"].includes(definition.kind),
          "价格特征须选择文字枚举或整数类型",
        );
        if (definition.values !== undefined)
          requireValue(
            Array.isArray(definition.values) &&
              definition.values.every(
                (value) =>
                  typeof value === "string" ||
                  (value &&
                    typeof value.value === "string" &&
                    typeof value.label === "string"),
              ),
            "特征枚举值格式错误",
          );
      }
      if (kind === "operations") {
        const fields = JSON.parse(values.fields_json);
        requireValue(Array.isArray(fields), "附加字段须为完整字段清单");
        requireValue(
          new Set(fields.map((field) => field.key)).size === fields.length,
          "附加字段身份不能重复",
        );
        requireValue(
          new Set(fields.map((field) => field.label)).size === fields.length,
          "附加字段名称不能重复",
        );
        for (const field of fields)
          requireValue(
            field &&
              typeof field.key === "string" &&
              field.key &&
              typeof field.label === "string" &&
              field.label.trim() &&
              ["text", "number", "boolean", "date", "select"].includes(
                field.type,
              ) &&
              typeof field.required === "boolean" &&
              (field.type !== "select" ||
                (Array.isArray(field.options) &&
                  field.options.length > 0 &&
                  field.options.every((value) => typeof value === "string"))),
            "请完整填写附加字段名称、类型及可选内容",
          );
      }
      if (kind === "operations")
        for (const declared of JSON.parse(values.pricing_features_json))
          if (declared.source === "asset") {
            const version = repo.where("dictionary_item_versions", {
              item_id: declared.factor_id,
              version: declared.factor_version,
            })[0];
            requireValue(
              version &&
                ["tower_type", "voltage_code"].includes(
                  JSON.parse(version.fields_json).asset_field,
                ),
              "请先为台账来源的价格特征配置可自动取得的台账事实",
            );
          }
      const keyId = key || id(),
        timestamp =
          c.equipment && previous
            ? new Date(
                Math.max(Date.now(), Date.parse(previous.updated_at) + 1),
              ).toISOString()
            : now();
      if (c.typeId) {
        if (!repo.find("dictionary_types", "id", c.typeId))
          repo.insert("dictionary_types", { id: c.typeId, title: c.title });
        root.type_id = c.typeId;
      }
      if (!previous) {
        if (c.created_at || c.equipment) root.created_at = timestamp;
        if (c.created_by || c.equipment) root.created_by = actor.id;
        if (c.equipment) {
          root.updated_at = timestamp;
          root.version = 1;
        }
        repo.insert(c.root, {
          id: keyId,
          ...root,
          ...(!c.versions ? values : {}),
        });
      }
      if (kind === "operations")
        values.default_unit_version =
          previous?.default_unit_id === values.default_unit_id
            ? previous.default_unit_version
            : get("units", values.default_unit_id).version;
      if (kind === "prices") {
        validatePricingRule(values);
        const op = get("operations", values.operation_id);
        values.operation_version = op.version;
        values.unit_id = op.default_unit_id;
        values.unit_version = op.default_unit_version;
        if (values.tower_type === "") values.tower_type = null;
      }
      if (c.versions) {
        const timestampKey = [
          "dictionary_item_versions",
          "operation_versions",
        ].includes(c.versions)
          ? "changed_at"
          : kind === "prices"
            ? "created_at"
            : "recorded_at";
        const actorKey =
          kind === "organizations"
            ? "actor_id"
            : kind === "prices"
              ? "created_by"
              : "changed_by";
        repo.insert(c.versions, {
          id: id(),
          [c.foreign]: keyId,
          [sequence]: (previous?.[sequence] || 0) + 1,
          ...values,
          [actorKey]: actor.id,
          [timestampKey]: timestamp,
          reason: input.reason || "",
        });
      } else if (previous) {
        if (c.plain) {
          requireValue(
            Object.entries(values).some(
              ([field, value]) => value !== previous[field],
            ),
            "内容没有变化",
          );
          values.updated_at = timestamp;
          audit(actor, kind, keyId, "revise", previous, {
            ...previous,
            ...values,
          });
        }
        if (c.equipment)
          Object.assign(values, {
            version: previous.version + 1,
            updated_at: timestamp,
            updated_by: actor.id,
            change_reason: input.reason || "",
          });
        repo.update(c.root, "id", keyId, values);
      }
      const result = get(kind, keyId, Boolean(previous?.deleted));
      if (!(c.plain && previous))
        audit(
          actor,
          kind,
          keyId,
          previous ? "revise" : "create",
          previous,
          result,
        );
      return result;
    });
  }
  return {
    definitions,
    list,
    get,
    save,
    audit,
    history(kind, key) {
      const c = config(kind);
      get(kind, key, true);
      return c.versions
        ? repo.where(c.versions, { [c.foreign]: key })
        : c.history
          ? repo.where(c.history, { [c.historyKey]: key })
          : repo.auditFor(kind, key);
    },
    remove(actor, kind, key, version) {
      authorize(actor, "admin");
      return repo.transaction(() => {
        const previous = get(kind, key),
          c = config(kind);
        expectedVersion(
          previous[c.sequence || "version_no"] || previous.version || 1,
          version,
        );
        if (c.versions && previous.status === "active")
          save(
            actor,
            kind,
            { ...previous, status: "inactive", expected_version: version },
            key,
          );
        if (c.plain) repo.update(c.root, "id", key, { status: "inactive" });
        audit(actor, kind, key, "delete", previous, { logical: true });
        return { id: key, deleted: true };
      });
    },
  };
}

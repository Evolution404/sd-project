import { isFoundationKind } from "../dictionaries/service.js";
import { isEquipmentKind } from "../equipment/service.js";
import { validateOperationFields } from "../work-standards/catalog-validation.mjs";
import { validateFactorFields } from "../pricing/factor-catalog.mjs";
import { catalogDefinitions } from "./definitions.js";
export { catalogDefinitions } from "./definitions.js";
import { calculate, validatePricingRule } from "../pricing/calculation.js";
import { validateFactorCondition, priceRulesMayOverlap } from "../pricing/features.js";
import { authorize, id, now } from "../../platform/auth/service.js";
import {
  requireValue,
  expectedVersion,
  text,
  integer,
} from "../../shared/errors/business-error.js";
// Deactivation is a formally versioned lifecycle decision, not a new price
// definition. Every business field must exactly match the published version;
// changing applicability or prices requires a separate validated revision.
const priceDefinitionFields = ["title","operation_id","operation_version","unit_id","unit_version","voltage_level_id","tower_type","work_mode","specification","additional_conditions_json","pricing_mode","pricing_scope","calculation_params_json","fee_components_json","base_fee_fen","unit_price_fen","quantity_brackets_json","price_source","price_date","effective_on","basis"];
function unchangedPriceDefinition(previous, next) {
  if (!previous || previous.status !== "active" || next.status !== "inactive")
    return false;
  const normalized = value => {
    if (typeof value === "string" && (value.trimStart().startsWith("{") || value.trimStart().startsWith("["))) {
      try { return JSON.stringify(JSON.parse(value)); } catch { return value; }
    }
    if (value && typeof value === "object") return JSON.stringify(value);
    return value;
  };
  return priceDefinitionFields.every(key =>
    normalized(previous[key]) === normalized(next[key] === undefined ? previous[key] : next[key]));
}
export function createCatalog(repo, equipment, auditor, dictionaries, materials) {
  const audit = auditor.record;
  const definitions = catalogDefinitions;
  function config(kind) {
    const value = definitions[kind];
    requireValue(value, "未知业务目录", 404);
    return value;
  }
  function label(kind, row) {
    if (isEquipmentKind(kind)) return equipment.get(kind, row.id, true).label;
    if (kind === "materials") return [row.name, row.model, row.specification].filter(Boolean).join(" · ");
    if (kind === "frameworks") return [row.name, row.fiscal_year].filter(Boolean).join(" · ");
    if (kind === "agreements") return [row.name, row.contract_number].filter(Boolean).join(" · ");
    return row.name || row.title || "业务对象";
  }
  function referenceLabels(kind, row) {
    const descriptions = {};
    for (const field of [...config(kind).rootFields, ...config(kind).fields]) {
      if (field.type !== "ref" || !row[field.key]) continue;
      const reference = config(field.reference);
      const target = repo.find(reference.view || reference.root, "id", row[field.key]);
      // Master names are display-only; the canonical record keeps just its ID.
      descriptions[field.key + "_label"] = target
        ? label(field.reference, target) : "历史关联记录不存在";
    }
    return descriptions;
  }
  function list(kind, includeDeleted = false) {
    if (isFoundationKind(kind)) return dictionaries.list(kind, includeDeleted);
    if (kind === "materials") return materials.list(includeDeleted);
    if (isEquipmentKind(kind)) return equipment.list(kind, includeDeleted);
    const c = config(kind), deleted = repo.deleted(kind);
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
          label: label(kind, row),
          ...referenceLabels(kind, row),

        };
      });
  }
  function search(kind, options = {}) {
    return equipment.search(kind, options);
  }
  function get(kind, key, includeDeleted = false) {
    if (isFoundationKind(kind)) return dictionaries.get(kind, key, includeDeleted);
    if (kind === "materials") return materials.get(key, includeDeleted);
    if (isEquipmentKind(kind)) return equipment.get(kind, key, includeDeleted);
    requireValue(
      typeof key === "string" && key.trim(),
      `请选择${config(kind).title}`,
      422,
    );
    const c = config(kind),
      row = repo.find(c.view || c.root, "id", key),
      deleted = repo.isDeleted(kind, key);
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
      label: label(kind, row),
      ...referenceLabels(kind, row),

    };
  }
  function save(actor, kind, input, key) {
    if (isFoundationKind(kind)) return dictionaries.save(actor, kind, input, key);
    if (kind === "materials") return materials.save(actor, input, key);
    if (isEquipmentKind(kind)) return equipment.save(actor, kind, input, key);
    authorize(
      actor,
      kind === "frameworks" || kind === "agreements" ? "write" : "admin",
    );
    return repo.transaction(() => {
      const c = config(kind),
        previous = key ? get(kind, key) : null,
        sequence = c.sequence || "version_no";
      const keyId = key || id();
      input = { ...input };
      for (const f of c.rootFields.filter((field) => field.systemManaged)) {
        if (previous && input[f.key] !== undefined)
          requireValue(input[f.key] === previous[f.key], "系统身份不可修改");
        input[f.key] =
          previous?.[f.key] ||
          kind.toUpperCase() + "-" + keyId.replaceAll("-", "");
      }
      if (previous)
        expectedVersion(
          previous[sequence] || previous.version || 1,
          input.expected_version,
        );
      if (kind === "operations" && (input.work_object_id ?? previous?.work_object_id)) {
        const workObjectId = input.work_object_id ?? previous.work_object_id;
        const existingBinding = previous?.work_object_id === workObjectId;
        const workObject = get("objects", workObjectId, existingBinding);
        const status = input.status ?? previous?.status ?? "active";
        // A historic association can be retired after its master is deleted.
        // New or changed associations still require a live master.
        requireValue(
          status === "inactive" || workObject.status === "active",
          "作业对象已停用，请更换关联对象或停用操作类型",
          409,
        );
        input.work_target_type = status === "inactive" && existingBinding
          ? previous.work_target_type : workObject.work_target_type;
        if (input.work_target_type === "physical")
          Object.assign(input, {
            allow_tower: 1,
            allow_span: 0,
            default_location_kind: "tower",
          });
      }
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
          ["money", "quantity", "integer", "boolean", "length_m"].includes(f.type)
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
      if (kind === "factors") validateFactorFields({ values, previous, get, repo });
      if (kind === "operations") validateOperationFields({ values, previous, get, repo });

      const timestamp = now();
      if (c.typeId) {
        if (!repo.find("dictionary_types", "id", c.typeId))
          repo.insert("dictionary_types", { id: c.typeId, title: c.title });
        root.type_id = c.typeId;
      }
      if (!previous) {
        if (c.created_at) root.created_at = timestamp;
        if (c.created_by) root.created_by = actor.id;
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
      let overlappingPrices = [];
      if (kind === "prices") {
        validatePricingRule(values);
        const existingBinding = previous?.operation_id === values.operation_id;
        const op = get("operations", values.operation_id, existingBinding);
        requireValue(
          values.status === "inactive" || op.status === "active",
          "操作类型已停用，请更换操作类型或停用参考价格规则",
          409,
        );
        // Retiring a rule must not silently adopt a newer operation or unit.
        // Editing an existing rule must not silently adopt a newer operation
        // version. Explicit adoption is an authorized, deliberate action.
        const keepAdopted = existingBinding && !input.adopt_latest_operation_version;
        values.operation_version = keepAdopted
          ? previous.operation_version : op.version;
        values.unit_id = keepAdopted ? previous.unit_id : op.default_unit_id;
        values.unit_version = keepAdopted
          ? previous.unit_version : op.default_unit_version;
        if (values.tower_type === "") values.tower_type = null;
        const statusOnlyRetirement = unchangedPriceDefinition(previous, values);
        // A pure retirement may reference historical feature definitions;
        // all other revisions still require the current active definition.
        const adoptedVersion = repo.where("operation_versions", {
          operation_id: values.operation_id, version: values.operation_version,
        })[0];
        const declarations = JSON.parse(adoptedVersion.pricing_features_json);
        for (const [code, condition] of Object.entries(JSON.parse(values.additional_conditions_json))) {
          const factor = repo.where("dictionary_items", {
            type_id: "price_factor", code,
          })[0];
          const declared = declarations.find((f) =>
            f.factor_id === factor?.id && f.factor_version === condition.factor_version);
          requireValue(declared, "价格适用条件必须由所选操作类型的正式版本声明");
          const definitionVersion = repo.where("dictionary_item_versions", {
            item_id: factor.id, version: declared.factor_version,
          })[0];
          requireValue(definitionVersion, "价格特征定义版本不存在");
          validateFactorCondition(JSON.parse(definitionVersion.fields_json), condition, code);
          const latestFactor = repo.latest("dictionary_item_versions",
            "item_id", factor.id, "version");
          requireValue(
            statusOnlyRetirement ||
              (latestFactor?.version === declared.factor_version && latestFactor.status === "active"),
            "价格特征「" + (latestFactor?.name || code) +
              "」已更新或停用；仅变更为停用状态可保留原定义，修改价格请升级操作类型及适用条件",
            409,
          );
        }
        if (values.status === "active") {
          const deletedPrices = repo.deleted("prices");
          overlappingPrices = repo.list("v_reference_price_current")
            .filter((rule) => rule.id !== keyId && !deletedPrices.has(rule.id))
            .filter((rule) => priceRulesMayOverlap(values, rule))
            .map((rule) => rule.title);
        }
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
        repo.update(c.root, "id", keyId, values);
      }
      const result = get(kind, keyId, Boolean(previous?.deleted));
      audit(
          actor,
          kind,
          keyId,
          previous ? "revise" : "create",
          previous,
          result,
        );
      return overlappingPrices.length
        ? { ...result, warnings: [`可能与以下参考价格规则重叠：${overlappingPrices.join("、")}；正式报价须明确选择及依据`] }
        : result;
    });
  }
  return {
    definitions,
    operationPriceFeatures(key, version) {
      const selected = version
        ? repo.where("operation_versions", {
            operation_id: key, version,
          })[0]
        : repo.latest("operation_versions", "operation_id", key, "version");
      requireValue(selected, "操作类型正式版本不存在", 404);
      const items = JSON.parse(selected.pricing_features_json).map((feature) => {
        const identity = repo.find("dictionary_items", "id", feature.factor_id);
        const adopted = repo.where("dictionary_item_versions", {
          item_id: feature.factor_id, version: feature.factor_version,
        })[0];
        requireValue(identity?.type_id === "price_factor" && adopted,
          "价格特征正式定义不存在", 409);
        const definition = JSON.parse(adopted.fields_json);
        const unit = definition.unit_id
          ? repo.where("dictionary_item_versions", {
              item_id: definition.unit_id, version: definition.unit_version,
            })[0]
          : null;
        return {
          ...feature, code: identity.code, name: adopted.name, definition,
          unit: unit?.name || "",
        };
      });
      return { operation_id: key, operation_version: selected.version, items };
    },
    previewPrice(actor, input) {
      authorize(actor, "admin");
      const previous = input.existing_id
        ? get("prices", input.existing_id) : null;
      const op = get("operations", input.operation_id);
      const keepAdopted = previous &&
        previous.operation_id === input.operation_id &&
        !input.adopt_latest_operation_version;
      const rule = {
        ...input,
        operation_version: keepAdopted ? previous.operation_version : op.version,
        unit_id: keepAdopted ? previous.unit_id : op.default_unit_id,
        unit_version: keepAdopted ? previous.unit_version : op.default_unit_version,
        status: input.status || "active",
      };
      const statusOnlyRetirement = unchangedPriceDefinition(previous, rule);
      for (const [key, label] of [
        ["title", "规则名称"], ["price_source", "价格来源"],
        ["price_date", "价格日期"], ["effective_on", "生效日期"],
        ["basis", "计价依据"],
      ])
        requireValue(typeof rule[key] === "string" && rule[key].trim(),
          "请填写" + label);
      validatePricingRule(rule);
      const adopted = repo.where("operation_versions", {
        operation_id: rule.operation_id,
        version: rule.operation_version,
      })[0];
      requireValue(adopted, "操作类型采用的正式版本不存在");
      const declarations = JSON.parse(adopted.pricing_features_json);
      const conditions = typeof rule.additional_conditions_json === "string"
        ? JSON.parse(rule.additional_conditions_json) :
        (rule.additional_conditions_json || {});
      for (const [code, condition] of Object.entries(conditions)) {
        const factor = repo.where("dictionary_items", {
          type_id: "price_factor", code,
        })[0];
        const declared = declarations.find((item) =>
          item.factor_id === factor?.id &&
          item.factor_version === condition.factor_version);
        requireValue(declared, "适用条件不属于所采用操作类型的正式版本：" + code);
        const version = repo.where("dictionary_item_versions", {
          item_id: factor.id, version: declared.factor_version,
        })[0];
        validateFactorCondition(JSON.parse(version.fields_json), condition, code);
        const latestFactor = repo.latest("dictionary_item_versions",
          "item_id", factor.id, "version");
        requireValue(
          statusOnlyRetirement ||
            (latestFactor?.version === declared.factor_version && latestFactor.status === "active"),
          "价格特征「" + (latestFactor?.name || code) +
            "」已更新或停用；原定义只能原样停用，修改其他内容请升级操作类型及适用条件",
          409,
        );
      }
      const overlaps = rule.status === "active"
        ? list("prices").filter((other) => other.id !== previous?.id)
          .filter((other) => priceRulesMayOverlap(rule, other))
          .map((other) => ({
            id: other.id,
            title: other.title,
            effective_on: other.effective_on,
          }))
        : [];
      const sampleQuantity = input.sample_quantity_scaled === undefined
        ? 10000 : input.sample_quantity_scaled;
      let sample = null, sampleError = null;
      try {
        const result = calculate(rule, sampleQuantity, input.sample_bases || {});
        sample = {
          quantity_scaled: sampleQuantity, amount_fen: result.amount_fen,
          calculation_trace: result.trace,
        };
      } catch (error) {
        if (!error.status) throw error;
        sampleError = error.message;
      }
      return {
        valid: true,
        operation_version: rule.operation_version,
        unit_version: rule.unit_version,
        sample,
        sample_error: sampleError,
        overlaps,
        warning: overlaps.length ? "规则适用范围可能重叠，正式报价须人工选择并记录依据" : null,
      };
    },
    displayLabels() {
      const labels = {},
        factors = new Map(
          repo
            .where("dictionary_items", { type_id: "price_factor" })
            .map((row) => [row.id, row.code]),
        );
      for (const version of repo
        .list("dictionary_item_versions")
        .sort((a, b) => a.version - b.version)) {
        const code = factors.get(version.item_id);
        if (code) {
          labels[code] = version.name;
          labels[code + "@" + version.version] = version.name;
        }
      }
      for (const version of repo
        .list("operation_versions")
        .sort((a, b) => a.version - b.version))
        for (const field of JSON.parse(version.fields_json))
          labels[field.key] = field.label;
      return labels;
    },
    list,
    search,
    get,
    save,
    audit,
    replacementPreview: equipment.replacementPreview,
    replacePhysical: equipment.replacePhysical,
    history(kind, key) {
      if (isFoundationKind(kind)) return dictionaries.history(kind, key);
      if (kind === "materials") return materials.history(key);
      if (isEquipmentKind(kind)) return equipment.history(kind, key);
      const c = config(kind);
      get(kind, key, true);
      return c.versions
        ? repo.where(c.versions, { [c.foreign]: key })
        : c.history
          ? repo.where(c.history, { [c.historyKey]: key })
          : repo.auditFor(kind, key);
    },
    remove(actor, kind, key, version) {
      if (isFoundationKind(kind)) return dictionaries.remove(actor, kind, key, version);
      if (kind === "materials") return materials.remove(actor, key, version);
      if (isEquipmentKind(kind)) return equipment.remove(actor, kind, key, version);
      authorize(actor, "admin");
      return repo.transaction(() => {
        const previous = get(kind, key),
          c = config(kind);
        expectedVersion(
          previous[c.sequence || "version_no"] || previous.version || 1,
          version,
        );
        // A reference-price deletion is an audit-backed logical tombstone,
        // not a new price definition. Old rules may legitimately reference
        // an older feature version: re-inserting an inactive version would
        // violate the current-feature guard and prevent deletion altogether.
        // All live price selectors exclude catalog audit tombstones.
        if (c.versions && previous.status === "active" && kind !== "prices")
          save(
            actor,
            kind,
            { ...previous, status: "inactive", expected_version: version },
            key,
          );
        audit(actor, kind, key, "delete", previous, { logical: true });
        return { id: key, deleted: true };
      });
    },
  };
}

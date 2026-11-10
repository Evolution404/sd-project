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
export function createCatalog(repo) {
  const definitions = catalogDefinitions;
  function config(kind) {
    const value = definitions[kind];
    requireValue(value, "未知业务目录", 404);
    return value;
  }
  function label(kind, row) {
    if (kind === "lines")
      return (
        row.name +
        " · " +
        (repo.find("voltage_levels", "id", row.voltage_level_id)?.name ||
          "电压待确认")
      );
    if (kind === "towers")
      return (
        label("lines", repo.find("transmission_lines", "id", row.line_id)) +
        " · " +
        row.tower_no
      );
    if (kind === "physical") {
      const links = repo.where("logical_towers", { physical_tower_id: row.id });
      return links.length
        ? links.map((tower) => label("towers", tower)).join(" / ")
        : row.asset_no ||
            [
              row.tower_type,
              row.model,
              row.height_scaled ? row.height_scaled / 10000 + "米" : "",
            ]
              .filter(Boolean)
              .join(" · ") ||
            "独立物理杆塔";
    }
    if (kind === "materials")
      return [row.name, row.model, row.specification]
        .filter(Boolean)
        .join(" · ");
    if (kind === "frameworks")
      return [row.name, row.fiscal_year].filter(Boolean).join(" · ");
    if (kind === "agreements")
      return [row.name, row.contract_number].filter(Boolean).join(" · ");
    if (kind !== "spans") return row.name || row.title || "业务对象";
    return [
      repo.find("transmission_lines", "id", row.line_id)?.name,
      repo.find("logical_towers", "id", row.start_tower_id)?.tower_no +
        " ~ " +
        repo.find("logical_towers", "id", row.end_tower_id)?.tower_no,
    ].join(" ");
  }
  function physicalBindings(id, index) {
    return index ? index.get(id) || [] : repo.physicalRelations().filter(row => row.physical_tower_id === id);
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
  function enriched(kind, row, index) {
    const references = referenceLabels(kind, row);
    if (kind === "physical") {
      const bindings = physicalBindings(row.id, index);
      const current = bindings.filter(link => link.logical_status !== "retired" && !link.logical_deleted);
      return {
        ...references,
        bindings, current_circuits: current.length,
        related_lines: [...new Set(current.map(link => link.line_name))].join("、"),
        related_towers: [...new Set(current.map(link => link.tower_no))].join("、"),
      };
    }
    if (kind === "lines") return {
      ...references,
      voltage_level_name: repo.find("voltage_levels", "id", row.voltage_level_id)?.name || "",
      parent_line_name: row.parent_line_id ? repo.find("transmission_lines", "id", row.parent_line_id)?.name || "" : "",
      junction_tower_no: row.junction_tower_id ? repo.find("logical_towers", "id", row.junction_tower_id)?.tower_no || "" : "",
    };
    if (kind === "towers") {
      const line = repo.find("transmission_lines", "id", row.line_id);
      return {
        ...references,
        tower_nature: repo.find("physical_towers", "id", row.physical_tower_id)?.tower_nature ?? null,
        line_name: line?.name || "",
        voltage_level_name: line ? repo.find("voltage_levels", "id", line.voltage_level_id)?.name || "" : "",
      };
    }
    if (kind === "spans") return {
      ...references,
      line_name: repo.find("transmission_lines", "id", row.line_id)?.name || "",
      start_tower_no: repo.find("logical_towers", "id", row.start_tower_id)?.tower_no || "",
      end_tower_no: repo.find("logical_towers", "id", row.end_tower_id)?.tower_no || "",
    };
    return references;
  }
  function list(kind, includeDeleted = false) {
    const c = config(kind),
      deleted = repo.deleted(kind),
      index = kind === "physical" ? new Map() : null;
    if (index) for (const link of repo.physicalRelations()) {
      if (!index.has(link.physical_tower_id)) index.set(link.physical_tower_id, []);
      index.get(link.physical_tower_id).push(link);
    }
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
          ...enriched(kind, row, index),
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
  function search(kind, options = {}) {
    config(kind);
    const result = repo.searchEquipment(kind, options);
    const index = kind === "physical" ? new Map() : null;
    if (index) for (const link of repo.physicalRelations()) {
      if (!index.has(link.physical_tower_id)) index.set(link.physical_tower_id, []);
      index.get(link.physical_tower_id).push(link);
    }
    return {
      ...result,
      items: result.items.map((row) => ({
        ...row,
        deleted: Boolean(row.deleted),
        label: label(kind, row),
        ...enriched(kind, row, index),
      })),
    };
  }
  function get(kind, key, includeDeleted = false) {
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
      ...enriched(kind, row),
      ...(kind === "towers"
        ? { identity_decisions: repo.auditFor("tower_identity_decisions", key) }
        : {}),
      ...(kind === "physical"
        ? { replacements: repo.auditFor("tower_replacements", key) }
        : {}),
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
  function audit(actor, entity, entityId, action, before, after, recordedAt = now()) {
    repo.insert("audit_events", {
      id: id(),
      actor_id: actor.id,
      entity,
      entity_id: entityId,
      action,
      before_json: before ? JSON.stringify(before) : null,
      after_json: after ? JSON.stringify(after) : null,
      created_at: recordedAt,
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
      const keyId = key || id();
      input = { ...input };
      let physicalDecision;
      for (const f of c.rootFields.filter((field) => field.systemManaged)) {
        if (previous && input[f.key] !== undefined)
          requireValue(input[f.key] === previous[f.key], "系统身份不可修改");
        input[f.key] =
          previous?.[f.key] ||
          kind.toUpperCase() + "-" + keyId.replaceAll("-", "");
      }
      if (kind === "lines") {
        const lineKind = input.line_kind ?? previous?.line_kind ?? "main";
        const parent = input.parent_line_id ?? previous?.parent_line_id ?? null;
        const junction = input.junction_tower_id ?? previous?.junction_tower_id ?? null;
        if (lineKind === "main") {
          requireValue(!parent && !junction, "主线不能关联所属主线或分支接入塔");
        } else {
          requireValue(parent && parent !== keyId, "支线必须选择合法所属主线");
          const parentLine = get("lines", parent);
          requireValue(parentLine.line_kind === "main", "支线只能归属主线");
          if (junction) {
            const entry = get("towers", junction);
            requireValue(entry.line_id === parent, "接入杆塔必须属于指定主线");
          }
        }
      }
      if (kind === "towers" && input.tower_no !== undefined)
        input.tower_no = String(input.tower_no).trim();
      if (kind === "towers" && !previous) {
        physicalDecision = input.physical_tower_id ? "shared" : "new";
        const line = get("lines", input.line_id);
        requireValue(line.status === "active", "请选择在运线路");
        const siblings = repo.where("logical_towers", { line_id: line.id });
        requireValue(
          !siblings.some(
            (tower) =>
              tower.tower_no === input.tower_no &&
              tower.status !== "retired" &&
              !repo.isDeleted("towers", tower.id),
          ),
          "本线路已有该杆塔号，请查询已有杆塔",
          409,
          { tower_no: "本线路杆塔号重复" },
        );
        input.sort_rank ??=
          Math.max(0, ...siblings.map((tower) => tower.sort_rank)) + 1;
        input.status ??= "active";
        requireValue(
          input.physical_mode !== "shared" || input.physical_tower_id,
          "请选择要共用的已有物理杆塔",
          422,
          { physical_tower_id: "共塔必须明确选择已有实物" },
        );
        if (!input.physical_tower_id) {
          input.physical_tower_id = save(
            actor,
            "physical",
            input.physical_properties || {},
          ).id;
        } else {
          requireValue(
            !Object.values(input.physical_properties || {}).some(
              (value) => value !== undefined && value !== null && value !== "",
            ),
            "共塔关系复用已有实物，实物属性变更请在物理杆塔详情办理",
          );
          requireValue(
            get("physical", input.physical_tower_id).status === "active",
            "共用杆塔须选择在运物理实体",
          );
        }
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

      const timestamp =
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
          }, timestamp);
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
      if (physicalDecision)
        audit(actor, "tower_identity_decisions", keyId, "confirm", null, {
          decision: physicalDecision,
          physical_tower_id: result.physical_tower_id,
          label: result.label,
        });
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
    replacementPreview(key) {
      const physical = get("physical", key);
      requireValue(physical.status !== "retired", "该物理实体已退役");
      return {
        physical,
        bindings: repo
          .where("logical_towers", { physical_tower_id: key })
          .filter((tower) => tower.status !== "retired")
          .map((tower) => ({ ...tower, label: label("towers", tower) })),
      };
    },
    replacePhysical(actor, key, input) {
      authorize(actor, "admin");
      return repo.transaction(() => {
        const current = this.replacementPreview(key);
        expectedVersion(current.physical.version, input.expected_version);
        const identity = (rows) =>
          rows.map((row) => row.id + "/" + row.version).sort();
        requireValue(
          JSON.stringify(identity(current.bindings)) ===
            JSON.stringify(identity(input.bindings || [])),
          "关联回路已变化，请重新核对整基更换范围",
          409,
        );
        const replacement = save(actor, "physical", {
          ...input.properties,
          status: "active",
        });
        for (const tower of current.bindings)
          save(
            actor,
            "towers",
            {
              ...tower,
              expected_version: tower.version,
              physical_tower_id: replacement.id,
            },
            tower.id,
          );
        save(
          actor,
          "physical",
          { status: "retired", expected_version: current.physical.version },
          key,
        );
        const decision = {
          old_physical_id: key,
          new_physical_id: replacement.id,
          bindings: current.bindings.map((tower) => ({
            logical_tower_id: tower.id,
            label: tower.label,
            old_version: tower.version,
            new_version: tower.version + 1,
          })),
        };
        audit(actor, "tower_replacements", key, "replace", current, decision);
        audit(
          actor,
          "tower_replacements",
          replacement.id,
          "replace",
          null,
          decision,
        );
        return { ...get("physical", replacement.id), replacement: decision };
      });
    },
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
        if (c.plain) repo.update(c.root, "id", key, { status: "inactive" });
        audit(actor, kind, key, "delete", previous, { logical: true });
        return { id: key, deleted: true };
      });
    },
  };
}

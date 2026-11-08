import { currentSources, reviseSource } from "./sources.mjs";
import { authorize, documentCode, id, now } from "./auth.mjs";
import {
  requireValue,
  text,
  integer,
  expectedVersion,
} from "../domain/errors.mjs";
export function createDemands(repo, catalog) {
  function get(key, includeDeleted = false) {
    const row = repo.find("v_demand_current", "id", key);
    requireValue(
      row && (includeDeleted || !repo.isDeleted("demands", key)),
      "需求不存在或已删除",
      404,
    );
    const definition = JSON.parse(row.full_definition_json);
    return {
      ...definition,
      ...row,
      deleted: repo.isDeleted("demands", key),
      work_locations: definition.work_locations,
      materials: repo
        .where("demand_material_version_items", {
          demand_id: key,
          demand_version: row.current_version,
        })
        .map((item) => {
          const definition = repo.find(
            "material_versions",
            "id",
            item.material_version_id,
          );
          return {
            ...item,
            material_name: definition.name,
            model: definition.model,
            specification: definition.specification,
          };
        }),
      sources: currentSources(repo, key),
      custom_fields: JSON.parse(definition.custom_fields_json || "{}"),
      binding:
        repo.find("v_project_demand_binding_current", "demand_id", key) || null,
    };
  }
  function normalize(input, previous) {
    const operationId = input.operation_id || previous?.operation_id;
    const sameOperation = previous?.operation_id === operationId;
    const current = catalog.get("operations", operationId, sameOperation);
    requireValue(
      sameOperation ||
        input.operation_version === undefined ||
        input.operation_version === current.version,
      "操作定义已更新，请刷新后核对",
      409,
    );
    const selectedVersion = sameOperation
      ? (input.operation_version ?? previous.operation_version)
      : current.version;
    requireValue(
      !sameOperation ||
        selectedVersion === previous.operation_version ||
        selectedVersion === current.version,
      "须明确选择原操作定义或当前正式定义",
    );
    const definition = repo.where("operation_versions", {
      operation_id: operationId,
      version: selectedVersion,
    })[0];
    const op = { ...current, ...definition, id: operationId };
    requireValue(op.status === "active", "操作类型已停用");
    if (!sameOperation)
      requireValue(
        catalog.get("units", op.default_unit_id).status === "active",
        "操作类型采用的单位已停用",
      );
    const unitDefinition = repo.where("dictionary_item_versions", {
      item_id: op.default_unit_id,
      version: op.default_unit_version,
    })[0];
    const unit = { ...unitDefinition, id: op.default_unit_id };
    const object =
      sameOperation && selectedVersion === previous.operation_version
        ? { id: previous.work_object_id, name: previous.work_object_snapshot }
        : catalog.get("objects", op.work_object_id);
    requireValue(
      !input.unit_id || input.unit_id === unit.id,
      "单位必须与操作类型一致",
    );
    requireValue(
      !input.work_object_id || input.work_object_id === object.id,
      "作业对象必须与操作类型一致",
    );
    const custom =
      input.custom_fields === undefined
        ? JSON.parse(previous?.custom_fields_json || "{}")
        : input.custom_fields;
    requireValue(
      custom && typeof custom === "object" && !Array.isArray(custom),
      "补充现场字段格式错误",
    );
    const fields = JSON.parse(op.fields_json);
    requireValue(
      Object.keys(custom).every((key) =>
        fields.some((field) => field.key === key),
      ),
      "补充现场字段必须属于采用的正式操作定义",
    );
    for (const field of fields) {
      const value = custom[field.key],
        fieldError = { ["custom_fields." + field.key]: `请核对${field.label}` };
      requireValue(
        !field.required ||
          (value !== undefined && value !== null && value !== ""),
        `请填写${field.label}`,
        422,
        fieldError,
      );
      if (value === undefined || value === null || value === "") continue;
      requireValue(
        field.type !== "text" || typeof value === "string",
        `${field.label}须为文字`,
        422,
        fieldError,
      );
      requireValue(
        field.type !== "number" ||
          (typeof value === "number" && Number.isFinite(value)),
        `${field.label}必须为数值`,
        422,
        fieldError,
      );
      requireValue(
        field.type !== "boolean" || typeof value === "boolean",
        `${field.label}必须为是或否`,
        422,
        fieldError,
      );
      requireValue(
        field.type !== "select" || field.options.includes(value),
        `${field.label}不在正式可选范围`,
        422,
        fieldError,
      );
      requireValue(
        field.type !== "date" ||
          (typeof value === "string" &&
            /^\d{4}-\d{2}-\d{2}$/.test(value) &&
            !Number.isNaN(Date.parse(value))),
        `${field.label}日期无效`,
        422,
        fieldError,
      );
    }
    const raw = input.work_locations ?? previous?.work_locations;
    requireValue(
      Array.isArray(raw) && raw.length > 0 && raw.length <= 5000,
      "必须提供1至5000个作业位置",
    );
    const keys = new Set();
    const locations = raw.map((loc, index) => {
      const kind = loc.location_kind;
      requireValue(
        ["logical_tower", "physical_tower", "span"].includes(kind),
        "作业位置类型无效",
      );
      requireValue(
        (op.work_target_type === "physical") === (kind === "physical_tower"),
        "设备定位必须与操作类型一致",
      );
      requireValue(
        kind === "span" ? op.allow_span : op.allow_tower,
        "操作类型不允许此作业位置",
      );
      const key =
        kind === "span"
          ? "span_id"
          : kind === "logical_tower"
            ? "logical_tower_id"
            : "physical_tower_id";
      let entity = catalog.get(
        kind === "span"
          ? "spans"
          : kind === "logical_tower"
            ? "towers"
            : "physical",
        loc[key],
      );
      requireValue(
        !["retired", "inactive"].includes(entity.status),
        "作业位置已停用或退役",
      );
      requireValue(
        !keys.has(`${kind}/${entity.id}`),
        "同一需求不能重复列入同一位置",
      );
      keys.add(`${kind}/${entity.id}`);
      const associated =
        kind === "physical_tower"
          ? repo
              .where("logical_towers", { physical_tower_id: entity.id })
              .filter((t) => t.status === "active")
          : [];
      const lineIds = [...new Set(associated.map((t) => t.line_id))];
      const contextLineId =
        loc.context_line_id || (lineIds.length === 1 ? lineIds[0] : null);
      requireValue(
        !contextLineId || lineIds.includes(contextLineId),
        "物理塔的上下文线路必须来自其真实在运回路",
      );
      if (kind === "span") {
        const original = previous?.work_locations.find(
          (location) => location.span_id === entity.id,
        );
        const version = loc.adopt_current_definition
          ? entity.version
          : (loc.span_version ?? original?.span_version ?? entity.version);
        requireValue(
          version === entity.version || original?.span_version === version,
          "档距定义已变化，请重新核对正式版本",
          409,
        );
        const history = repo.where("line_span_history", {
          span_id: entity.id,
          version_no: version,
        })[0];
        requireValue(history, "档距历史版本不存在");
        entity = {
          id: entity.id,
          line_id: history.line_id,
          start_tower_id: history.start_tower_id,
          end_tower_id: history.end_tower_id,
          version: history.version_no,
          status: history.status,
          transmission_center_length_mm: history.transmission_center_length_mm,
        };
      }
      const line = entity.line_id
        ? catalog.get("lines", entity.line_id)
        : contextLineId
          ? catalog.get("lines", contextLineId)
          : null;
      requireValue(
        ["outage", "non_outage", "unspecified"].includes(
          loc.work_mode || "unspecified",
        ),
        "作业方式无效",
      );
      const physical =
        kind === "logical_tower" && entity.physical_tower_id
          ? catalog.get("physical", entity.physical_tower_id)
          : kind === "physical_tower"
            ? entity
            : null;
      let actual;
      try {
        actual =
          typeof loc.site_features_json === "string"
            ? JSON.parse(loc.site_features_json)
            : loc.site_features_json || {};
      } catch {
        requireValue(false, "现场特征格式错误");
      }
      requireValue(
        actual && typeof actual === "object" && !Array.isArray(actual),
        "现场特征须为具名事实对象",
      );
      actual = { ...actual };
      const asset = {
        tower_type: physical?.tower_type || null,
        voltage_code: line
          ? catalog.get("voltages", line.voltage_level_id, true).code
          : null,
      };
      for (const declared of JSON.parse(op.pricing_features_json)) {
        const factor = repo.find("dictionary_items", "id", declared.factor_id),
          version = repo.where("dictionary_item_versions", {
            item_id: factor.id,
            version: declared.factor_version,
          })[0],
          definition = JSON.parse(version.fields_json),
          value = asset[definition.asset_field];
        if (
          ["asset", "either"].includes(declared.source) &&
          value !== undefined &&
          value !== null
        ) {
          if (declared.source === "asset" && actual[factor.code])
            requireValue(
              actual[factor.code].value === value,
              "现场特征与所选设备的正式台账事实不一致",
            );
          if (declared.source === "asset" || !actual[factor.code])
            actual[factor.code] = {
              factor_version: declared.factor_version,
              value,
            };
        }
      }
      for (const [code, feature] of Object.entries(actual)) {
        const factor = repo.where("dictionary_items", {
          type_id: "price_factor",
          code,
        })[0];
        requireValue(
          factor &&
            feature &&
            typeof feature === "object" &&
            Number.isSafeInteger(feature.factor_version),
          "现场特征须引用正式价格特征及其版本",
        );
        const version = repo.where("dictionary_item_versions", {
          item_id: factor.id,
          version: feature.factor_version,
        })[0];
        requireValue(version, "现场特征定义版本不存在");
        const definition = JSON.parse(version.fields_json);
        requireValue(
          definition.kind === "number"
            ? Number.isSafeInteger(feature.value)
            : typeof feature.value === "string" && feature.value.trim(),
          "现场特征实际值类型错误",
        );
        if (definition.kind === "enum" && definition.values?.length)
          requireValue(
            definition.values.some(
              (option) =>
                (typeof option === "object" ? option.value : option) ===
                feature.value,
            ),
            "现场特征实际值不在正式字典选项中",
          );
      }
      return {
        item_no: index + 1,
        location_kind: kind,
        [key]: entity.id,
        ...(kind === "span" ? { span_version: entity.version } : {}),
        context_line_id: contextLineId,
        quantity_scaled: integer(loc.quantity_scaled, "位置数量", 1),
        work_mode: loc.work_mode || "unspecified",
        site_features_json: actual,
        location_snapshot_json: {
          line_name: line?.name || "",
          line_id: line?.id || null,
          voltage_level_id: line?.voltage_level_id || null,
          voltage_code: asset.voltage_code,
          specification:
            loc.specification ||
            loc.location_snapshot_json?.specification ||
            "",
          tower_no: entity.tower_no || "",
          physical_code: physical?.tower_code || "",
          tower_type: physical?.tower_type || null,
          span: kind === "span" ? entity : null,
          location_label:
            kind === "span"
              ? catalog.get("towers", entity.start_tower_id, true).tower_no +
                " ~ " +
                catalog.get("towers", entity.end_tower_id, true).tower_no
              : entity.tower_no || physical?.tower_code || "",
        },
      };
    });
    const total = locations.reduce((sum, loc) => sum + loc.quantity_scaled, 0);
    integer(total, "需求总数量", 1);
    const materials = (input.materials ?? previous?.materials ?? []).map(
      (item, index) => {
        const adopted = previous?.materials?.some(
          (old) => old.material_id === item.material_id,
        );
        const master = catalog.get(
          "materials",
          item.material_id,
          Boolean(adopted),
        );
        requireValue(
          master.status === "active" ||
            previous?.materials?.some((old) => old.material_id === master.id),
          "物资已停用",
        );
        return {
          material_id: master.id,
          quantity_scaled: integer(item.quantity_scaled, "预计物资数量", 1),
          note: item.note || "",
          item_no: index + 1,
        };
      },
    );
    requireValue(
      new Set(materials.map((x) => x.material_id)).size === materials.length,
      "物资不能重复",
    );
    const priorityId =
      input.priority_id === undefined
        ? previous?.priority_id || null
        : input.priority_id;
    const priority = priorityId
      ? catalog.get(
          "priorities",
          priorityId,
          priorityId === previous?.priority_id,
        )
      : null;
    const first = locations[0],
      snapshot = first.location_snapshot_json;
    return {
      operation_id: op.id,
      operation_version: op.version,
      operation_snapshot: op.name,
      work_object_id: object.id,
      work_object_snapshot: object.name,
      work_target_type: op.work_target_type,
      unit_id: unit.id,
      unit_version: unit.version,
      unit_snapshot: unit.name,
      quantity_scaled: total,
      target_object: text(
        input.target_object ||
          previous?.target_object ||
          op.default_target_object ||
          object.name,
        "处理部位",
      ),
      problem_description: text(
        input.problem_description ?? previous?.problem_description,
        "问题描述",
      ),
      completion_standard: text(
        input.completion_standard ??
          previous?.completion_standard ??
          op.completion_standard,
        "验收标准",
      ),
      priority_id: priorityId,
      priority_snapshot:
        priorityId === previous?.priority_id
          ? previous?.priority_snapshot
          : priority?.name || null,
      expected_on:
        input.expected_on === undefined
          ? (previous?.expected_on ?? null)
          : input.expected_on,
      logical_tower_id: first.logical_tower_id || null,
      physical_tower_id: first.physical_tower_id || null,
      span_id: first.span_id || null,
      span_version: first.span_version || null,
      span_snapshot_json: first.span_id ? JSON.stringify(snapshot.span) : null,
      observed_physical_tower_id: null,
      context_line_id: first.context_line_id || null,
      line_name_snapshot: snapshot.line_name,
      tower_no_snapshot: snapshot.tower_no,
      physical_code_snapshot: snapshot.physical_code,
      custom_fields_json: JSON.stringify(custom),
      field_definitions_json: op.fields_json,
      work_locations: locations,
      materials,
    };
  }
  function save(actor, input, key) {
    authorize(actor, "write");
    return repo.transaction(() => {
      const previous = key ? get(key) : null;
      if (previous)
        expectedVersion(previous.current_version, input.expected_version);
      const normalized = normalize(input, previous);
      const duplicates = repo.demandDuplicates(
        normalized.operation_id,
        normalized.work_locations,
        key,
      );
      requireValue(
        !duplicates.length ||
          (input.duplicate_decision === "separate" &&
            JSON.stringify((input.duplicate_matches || []).slice().sort()) ===
              JSON.stringify(duplicates.map((row) => row.demand_no).sort())),
        "发现同操作同位置的疑似重复需求，须人工判定",
        409,
        { duplicates: duplicates.map((x) => x.demand_no) },
      );
      let keyId = key || id(),
        timestamp = now();
      if (previous) {
        const snapshot = {
          ...JSON.parse(previous.full_definition_json),
          ...normalized,
        };
        const materialIdentity = (items) =>
          items.map((item) => ({
            material_id: item.material_id,
            quantity_scaled: item.quantity_scaled,
            note: item.note || "",
          }));
        if (
          JSON.stringify(materialIdentity(normalized.materials)) ===
          JSON.stringify(materialIdentity(previous.materials))
        )
          delete snapshot.materials;
        const sourceChange = (input.sources || []).some(
          (source) =>
            !source.id ||
            !previous.sources.some(
              (old) =>
                old.id === source.id &&
                ["description", "discovered_on", "external_record_id"].every(
                  (field) =>
                    source[field] === undefined || source[field] === old[field],
                ),
            ),
        );
        if (sourceChange) snapshot.source_changes = input.sources;
        requireValue(
          sourceChange ||
            JSON.stringify(normalized) !==
              JSON.stringify(normalize(previous, previous)),
          "需求内容没有变化",
        );
        repo.insert("demand_revisions", {
          id: id(),
          demand_id: keyId,
          version: previous.current_version + 1,
          snapshot_json: JSON.stringify(snapshot),
          changed_by: actor.id,
          changed_at: timestamp,
          reason: input.reason || "",
        });
      } else {
        const { work_locations, materials, ...root } = normalized;
        repo.insert("demands", {
          id: keyId,
          demand_no: text(input.demand_no || documentCode("XQ"), "需求编号"),
          ...root,
          initial_work_locations_json: JSON.stringify(work_locations),
          created_by: actor.id,
          created_at: timestamp,
        });
        materials.forEach((item) =>
          repo.insert("demand_material_items", {
            id: id(),
            demand_id: keyId,
            ...item,
            created_at: timestamp,
            updated_at: timestamp,
          }),
        );
      }
      if (input.sources)
        for (const source of input.sources) {
          if (source.id) {
            const current = reviseSource(
              repo,
              catalog,
              actor,
              source.id,
              source,
            );
            source.id = current.id;
            requireValue(
              repo.find("source_records", "id", source.id),
              "来源不存在",
            );
            if (
              !repo.where("demand_sources", {
                demand_id: keyId,
                source_id: source.id,
              }).length
            )
              repo.insert("demand_sources", {
                demand_id: keyId,
                source_id: source.id,
              });
          } else {
            const sourceId = id();
            repo.insert("source_records", {
              id: sourceId,
              source_system: source.source_system || "manual",
              external_record_id: source.external_record_id || null,
              description: text(source.description, "来源说明"),
              discovered_on: source.discovered_on || null,
              created_by: actor.id,
              created_at: timestamp,
            });
            repo.insert("demand_sources", {
              demand_id: keyId,
              source_id: sourceId,
            });
          }
        }
      if (duplicates.length) {
        const batchId = id();
        repo.insert("demand_batches", {
          id: batchId,
          draft_json: JSON.stringify({
            decision: "separate",
            demand_id: keyId,
          }),
          created_by: actor.id,
          created_at: timestamp,
          updated_at: timestamp,
        });
        for (const duplicate of duplicates)
          repo.insert("demand_duplicate_reviews", {
            id: id(),
            batch_id: batchId,
            matched_demand_id: duplicate.id,
            new_demand_id: keyId,
            decision: "separate",
            reason: input.duplicate_reason || "",
            actor_id: actor.id,
            created_at: timestamp,
          });
        repo.update("demand_batches", "id", batchId, {
          status: "submitted",
          version: 2,
          updated_at: now(),
        });
      }
      catalog.audit(
        actor,
        "demands",
        keyId,
        previous ? "revise" : "create",
        previous,
        get(keyId),
      );
      return get(keyId);
    });
  }
  return {
    get,
    normalize,
    save,
    list(includeDeleted = false) {
      const deleted = repo.deleted("demands");
      return repo
        .list("v_demand_current")
        .filter((x) => includeDeleted || !deleted.has(x.id))
        .map((x) => ({
          ...JSON.parse(x.full_definition_json),
          ...x,
          binding:
            repo.find("v_project_demand_binding_current", "demand_id", x.id) ||
            null,
          deleted: deleted.has(x.id),
        }));
    },
    transition(actor, key, input) {
      authorize(actor, "demand.activate");
      return repo.transaction(() => {
        const previous = get(key);
        expectedVersion(previous.current_version, input.expected_version);
        const last = repo.latest(
          "demand_lifecycle_events",
          "demand_id",
          key,
          "event_seq",
        );
        expectedVersion(last.event_seq, input.expected_event_seq);
        repo.insert("demand_lifecycle_events", {
          id: id(),
          demand_id: key,
          event_seq: last.event_seq + 1,
          from_status: previous.status,
          to_status: input.status,
          actor_id: actor.id,
          recorded_at: now(),
          reason: input.reason || "",
        });
        return get(key);
      });
    },
    history(key) {
      get(key, true);
      return {
        versions: repo.where("demand_versions", { demand_id: key }),
        reference_quotes: repo
          .where("reference_price_evaluations", { demand_id: key })
          .map((quote) => ({
            ...quote,
            lines: repo.where("reference_price_evaluation_lines", {
              evaluation_id: quote.id,
            }),
          })),
        sources: currentSources(repo, key, true),
        events: repo.where("demand_lifecycle_events", { demand_id: key }),
        bindings: repo
          .where("project_demand_scopes", { demand_id: key })
          .map((scope) => ({
            ...scope,
            events: repo.where("project_demand_link_events", {
              project_scope_id: scope.id,
            }),
          })),
      };
    },
    remove(actor, key, input) {
      authorize(actor, "admin");
      return repo.transaction(() => {
        const previous = get(key);
        expectedVersion(previous.current_version, input.expected_version);
        requireValue(
          previous.status === "cancelled",
          "需求删除前须明确取消并处理项目关联",
        );
        catalog.audit(actor, "demands", key, "delete", previous, {
          logical: true,
        });
        return { deleted: true };
      });
    },
  };
}

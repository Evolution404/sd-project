import { currentSources, reviseSource, removeSource } from "./sources.js";
import type { Actor, ListQuery, Page } from "../../shared/types/contracts.js";
import { isObject } from "../../shared/types/contracts.js";
import type { Database } from "../../database/connection.js";
import type { DemandRepository } from "../../database/repositories/demands.js";
import type {
  DemandCatalog, DemandWriteInput, DemandRecord, DemandLocation, DemandListItem,
  NormalizedDemand, DemandStatus, DemandMaterialInput,
} from "../../shared/types/demands.js";
import { normalizeAttributeValues, validateAttributeSchema } from "../../shared/operation-attributes.js";
import { assertQuantityPrecision } from "../../shared/quantity-precision.js";
import { authorize, documentCode, id, now } from "../../platform/auth/service.js";
import {
  requireValue,
  text,
  integer,
  expectedVersion,
} from "../../shared/errors/business-error.js";
function parseDemandInput(value: unknown): DemandWriteInput {
  requireValue(isObject(value), "需求内容必须为对象");
  requireValue(value.work_locations === undefined || Array.isArray(value.work_locations),
    "作业位置必须是列表");
  requireValue(!Array.isArray(value.work_locations) || value.work_locations.every(isObject), "每个作业位置须为完整事实对象");
  requireValue(value.materials === undefined || Array.isArray(value.materials), "预计物资必须是列表");
  requireValue(value.sources === undefined || Array.isArray(value.sources), "来源必须是列表");
  requireValue(!Array.isArray(value.materials) || value.materials.every(isObject), "每项预计物资须为对象");
  requireValue(!Array.isArray(value.sources) || value.sources.every(isObject), "每项来源须为对象");
  requireValue(value.attributes === undefined || isObject(value.attributes),
    "补充现场字段必须是对象");
  return value as DemandWriteInput;
}
function parseLifecycleInput(value: unknown): {
  expected_version: number; expected_event_seq: number; status: DemandStatus; reason?: string
} {
  requireValue(isObject(value) && (["pending","active","returned","cancelled"] as unknown[]).includes(value.status),
    "需求生命周期状态无效");
  return value as unknown as {
    expected_version: number; expected_event_seq: number; status: DemandStatus; reason?: string
  };
}
export function createDemands(
  repo: DemandRepository,
  catalog: DemandCatalog,
  database: Pick<Database, "transaction">
) {
  function get(key: string, includeDeleted = false): DemandRecord {
    const row = repo.current(key);
    requireValue(
      row && (includeDeleted || !repo.isDeleted(key)),
      "需求不存在或已删除",
      404,
    );
    const definition = JSON.parse(row.full_definition_json) as NormalizedDemand;
    return {
      ...definition,
      ...row,
      deleted: repo.isDeleted(key),
      work_locations: definition.work_locations,
      materials: repo.materials(key, row.current_version),
      sources: currentSources(repo, key),
      binding:
        repo.binding(key) || null,
    };
  }
  function normalize(raw: unknown, previous: DemandRecord | null = null): NormalizedDemand {
    const input = parseDemandInput(raw);
    const operationId = input.operation_id || previous?.operation_id;
    requireValue(typeof operationId === "string" && operationId.trim(), "请选择操作类型");
    const sameOperation = Boolean(previous && previous.operation_id === operationId);
    const current = catalog.get("operations", operationId, sameOperation);
    requireValue(
      sameOperation ||
        input.operation_version === undefined ||
        input.operation_version === current.version,
      "操作定义已更新，请刷新后核对",
      409,
    );
    const selectedVersion = sameOperation
      ? (input.operation_version ?? previous?.operation_version ?? current.version)
      : current.version;
    requireValue(
      !sameOperation ||
        selectedVersion === previous?.operation_version ||
        selectedVersion === current.version,
      "须明确选择原操作定义或当前正式定义",
    );
    const definition = repo.operationVersion(operationId, selectedVersion);
    requireValue(definition, "操作类型正式版本不存在", 404);
    const op = { ...current, ...definition, id: operationId };
    requireValue(op.status === "active", "操作类型已停用");
    if (!sameOperation)
      requireValue(
        catalog.get("units", op.default_unit_id).status === "active",
        "操作类型采用的单位已停用",
      );
    const unitDefinition = repo.unitVersion(op.default_unit_id, op.default_unit_version);
    requireValue(unitDefinition, "正式计量单位版本不存在", 404);
    const unit = { ...unitDefinition, id: op.default_unit_id };
    const adoptedObject = repo.workObjectVersion(op.work_object_id, op.work_object_version_no);
    requireValue(adoptedObject, "所选操作类型引用的作业对象正式版本不存在", 404);
    const object = { ...adoptedObject, id: op.work_object_id };
    requireValue(
      !input.unit_id || input.unit_id === unit.id,
      "单位必须与操作类型一致",
    );
    requireValue(
      !input.work_object_id || input.work_object_id === object.id,
      "作业对象必须与操作类型一致",
    );
    const schema = validateAttributeSchema(JSON.parse(op.attributes_schema_json));
    const attributes = normalizeAttributeValues(schema, "demand", input.attributes ?? previous?.attributes ?? {}, "attributes");
    const rawLocations = input.work_locations ?? previous?.work_locations;
    requireValue(
      Array.isArray(rawLocations) && rawLocations.length > 0 && rawLocations.length <= 5000,
      "必须提供1至5000个作业位置",
    );
    const keys = new Set<string>();
    const locations: DemandLocation[] = rawLocations.map((loc, index): DemandLocation => {
      const kind = loc.location_kind;
      requireValue(
        ["logical_tower", "physical_tower", "span"].includes(kind),
        "作业位置类型无效",
      );
      requireValue(
        (object.attribution_unit === "physical_tower") === (kind === "physical_tower"),
        "设备定位必须与作业对象归属单元一致",
      );
      requireValue(
        kind !== "span" || object.object_position === "corridor",
        "只有通道作业对象可以选择档距作业点位",
      );
      const key =
        kind === "span"
          ? "span_id"
          : kind === "logical_tower"
            ? "logical_tower_id"
            : "physical_tower_id";
      requireValue(typeof loc[key] === "string" && loc[key], "请选择真实作业位置");
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
          ? repo.activePhysicalCircuits(entity.id)
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
        const history = repo.spanVersion(entity.id, version);
        requireValue(history, "档距历史版本不存在");
        entity = {
          ...entity,
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
      const voltage = line?.voltage_level_id ? catalog.get("voltages", line.voltage_level_id, true) : null;
      const original = previous?.operation_id === operationId && previous.operation_version === selectedVersion
        ? previous.work_locations.find((item) => item.location_kind === kind && item[key] === entity.id) : undefined;
      const frozen = original?.location_snapshot_json;
      const snapshotAsset = frozen || {
        voltage_level_id: line?.voltage_level_id || null,
        tower_material: physical?.tower_material || null,
        tower_nature: physical?.tower_nature || null,
      };
      const locationAttributes = normalizeAttributeValues(schema, "location", loc.attributes ?? original?.attributes ?? {},
        `work_locations.${index}.attributes`, {
          voltage_level_id: snapshotAsset.voltage_level_id,
          tower_material: snapshotAsset.tower_material,
          tower_nature: snapshotAsset.tower_nature,
        });
      return {
        item_no: index + 1,
        location_kind: kind,
        [key]: entity.id,
        ...(kind === "span" ? { span_version: entity.version } : {}),
        context_line_id: contextLineId,
        quantity_scaled: assertQuantityPrecision(
          integer(loc.quantity_scaled, "位置数量", 1),
          unit.fields_json, unit.name, `work_locations.${index}.quantity_scaled`,
        ),
        work_mode: loc.work_mode || "unspecified",
        attributes: locationAttributes,
        location_snapshot_json: {
          physical_tower_id: frozen?.physical_tower_id ?? physical?.id ?? null,
          line_name: line?.name || "",
          line_id: line?.id || null,
          voltage_level_id: snapshotAsset.voltage_level_id,
          voltage_code: frozen?.voltage_code ?? voltage?.code ?? null,
          specification:
            loc.specification ||
            loc.location_snapshot_json?.specification ||
            "",
          tower_no:
            entity.tower_no ||
            associated
              .filter(
                (tower) => !contextLineId || tower.line_id === contextLineId,
              )
              .map((tower) => tower.tower_no)
              .join(" / "),
          asset_no: physical?.asset_no || null,
          physical_code: physical?.tower_code || "",
          tower_material: snapshotAsset.tower_material,
          tower_nature: snapshotAsset.tower_nature,
          span: kind === "span" ? entity : null,
          location_label:
            kind === "span"
              ? catalog.get("towers", text(entity.start_tower_id, "起始杆塔"), true).tower_no +
                " ~ " +
                catalog.get("towers", text(entity.end_tower_id, "终止杆塔"), true).tower_no
              : entity.tower_no || physical?.label || "真实作业位置",
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
          quantity_scaled: (() => {
            const requested = integer(item.quantity_scaled, "预计物资数量", 1);
            // Unchanged historical quantities must not be retroactively rejected
            // merely because the material's unit was revised later.
            if (previous?.materials?.some((old) =>
              old.material_id === master.id && old.quantity_scaled === requested)) return requested;
            const unitCurrent = catalog.get("units", master.unit_id);
            const materialUnit = repo.unitVersion(master.unit_id, unitCurrent.version);
            requireValue(materialUnit, "物资计量单位正式版本不存在", 404);
            return assertQuantityPrecision(requested, materialUnit.fields_json,
              materialUnit.name, `materials.${index}.quantity_scaled`);
          })(),
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
      object_position: object.object_position,
      attribution_unit: object.attribution_unit,
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
      observed_physical_tower_id: first.logical_tower_id ? snapshot.physical_tower_id : null,
      context_line_id: first.context_line_id || null,
      line_name_snapshot: snapshot.line_name,
      tower_no_snapshot: snapshot.tower_no,
      physical_code_snapshot: snapshot.physical_code,
      attributes,
      work_locations: locations,
      materials,
    };
  }
  function save(actor: Actor, raw: unknown, key?: string, context: {batchId?: string} = {}): DemandRecord {
    const input = parseDemandInput(raw);
    authorize(actor, "write");
    return database.transaction(() => {
      const previous = key ? get(key) : null;
      if (previous)
        expectedVersion(previous.current_version, input.expected_version);
      const normalized = normalize(input, previous);
      const duplicates = repo.duplicates(
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
        const materialIdentity = (items: DemandMaterialInput[]) =>
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
            source.action === "delete" || !source.id ||
            !previous.sources.some(
              (old) =>
                old.id === source.id &&
                (["description", "discovered_on", "external_record_id"] as const).every(
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
        repo.appendRevision({
          id: id(),
          demand_id: keyId,
          version: previous.current_version + 1,
          snapshot_json: JSON.stringify(snapshot),
          changed_by: actor.id,
          changed_at: timestamp,
          reason: input.reason || "",
        });
      } else {
        const { work_locations, materials, attributes, ...root } = normalized;
        repo.createDemand({
          id: keyId,
          demand_no: documentCode("XQ", keyId),
          batch_id: context.batchId || null,
          ...root,
          initial_attributes_json: JSON.stringify(attributes),
          initial_work_locations_json: JSON.stringify(work_locations),
          created_by: actor.id,
          created_at: timestamp,
        });
        materials.forEach((item) =>
          repo.appendExpectedMaterial({
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
          requireValue(source.action === undefined || source.action === "upsert" || source.action === "delete", "未知来源操作");
          if (source.action === "delete") {
            requireValue(source.id && repo.linkedSource(keyId, source.id), "删除来源须明确本需求已有来源身份");
            removeSource(repo, catalog, actor, source.id);
          } else if (source.id) {
            requireValue(repo.linkedSource(keyId, source.id), "来源身份不属于本需求");
            const current = reviseSource(
              repo,
              catalog,
              actor,
              source.id,
              source,
            );
            source.id = current.id;
            requireValue(repo.source(current.id), "来源不存在");
            if (!repo.linkedSource(keyId, current.id))
              repo.linkSource(keyId, current.id);
          } else {
            const sourceId = id();
            repo.createSource({
              id: sourceId,
              source_system: context.batchId ? "excel" : "manual",
              external_record_id: null,
              description: text(source.description, "来源说明"),
              discovered_on: source.discovered_on || null,
              created_by: actor.id,
              created_at: timestamp,
            });
            repo.linkSource(keyId, sourceId);
          }
        }
      if (duplicates.length) {
        const batchId = id();
        repo.createDuplicateBatch({
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
          repo.appendDuplicateReview({
            id: id(),
            batch_id: batchId,
            matched_demand_id: duplicate.id,
            new_demand_id: keyId,
            decision: "separate",
            reason: input.duplicate_reason || "",
            actor_id: actor.id,
            created_at: timestamp,
          });
        repo.finalizeDuplicateBatch(batchId, now());
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
    findDuplicates(operationId: string, locations: DemandLocation[], exceptId?:string) {
      return repo.duplicates(operationId, locations, exceptId);
    },
    save,
    search(query: ListQuery): Page<DemandListItem> {
      const result = repo.search(query);
      return { ...result, items: result.items.map(({ binding_json, ...row }) => ({
        ...JSON.parse(row.full_definition_json), ...row,
        binding: binding_json ? JSON.parse(binding_json) : null,
        deleted: Boolean(row.deleted),
      })) };
    },
    searchCandidates(query: ListQuery, includePending = false): Page<DemandListItem> {
      const result = repo.eligibleCandidates(query, includePending);
      return { ...result, items: result.items.map(row => ({
        ...JSON.parse(row.full_definition_json),
        ...row,
        binding: null,
        deleted: false
      })) };
    },
    list(includeDeleted = false): DemandListItem[] {
      return repo.currentAll()
        .filter((row) => includeDeleted || !row.deleted)
        .map(({binding_json, ...row}) => ({
          ...JSON.parse(row.full_definition_json),
          ...row,
          binding: binding_json ? JSON.parse(binding_json) : null,
          deleted: Boolean(row.deleted),
        }));
    },
    transition(actor: Actor, key: string, raw: unknown): DemandRecord {
      const input = parseLifecycleInput(raw);
      authorize(actor, "demand.activate");
      return database.transaction(() => {
        const previous = get(key);
        expectedVersion(previous.current_version, input.expected_version);
        const last = repo.lastLifecycle(key);
        requireValue(last, "需求初始状态事件不存在", 409);
        expectedVersion(last.event_seq, input.expected_event_seq);
        requireValue(!(input.status === "returned" && repo.binding(key)),
          "需求已由子项目承接，不能退回；请正式修订需求，或先按项目规则明确解除关联", 409);
        repo.appendLifecycle({
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
    history(key: string) {
      get(key, true);
      return repo.history(key);
    },
    remove(actor: Actor, key: string, raw: unknown): { deleted: true } {
      requireValue(isObject(raw), "请提供需删除需求的版本");
      const input = raw;
      authorize(actor, "admin");
      return database.transaction(() => {
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

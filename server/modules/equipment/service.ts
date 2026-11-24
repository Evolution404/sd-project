import { authorize, id, now } from "../../platform/auth/service.js";
import type { AuditService } from "../../platform/audit/service.js";
import type { Database } from "../../database/connection.js";
import type { EquipmentRepository } from "../../database/repositories/equipment.js";
import type { DictionaryService } from "../dictionaries/service.js";
import type { Actor, Page } from "../../shared/types/contracts.js";
import { isObject } from "../../shared/types/contracts.js";
import type {
  EquipmentCatalogKind,
  EquipmentKind,
  EquipmentRecord,
  EquipmentFields,
  EquipmentFieldValue,
  EquipmentSearchOptions,
  PhysicalBinding,
  ReplacementPreview,
  ReplacementBinding,
} from "../../shared/types/equipment.js";
import {
  requireValue,
  expectedVersion,
  integer,
  text,
} from "../../shared/errors/business-error.js";
import { catalogDefinitions } from "../catalog/definitions.js";
import { EQUIPMENT_BULK_FIELDS, isEquipmentBulkKind } from "../../shared/equipment-bulk.js";

export function isEquipmentKind(kind: string): kind is EquipmentCatalogKind {
  return ["voltages", "lines", "physical", "towers", "spans"].includes(kind);
}
// A label is one business attribute, never a concatenation of relationship fields.
function physicalLabel(row: EquipmentRecord): string {
  return row.asset_no || row.tower_code || "独立物理杆塔";
}

export function createEquipment(
  repository: EquipmentRepository,
  database: Pick<Database, "transaction">,
  audit: AuditService,
  dictionaries: DictionaryService,
) {
  function decorate(
    kind: EquipmentCatalogKind,
    rows: EquipmentRecord[],
  ): EquipmentRecord[] {
    const ids = [
      ...new Set(
        rows
          .map((row) => (kind === "physical" ? row.id : row.physical_tower_id))
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    const bindings = new Map<string, PhysicalBinding[]>();
    for (const binding of repository.bindings(ids)) {
      const related = bindings.get(binding.physical_tower_id) || [];
      related.push(binding);
      bindings.set(binding.physical_tower_id, related);
    }
    return rows.map((row) => {
      const related =
        bindings.get(
          kind === "physical" ? row.id : row.physical_tower_id || "",
        ) || [];
      let label = row.name || "业务对象";
      if (kind === "physical") label = physicalLabel(row);
      if (kind === "towers") label = row.tower_no || "杆塔号未知";
      // Span endpoints have independent fields; no fabricated compound name.
      if (kind === "spans") label = "档距";
      const current = related.filter(
        (link) => link.logical_status !== "retired" && !link.logical_deleted,
      );
      return {
        ...row,
        deleted: Boolean(row.deleted),
        label,
        ...(kind === "physical"
          ? {
              bindings: related,
              current_circuits: current.length,
              related_lines: [
                ...new Set(current.map((link) => link.line_name)),
              ].join("、"),
              related_towers: [
                ...new Set(current.map((link) => link.tower_no)),
              ].join("、"),
            }
          : {}),

      };
    });
  }
  function get(
    kind: EquipmentCatalogKind,
    key: string,
    includeDeleted = false,
  ): EquipmentRecord {
    requireValue(
      typeof key === "string" && key.trim(),
      `请选择${catalogDefinitions[kind].title}`,
      422,
    );
    const row = repository.current(kind, key);
    requireValue(
      row && (includeDeleted || !row.deleted),
      `${catalogDefinitions[kind].title}不存在或已删除`,
      404,
    );
    return {
      ...decorate(kind, [row])[0]!,
      ...(kind === "towers"
        ? { identity_decisions: audit.history("tower_identity_decisions", key) }
        : {}),
      ...(kind === "physical"
        ? { replacements: audit.history("tower_replacements", key) }
        : {}),
    };
  }
  function fields(
    kind: EquipmentCatalogKind,
    input: Record<string, unknown>,
    previous: EquipmentRecord | null,
  ): EquipmentFields {
    const definition = catalogDefinitions[kind],
      values: EquipmentFields = {};
    for (const field of [...definition.rootFields, ...definition.fields]) {
      const key = field.key as keyof EquipmentRecord;
      let value = input[field.key];
      if (value === undefined) value = previous?.[key] ?? field.default;
      if (value === undefined) value = field.type === "text" ? "" : null;
      if (
        field.type === "text" &&
        (value === null || (value === "" && field.nullable))
      )
        value = field.nullable ? null : "";
      if (field.type === "date" && value === "") value = null;
      requireValue(
        !field.required || (value !== null && value !== ""),
        `请填写${field.label}`,
        422,
        { [field.key]: `请填写${field.label}` },
      );
      if (value !== null) {
        if (["quantity", "integer", "length_m"].includes(field.type))
          integer(value, field.label);
        else if (field.type === "decimal") {
          value =
            typeof value === "string" && value.trim() ? Number(value) : value;
          requireValue(
            typeof value === "number" && Number.isFinite(value),
            `${field.label}必须为有效数字`,
          );
        } else
          requireValue(typeof value === "string", `${field.label}必须为文本`);
      }
      if (field.options && value !== null)
        requireValue(
          field.options.includes(String(value)),
          `${field.label}不符合选项约束`,
          422,
          { [field.key]: `请选择合法的${field.label}` },
        );
      if (field.type === "ref" && value) {
        requireValue(field.reference,"请选择关联类型");
        const selected = field.reference === "tower_natures" || field.reference === "tower_materials"
          ? dictionaries.get(field.reference,text(value,field.label),previous?.[key]===value)
          : isEquipmentKind(field.reference)
            ? get(field.reference,text(value,field.label),previous?.[key]===value)
            : null;
        requireValue(selected,field.label+"关联类型无效");
        requireValue(
          !["inactive", "retired"].includes(selected.status) ||
            previous?.[key] === value,
          `${field.label}已停用`,
        );
      }
      if (definition.rootFields.includes(field) && previous)
        requireValue(
          value === previous[key],
          `${field.label}是稳定身份，不能改挂`,
        );
      if (!previous || !definition.rootFields.includes(field))
        values[key] = value as EquipmentFieldValue;
    }
    return values;
  }
  function save(
    actor: Actor,
    kind: EquipmentCatalogKind,
    supplied: Record<string, unknown>,
    key?: string,
  ): EquipmentRecord {
    authorize(actor, "admin");
    return database.transaction(() => {
      const definition = catalogDefinitions[kind];
      const previous = key
        ? get(
            kind,
            key,
            Boolean(
              supplied.historical_update && definition.equipment,
            ),
          )
        : null;
      const assetId = key || id(),
        input = { ...supplied };
      for (const field of definition.rootFields.filter(
        (field) => field.systemManaged,
      )) {
        if (previous && input[field.key] !== undefined)
          requireValue(
            input[field.key] === previous[field.key as keyof EquipmentRecord],
            "系统身份不可修改",
          );
        input[field.key] =
          previous?.[field.key as keyof EquipmentRecord] ||
          (kind === "spans" ? undefined : repository.nextNumber(kind));
      }
      if (previous) expectedVersion(previous.version, input.expected_version);
      if (kind === "lines") {
        const lineKind = input.line_kind ?? previous?.line_kind ?? "main";
        const parent = input.parent_line_id ?? previous?.parent_line_id ?? null;
        const junction =
          input.junction_tower_id ?? previous?.junction_tower_id ?? null;
        if (lineKind === "main")
          requireValue(
            !parent && !junction,
            "主线不能关联所属主线或分支接入塔",
          );
        else {
          requireValue(
            parent && parent !== assetId,
            "支线必须选择合法所属主线",
          );
          const parentLine = get("lines", text(parent, "所属主线"));
          requireValue(parentLine.line_kind === "main", "支线只能归属主线");
          if (junction)
            requireValue(
              get("towers", text(junction, "接入杆塔")).line_id === parent,
              "接入杆塔必须属于指定主线",
            );
        }
      }
      let physicalDecision: "shared" | "new" | undefined;
      if (kind === "towers" && input.tower_no !== undefined)
        input.tower_no = String(input.tower_no).trim();
      if (kind === "towers" && !previous) {
        physicalDecision = input.physical_tower_id ? "shared" : "new";
        const line = get("lines", text(input.line_id, "所属线路"));
        requireValue(line.status === "active", "请选择在运线路");
        const siblings = repository.towersInLine(line.id);
        requireValue(
          !siblings.some(
            (tower) =>
              tower.tower_no === input.tower_no &&
              tower.status !== "retired" &&
              !tower.deleted,
          ),
          "本线路已有该杆塔号，请查询已有杆塔",
          409,
          { tower_no: "本线路杆塔号重复" },
        );
        input.sort_rank ??=
          Math.max(0, ...siblings.map((tower) => tower.sort_rank || 0)) + 1;
        input.status ??= "active";
        requireValue(
          input.physical_mode !== "shared" || input.physical_tower_id,
          "请选择要共用的已有物理杆塔",
          422,
          { physical_tower_id: "共塔必须明确选择已有实物" },
        );
        const properties = input.physical_properties || {};
        requireValue(isObject(properties), "物理杆塔资料必须为对象");
        if (!input.physical_tower_id)
          input.physical_tower_id = save(actor, "physical", properties).id;
        else {
          requireValue(
            !Object.values(properties).some(
              (value) => value !== undefined && value !== null && value !== "",
            ),
            "共塔关系复用已有实物，实物属性变更请在物理杆塔详情办理",
          );
          requireValue(
            get("physical", text(input.physical_tower_id, "物理杆塔"))
              .status === "active",
            "共用杆塔须选择在运物理实体",
          );
        }
      }
      const values = fields(kind, input, previous);
      const timestamp =
        definition.equipment && previous
          ? new Date(
              Math.max(Date.now(), Date.parse(previous.updated_at!) + 1),
            ).toISOString()
          : now();
      if (!previous) {
        repository.createAsset(kind, assetId, {
          ...values,
          ...(definition.equipment
            ? {
                created_at: timestamp,
                created_by: actor.id,
                updated_at: timestamp,
                version: 1,
              }
            : {}),
        });
      } else {
        if (definition.plain)
          requireValue(
            Object.entries(values).some(
              ([field, value]) =>
                value !== previous[field as keyof EquipmentRecord],
            ),
            "内容没有变化",
          );
        if (definition.plain)
          audit.record(
            actor,
            kind,
            assetId,
            "revise",
            previous,
            { ...previous, ...values, updated_at: timestamp },
            timestamp,
          );
        repository.reviseAsset(kind, assetId, {
          ...values,
          ...(definition.equipment
            ? {
                version: previous.version + 1,
                updated_at: timestamp,
                updated_by: actor.id,
                change_reason:
                  typeof input.reason === "string" ? input.reason : "",
              }
            : { updated_at: timestamp }),
        });
      }
      const result = get(kind, assetId, Boolean(previous?.deleted));
      if (!(definition.plain && previous))
        audit.record(
          actor,
          kind,
          assetId,
          previous ? "revise" : "create",
          previous,
          result,
          timestamp,
        );
      if (physicalDecision)
        audit.record(
          actor,
          "tower_identity_decisions",
          assetId,
          "confirm",
          null,
          {
            decision: physicalDecision,
            physical_tower_id: result.physical_tower_id,
            label: result.label,
          },
        );
      return result;
    });
  }
  function bulk(actor: Actor, kind: EquipmentCatalogKind, input: unknown) {
    authorize(actor, "admin");
    requireValue(isEquipmentBulkKind(kind), "此设备类别不支持批量维护", 422);
    requireValue(isObject(input) && Array.isArray(input.rows) && input.rows.length >= 1 && input.rows.length <= 100,
      "每次请选择1至100条设备", 422);
    const rows = input.rows;
    const allowed = new Set<string>(EQUIPMENT_BULK_FIELDS[kind]);
    return database.transaction(() => {
      const ids = new Set<string>();
      const prepared = rows.map((row: unknown) => {
        requireValue(isObject(row) && Object.keys(row).every(k => ["id","expected_version","changes"].includes(k)), "批量设备记录格式无效", 422);
        const key = text(row.id, "设备ID");
        requireValue(!ids.has(key), "批次内设备身份重复", 422);
        ids.add(key);
        const prior = get(kind, key);
        expectedVersion(prior.version, row.expected_version);
        requireValue(prior.status !== "retired", "退役设备请走独立历史维护流程", 422);
        requireValue(isObject(row.changes) && Object.keys(row.changes).length > 0, "修改字段不能为空", 422);
        const changes: Record<string, unknown> = {};
        for (const [field, raw] of Object.entries(row.changes)) {
          requireValue(allowed.has(field), "不允许批量修改字段：" + field, 422);
          let value = raw;
          if (field === "name" || field === "tower_no" || field === "voltage_level_id") value = text(raw, field);
          else if (field === "sort_rank") { integer(value, "线路排序"); requireValue(Number(value) >= 1, "线路排序必须为正整数", 422); }
          else if (field === "asset_no") value = raw === null || raw === "" ? null : text(raw, "现场铭牌");
          else if (field === "height_scaled" || field === "transmission_center_length_mm") {
            if (value !== null) integer(value, field);
          } else if (field === "longitude" || field === "latitude") {
            const limit = field === "longitude" ? 180 : 90;
            requireValue(value === null || (typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit),
              "经纬度范围无效", 422);
          } else if (field === "commissioned_on") {
            requireValue(value === null || (typeof value === "string" && /^\\d{4}-\\d{2}-\\d{2}$/.test(value) &&
              Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value), "投运日期无效", 422);
          } else {
            requireValue(typeof value === "string" || (value === null && ["tower_material","tower_nature","display_name"].includes(field)),
              "字段类型无效：" + field, 422);
          }
          if (value !== prior[field as keyof EquipmentRecord]) changes[field] = value;
        }
        return { key, version: prior.version, changes };
      });
      const changed = prepared.filter(row => Object.keys(row.changes).length);
      if (kind === "towers") {
        const proposed = new Map(prepared.map(row => [row.key,row.changes]));
        const lineIds = new Set(changed.map(row => get("towers",row.key).line_id!));
        for (const lineId of lineIds) {
          const seen = new Set<string>();
          for (const tower of repository.towersInLine(lineId)) {
            if (tower.deleted || tower.status === "retired") continue;
            const next = proposed.get(tower.id);
            const no = String(next?.tower_no ?? tower.tower_no).trim();
            requireValue(!seen.has(no),"本线路杆塔号重复",422);
            seen.add(no);
          }
        }
      }
      for (const row of changed) save(actor, kind, { ...row.changes, expected_version: row.version, reason: "批量维护普通设备资料" }, row.key);
      return {count: changed.length, ids: changed.map(row => row.key)};
    });
  }
  function replacementPreview(key: string): ReplacementPreview {
    const physical = get("physical", key);
    requireValue(physical.status !== "retired", "该物理实体已退役");
    const bindings = repository.boundTowers(key);
    requireValue(!bindings.some(tower => tower.deleted && tower.status === "active"),
      "有已删除但仍为在运状态的关联逻辑杆塔，请先核实其退役事实并办理历史更正", 409);
    return {
      physical,
      bindings: decorate("towers", bindings.filter(tower => !tower.deleted)),
    };
  }
  return {
    get,
    save,
    bulk,
    list: (
      kind: EquipmentCatalogKind,
      includeDeleted = false,
    ): EquipmentRecord[] =>
      decorate(kind, repository.all(kind, includeDeleted)),
    search: (
      kind: EquipmentKind,
      options: EquipmentSearchOptions = {},
    ): Page<EquipmentRecord> => {
      const page = repository.search(kind, options);
      return { ...page, items: decorate(kind, page.items) };
    },
    history(kind: EquipmentCatalogKind, key: string) {
      get(kind, key, true);
      return kind === "voltages"
        ? audit.history(kind, key)
        : repository.history(kind, key);
    },
    deletionImpact(actor: Actor, kind: EquipmentCatalogKind, key: string) {
      authorize(actor, "admin");
      return { expected_version: get(kind, key).version, references: repository.deletionReferences(kind, key) };
    },
    remove(
      actor: Actor,
      kind: EquipmentCatalogKind,
      key: string,
      version: unknown,
      references?: unknown,
    ) {
      authorize(actor, "admin");
      return database.transaction(() => {
        const previous = get(kind, key);
        expectedVersion(previous.version, version);
        const current = repository.deletionReferences(kind, key);
        requireValue(references === undefined || (isObject(references) &&
          Object.entries(current).every(([field, count]) => references[field] === count)),
          "设备引用已变化，请重新核对删除影响", 409);
        if (kind === "voltages")
          repository.reviseAsset(kind, key, { status: "inactive" });
        audit.record(actor, kind, key, "delete", previous, { logical: true });
        return { id: key, deleted: true };
      });
    },
    replacementPreview,
    replacePhysical(actor: Actor, key: string, input: Record<string, unknown>) {
      authorize(actor, "admin");
      return database.transaction(() => {
        const current = replacementPreview(key);
        expectedVersion(current.physical.version, input.expected_version);
        const submitted = input.bindings || [];
        requireValue(
          Array.isArray(submitted) &&
            submitted.every(
              (binding) =>
                isObject(binding) &&
                typeof binding.id === "string" &&
                Number.isInteger(binding.version),
            ),
          "请核对整基更换的关联回路版本",
        );
        const identities = (rows: ReplacementBinding[]) =>
          rows.map((row) => row.id + "/" + row.version).sort();
        requireValue(
          JSON.stringify(identities(current.bindings)) ===
            JSON.stringify(
              identities(submitted as ReplacementBinding[]),
            ),
          "关联回路已变化，请重新核对整基更换范围",
          409,
        );
        const properties = input.properties || {};
        requireValue(isObject(properties), "物理杆塔资料必须为对象");
        const replacement = save(actor, "physical", {
          ...properties,
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
            line_name: tower.line_name,
            voltage_level_name: tower.voltage_level_name,
            tower_no: tower.tower_no,
            old_version: tower.version,
            new_version: tower.version + 1,
          })),
        };
        audit.record(
          actor,
          "tower_replacements",
          key,
          "replace",
          current,
          decision,
        );
        audit.record(
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
  };
}
export type EquipmentService = ReturnType<typeof createEquipment>;

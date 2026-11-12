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

export function isEquipmentKind(kind: string): kind is EquipmentCatalogKind {
  return ["voltages", "lines", "physical", "towers", "spans"].includes(kind);
}
function bindingLabel(binding: PhysicalBinding): string {
  return `${binding.line_name} · ${binding.voltage_name || "电压待确认"} · ${binding.tower_no}`;
}
function physicalLabel(
  row: EquipmentRecord,
  bindings: PhysicalBinding[],
): string {
  return bindings.length
    ? bindings.map(bindingLabel).join(" / ")
    : row.asset_no ||
        [
          row.tower_material_label || row.tower_material,
          row.model,
          row.height_scaled ? row.height_scaled / 10000 + "米" : "",
        ]
          .filter(Boolean)
          .join(" · ") ||
        "独立物理杆塔";
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
      const line = row.line_id_label || "历史关联记录不存在";
      let label = row.name || "业务对象";
      if (kind === "lines")
        label = `${row.name} · ${row.voltage_level_name || "电压待确认"}`;
      if (kind === "physical") label = physicalLabel(row, related);
      if (kind === "towers") label = `${line} · ${row.tower_no}`;
      if (kind === "spans")
        label = `${row.line_name} ${row.start_tower_no} ~ ${row.end_tower_no}`;
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
        ...(kind === "towers" && row.physical_tower_id
          ? {
              physical_tower_id_label: related.length
                ? related.map(bindingLabel).join(" / ")
                : row.physical_tower_id_label,
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
              supplied.historical_update &&
                definition.equipment &&
                actor.role === "admin",
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
          kind.toUpperCase() + "-" + assetId.replaceAll("-", "");
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
  function replacementPreview(key: string): ReplacementPreview {
    const physical = get("physical", key);
    requireValue(physical.status !== "retired", "该物理实体已退役");
    return {
      physical,
      bindings: decorate("towers", repository.boundTowers(key)),
    };
  }
  return {
    get,
    save,
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
    remove(
      actor: Actor,
      kind: EquipmentCatalogKind,
      key: string,
      version: unknown,
    ) {
      authorize(actor, "admin");
      return database.transaction(() => {
        const previous = get(kind, key);
        expectedVersion(previous.version, version);
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
            label: tower.label,
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

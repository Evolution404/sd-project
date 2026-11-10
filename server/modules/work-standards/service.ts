import type { WorkStandardRepository } from "../../database/repositories/work-standards.js";
import type { Database } from "../../database/connection.js";
import type { AuditService } from "../../platform/audit/service.js";
import type { Actor, ListQuery } from "../../shared/types/contracts.js";
import { isObject } from "../../shared/types/contracts.js";
import type {
  OperationRecord,
  OperationVersion,
  OperationField,
  PricingFeatureDeclaration,
  WorkObjectRecord,
  WorkObjectScope,
} from "../../shared/types/work-standards.js";
import type { DictionaryService } from "../dictionaries/service.js";
import type { PriceFactorService } from "../pricing/factors.js";
import { definitionName, definitionStatus } from "../dictionaries/service.js";
import { validateFactorDefinition } from "../pricing/features.js";
import { jsonDocument } from "../../shared/json.js";
import {
  requireValue,
  expectedVersion,
  integer,
  text,
} from "../../shared/errors/business-error.js";
import { authorize, id, now } from "../../platform/auth/service.js";
const objectRecord = (row: WorkObjectRecord): WorkObjectRecord => ({
  ...row,
  label: row.name,
  deleted: Boolean(row.deleted),
});
const operationRecord = (row: OperationRecord): OperationRecord => ({
  ...row,
  label: row.name,
  deleted: Boolean(row.deleted),
});
function optionalText(value: unknown, label: string): string {
  requireValue(
    value === null || typeof value === "string",
    `${label}必须为文本`,
  );
  return value || "";
}
function binary(value: unknown, label: string): 0 | 1 {
  requireValue(value === 0 || value === 1, `${label}须选择是或否`);
  return value;
}
export function createWorkStandards(
  repository: WorkStandardRepository,
  dictionaries: DictionaryService,
  factors: PriceFactorService,
  database: Pick<Database, "transaction">,
  audit: AuditService,
) {
  function getObject(key: string, includeDeleted = false): WorkObjectRecord {
    requireValue(typeof key === "string" && key.trim(), "请选择作业对象");
    const row = repository.object(key);
    requireValue(
      row && (includeDeleted || !row.deleted),
      "作业对象不存在或已删除",
      404,
    );
    return objectRecord(row);
  }
  function getOperation(key: string, includeDeleted = false): OperationRecord {
    requireValue(typeof key === "string" && key.trim(), "请选择操作类型");
    const row = repository.operation(key);
    requireValue(
      row && (includeDeleted || !row.deleted),
      "操作类型不存在或已删除",
      404,
    );
    return operationRecord(row);
  }
  function operationVersion(key: string, version: number): OperationRecord {
    const row = repository.operationVersion(
      key,
      integer(version, "操作定义版本", 1),
    );
    requireValue(row, "操作类型正式版本不存在", 404);
    return operationRecord(row);
  }
  function saveObject(
    actor: Actor,
    input: Record<string, unknown>,
    key?: string,
  ): WorkObjectRecord {
    authorize(actor, "admin");
    return database.transaction(() => {
      const previous = key ? getObject(key) : null,
        objectId = key || id(),
        timestamp = now();
      if (previous) {
        expectedVersion(previous.version_no, input.expected_version);
        requireValue(
          input.code === undefined || input.code === previous.code,
          "系统身份不可修改",
        );
      }
      const status = definitionStatus(
        input.status === undefined
          ? previous?.status || "active"
          : input.status,
      );
      const scope =
        input.work_target_type === undefined
          ? previous?.work_target_type || "line"
          : input.work_target_type;
      requireValue(
        scope === "line" ||
          scope === "physical" ||
          (scope === "both" &&
            previous?.work_target_type === scope &&
            status === "inactive"),
        "请选择线路或共用物理杆塔作为唯一归属范围",
      );
      if (!previous)
        repository.createObject({
          id: objectId,
          code: "OBJECTS-" + objectId.replaceAll("-", ""),
          created_at: timestamp,
        });
      repository.appendObject({
        id: id(),
        work_object_id: objectId,
        version_no: (previous?.version_no || 0) + 1,
        name: definitionName(
          input.name === undefined ? previous?.name : input.name,
        ),
        work_target_type: scope as WorkObjectScope,
        status,
        sort_order: previous?.sort_order ?? 100,
        reason: typeof input.reason === "string" ? input.reason : "",
        changed_by: actor.id,
        recorded_at: timestamp,
      });
      const result = getObject(objectId);
      audit.record(
        actor,
        "objects",
        objectId,
        previous ? "revise" : "create",
        previous,
        result,
      );
      return result;
    });
  }
  function extraFields(
    value: unknown,
    previous: OperationRecord | null,
  ): string {
    const document = jsonDocument(value, "附加字段");
    requireValue(Array.isArray(document.value), "附加字段须为完整字段清单");
    const old: OperationField[] = previous
      ? JSON.parse(previous.fields_json)
      : [];
    const fields = document.value.map((field) => {
      requireValue(isObject(field), "请完整填写附加字段");
      const key =
        field.key ||
        old.find((item) => item.label === field.label)?.key ||
        id();
      requireValue(
        typeof key === "string" &&
          key &&
          typeof field.label === "string" &&
          field.label.trim() &&
          typeof field.type === "string" &&
          ["text", "number", "boolean", "date", "select"].includes(
            field.type,
          ) &&
          typeof field.required === "boolean" &&
          (field.type !== "select" ||
            (Array.isArray(field.options) &&
              field.options.length > 0 &&
              field.options.every((option) => typeof option === "string"))),
        "请完整填写附加字段名称、类型及可选内容",
      );
      return { ...field, key } as OperationField;
    });
    requireValue(
      new Set(fields.map((field) => field.key)).size === fields.length,
      "附加字段身份不能重复",
    );
    requireValue(
      new Set(fields.map((field) => field.label)).size === fields.length,
      "附加字段名称不能重复",
    );
    return jsonDocument(fields, "附加字段").text;
  }
  function declaredFeatures(
    value: unknown,
    previous: OperationRecord | null,
  ): string {
    const document = jsonDocument(value, "计价所需信息");
    requireValue(Array.isArray(document.value), "计价所需信息须为完整特征清单");
    const originals: PricingFeatureDeclaration[] = previous
        ? JSON.parse(previous.pricing_features_json)
        : [],
      used = new Set<string>();
    for (const declared of document.value) {
      requireValue(
        isObject(declared) &&
          typeof declared.factor_id === "string" &&
          typeof declared.factor_version === "number" &&
          Number.isSafeInteger(declared.factor_version) &&
          typeof declared.required === "boolean" &&
          typeof declared.source === "string",
        "请选择正式价格特征并明确是否计价必需",
      );
      requireValue(
        !used.has(declared.factor_id),
        "同一操作不能重复声明价格特征",
      );
      used.add(declared.factor_id);
      factors.version(declared.factor_id, declared.factor_version);
      const same = originals.some(
        (old) =>
          old.factor_id === declared.factor_id &&
          old.factor_version === declared.factor_version &&
          old.source === declared.source &&
          old.required === declared.required,
      );
      requireValue(
        declared.source === "manual" || same,
        "新增计价所需信息只能使用现场填写，台账属性请在价格适用条件中配置",
      );
      if (!same) {
        const current = factors.get(declared.factor_id);
        requireValue(
          current.status === "active" &&
            current.version === declared.factor_version,
          "价格特征已更新或停用，请刷新后重新选择",
          409,
        );
      }
    }
    return document.text;
  }
  function saveOperation(
    actor: Actor,
    input: Record<string, unknown>,
    key?: string,
  ): OperationRecord {
    authorize(actor, "admin");
    return database.transaction(() => {
      const previous = key ? getOperation(key) : null,
        operationId = key || id(),
        timestamp = now();
      if (previous) {
        expectedVersion(previous.version, input.expected_version);
        requireValue(
          input.code === undefined || input.code === previous.code,
          "系统身份不可修改",
        );
      }
      const status = definitionStatus(
        input.status === undefined
          ? previous?.status || "active"
          : input.status,
      );
      const objectId = text(
        input.work_object_id === undefined
          ? previous?.work_object_id
          : input.work_object_id,
        "作业对象",
      );
      const object = getObject(objectId, previous?.work_object_id === objectId);
      requireValue(
        status === "inactive" || object.status === "active",
        "作业对象已停用，请更换关联对象或停用操作类型",
        409,
      );
      const scope =
        status === "inactive" && previous?.work_object_id === objectId
          ? previous.work_target_type
          : object.work_target_type;
      requireValue(
        scope === "line" || scope === "physical",
        "操作类型须关联唯一归属范围的作业对象",
      );
      const unitId = text(
        input.default_unit_id === undefined
          ? previous?.default_unit_id
          : input.default_unit_id,
        "固定计量单位",
      );
      const unit = dictionaries.getDictionary(
        "units",
        unitId,
        previous?.default_unit_id === unitId,
      );
      requireValue(
        unit.status === "active" || previous?.default_unit_id === unitId,
        "固定计量单位已停用",
      );
      const allowTower =
        scope === "physical"
          ? 1
          : binary(
              input.allow_tower === undefined
                ? (previous?.allow_tower ?? 1)
                : input.allow_tower,
              "允许杆塔",
            );
      const allowSpan =
        scope === "physical"
          ? 0
          : binary(
              input.allow_span === undefined
                ? (previous?.allow_span ?? 0)
                : input.allow_span,
              "允许档距",
            );
      const defaultLocation =
        scope === "physical"
          ? "tower"
          : input.default_location_kind === undefined
            ? previous?.default_location_kind || "tower"
            : input.default_location_kind;
      requireValue(
        (defaultLocation === "tower" && allowTower === 1) ||
          (defaultLocation === "span" && allowSpan === 1),
        "默认作业位置须属于允许的位置类型",
      );
      const quantity =
        input.default_quantity_scaled === undefined
          ? (previous?.default_quantity_scaled ?? null)
          : input.default_quantity_scaled;
      if (quantity !== null) integer(quantity, "建议数量", 1);
      const fields = extraFields(
        input.fields_json === undefined
          ? previous?.fields_json || []
          : input.fields_json,
        previous,
      );
      const declarations = declaredFeatures(
        input.pricing_features_json === undefined
          ? previous?.pricing_features_json || []
          : input.pricing_features_json,
        previous,
      );
      if (!previous)
        repository.createOperation({
          id: operationId,
          code: "OPERATIONS-" + operationId.replaceAll("-", ""),
          created_at: timestamp,
        });
      const definition: OperationVersion = {
        id: id(),
        operation_id: operationId,
        version: (previous?.version || 0) + 1,
        name: definitionName(
          input.name === undefined ? previous?.name : input.name,
        ),
        status,
        sort_order: previous?.sort_order ?? 100,
        work_target_type: scope,
        work_object_id: objectId,
        default_unit_id: unitId,
        default_unit_version:
          previous?.default_unit_id === unitId
            ? previous.default_unit_version
            : unit.version,
        default_quantity_scaled: quantity as number | null,
        completion_standard:
          input.completion_standard === undefined
            ? (previous?.completion_standard ?? null)
            : input.completion_standard === null ||
                input.completion_standard === ""
              ? null
              : optionalText(input.completion_standard, "默认验收标准"),
        fields_json: fields,
        pricing_features_json: declarations,
        allow_tower: allowTower,
        allow_span: allowSpan,
        default_location_kind: defaultLocation as "tower" | "span",
        default_target_object: optionalText(
          input.default_target_object === undefined
            ? previous?.default_target_object || ""
            : input.default_target_object,
          "默认部位",
        ),
        entry_hint: optionalText(
          input.entry_hint === undefined
            ? previous?.entry_hint || ""
            : input.entry_hint,
          "录入提示",
        ),
        reason: typeof input.reason === "string" ? input.reason : "",
        changed_by: actor.id,
        changed_at: timestamp,
      };
      if (previous) {
        const facts = [
          "name",
          "status",
          "sort_order",
          "work_target_type",
          "work_object_id",
          "default_unit_id",
          "default_unit_version",
          "default_quantity_scaled",
          "completion_standard",
          "fields_json",
          "pricing_features_json",
          "allow_tower",
          "allow_span",
          "default_location_kind",
          "default_target_object",
          "entry_hint",
        ] as const;
        requireValue(
          facts.some((key) =>
            key === "fields_json" || key === "pricing_features_json"
              ? jsonDocument(previous[key], "原操作定义").text !==
                definition[key]
              : previous[key] !== definition[key],
          ),
          "内容没有变化",
        );
      }
      repository.appendOperation(definition);
      const result = getOperation(operationId);
      audit.record(
        actor,
        "operations",
        operationId,
        previous ? "revise" : "create",
        previous,
        result,
      );
      return result;
    });
  }
  return {
    objectDetail(key: string) {
      return {
        item: getObject(key, true),
        versions: repository.objectHistory(key),
        audits: audit.history("objects", key),
      };
    },
    operationDetail(key: string) {
      return {
        item: getOperation(key, true),
        versions: repository.operationHistory(key),
        audits: audit.history("operations", key),
      };
    },
    objectImpact(key: string) {
      const row = getObject(key);
      return {
        references: repository.objectReferences(key),
        expected_version: row.version_no,
      };
    },
    operationImpact(key: string) {
      const row = getOperation(key);
      return {
        references: repository.operationReferences(key),
        expected_version: row.version,
      };
    },
    getObject,
    getOperation,
    operationVersion,
    saveObject,
    saveOperation,
    objects: (includeDeleted = false) =>
      repository
        .objects()
        .filter((row) => includeDeleted || !row.deleted)
        .map(objectRecord),
    operations: (includeDeleted = false) =>
      repository
        .operations()
        .filter((row) => includeDeleted || !row.deleted)
        .map(operationRecord),
    searchObjects: (query: ListQuery) => {
      const page = repository.searchObjects(query);
      return { ...page, items: page.items.map(objectRecord) };
    },
    searchOperations: (query: ListQuery) => {
      const page = repository.searchOperations(query);
      return { ...page, items: page.items.map(operationRecord) };
    },
    objectHistory: (key: string) => {
      getObject(key, true);
      return repository.objectHistory(key);
    },
    operationHistory: (key: string) => {
      getOperation(key, true);
      return repository.operationHistory(key);
    },
    operationPriceFeatures(key: string, version?: number) {
      const selected = version
        ? operationVersion(key, version)
        : getOperation(key, true);
      const items = repository
        .pricingFeatures(key, selected.version)
        .map((row) => {
          requireValue(
            row.code && row.name && row.fields_json,
            "价格特征正式定义不存在",
            409,
          );
          const declaration: PricingFeatureDeclaration = JSON.parse(
            row.declaration_json,
          );
          return {
            ...declaration,
            code: row.code,
            name: row.name,
            definition: validateFactorDefinition(JSON.parse(row.fields_json), {
              allowLegacyAsset: true,
            }),
            unit: row.unit_name || "",
            current_version: row.current_version,
            current_status: row.current_status,
            current_name: row.current_name,
          };
        });
      return { operation_id: key, operation_version: selected.version, items };
    },
    removeObject(
      actor: Actor,
      key: string,
      version: unknown,
      references?: unknown,
    ) {
      authorize(actor, "admin");
      return database.transaction(() => {
        const previous = getObject(key);
        expectedVersion(previous.version_no, version);
        const count = repository.objectReferences(key);
        requireValue(
          references === undefined || references === count,
          "引用关系已变化，请重新检查后删除",
          409,
        );
        if (previous.status === "active")
          saveObject(
            actor,
            { status: "inactive", expected_version: version },
            key,
          );
        audit.record(actor, "objects", key, "delete", previous, {
          logical: true,
        });
        return { id: key, deleted: true };
      });
    },
    removeOperation(
      actor: Actor,
      key: string,
      version: unknown,
      references?: unknown,
    ) {
      authorize(actor, "admin");
      return database.transaction(() => {
        const previous = getOperation(key);
        expectedVersion(previous.version, version);
        const count = repository.operationReferences(key);
        requireValue(
          references === undefined || references === count,
          "引用关系已变化，请重新检查后删除",
          409,
        );
        if (previous.status === "active")
          saveOperation(
            actor,
            { status: "inactive", expected_version: version },
            key,
          );
        audit.record(actor, "operations", key, "delete", previous, {
          logical: true,
        });
        return { id: key, deleted: true };
      });
    },
  };
}
export type WorkStandardService = ReturnType<typeof createWorkStandards>;

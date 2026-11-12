import type { WorkStandardRepository } from "../../database/repositories/work-standards.js";
import type { Database } from "../../database/connection.js";
import type { AuditService } from "../../platform/audit/service.js";
import type { Actor, ListQuery } from "../../shared/types/contracts.js";
import { isObject } from "../../shared/types/contracts.js";
import { validateAttributeSchema } from "../../shared/operation-attributes.js";
import { quantityPrecisionFromFields } from "../../shared/quantity-precision.js";
import type {
  OperationRecord,
  OperationVersion,
  WorkObjectRecord,
  ObjectPosition,
  AttributionUnit,
} from "../../shared/types/work-standards.js";
import type { DictionaryService } from "../dictionaries/service.js";
import { definitionName, definitionStatus } from "../dictionaries/service.js";
import { jsonDocument } from "../../shared/json.js";
import { assertQuantityPrecision } from "../../shared/quantity-precision.js";
import {
  BusinessError,
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
export function createWorkStandards(
  repository: WorkStandardRepository,
  dictionaries: DictionaryService,
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
      const objectPosition = input.object_position === undefined
        ? previous?.object_position : input.object_position;
      const attributionUnit = input.attribution_unit === undefined
        ? previous?.attribution_unit : input.attribution_unit;
      requireValue(objectPosition === "body" || objectPosition === "corridor",
        "对象位置必须选择本体或通道");
      requireValue(attributionUnit === "physical_tower" || attributionUnit === "logical_tower",
        "归属单元必须选择物理杆塔或逻辑杆塔");
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
        object_position: objectPosition as ObjectPosition,
        attribution_unit: attributionUnit as AttributionUnit,
        status,
        sort_order: input.sort_order === undefined ? previous?.sort_order ?? 100 : integer(input.sort_order, "显示顺序"),
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
  function attributes(value: unknown): string {
    try {
      const document = jsonDocument(value, "附加属性");
      requireValue(Array.isArray(document.value), "附加属性须为定义清单");
      const schema = validateAttributeSchema(document.value.map((field) => {
        requireValue(isObject(field), "附加属性定义无效");
        return { ...field, key: field.key || id() };
      }));
      for (const field of schema) {
        if ((field.type === "integer" || field.type === "decimal") && field.unit_id) {
          const unit = repository.unitVersion(field.unit_id, field.unit_version!);
          requireValue(unit, "属性计量单位正式版本不存在", 404);
          requireValue(quantityPrecisionFromFields(unit.fields_json) === field.precision,
            `${field.label}精度须与采用的计量单位正式版本一致`);
        }
      }
      return jsonDocument(schema, "附加属性").text;
    } catch (failure) {
      if (failure instanceof BusinessError)
        throw new BusinessError(failure.message, failure.status, { attributes_schema_json: failure.message });
      throw failure;
    }
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
      requireValue(
        !["work_target_type", "allow_tower", "allow_span", "default_location_kind"]
          .some(key => Object.prototype.hasOwnProperty.call(input,key)),
        "操作类型不得重复配置对象位置、归属单元或旧作业范围",
      );
      requireValue(
        input.adopt_current_object === undefined || typeof input.adopt_current_object === "boolean",
        "是否采用作业对象当前版本必须为是或否",
      );
      const objectVersion = !previous || objectId !== previous.work_object_id ||
        input.adopt_current_object === true
        ? object.version_no : previous.work_object_version_no;
      const adoptedObject = repository.objectVersion(objectId, objectVersion);
      requireValue(adoptedObject, "采用的作业对象正式版本不存在", 404);
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
      requireValue(input.adopt_current_unit === undefined || typeof input.adopt_current_unit === "boolean",
        "是否采用单位当前版本必须为是或否");
      const adoptedUnitVersion = !previous || unitId !== previous.default_unit_id ||
        input.adopt_current_unit === true ? unit.version : previous.default_unit_version;
      const adoptedUnit = repository.unitVersion(unitId, adoptedUnitVersion);
      requireValue(adoptedUnit, "采用的计量单位正式版本不存在", 404);
      const quantity =
        input.default_quantity_scaled === undefined
          ? (previous?.default_quantity_scaled ?? null)
          : input.default_quantity_scaled;
      if (quantity !== null) assertQuantityPrecision(
        integer(quantity, "建议数量", 1), adoptedUnit.fields_json, adoptedUnit.name,
        "default_quantity_scaled",
      );
      const schema = attributes(input.attributes_schema_json === undefined
        ? previous?.attributes_schema_json || [] : input.attributes_schema_json);
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
        sort_order: input.sort_order === undefined ? previous?.sort_order ?? 100 : integer(input.sort_order, "显示顺序"),
        work_object_id: objectId,
        work_object_version_no: objectVersion,
        default_unit_id: unitId,
        // A revision retains its adopted unit version until explicitly refreshed.
        default_unit_version: adoptedUnitVersion,
        default_quantity_scaled: quantity as number | null,
        completion_standard:
          input.completion_standard === undefined
            ? (previous?.completion_standard ?? null)
            : input.completion_standard === null ||
                input.completion_standard === ""
              ? null
              : optionalText(input.completion_standard, "默认验收标准"),
        attributes_schema_json: schema,
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
          "work_object_id",
          "work_object_version_no",
          "default_unit_id",
          "default_unit_version",
          "default_quantity_scaled",
          "completion_standard",
          "attributes_schema_json",
          "default_target_object",
          "entry_hint",
        ] as const;
        requireValue(
          facts.some((key) =>
            key === "attributes_schema_json"
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
        adoptions: repository.operationAdoptions(key),
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
    operationAttributes(key: string, version?: number) {
      const selected = version ? operationVersion(key, version) : getOperation(key, true);
      return { operation_id: key, operation_version: selected.version,
        items: validateAttributeSchema(JSON.parse(selected.attributes_schema_json)) };
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

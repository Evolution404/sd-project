import type { DictionaryRepository } from "../../database/repositories/dictionaries.js";
import type { Database } from "../../database/connection.js";
import type { AuditService } from "../../platform/audit/service.js";
import type { Actor, ListQuery } from "../../shared/types/contracts.js";
import type {
  DictionaryKind,
  FoundationKind,
  DictionaryItem,
  OrganizationDefinition,
  DefinitionStatus,
} from "../../shared/types/master-data.js";
import { authorize, id, now } from "../../platform/auth/service.js";
import { quantityPrecisionFromFields, unitFieldsWithPrecision } from "../../shared/quantity-precision.js";
import {
  requireValue,
  expectedVersion,
} from "../../shared/errors/business-error.js";
export function isFoundationKind(kind: string): kind is FoundationKind {
  return ["units", "priorities", "categories", "organizations"].includes(kind);
}
export function definitionName(value: unknown): string {
  requireValue(typeof value === "string" && value.trim(), "请填写名称", 422, {
    name: "请填写名称",
  });
  return value;
}
export function definitionStatus(value: unknown): DefinitionStatus {
  requireValue(
    value === "active" || value === "inactive",
    "请选择有效状态",
    422,
    { status: "请选择启用或停用" },
  );
  return value;
}
function decorateDictionary(kind: DictionaryKind, row: DictionaryItem): DictionaryItem {
  return {
    ...row,
    deleted: Boolean(row.deleted),
    label: row.name,
    ...(kind === "units" ? { quantity_precision: quantityPrecisionFromFields(row.fields_json) } : {}),
  };
}
export function createDictionaries(
  repository: DictionaryRepository,
  database: Pick<Database, "transaction">,
  audit: AuditService,
) {
  function getDictionary(
    kind: DictionaryKind,
    key: string,
    includeDeleted = false,
  ): DictionaryItem {
    requireValue(typeof key === "string" && key.trim(), "请选择字典项目");
    const row = repository.dictionary(kind, key);
    requireValue(
      row && (includeDeleted || !row.deleted),
      "字典项目不存在或已删除",
      404,
    );
    return decorateDictionary(kind, row);
  }
  function getOrganization(
    key: string,
    includeDeleted = false,
  ): OrganizationDefinition {
    requireValue(typeof key === "string" && key.trim(), "请选择归口单位");
    const row = repository.organization(key);
    requireValue(
      row && (includeDeleted || !row.deleted),
      "归口单位不存在或已删除",
      404,
    );
    return { ...row, deleted: Boolean(row.deleted), label: row.name };
  }
  function saveDictionary(
    actor: Actor,
    kind: DictionaryKind,
    input: Record<string, unknown>,
    key?: string,
  ): DictionaryItem {
    authorize(actor, "admin");
    return database.transaction(() => {
      const previous = key ? getDictionary(kind, key) : null,
        itemId = key || id();
      if (previous) {
        expectedVersion(previous.version, input.expected_version);
        requireValue(
          input.code === undefined || input.code === previous.code,
          "系统身份不可修改",
        );
      }
      const timestamp = now();
      if (!previous)
        repository.createDictionary(kind, {
          id: itemId,
          code: kind.toUpperCase() + "-" + itemId.replaceAll("-", ""),
          created_at: timestamp,
        });
      repository.appendDictionaryVersion({
        id: id(),
        item_id: itemId,
        version: (previous?.version || 0) + 1,
        name: definitionName(
          input.name === undefined ? previous?.name : input.name,
        ),
        status: definitionStatus(
          input.status === undefined
            ? previous?.status || "active"
            : input.status,
        ),
        sort_order: previous?.sort_order ?? 100,
        fields_json: kind === "units"
          ? unitFieldsWithPrecision(previous?.fields_json,
              input.quantity_precision === undefined ? previous?.quantity_precision ?? 0 : input.quantity_precision)
          : previous?.fields_json || "[]",
        reason: typeof input.reason === "string" ? input.reason : "",
        changed_by: actor.id,
        changed_at: timestamp,
      });
      const result = getDictionary(kind, itemId);
      audit.record(
        actor,
        kind,
        itemId,
        previous ? "revise" : "create",
        previous,
        result,
      );
      return result;
    });
  }
  function saveOrganization(
    actor: Actor,
    input: Record<string, unknown>,
    key?: string,
  ): OrganizationDefinition {
    authorize(actor, "admin");
    return database.transaction(() => {
      const previous = key ? getOrganization(key) : null,
        unitId = key || id();
      if (previous) {
        expectedVersion(previous.version_no, input.expected_version);
        requireValue(
          input.code === undefined || input.code === previous.code,
          "系统身份不可修改",
        );
      }
      const parent =
        input.parent_unit_id === undefined
          ? previous?.parent_unit_id || null
          : input.parent_unit_id === null || input.parent_unit_id === ""
            ? null
            : input.parent_unit_id;
      requireValue(
        parent === null || typeof parent === "string",
        "请选择有效的上级单位",
      );
      if (parent) {
        const selected = getOrganization(
          parent,
          previous?.parent_unit_id === parent,
        );
        requireValue(
          selected.status === "active" || previous?.parent_unit_id === parent,
          "上级单位已停用",
        );
      }
      if (!previous)
        repository.createOrganization({
          id: unitId,
          code: "ORGANIZATIONS-" + unitId.replaceAll("-", ""),
        });
      repository.appendOrganizationVersion({
        id: id(),
        unit_id: unitId,
        version_no: (previous?.version_no || 0) + 1,
        name: definitionName(
          input.name === undefined ? previous?.name : input.name,
        ),
        status: definitionStatus(
          input.status === undefined
            ? previous?.status || "active"
            : input.status,
        ),
        parent_unit_id: parent,
        actor_id: actor.id,
        recorded_at: now(),
        reason: typeof input.reason === "string" ? input.reason : "",
      });
      const result = getOrganization(unitId);
      audit.record(
        actor,
        "organizations",
        unitId,
        previous ? "revise" : "create",
        previous,
        result,
      );
      return result;
    });
  }
  function remove(
    actor: Actor,
    kind: FoundationKind,
    key: string,
    version: unknown,
    expectedReferences?: unknown,
  ) {
    authorize(actor, "admin");
    return database.transaction(() => {
      const previous =
        kind === "organizations"
          ? getOrganization(key)
          : getDictionary(kind, key);
      expectedVersion(
        "version_no" in previous ? previous.version_no : previous.version,
        version,
      );
      const references =
        kind === "organizations" ? null : repository.references(key);
      requireValue(
        expectedReferences === undefined || references === expectedReferences,
        "正式引用已变化，请重新核对删除影响",
        409,
      );
      if (previous.status === "active") {
        if (kind === "organizations")
          saveOrganization(
            actor,
            { status: "inactive", expected_version: version },
            key,
          );
        else
          saveDictionary(
            actor,
            kind,
            { status: "inactive", expected_version: version },
            key,
          );
      }
      audit.record(actor, kind, key, "delete", previous, {
        logical: true,
        references,
      });
      return { id: key, deleted: true };
    });
  }
  return {
    detail(kind: DictionaryKind, key: string) {
      return {
        item: getDictionary(kind, key, true),
        versions: repository.dictionaryHistory(key).map((row) => ({
          ...row,
          ...(kind === "units" ? { quantity_precision: quantityPrecisionFromFields(row.fields_json) } : {}),
        })),
        audits: audit.history(kind, key),
      };
    },
    getDictionary,
    getOrganization,
    saveDictionary,
    saveOrganization,
    remove,
    impact: (kind: DictionaryKind, key: string) => {
      const row = getDictionary(kind, key);
      return {
        references: repository.references(key),
        expected_version: row.version,
      };
    },
    get: (kind: FoundationKind, key: string, includeDeleted = false) =>
      kind === "organizations"
        ? getOrganization(key, includeDeleted)
        : getDictionary(kind, key, includeDeleted),
    save: (
      actor: Actor,
      kind: FoundationKind,
      input: Record<string, unknown>,
      key?: string,
    ) =>
      kind === "organizations"
        ? saveOrganization(actor, input, key)
        : saveDictionary(actor, kind, input, key),
    list: (kind: FoundationKind, includeDeleted = false) =>
      kind === "organizations"
        ? repository
            .organizations()
            .filter((row) => includeDeleted || !row.deleted)
            .map((row) => ({
              ...row,
              label: row.name,
              deleted: Boolean(row.deleted),
            }))
        : repository
            .dictionaryItems(kind)
            .filter((row) => includeDeleted || !row.deleted)
            .map((row) => decorateDictionary(kind, row)),
    search(kind: FoundationKind, query: ListQuery) {
      const page =
        kind === "organizations"
          ? repository.searchOrganizations(query)
          : repository.searchDictionary(kind, query);
      return {
        ...page,
        items: page.items.map((row) => kind === "organizations"
          ? { ...row, label: row.name, deleted: Boolean(row.deleted) }
          : decorateDictionary(kind, row as DictionaryItem)),
      };
    },
    history(kind: FoundationKind, key: string) {
      if (kind === "organizations") {
        getOrganization(key, true);
        return repository.organizationHistory(key);
      }
      getDictionary(kind, key, true);
      return repository.dictionaryHistory(key).map((row) => ({
        ...row,
        ...(kind === "units" ? { quantity_precision: quantityPrecisionFromFields(row.fields_json) } : {}),
      }));
    },
  };
}
export type DictionaryService = ReturnType<typeof createDictionaries>;

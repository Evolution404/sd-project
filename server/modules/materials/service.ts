import type { MaterialRepository } from "../../database/repositories/materials.js";
import type { Database } from "../../database/connection.js";
import type { AuditService } from "../../platform/audit/service.js";
import { isObject, type Actor, type ListQuery } from "../../shared/types/contracts.js";
import type { MaterialRecord } from "../../shared/types/master-data.js";
import type { DictionaryService } from "../dictionaries/service.js";
import { definitionName, definitionStatus } from "../dictionaries/service.js";
import { authorize, id, now } from "../../platform/auth/service.js";
import {
  requireValue,
  expectedVersion,
  text,
} from "../../shared/errors/business-error.js";
function decorate(row: MaterialRecord): MaterialRecord {
  return {
    ...row,
    deleted: Boolean(row.deleted),
    label: [row.name, row.model, row.specification].filter(Boolean).join(" · "),
  };
}
export function createMaterials(
  repository: MaterialRepository,
  dictionaries: DictionaryService,
  database: Pick<Database, "transaction">,
  audit: AuditService,
) {
  function get(key: string, includeDeleted = false): MaterialRecord {
    requireValue(typeof key === "string" && key.trim(), "请选择物资");
    const row = repository.current(key);
    requireValue(
      row && (includeDeleted || !row.deleted),
      "物资不存在或已删除",
      404,
    );
    return decorate(row);
  }
  function save(
    actor: Actor,
    input: Record<string, unknown>,
    key?: string,
  ): MaterialRecord {
    authorize(actor, "admin");
    return database.transaction(() => {
      const previous = key ? get(key) : null,
        materialId = key || id(),
        timestamp = now();
      if (previous) {
        expectedVersion(previous.version_no, input.expected_version);
        requireValue(
          input.code === undefined || input.code === previous.code,
          "系统身份不可修改",
        );
      }
      const unitId =
        input.unit_id === undefined ? previous?.unit_id : input.unit_id;
      requireValue(
        !previous || unitId === previous.unit_id,
        "计量单位是稳定身份，不能改挂",
      );
      const unit = dictionaries.getDictionary(
        "units",
        text(unitId, "计量单位"),
        previous?.unit_id === unitId,
      );
      requireValue(
        unit.status === "active" || previous?.unit_id === unit.id,
        "计量单位已停用",
      );
      if (!previous)
        repository.create({
          id: materialId,
          code: repository.nextNumber(),
          unit_id: unit.id,
          created_by: actor.id,
          created_at: timestamp,
        });
      function optional(key: "model" | "specification" | "note"): string {
        const value =
          input[key] === undefined ? previous?.[key] || "" : (input[key] ?? "");
        requireValue(
          typeof value === "string",
          key === "model"
            ? "型号必须为文本"
            : key === "specification"
              ? "规格必须为文本"
              : "备注必须为文本",
        );
        return value;
      }
      repository.appendVersion({
        id: id(),
        material_id: materialId,
        version_no: (previous?.version_no || 0) + 1,
        name: definitionName(
          input.name === undefined ? previous?.name : input.name,
        ),
        model: optional("model"),
        specification: optional("specification"),
        note: optional("note"),
        category_id: previous?.category_id || null,
        status: definitionStatus(
          input.status === undefined
            ? previous?.status || "active"
            : input.status,
        ),
        reason: typeof input.reason === "string" ? input.reason : "",
        changed_by: actor.id,
        recorded_at: timestamp,
      });
      const result = get(materialId);
      audit.record(
        actor,
        "materials",
        materialId,
        previous ? "revise" : "create",
        previous,
        result,
      );
      return result;
    });
  }
  return {
    detail(key: string) {
      return {
        item: get(key, true),
        versions: repository.history(key),
        audits: audit.history("materials", key),
      };
    },
    get,
    save,
    saveBatch(actor: Actor, raw: unknown) {
      authorize(actor, "admin");
      requireValue(Array.isArray(raw) && raw.length>=1 && raw.length<=100,
        "批量修改必须包含1～100条物资", 400);
      const allowed=new Set(["name","model","specification","note"]);
      const seen=new Set<string>();
      const updates=raw.map((item: unknown) => {
        requireValue(isObject(item) && typeof item.id==="string" && item.id.trim()
          && Number.isInteger(item.expected_version) && Number(item.expected_version)>0
          && isObject(item.changes), "批量修改条目缺少身份、正式版本或修改字段", 400);
        requireValue(!seen.has(String(item.id)), "批量修改不允许重复物资", 400);
        seen.add(String(item.id));
        const entries=Object.entries(item.changes);
        requireValue(entries.length>0 && entries.every(([key,value])=>
          allowed.has(key) && typeof value==="string"),
          "批量修改只允许物资名称、型号、规格、备注四个字段", 400);
        return {id:String(item.id),expected_version:Number(item.expected_version),
          changes:Object.fromEntries(entries)};
      });
      // Each original save() still performs domain validation, versioning and audit.
      // The outer transaction ensures the entire batch rolls back on any conflict.
      return database.transaction(() => {
        const records=updates.map(item=>save(actor,{
          ...item.changes,expected_version:item.expected_version,
        },item.id));
        return {count:records.length,ids:records.map(row=>row.id)};
      });
    },
    impact: (key: string) => {
      const row = get(key);
      return {
        references: repository.references(key),
        expected_version: row.version_no,
      };
    },
    list: (includeDeleted = false) =>
      repository
        .all()
        .filter((row) => includeDeleted || !row.deleted)
        .map(decorate),
    facets: (query: ListQuery, key: string, search: string, offset: number) =>
      repository.facets(query, key, search, offset),
    search: (query: ListQuery) => {
      const page = repository.search(query);
      return { ...page, items: page.items.map(decorate) };
    },
    history: (key: string) => {
      get(key, true);
      return repository.history(key);
    },
    remove(
      actor: Actor,
      key: string,
      version: unknown,
      expectedReferences?: unknown,
    ) {
      authorize(actor, "admin");
      return database.transaction(() => {
        const previous = get(key);
        expectedVersion(previous.version_no, version);
        const references = repository.references(key);
        requireValue(
          expectedReferences === undefined || expectedReferences === references,
          "正式引用已变化，请重新核对删除影响",
          409,
        );
        if (previous.status === "active")
          save(actor, { status: "inactive", expected_version: version }, key);
        audit.record(actor, "materials", key, "delete", previous, {
          logical: true,
          references,
        });
        return { id: key, deleted: true };
      });
    },
  };
}
export type MaterialService = ReturnType<typeof createMaterials>;

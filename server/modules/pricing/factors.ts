import type { PriceFactorRepository } from "../../database/repositories/price-factors.js";
import type { Database } from "../../database/connection.js";
import type { AuditService } from "../../platform/audit/service.js";
import type { DictionaryService } from "../dictionaries/service.js";
import type { Actor, ListQuery } from "../../shared/types/contracts.js";
import type { PriceFactorRecord } from "../../shared/types/work-standards.js";
import { definitionName, definitionStatus } from "../dictionaries/service.js";
import { validateFactorDefinition } from "./features.js";
import { jsonDocument } from "../../shared/json.js";
import { authorize, id, now } from "../../platform/auth/service.js";
import {
  requireValue,
  expectedVersion,
} from "../../shared/errors/business-error.js";
const builtIn = new Set([
  "电压等级",
  "线路电压等级",
  "塔型",
  "物理杆塔塔型",
  "停电方式",
  "作业方式",
  "作业位置",
  "归属范围",
  "工作量",
  "数量",
  "规格",
  "作业规格",
  "操作类型",
]);
const decorate = (row: PriceFactorRecord): PriceFactorRecord => ({
  ...row,
  label: row.name,
  deleted: Boolean(row.deleted),
});
export function createPriceFactors(
  repository: PriceFactorRepository,
  dictionaries: DictionaryService,
  database: Pick<Database, "transaction">,
  audit: AuditService,
) {
  function get(key: string, includeDeleted = false): PriceFactorRecord {
    requireValue(typeof key === "string" && key.trim(), "请选择价格特征");
    const row = repository.current(key);
    requireValue(
      row && (includeDeleted || !row.deleted),
      "价格特征不存在或已删除",
      404,
    );
    return decorate(row);
  }
  function version(key: string, number: number) {
    const selected = repository.version(key, number);
    requireValue(selected, "价格特征正式定义不存在", 409);
    return selected;
  }
  function save(
    actor: Actor,
    input: Record<string, unknown>,
    key?: string,
  ): PriceFactorRecord {
    authorize(actor, "admin");
    return database.transaction(() => {
      const previous = key ? get(key) : null,
        factorId = key || id(),
        timestamp = now();
      if (previous) {
        expectedVersion(previous.version, input.expected_version);
        requireValue(
          input.code === undefined || input.code === previous.code,
          "系统身份不可修改",
        );
      }
      const name = definitionName(
        input.name === undefined ? previous?.name : input.name,
      );
      requireValue(
        !builtIn.has(name.trim()),
        "该条件已有正式业务字段，请在参考价格适用条件中直接配置",
      );
      const document = jsonDocument(
        input.fields_json === undefined
          ? previous?.fields_json || { kind: "enum", values: [] }
          : input.fields_json,
        "特征定义",
      );
      const unchangedLegacy =
        previous &&
        jsonDocument(previous.fields_json, "原特征定义").text === document.text;
      const definition = validateFactorDefinition(document.value, {
        allowLegacyAsset: Boolean(unchangedLegacy),
      });
      if (definition.unit_id) {
        requireValue(
          repository.unitVersion(definition.unit_id, definition.unit_version!),
          "整数计量单位版本不存在或不是正式计量单位",
        );
        const old = previous
          ? validateFactorDefinition(
              jsonDocument(previous.fields_json, "原特征定义").value,
              { allowLegacyAsset: true },
            )
          : null;
        if (
          old?.unit_id !== definition.unit_id ||
          old?.unit_version !== definition.unit_version
        ) {
          const current = dictionaries.getDictionary(
            "units",
            definition.unit_id,
          );
          requireValue(
            current.status === "active" &&
              current.version === definition.unit_version,
            "整数计量单位已更新或停用，请重新选择",
            409,
          );
        }
      }
      const status = definitionStatus(
        input.status === undefined
          ? previous?.status || "active"
          : input.status,
      );
      requireValue(
        !previous ||
          previous.name !== name ||
          previous.status !== status ||
          jsonDocument(previous.fields_json, "原特征定义").text !==
            document.text,
        "内容没有变化",
      );
      if (!previous)
        repository.create({
          id: factorId,
          code: "FACTORS-" + factorId.replaceAll("-", ""),
          created_at: timestamp,
        });
      repository.append({
        id: id(),
        item_id: factorId,
        version: (previous?.version || 0) + 1,
        name,
        status,
        sort_order: previous?.sort_order ?? 100,
        fields_json: document.text,
        reason: typeof input.reason === "string" ? input.reason : "",
        changed_by: actor.id,
        changed_at: timestamp,
      });
      const result = get(factorId);
      audit.record(
        actor,
        "factors",
        factorId,
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
        audits: audit.history("factors", key),
      };
    },
    impact(key: string) {
      const row = get(key);
      return {
        references: repository.references(key),
        expected_version: row.version,
      };
    },
    get,
    version,
    save,
    list: (includeDeleted = false) =>
      repository
        .all()
        .filter((row) => includeDeleted || !row.deleted)
        .map(decorate),
    search: (query: ListQuery) => {
      const page = repository.search(query);
      return { ...page, items: page.items.map(decorate) };
    },
    history: (key: string) => {
      get(key, true);
      return repository.history(key);
    },
    remove(actor: Actor, key: string, number: unknown, references?: unknown) {
      authorize(actor, "admin");
      return database.transaction(() => {
        const previous = get(key);
        expectedVersion(previous.version, number);
        const count = repository.references(key);
        requireValue(
          references === undefined || references === count,
          "引用关系已变化，请重新检查后删除",
          409,
        );
        if (previous.status === "active")
          save(actor, { status: "inactive", expected_version: number }, key);
        audit.record(actor, "factors", key, "delete", previous, {
          logical: true,
        });
        return { id: key, deleted: true };
      });
    },
  };
}
export type PriceFactorService = ReturnType<typeof createPriceFactors>;

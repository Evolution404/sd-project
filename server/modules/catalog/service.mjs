import { isFoundationKind } from "../dictionaries/service.js";
import { isEquipmentKind } from "../equipment/service.js";
import { catalogDefinitions } from "./definitions.js";
export { catalogDefinitions } from "./definitions.js";
import { authorize, id, now } from "../../platform/auth/service.js";
import {
  requireValue,
  expectedVersion,
  text,
  integer,
} from "../../shared/errors/business-error.js";
export function createCatalog(repo, equipment, auditor, dictionaries, materials, factors, standards, priceRules, funding) {
  const audit = auditor.record;
  const definitions = catalogDefinitions;
  function config(kind) {
    const value = definitions[kind];
    requireValue(value, "未知业务目录", 404);
    return value;
  }
  function label(kind, row) {
    if (isEquipmentKind(kind)) return equipment.get(kind, row.id, true).label;
    if (kind === "materials") return [row.name, row.model, row.specification].filter(Boolean).join(" · ");
    if (kind === "frameworks") return [row.name, row.fiscal_year].filter(Boolean).join(" · ");
    if (kind === "agreements") return [row.name, row.contract_number].filter(Boolean).join(" · ");
    return row.name || row.title || "业务对象";
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
  function list(kind, includeDeleted = false) {
    if (kind === "frameworks" || kind === "agreements") return funding.list(kind, includeDeleted);
    if (kind === "prices") return priceRules.list(includeDeleted);
    if (kind === "factors") return factors.list(includeDeleted);
    if (kind === "objects") return standards.objects(includeDeleted);
    if (kind === "operations") return standards.operations(includeDeleted);
    if (isFoundationKind(kind)) return dictionaries.list(kind, includeDeleted);
    if (kind === "materials") return materials.list(includeDeleted);
    if (isEquipmentKind(kind)) return equipment.list(kind, includeDeleted);
    const c = config(kind), deleted = repo.deleted(kind);
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
          ...referenceLabels(kind, row),

        };
      });
  }
  function search(kind, options = {}) {
    return equipment.search(kind, options);
  }
  function get(kind, key, includeDeleted = false) {
    if (kind === "frameworks" || kind === "agreements") return funding.get(kind, key, includeDeleted);
    if (kind === "prices") return priceRules.get(key, includeDeleted);
    if (kind === "factors") return factors.get(key, includeDeleted);
    if (kind === "objects") return standards.getObject(key, includeDeleted);
    if (kind === "operations") return standards.getOperation(key, includeDeleted);
    if (isFoundationKind(kind)) return dictionaries.get(kind, key, includeDeleted);
    if (kind === "materials") return materials.get(key, includeDeleted);
    if (isEquipmentKind(kind)) return equipment.get(kind, key, includeDeleted);
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
      ...referenceLabels(kind, row),

    };
  }
  function save(actor, kind, input, key) {
    if (kind === "frameworks" || kind === "agreements") return funding.save(actor, kind, input, key);
    if (kind === "prices") return priceRules.save(actor, input, key);
    if (kind === "factors") return factors.save(actor, input, key);
    if (kind === "objects") return standards.saveObject(actor, input, key);
    if (kind === "operations") return standards.saveOperation(actor, input, key);
    if (isFoundationKind(kind)) return dictionaries.save(actor, kind, input, key);
    if (kind === "materials") return materials.save(actor, input, key);
    if (isEquipmentKind(kind)) return equipment.save(actor, kind, input, key);
    authorize(
      actor,
      kind === "frameworks" || kind === "agreements" ? "write" : "admin",
    );
    return repo.transaction(() => {
      const c = config(kind),
        previous = key ? get(kind, key) : null,
        sequence = c.sequence || "version_no";
      const keyId = key || id();
      input = { ...input };
      for (const f of c.rootFields.filter((field) => field.systemManaged)) {
        if (previous && input[f.key] !== undefined)
          requireValue(input[f.key] === previous[f.key], "系统身份不可修改");
        input[f.key] =
          previous?.[f.key] ||
          kind.toUpperCase() + "-" + keyId.replaceAll("-", "");
      }
      if (previous)
        expectedVersion(
          previous[sequence] || previous.version || 1,
          input.expected_version,
        );
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

      const timestamp = now();
      if (c.typeId) {
        if (!repo.find("dictionary_types", "id", c.typeId))
          repo.insert("dictionary_types", { id: c.typeId, title: c.title });
        root.type_id = c.typeId;
      }
      if (!previous) {
        if (c.created_at) root.created_at = timestamp;
        if (c.created_by) root.created_by = actor.id;
        repo.insert(c.root, {
          id: keyId,
          ...root,
          ...(!c.versions ? values : {}),
        });
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
        repo.update(c.root, "id", keyId, values);
      }
      const result = get(kind, keyId, Boolean(previous?.deleted));
      audit(
          actor,
          kind,
          keyId,
          previous ? "revise" : "create",
          previous,
          result,
        );
      return result;
    });
  }
  return {
    definitions,
    operationPriceFeatures: standards.operationPriceFeatures,
    previewPrice: priceRules.preview,
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
    replacementPreview: equipment.replacementPreview,
    replacePhysical: equipment.replacePhysical,
    history(kind, key) {
      if (kind === "frameworks" || kind === "agreements") return funding.history(kind, key);
      if (kind === "prices") return priceRules.history(key);
      if (kind === "factors") return factors.history(key);
      if (kind === "objects") return standards.objectHistory(key);
      if (kind === "operations") return standards.operationHistory(key);
      if (isFoundationKind(kind)) return dictionaries.history(kind, key);
      if (kind === "materials") return materials.history(key);
      if (isEquipmentKind(kind)) return equipment.history(kind, key);
      const c = config(kind);
      get(kind, key, true);
      return c.versions
        ? repo.where(c.versions, { [c.foreign]: key })
        : c.history
          ? repo.where(c.history, { [c.historyKey]: key })
          : repo.auditFor(kind, key);
    },
    remove(actor, kind, key, version) {
      if (kind === "frameworks" || kind === "agreements") return funding.remove(actor, kind, key, version);
      if (kind === "prices") return priceRules.remove(actor, key, version);
      if (kind === "factors") return factors.remove(actor, key, version);
      if (kind === "objects") return standards.removeObject(actor, key, version);
      if (kind === "operations") return standards.removeOperation(actor, key, version);
      if (isFoundationKind(kind)) return dictionaries.remove(actor, kind, key, version);
      if (kind === "materials") return materials.remove(actor, key, version);
      if (isEquipmentKind(kind)) return equipment.remove(actor, kind, key, version);
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
        audit(actor, kind, key, "delete", previous, { logical: true });
        return { id: key, deleted: true };
      });
    },
  };
}

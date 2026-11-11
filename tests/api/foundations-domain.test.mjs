import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../helpers.mjs";
import { id, now } from "../../dist/server/platform/auth/service.js";
import { parseListQuery } from "../../dist/server/platform/http/list-query.js";

test("dictionary revisions preserve previously recorded order and extension facts", (t) => {
  const { s, user, unit } = fixture(t);
  const custom = JSON.stringify({ legacy_dimension: "长度" });
  s.repo.insert("dictionary_item_versions", {
    id: id(),
    item_id: unit.id,
    version: 2,
    name: unit.name,
    status: "active",
    sort_order: 7,
    fields_json: custom,
    changed_by: user.id,
    changed_at: now(),
  });
  const revised = s.dictionaries.saveDictionary(
    user,
    "units",
    { name: "单位正式修订", expected_version: 2 },
    unit.id,
  );
  assert.equal(revised.sort_order, 7);
  assert.deepEqual(JSON.parse(revised.fields_json), { legacy_dimension: "长度", quantity_precision: 0 });
  assert.equal(revised.version, 3);
  assert.equal(
    s.catalog.get("units", unit.id).current_version_id,
    revised.current_version_id,
  );
  assert.throws(
    () =>
      s.dictionaries.saveDictionary(
        user,
        "units",
        { name: "并发覆盖", expected_version: 2 },
        unit.id,
      ),
    /版本冲突/,
  );
  assert.throws(
    () =>
      s.dictionaries.saveDictionary(
        user,
        "units",
        { status: null, expected_version: 3 },
        unit.id,
      ),
    /状态/,
  );
  assert.equal(s.dictionaries.history("units", unit.id).length, 3);
});

test("material revisions preserve historical category facts and stable unit identity", (t) => {
  const { s, user, unit } = fixture(t);
  const timestamp = now(),
    categoryId = id(),
    materialId = id();
  s.repo.transaction(() => {
    s.repo.insert("dictionary_types", {
      id: "material_category",
      title: "物资类别",
    });
    s.repo.insert("dictionary_items", {
      id: categoryId,
      type_id: "material_category",
      code: "legacy-category",
      created_at: timestamp,
    });
    s.repo.insert("dictionary_item_versions", {
      id: id(),
      item_id: categoryId,
      version: 1,
      name: "原正式分类",
      status: "active",
      changed_by: user.id,
      changed_at: timestamp,
    });
    s.repo.insert("materials", {
      id: materialId,
      code: "legacy-material",
      unit_id: unit.id,
      created_by: user.id,
      created_at: timestamp,
    });
    s.repo.insert("material_versions", {
      id: id(),
      material_id: materialId,
      version_no: 1,
      name: "已有正式物资",
      model: "原型号",
      category_id: categoryId,
      status: "active",
      changed_by: user.id,
      recorded_at: timestamp,
    });
  });
  const revised = s.materials.save(
    user,
    { name: "修订物资名称", expected_version: 1 },
    materialId,
  );
  assert.equal(revised.category_id, categoryId);
  assert.equal(revised.model, "原型号");
  assert.equal(revised.unit_id, unit.id);
  const other = s.dictionaries.saveDictionary(user, "units", {
    name: "另一个单位",
  });
  assert.throws(
    () =>
      s.materials.save(
        user,
        { unit_id: other.id, expected_version: 2 },
        materialId,
      ),
    /稳定身份/,
  );
  const before = s.materials.impact(materialId);
  assert.equal(before.references, 0);
  s.materials.remove(user, materialId, 2, before.references);
  assert.equal(s.materials.get(materialId, true).deleted, true);
  const detail = s.materials.detail(materialId);
  assert.equal(detail.versions[0].category_id, categoryId);
  assert.equal(detail.versions.length, 3);
  assert.ok(detail.audits.some((event) => event.action === "delete"));
  assert.deepEqual(s.repo.integrity().foreignKeys, []);
});

test("dictionary deletion checks fresh formal references and leaves prior adoptions readable", (t) => {
  const { s, user, unit } = fixture(t);
  const before = s.dictionaries.impact("units", unit.id);
  s.materials.save(user, { name: "新增关联", unit_id: unit.id });
  assert.throws(
    () => s.dictionaries.remove(user, "units", unit.id, 1, before.references),
    /引用已变化/,
  );
  assert.equal(s.dictionaries.getDictionary("units", unit.id).status, "active");
  const current = s.dictionaries.impact("units", unit.id);
  s.dictionaries.remove(user, "units", unit.id, 1, current.references);
  assert.equal(
    s.dictionaries.getDictionary("units", unit.id, true).deleted,
    true,
  );
  assert.throws(
    () => s.materials.save(user, { name: "非法新增", unit_id: unit.id }),
    /不存在或已删除/,
  );
  const material = s.materials.list()[0];
  s.materials.save(
    user,
    { name: "原关联资料修订", expected_version: 1 },
    material.id,
  );
  assert.equal(s.materials.get(material.id).unit_id, unit.id);
});

test("material SQL pagination and unit-name filters preserve labels without N+1 hydration", (t) => {
  const { s, user, unit } = fixture(t);
  for (let index = 0; index < 45; index++)
    s.materials.save(user, {
      name: "分页物资" + String(index).padStart(2, "0"),
      unit_id: unit.id,
      model: "型号甲",
    });
  const query = parseListQuery(
    new URLSearchParams({
      q: "分页物资",
      sort: "name",
      direction: "asc",
      page: "2",
      filters: JSON.stringify({ unit_id: "套" }),
    }),
  );
  const page = s.materials.search(query);
  assert.equal(page.total, 45);
  assert.equal(page.items.length, 15);
  assert.equal(page.items[0].name, "分页物资30");
  assert.equal(page.items[0].unit_id_label, "套");
  assert.equal(
    s.materials.search({ ...query, sort: "name; DELETE FROM materials;--" })
      .total,
    45,
  );
  const viewer = { ...user, role: "viewer", permissions: ["read"] };
  assert.throws(
    () => s.materials.save(viewer, { name: "越权", unit_id: unit.id }),
    /权限/,
  );
  assert.throws(
    () => s.dictionaries.saveDictionary(viewer, "priorities", { name: "越权" }),
    /权限/,
  );
});

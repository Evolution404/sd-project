import {
  parseWorkbook,
  makeWorkbook,
  makeBusinessReport,
  errorsWorkbook,
  issue,
  MAX_DOCUMENTS,
} from "./workbook.mjs";
import { createAssetExchange } from "./assets.mjs";
import { createReferences } from "./references.mjs";
import { decimalText } from "../../shared/decimal.js";
import { validateFeatureValue } from "../pricing/features.js";
import { authorize, id, now, digest } from "../../platform/auth/service.js";
import { requireValue, expectedVersion } from "../../shared/errors/business-error.js";
const clean = (row) =>
  Object.fromEntries(
    Object.entries(row).filter(([key]) => !key.startsWith("_")),
  );
const identity = (kind, row) =>
  kind === "work_locations"
    ? `${row.location_kind}/${row.logical_tower_id || row.physical_tower_id || row.span_id}`
    : kind === "materials"
      ? row.material_id
      : kind === "items"
        ? `${row.cost_node_id}/${row.project_scope_id || ""}`
        : row.project_scope_id;
function mergeDetails(kind, old, updates) {
  const result = old.map((x) => ({ ...x }));
  for (const row of updates) {
    const entry = clean(row),
      key = identity(kind, entry),
      index = result.findIndex((x) => identity(kind, x) === key);
    delete entry.action;
    if (row.action === "delete") {
      requireValue(index >= 0, "删除明细不存在");
      result.splice(index, 1);
    } else {
      requireValue(!row.action || row.action === "upsert", "未知明细动作");
      if (index >= 0) result[index] = { ...result[index], ...entry };
      else result.push(entry);
    }
  }
  return result;
}
function differences(before, after, path = "") {
  const result = [];
  for (const key of new Set([
    ...Object.keys(before || {}),
    ...Object.keys(after || {}),
  ])) {
    if (["_sheet", "_row"].includes(key)) continue;
    const a = before?.[key],
      b = after?.[key];
    if (JSON.stringify(a) !== JSON.stringify(b))
      result.push({ field: path + key, before: a ?? null, after: b ?? null });
  }
  return result;
}
export function createExchange(system) {
  const { repo, catalog, demands, finance } = system;
  const assets = createAssetExchange(system);
  let references;
  let matchingMs = 0;
  function nodePath(nodeId) {
    const parts = [];
    let node = repo.find("v_project_cost_node_current", "id", nodeId);
    while (node) {
      parts.unshift(node.name);
      node = node.parent_id
        ? repo.find("v_project_cost_node_current", "id", node.parent_id)
        : null;
    }
    return parts.join("/");
  }
  function resolveDetails(kind, row, projectId, existing) {
    const value = { ...row };
    const started = performance.now();
    if (kind === "work_locations") {
      const adopted = existing?.work_locations.find(
        (location) =>
          identity("work_locations", location) ===
          identity("work_locations", value),
      );
      const frozen =
        adopted &&
        (!row.line_name ||
          row.line_name === adopted.location_snapshot_json.line_name) &&
        (!row.tower_no ||
          row.tower_no === adopted.location_snapshot_json.tower_no);
      if (!frozen) Object.assign(value, references.location(value));
    }
    if (
      kind === "materials" &&
      value.material_name &&
      !existing?.materials.some(
        (material) =>
          material.material_id === value.material_id &&
          material.material_name === value.material_name &&
          (!value.material_model || value.material_model === material.model) &&
          (!value.material_specification ||
            value.material_specification === material.specification),
      )
    )
      value.material_id = references.named(
        "materials",
        value.material_name,
        value.material_id,
        {
          model: value.material_model,
          specification: value.material_specification,
        },
      ).id;
    matchingMs += performance.now() - started;
    if (kind === "items" && value.cost_node_path) {
      const matches = repo
        .where("v_project_cost_node_current", { project_id: projectId })
        .filter((node) => nodePath(node.id) === value.cost_node_path);
      requireValue(matches.length === 1, "费用科目完整路径未精确匹配唯一科目");
      value.cost_node_id = matches[0].id;
    }
    if (["items", "resolutions"].includes(kind) && value.demand_description)
      value.project_scope_id = references.scope(
        projectId,
        value.demand_description,
        value.project_scope_id,
      ).id;
    return value;
  }
  function prepare(kind, parsed, mode, projectId) {
    requireValue(["create", "update", "mixed"].includes(mode), "导入模式无效");
    references = createReferences(system);
    matchingMs = 0;
    const preparationStarted = performance.now();
    let validationMs = 0;
    const numberKey = kind === "demands" ? "demand_no" : "number",
      grouped = new Map(),
      sourceByPosition = new Map();
    for (const [sheet, rows] of Object.entries(parsed.rows)) {
      const groups = new Map();
      for (const row of rows) {
        if (!groups.has(row[numberKey])) groups.set(row[numberKey], []);
        groups.get(row[numberKey]).push(row);
        sourceByPosition.set(row._sheet + "\0" + row._row, row);
      }
      grouped.set(sheet, groups);
    }
    const rowsFor = (sheet, number) => grouped.get(sheet)?.get(number) || [];
    const issues = [...parsed.issues],
      documents = [],
      numbers = new Set();
    for (const root of parsed.rows.documents) {
      const number = root[numberKey];
      try {
        requireValue(
          typeof number === "string" && number.trim(),
          "缺少业务编号",
        );
        requireValue(!numbers.has(number), "文件内业务编号重复");
        numbers.add(number);
        const existing = root.id
          ? kind === "demands"
            ? demands.get(root.id)
            : finance.settlement(root.id)
          : null;
        const matchingStarted = performance.now();
        if (
          kind === "demands" &&
          root.operation_name &&
          (!existing || root.operation_name !== existing.operation_snapshot)
        )
          root.operation_id = references.named(
            "operations",
            root.operation_name,
            root.operation_id,
          ).id;
        if (kind === "demands" && root.priority_name)
          root.priority_id = references.named(
            "priorities",
            root.priority_name,
            root.priority_id,
          ).id;
        if (kind === "settlements" && root.project_name)
          root.project_id = references.project(
            root.project_name,
            root.project_id,
          ).id;
        if (kind === "settlements" && !existing && root.project_id) {
          const project = system.projects.get(root.project_id);
          root.approval_version_id ??= project.approval?.id;
          root.funding_version_id ??= project.funding?.id || null;
        }
        matchingMs += performance.now() - matchingStarted;
        requireValue(
          !existing || existing[numberKey] === number,
          "业务编号与稳定标识不一致",
        );
        if (kind === "demands" && !existing)
          requireValue(
            !repo.find("demands", "demand_no", number),
            "业务编号已存在，更新必须携带稳定标识",
          );
        if (kind === "settlements" && !existing)
          requireValue(
            !repo.where("settlements", { project_id: root.project_id, number })
              .length,
            "结算编号已存在，更新须携带稳定标识",
          );
        requireValue(
          mode !== "create" || !existing,
          "仅新增模式不能更新现有单据",
        );
        requireValue(mode !== "update" || existing, "仅更新模式不能新增单据");
        if (existing)
          expectedVersion(
            kind === "demands"
              ? existing.current_version
              : existing.version?.version_no || 0,
            root.expected_version,
          );
        if (kind === "settlements" && existing)
          expectedVersion(
            existing.draft?.edit_version || 0,
            root.expected_edit_version,
          );
        if (projectId)
          requireValue(
            (root.project_id || existing?.project_id) === projectId,
            "文件单据不属于当前子项目",
          );
        const payload = {
          ...(kind === "demands" ? existing : existing?.draft?.document || {}),
          ...clean(root),
        };
        const detailKeys =
          kind === "demands"
            ? ["work_locations", "materials"]
            : ["items", "resolutions"];
        for (const key of detailKeys) {
          for (const row of rowsFor(key, number)) {
            try {
              Object.assign(
                row,
                resolveDetails(
                  key,
                  row,
                  payload.project_id || existing?.project_id,
                  existing,
                ),
              );
            } catch (error) {
              issues.push(
                issue(
                  row._sheet,
                  row._row,
                  key === "work_locations"
                    ? "tower_no"
                    : key === "materials"
                      ? "material_name"
                      : "cost_node_path",
                  clean(row),
                  error.message,
                ),
              );
              throw error;
            }
          }
          const rows = rowsFor(key, number).map((row) => {
            const value = clean(row);
            delete value[numberKey];
            for (const [field, data] of Object.entries(value))
              if (data === "__EMPTY__") value[field] = "";
            if (
              value.site_features_json &&
              typeof value.site_features_json === "string"
            )
              value.site_features_json = JSON.parse(value.site_features_json);
            return value;
          });
          payload[key] = mergeDetails(key, payload[key] || [], rows);
        }
        for (const key of detailKeys) {
          const sourceRows = rowsFor(key, number);
          const keys = sourceRows.map((row) => identity(key, row));
          requireValue(
            new Set(keys).size === keys.length,
            "同一单据的明细身份重复",
          );
        }
        let normalized;
        if (kind === "demands") {
          for (const row of rowsFor("work_locations", number).filter(
            (row) => row.action !== "delete",
          )) {
            const key =
              row.location_kind === "span"
                ? "span_id"
                : row.location_kind === "physical_tower"
                  ? "physical_tower_id"
                  : "logical_tower_id";
            try {
              catalog.get(
                row.location_kind === "span"
                  ? "spans"
                  : row.location_kind === "physical_tower"
                    ? "physical"
                    : "towers",
                row[key],
              );
            } catch (error) {
              issues.push(
                issue(row._sheet, row._row, key, row[key], error.message),
              );
            }
          }
          payload.sources = rowsFor("sources", number).length
            ? rowsFor("sources", number).map((row) => {
                const value = clean(row);
                delete value.demand_no;
                return value;
              })
            : existing?.sources || [];
          for (const source of payload.sources)
            if (source.id) {
              const original = repo.find("source_records", "id", source.id);
              requireValue(original, "来源标识不存在");
              requireValue(
                !repo
                  .auditFor("sources", source.id)
                  .some((event) =>
                    ["delete", "correct"].includes(event.action),
                  ),
                "来源已有更正或删除，须刷新后重新核对",
                409,
              );
            }
          const operation = catalog.get(
            "operations",
            payload.operation_id,
            Boolean(existing),
          );
          const adopted = repo.where("operation_versions", {
            operation_id: payload.operation_id,
            version:
              payload.operation_version ||
              existing?.operation_version ||
              operation.version,
          })[0];
          const definitions = JSON.parse(adopted.fields_json);
          const declaredFeatures = JSON.parse(adopted.pricing_features_json);
          for (const row of rowsFor("site_features", number)) {
            try {
              const locationRows = rowsFor("work_locations", number);
              const sourceRow = row.location_row
                ? locationRows.find(
                    (location) => location._row === Number(row.location_row),
                  )
                : locationRows.length === 1
                  ? locationRows[0]
                  : null;
              requireValue(sourceRow, "请填写本需求作业位置的工作表行号");
              const location = payload.work_locations.find(
                (location) =>
                  identity("work_locations", location) ===
                  identity("work_locations", sourceRow),
              );
              requireValue(location, "现场特征未对应本需求真实位置");
              const candidates = declaredFeatures
                .map((feature) => ({
                  feature,
                  factor: catalog.get("factors", feature.factor_id, true),
                }))
                .filter((entry) =>
                  row.factor_id
                    ? entry.factor.id === row.factor_id
                    : entry.factor.name === row.factor_name,
                );
              requireValue(
                candidates.length === 1,
                "特征名称须唯一对应本需求采用的正式定义",
              );
              const { factor, feature: declared } = candidates[0];
              const factorCode = factor.code;
              requireValue(declared, "价格特征不属于本需求采用的正式操作定义");
              const version = repo.where("dictionary_item_versions", {
                  item_id: factor.id,
                  version: declared.factor_version,
                })[0],
                definition = JSON.parse(version.fields_json),
                actualLocation = location;
              const actual =
                typeof actualLocation.site_features_json === "string"
                  ? JSON.parse(actualLocation.site_features_json)
                  : { ...(actualLocation.site_features_json || {}) };
              if (row.value === undefined) continue;
              if (row.value === null) delete actual[factorCode];
              else {
                let value = row.value;
                if (definition.kind === "number") {
                  requireValue(
                    typeof value === "number" ||
                      (typeof value === "string" && value.trim()),
                    "整数现场特征不能为空",
                  );
                  value = Number(value);
                } else value = String(value);
                validateFeatureValue(definition, value, version.name);
                actual[factorCode] = {
                  factor_version: declared.factor_version,
                  value,
                };
              }
              actualLocation.site_features_json = actual;
            } catch (error) {
              issues.push(
                issue(row._sheet, row._row, "value", row.value, error.message),
              );
              throw error;
            }
          }

          payload.custom_fields = {
            ...(existing?.custom_fields || payload.custom_fields || {}),
          };
          for (const row of rowsFor("custom_fields", number)) {
            const definition = definitions.find((field) =>
              row.field_key
                ? field.key === row.field_key
                : field.label === row.field_name,
            );
            requireValue(definition, "补充现场字段未精确匹配正式操作定义");
            if (row.value === undefined) continue;
            let value = row.value;
            if (value !== null && definition.type === "number") {
              requireValue(
                typeof value === "number" ||
                  (typeof value === "string" &&
                    value.trim() !== "" &&
                    !Number.isNaN(Number(value))),
                "补充数值格式错误",
              );
              value = Number(value);
            }
            if (value !== null && definition.type === "boolean") {
              requireValue(
                [true, false, "是", "否", "true", "false", "1", "0"].includes(
                  value,
                ),
                "是或否字段取值错误",
              );
              value = [true, "是", "true", "1"].includes(value);
            }
            payload.custom_fields[definition.key] = value;
          }
          const validationStarted = performance.now();
          normalized = demands.normalize(payload, existing);
          const duplicates = repo.demandDuplicates(
            normalized.operation_id,
            normalized.work_locations,
            existing?.id,
          );
          requireValue(
            !duplicates.length,
            "存在同操作同位置疑似重复需求，须在线复核后处理",
            409,
            { duplicates },
          );
          validationMs += performance.now() - validationStarted;
          Object.assign(payload, normalized);
        } else
          finance.validateDraft(
            payload.project_id || existing.project_id,
            payload,
          );
        const change = differences(
          kind === "demands" && existing
            ? demands.normalize(existing, existing)
            : existing?.draft?.document || {},
          kind === "demands" ? normalized : payload,
        );
        if (
          kind === "demands" &&
          existing &&
          payload.sources.some(
            (source) =>
              !source.id ||
              !existing.sources.some(
                (old) =>
                  old.id === source.id &&
                  ["description", "discovered_on"].every(
                    (field) =>
                      source[field] === undefined ||
                      source[field] === old[field],
                  ),
              ),
          )
        )
          change.push({
            field: "sources",
            before: existing.sources,
            after: payload.sources,
          });
        documents.push({
          number,
          id: existing?.id || null,
          action: existing
            ? change.length
              ? "update"
              : "unchanged"
            : "create",
          payload,
          changes: change,
          sheet: root._sheet,
          row: root._row,
        });
      } catch (error) {
        issues.push(
          issue(
            root._sheet,
            root._row,
            error.message.includes("版本")
              ? "expected_version"
              : Object.keys(error.fields || {})[0] ||
                  (kind === "demands" ? "operation_name" : "project_name"),
            root,
            error.message,
          ),
        );
      }
    }
    for (const [key, rows] of Object.entries(parsed.rows))
      if (key !== "documents")
        for (const row of rows)
          if (!numbers.has(row[numberKey]))
            issues.push(
              issue(
                row._sheet,
                row._row,
                numberKey,
                row[numberKey],
                "明细未对应文件中的业务单据",
              ),
            );
    const seenLocations = new Map();
    for (const doc of documents)
      if (kind === "demands" && doc.action === "create")
        for (const loc of doc.payload.work_locations) {
          const key =
              doc.payload.operation_id + "/" + identity("work_locations", loc),
            previous = seenLocations.get(key);
          if (previous && previous.number !== doc.number) {
            issues.push(
              issue(
                doc.sheet,
                doc.row,
                "work_locations",
                doc.number,
                "文件内多个需求存在同操作同位置疑似重复",
              ),
            );
            issues.push(
              issue(
                previous.sheet,
                previous.row,
                "work_locations",
                previous.number,
                "文件内多个需求存在同操作同位置疑似重复",
              ),
            );
          } else seenLocations.set(key, doc);
        }
    const invalidNumbers = new Set();
    for (const problem of issues) {
      const source = sourceByPosition.get(problem.sheet + "\0" + problem.row);
      if (source) invalidNumbers.add(source[numberKey]);
    }
    return {
      documents: documents.filter((doc) => !invalidNumbers.has(doc.number)),
      timings_ms: {
        preparation: performance.now() - preparationStarted,
        code_matching: matchingMs,
        validation: validationMs,
      },
      document_count: parsed.rows.documents.length,
      invalid_document_count:
        parsed.rows.documents.length -
        documents.filter((doc) => !invalidNumbers.has(doc.number)).length,
      issues,
    };
  }
  async function preview(actor, kind, buffer, options = {}) {
    if (kind === "assets") return assets.preview(actor, buffer, options);
    authorize(actor, "write");
    requireValue(["demands", "settlements"].includes(kind), "未知交换类型");
    const started = performance.now();
    const parsed = await parseWorkbook(buffer, kind);
    const parsedAt = performance.now();
    const numberKey = kind === "demands" ? "demand_no" : "number";
    for (const root of parsed.rows.documents)
      root[numberKey] ||= "row-" + root._row;
    for (const [sheet, rows] of Object.entries(parsed.rows))
      if (sheet !== "documents")
        for (const row of rows) {
          if (row[numberKey]) continue;
          const root = row.document_row
            ? parsed.rows.documents.find(
                (root) => root._row === Number(row.document_row),
              )
            : parsed.rows.documents.length === 1
              ? parsed.rows.documents[0]
              : null;
          if (root) row[numberKey] = root[numberKey];
          else
            parsed.issues.push(
              issue(
                row._sheet,
                row._row,
                "document_row",
                row.document_row,
                "多单据明细须指明对应清单的实际行号",
              ),
            );
        }
    if (kind === "settlements" && options.projectId) {
      const project = system.projects.get(options.projectId);
      for (const root of parsed.rows.documents) {
        root.project_id ||= project.id;
        root.approval_version_id ||= project.approval?.id;
        root.funding_version_id ||= project.funding?.id;
      }
    }
    const prepared = prepare(
      kind,
      parsed,
      options.mode || "mixed",
      options.projectId,
    );
    const token = id(),
      body = {
        kind,
        mode: options.mode || "mixed",
        projectId: options.projectId || null,
        sha256: digest(buffer),
        parsed,
        ...prepared,
      };
    // A draft batch is an import work-in-progress, never a formal business fact.
    repo.insert("demand_batches", {
      id: token,
      draft_json: JSON.stringify(body),
      created_by: actor.id,
      created_at: now(),
      updated_at: now(),
    });
    return {
      token,
      ...prepared,
      timings_ms: {
        ...prepared.timings_ms,
        parse: parsedAt - started,
        total: performance.now() - started,
      },
      summary: counts(prepared),
    };
  }
  function counts(prepared) {
    return {
      documents: prepared.document_count,
      invalid_documents: prepared.invalid_document_count,
      duplicate_issues: prepared.issues.filter((issue) =>
        issue.reason.includes("重复"),
      ).length,
      created: prepared.documents.filter((x) => x.action === "create").length,
      updated: prepared.documents.filter((x) => x.action === "update").length,
      unchanged: prepared.documents.filter((x) => x.action === "unchanged")
        .length,
      invalid: prepared.issues.length,
      conflicts: prepared.issues.filter((x) => x.field === "expected_version")
        .length,
    };
  }
  function commit(actor, token, input) {
    authorize(actor, "write");
    return system.idempotent(
      actor,
      input.request_key,
      { token, atomic: Boolean(input.atomic) },
      () => {
        const batch = repo.find("demand_batches", "id", token);
        requireValue(
          batch && batch.created_by === actor.id,
          "预检批次不存在",
          404,
        );
        requireValue(batch.status === "draft", "批次已提交", 409);
        const commitStarted = performance.now();
        const body = JSON.parse(batch.draft_json),
          prepared =
            body.kind === "assets"
              ? assets.prepare(body.parsed, body.mode)
              : prepare(body.kind, body.parsed, body.mode, body.projectId),
          results = [],
          failures = [...prepared.issues];
        requireValue(
          !input.atomic || !failures.length,
          "整批提交包含预检错误，全部未写入",
          422,
          { issues: failures },
        );
        const execute = () => {
          for (const document of prepared.documents) {
            try {
              const result = repo.transaction(() => {
                if (document.action === "unchanged")
                  return { id: document.id, unchanged: true };
                if (body.kind === "assets")
                  return assets.execute(actor, document);
                if (body.kind === "demands")
                  return demands.save(actor, document.payload, document.id, {
                    batchId: token,
                  });
                return finance.saveDraft(
                  actor,
                  document.payload.project_id,
                  document.payload,
                  document.id,
                );
              });
              results.push({
                number: result.demand_no || result.number || document.number,
                id: result.id,
                action: document.action,
              });
            } catch (error) {
              if (input.atomic) throw error;
              failures.push(
                issue(
                  document.sheet,
                  document.row,
                  "document",
                  document.number,
                  error.message,
                ),
              );
            }
          }
        };
        const writeStarted = performance.now();
        execute();
        const writeCompleted = performance.now();
        const result = {
          results,
          issues: failures,
          timings_ms: {
            revalidation: writeStarted - commitStarted,
            business_writes: writeCompleted - writeStarted,
          },
          submitted_at: now(),
          kind: body.kind,
        };
        repo.update("demand_batches", "id", token, {
          status: "submitted",
          draft_json: JSON.stringify({ ...body, result }),
          version: batch.version + 1,
          updated_at: now(),
          idempotency_key: input.request_key,
          payload_sha256: body.sha256,
        });
        catalog.audit(actor, "exchange", token, "commit", null, result);
        return result;
      },
    );
  }
  function lookupRows() {
    return [
      "operations",
      "physical",
      "towers",
      "spans",
      "materials",
      "lines",
      "units",
    ].flatMap((kind) =>
      catalog
        .list(kind)
        .filter((row) => !["inactive", "retired"].includes(row.status))
        .map((row) => ({
          kind: catalog.definitions[kind].title,
          id: row.id,
          name: row.label,
          model: row.model,
          specification: row.specification,
        })),
    );
  }
  async function exportData(actor, kind, options = {}) {
    if (kind === "assets") return assets.exportData(actor, options);
    authorize(actor, "read");
    let records =
      kind === "demands" ? demands.list() : finance.allSettlements();
    if (options.projectId)
      records = records.filter(
        (record) => record.project_id === options.projectId,
      );
    if (options.ids?.length)
      records = records.filter((x) => options.ids.includes(x.id));
    if (options.query)
      records = records.filter((x) =>
        JSON.stringify(x).includes(options.query),
      );
    requireValue(
      records.length <= MAX_DOCUMENTS,
      "导出超过5000张，请收窄筛选条件",
    );
    if (options.report) {
      const businessLabels = system.catalog.displayLabels();
      const statuses = {
        pending: "待确认",
        active: "有效",
        returned: "退回",
        cancelled: "已取消",
        submit: "待审核",
        approve: "已批准",
        return: "已退回",
        reject: "已驳回",
      };
      if (kind === "demands") {
        const detailed = records.map((record) => demands.get(record.id));
        return makeBusinessReport(
          kind,
          detailed.map((record) => ({
            需求编号: record.demand_no,
            操作类型: record.operation_snapshot,
            作业对象: record.work_object_snapshot,
            问题描述: record.problem_description,
            验收标准: record.completion_standard,
            工作量: decimalText(record.quantity_scaled, 4),
            计量单位: record.unit_snapshot,
            需求状态: statuses[record.status],
            位置数量: record.work_locations.length,
            正式版本: record.current_version,
            来源依据: record.sources
              .map((source) => source.description)
              .join("；"),
          })),
          detailed.flatMap((record) =>
            record.work_locations.map((location) => ({
              需求编号: record.demand_no,
              线路: location.location_snapshot_json.line_name,
              作业位置:
                location.location_snapshot_json.location_label ||
                location.location_snapshot_json.physical_code ||
                location.location_snapshot_json.tower_no ||
                location.span_id,
              工作量: decimalText(location.quantity_scaled, 4),
              计量单位: record.unit_snapshot,
              作业方式:
                location.work_mode === "outage"
                  ? "停电"
                  : location.work_mode === "non_outage"
                    ? "不停电"
                    : "未明确",
              现场特征: Object.entries(location.site_features_json)
                .map(
                  ([code, fact]) =>
                    (businessLabels[code + "@" + fact.factor_version] ||
                      "历史价格特征") +
                    "=" +
                    fact.value,
                )
                .join(" / "),
            })),
          ),
        );
      }
      const sum = (items, key) =>
        items.reduce((total, item) => total + BigInt(item[key] || 0), 0n);
      return makeBusinessReport(
        kind,
        records.map((record) => {
          const project = system.projects.get(record.project_id),
            effective = repo.where("v_settlement_effective_versions", {
              settlement_id: record.id,
            })[0],
            approvedItems =
              effective && effective.change_type !== "void"
                ? repo.where("settlement_item_versions", {
                    settlement_version_id: effective.id,
                  })
                : [],
            resolved =
              effective && effective.change_type !== "void"
                ? repo.where("settlement_scope_results", {
                    settlement_version_id: effective.id,
                  })
                : [];
          return {
            结算编号: record.number,
            子项目编号: project.code,
            子项目当前名称: project.name,
            最新正式版本: record.version?.version_no || 0,
            最新审核状态: statuses[record.review?.action] || "未提交",
            草稿状态: record.draft ? "有草稿" : "无草稿",
            "本次草稿金额（元）": record.draft
              ? decimalText(sum(record.draft.document.items, "amount_fen"), 2)
              : "",
            "当前已批准金额（元）": decimalText(
              sum(approvedItems, "amount_fen"),
              2,
            ),
            当前新增解决量: decimalText(
              sum(resolved, "resolved_quantity_scaled"),
              4,
            ),
            结算日期:
              record.version?.settlement_on ||
              record.draft?.document.settlement_on ||
              "",
            结算依据:
              record.version?.basis || record.draft?.document.basis || "",
          };
        }),
      );
    }
    const rows = {
      documents: [],
      work_locations: [],
      materials: [],
      sources: [],
      items: [],
      resolutions: [],
      custom_fields: [],
      site_features: [],
    };
    for (let record of records) {
      if (kind === "demands") record = demands.get(record.id);
      else record.project_name = system.projects.get(record.project_id).name;
      if (kind === "demands") {
        rows.documents.push({
          ...record,
          expected_version: record.current_version,
          operation_name: record.operation_snapshot,
        });
        rows.work_locations.push(
          ...record.work_locations.map((x) => ({
            ...x,
            demand_no: record.demand_no,
            specification: x.location_snapshot_json?.specification || "",
            action: "upsert",
            line_name: x.location_snapshot_json.line_name,
            tower_no: x.location_snapshot_json.tower_no || undefined,
            asset_no: x.physical_tower_id
              ? catalog.get("physical", x.physical_tower_id, true).asset_no
              : undefined,
          })),
        );
        for (const location of record.work_locations) {
          const locationRow =
            rows.work_locations.length -
            record.work_locations.length +
            record.work_locations.indexOf(location) +
            2;
          for (const [code, feature] of Object.entries(
            location.site_features_json || {},
          ))
            rows.site_features.push({
              demand_no: record.demand_no,
              location_row: locationRow,
              location_kind: location.location_kind,
              factor_id: repo.where("dictionary_items", {
                type_id: "price_factor",
                code,
              })[0].id,
              factor_name: repo.where("dictionary_item_versions", {
                item_id: repo.where("dictionary_items", {
                  type_id: "price_factor",
                  code,
                })[0].id,
                version: feature.factor_version,
              })[0].name,
              value: feature.value,
            });
        }
        rows.materials.push(
          ...record.materials.map((x) => ({
            material_name: x.material_name,
            material_model: x.model,
            material_specification: x.specification,
            ...x,
            demand_no: record.demand_no,
            action: "upsert",
          })),
        );
        for (const field of JSON.parse(record.field_definitions_json || "[]"))
          if (record.custom_fields?.[field.key] !== undefined)
            rows.custom_fields.push({
              demand_no: record.demand_no,
              field_key: field.key,
              field_name: field.label,
              value: record.custom_fields[field.key],
            });
        rows.sources.push(
          ...record.sources.map((x) => ({ ...x, demand_no: record.demand_no })),
        );
      } else {
        const doc = record.draft?.document || record.version || {};
        rows.documents.push({
          ...doc,
          id: record.id,
          number: record.number,
          project_name: record.project_name,
          project_id: record.project_id,
          expected_version: record.version?.version_no || 0,
          expected_edit_version: record.draft?.edit_version || 0,
        });
        rows.items.push(
          ...(record.draft?.document.items || record.items).map((x) => ({
            ...x,
            number: record.number,
            cost_node_path: x.cost_node_id
              ? nodePath(x.cost_node_id)
              : undefined,
            demand_description: x.project_scope_id
              ? system.demands.get(
                  repo.find("project_demand_scopes", "id", x.project_scope_id)
                    .demand_id,
                  true,
                ).problem_description
              : undefined,
            action: "upsert",
          })),
        );
        rows.resolutions.push(
          ...(record.draft?.document.resolutions || record.resolutions).map(
            (x) => ({
              ...x,
              number: record.number,
              demand_description: system.demands.get(
                repo.find("project_demand_scopes", "id", x.project_scope_id)
                  .demand_id,
                true,
              ).problem_description,
              action: "upsert",
            }),
          ),
        );
      }
    }
    return makeWorkbook(kind, rows, {
      report: options.report,
      lookups: lookupRows(),
    });
  }
  return {
    preview,
    commit,
    exportData,
    template(actor, kind, projectId) {
      authorize(actor, "read");
      if (kind === "assets") return makeWorkbook("assets");
      const project = projectId ? system.projects.get(projectId) : null;
      return makeWorkbook(
        kind,
        project && kind === "settlements"
          ? {
              documents: [
                {
                  project_id: project.id,
                  approval_version_id: project.approval?.id,
                  funding_version_id: project.funding?.id,
                  expected_version: 0,
                },
              ],
            }
          : {},
        { lookups: lookupRows() },
      );
    },
    results(actor, token) {
      authorize(actor, "read");
      const batch = repo.find("demand_batches", "id", token);
      requireValue(batch && batch.created_by === actor.id, "批次不存在", 404);
      const result = JSON.parse(batch.draft_json).result;
      requireValue(result, "批次尚未提交", 409);
      return makeBusinessReport("exchange", [
        ...result.results.map((row) => ({
          业务编号: row.number,
          处理结果:
            row.action === "create"
              ? "已新增"
              : row.action === "update"
                ? "已更新"
                : "保持原值",
          业务标识: row.id,
          提交时间: result.submitted_at,
        })),
        ...result.issues.map((row) => ({
          处理结果: "失败",
          工作表: row.sheet,
          行号: row.row,
          字段: row.field,
          原始值:
            typeof row.raw_value === "object"
              ? JSON.stringify(row.raw_value)
              : row.raw_value,
          原因: row.reason,
          修改建议: row.suggestion,
        })),
      ]);
    },
    errors(actor, token) {
      authorize(actor, "read");
      const batch = repo.find("demand_batches", "id", token);
      requireValue(batch && batch.created_by === actor.id, "批次不存在", 404);
      const body = JSON.parse(batch.draft_json);
      return errorsWorkbook(body.result?.issues || body.issues);
    },
  };
}

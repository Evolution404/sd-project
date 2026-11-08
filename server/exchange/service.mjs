import {
  parseWorkbook,
  makeWorkbook,
  makeBusinessReport,
  errorsWorkbook,
  issue,
  MAX_DOCUMENTS,
} from "./workbook.mjs";
import { decimalText } from "../domain/decimal.mjs";
import { authorize, id, now, digest } from "../application/auth.mjs";
import { requireValue, expectedVersion } from "../domain/errors.mjs";
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
  // Rebuilt for each preflight/commit: O(n) code and sheet indexes instead of
  // rescanning all 5000 master records for each of 5000 Excel detail rows.
  let codeIndexes = new Map();
  let matchingMs = 0;
  function resolveCode(kind, code) {
    const started = performance.now();

    const key =
      { physical: "tower_code", towers: "logical_code", lines: "line_code" }[
        kind
      ] || "code";
    let index = codeIndexes.get(kind);
    if (!index) {
      index = new Map();
      for (const row of catalog.list(kind, true)) {
        for (const value of new Set([
          row[key],
          kind === "spans" ? row.id : null,
        ])) {
          if (value == null) continue;
          const rows = index.get(value) || [];
          if (!rows.some((existing) => existing.id === row.id)) rows.push(row);
          index.set(value, rows);
        }
      }
      codeIndexes.set(kind, index);
    }
    const matches = index.get(code) || [];
    requireValue(
      matches.length === 1,
      `编码 ${code} 未精确匹配唯一${catalog.definitions[kind].title}`,
    );
    matchingMs += performance.now() - started;
    return matches[0];
  }
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
  function resolveDetails(kind, row, projectId) {
    const value = { ...row };
    if (kind === "work_locations" && value.location_code) {
      const reference =
          value.location_kind === "physical_tower"
            ? "physical"
            : value.location_kind === "span"
              ? "spans"
              : "towers",
        key =
          value.location_kind === "physical_tower"
            ? "physical_tower_id"
            : value.location_kind === "span"
              ? "span_id"
              : "logical_tower_id";
      value[key] = resolveCode(reference, value.location_code).id;
    }
    if (kind === "materials" && value.material_code)
      value.material_id = resolveCode("materials", value.material_code).id;
    if (kind === "items" && value.cost_node_path) {
      const matches = repo
        .where("v_project_cost_node_current", { project_id: projectId })
        .filter((node) => nodePath(node.id) === value.cost_node_path);
      requireValue(matches.length === 1, "费用科目完整路径未精确匹配唯一科目");
      value.cost_node_id = matches[0].id;
    }
    if (["items", "resolutions"].includes(kind) && value.demand_no) {
      const demand = repo.find("demands", "demand_no", value.demand_no);
      requireValue(demand, "需求编号不存在");
      const scope = repo.where("project_demand_scopes", {
        project_id: projectId,
        demand_id: demand.id,
      })[0];
      requireValue(scope, "该需求未关联此子项目");
      value.project_scope_id = scope.id;
    }
    return value;
  }
  function prepare(kind, parsed, mode, projectId) {
    requireValue(["create", "update", "mixed"].includes(mode), "导入模式无效");
    codeIndexes = new Map();
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
        if (kind === "demands" && root.operation_code)
          root.operation_id = resolveCode("operations", root.operation_code).id;
        if (kind === "settlements" && root.project_code) {
          const project = repo.find("projects", "code", root.project_code);
          requireValue(project, "子项目编码不存在");
          root.project_id = project.id;
        }
        const existing = root.id
          ? kind === "demands"
            ? demands.get(root.id)
            : finance.settlement(root.id)
          : null;
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
                ),
              );
            } catch (error) {
              issues.push(
                issue(
                  row._sheet,
                  row._row,
                  row.location_code
                    ? "location_code"
                    : row.material_code
                      ? "material_code"
                      : row.cost_node_path
                        ? "cost_node_path"
                        : "demand_no",
                  row.location_code ||
                    row.material_code ||
                    row.cost_node_path ||
                    row.demand_no,
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
              const matches = payload.work_locations.filter((location) => {
                const locationCode =
                  location.location_code ||
                  (location.physical_tower_id
                    ? catalog.get("physical", location.physical_tower_id, true)
                        .tower_code
                    : location.logical_tower_id
                      ? catalog.get("towers", location.logical_tower_id, true)
                          .logical_code
                      : location.span_id);
                return (
                  locationCode === row.location_code &&
                  (!row.location_kind ||
                    location.location_kind === row.location_kind)
                );
              });
              requireValue(
                matches.length === 1,
                "现场价格特征未精确匹配本需求唯一作业位置",
              );
              const factor = repo.where("dictionary_items", {
                  type_id: "price_factor",
                  code: row.factor_code,
                })[0],
                declared =
                  factor &&
                  declaredFeatures.find(
                    (feature) => feature.factor_id === factor.id,
                  );
              requireValue(declared, "价格特征不属于本需求采用的正式操作定义");
              const version = repo.where("dictionary_item_versions", {
                  item_id: factor.id,
                  version: declared.factor_version,
                })[0],
                definition = JSON.parse(version.fields_json),
                location = matches[0];
              const actual =
                typeof location.site_features_json === "string"
                  ? JSON.parse(location.site_features_json)
                  : { ...(location.site_features_json || {}) };
              if (row.value === undefined) continue;
              if (row.value === null) delete actual[row.factor_code];
              else {
                let value = row.value;
                if (definition.kind === "number") {
                  value = Number(value);
                  requireValue(
                    Number.isSafeInteger(value),
                    "价格特征实际值须为整数",
                  );
                } else value = String(value);
                actual[row.factor_code] = {
                  factor_version: declared.factor_version,
                  value,
                };
              }
              location.site_features_json = actual;
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
                  ["description", "discovered_on", "external_record_id"].every(
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
              : Object.keys(error.fields || {})[0] || numberKey,
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
    authorize(actor, "write");
    requireValue(["demands", "settlements"].includes(kind), "未知交换类型");
    const started = performance.now();
    const parsed = await parseWorkbook(buffer, kind);
    const parsedAt = performance.now();
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
          prepared = prepare(body.kind, body.parsed, body.mode, body.projectId),
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
                if (body.kind === "demands")
                  return demands.save(actor, document.payload, document.id);
                return finance.saveDraft(
                  actor,
                  document.payload.project_id,
                  document.payload,
                  document.id,
                );
              });
              results.push({
                number: document.number,
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
    ]
      .flatMap((kind) =>
        catalog
          .list(kind)
          .filter((row) => !["inactive", "retired"].includes(row.status))
          .map((row) => ({
            kind,
            id: row.id,
            code:
              row.code ||
              row.tower_code ||
              row.logical_code ||
              row.line_code ||
              "",
            name: row.name || row.tower_no || "",
          })),
      )
      .concat(
        repo.list("projects").map((row) => ({
          kind: "projects",
          id: row.id,
          code: row.code,
          name: system.projects.get(row.id).name,
        })),
        repo.list("v_project_cost_node_current").map((row) => ({
          kind: "cost_nodes",
          id: row.id,
          name: row.name,
          code: row.project_id,
        })),
        repo.list("project_demand_scopes").map((row) => ({
          kind: "project_scopes",
          id: row.id,
          name: row.demand_id,
          code: row.project_id,
        })),
      );
  }
  async function exportData(actor, kind, options = {}) {
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
                .map(([code, fact]) => code + "=" + fact.value)
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
            子项目编码: project.code,
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
      else
        record.project_code = repo.find(
          "projects",
          "id",
          record.project_id,
        ).code;
      if (kind === "demands") {
        rows.documents.push({
          ...record,
          expected_version: record.current_version,
          operation_code: catalog.get("operations", record.operation_id, true)
            .code,
        });
        rows.work_locations.push(
          ...record.work_locations.map((x) => ({
            ...x,
            demand_no: record.demand_no,
            specification: x.location_snapshot_json?.specification || "",
            action: "upsert",
            location_code: x.physical_tower_id
              ? catalog.get("physical", x.physical_tower_id, true).tower_code
              : x.logical_tower_id
                ? catalog.get("towers", x.logical_tower_id, true).logical_code
                : x.span_id,
          })),
        );
        for (const location of record.work_locations) {
          const locationCode = location.physical_tower_id
            ? catalog.get("physical", location.physical_tower_id, true)
                .tower_code
            : location.logical_tower_id
              ? catalog.get("towers", location.logical_tower_id, true)
                  .logical_code
              : location.span_id;
          for (const [code, feature] of Object.entries(
            location.site_features_json || {},
          ))
            rows.site_features.push({
              demand_no: record.demand_no,
              location_code: locationCode,
              location_kind: location.location_kind,
              factor_code: code,
              value: feature.value,
            });
        }
        rows.materials.push(
          ...record.materials.map((x) => ({
            material_code: catalog.get("materials", x.material_id, true).code,
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
          project_code: record.project_code,
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
            demand_no: x.project_scope_id
              ? repo.find(
                  "demands",
                  "id",
                  repo.find("project_demand_scopes", "id", x.project_scope_id)
                    .demand_id,
                ).demand_no
              : undefined,
            action: "upsert",
          })),
        );
        rows.resolutions.push(
          ...(record.draft?.document.resolutions || record.resolutions).map(
            (x) => ({ ...x, number: record.number, action: "upsert" }),
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

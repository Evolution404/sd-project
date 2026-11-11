import {
  parseWorkbook,
  makeWorkbook,
  makeBusinessReport,
  errorsWorkbook,
  issue,
} from "./workbook.js";
import { createAssetExchange } from "./assets.js";
import { createReferences } from "./references.js";
import { cleanRow as clean, detailIdentity as identity, mergeDetails, differences } from "./details.js";
import { validateFeatureValue } from "../pricing/features.js";
import { authorize, id, now, digest } from "../../platform/auth/service.js";
import { requireValue, expectedVersion } from "../../shared/errors/business-error.js";
import type {System} from "../../bootstrap.js";
import type {Actor} from "../../shared/types/contracts.js";
import type {DemandRecord} from "../../shared/types/demands.js";
import type {ParsedWorkbook,ParsedWorkbookRow,WorkbookKind,WorkbookIssue,ExchangeCommitResult,
  ExchangeMode,ExchangePreviewOptions,ExchangeExportOptions,
  ExchangePreviewDocument,ExchangePrepareResult,ExchangeCommitInput} from "../../shared/types/exchange.js";
import {BusinessError} from "../../shared/errors/business-error.js";
import {isObject} from "../../shared/types/contracts.js";
import type {DetailKind} from "./details.js";
import type {OperationField,PricingFeatureDeclaration} from "../../shared/types/work-standards.js";
import {validateFactorDefinition} from "../pricing/features.js";
import {financeSettlementDraft} from "../finance/requests.js";
import {createExchangeExporter} from "./export.js";
export function createExchange(system:System) {
  const { exchangePersistence, catalog, demands, finance } = system;
  const assets = createAssetExchange(system);
  let references = createReferences(system);
  let matchingMs = 0;
  function resolveDetails(kind:string, row:ParsedWorkbookRow, projectId:string|null|undefined, existing:DemandRecord|null) {
    const value = { ...row };
    const started = performance.now();
    if (kind === "work_locations") {
      const adopted = existing?.work_locations.find(
        (location) =>
          identity("work_locations", {...location}) ===
          identity("work_locations", value),
      );
      const frozen =
        adopted &&
        (!row.line_name ||
          row.line_name === adopted.location_snapshot_json.line_name) &&
        (!row.tower_no ||
          row.tower_no === adopted.location_snapshot_json.tower_no);
      if (!frozen) {
        requireValue(value.location_kind==="physical_tower" || value.location_kind==="logical_tower" || value.location_kind==="span", "请填写位置类型");
        Object.assign(value, references.location({...value,location_kind:value.location_kind}));
      }
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
      requireValue(typeof projectId==="string", "选择结算所属子项目");
      value.cost_node_id = references.costNode(projectId, value.cost_node_path).id;
    }
    if (["items", "resolutions"].includes(kind) && value.demand_description) {
      requireValue(typeof projectId==="string", "选择结算所属子项目");
      value.project_scope_id = references.scope(
        projectId,
        value.demand_description,
        value.project_scope_id,
      ).id;
    }
    return value;
  }
  function prepare(kind:"demands"|"settlements",parsed:ParsedWorkbook,mode:ExchangeMode, projectId:string|null|undefined):ExchangePrepareResult {
    requireValue(["create", "update", "mixed"].includes(mode), "导入模式无效");
    references = createReferences(system);
    matchingMs = 0;
    const preparationStarted = performance.now();
    let validationMs = 0;
    const numberKey = kind === "demands" ? "demand_no" : "number",
      grouped = new Map<string,Map<string,ParsedWorkbookRow[]>>(),
      sourceByPosition = new Map<string,ParsedWorkbookRow>();
    for (const [sheet, rows] of Object.entries(parsed.rows)) {
      const groups = new Map<string,ParsedWorkbookRow[]>();
      for (const row of rows) {
        const businessNumber=String(row[numberKey]??"");
        const group=groups.get(businessNumber)??[];
        group.push(row);
        groups.set(businessNumber,group);
        sourceByPosition.set(row._sheet + "\0" + row._row, row);
      }
      grouped.set(sheet, groups);
    }
    const rowsFor = (sheet:string, number:string):ParsedWorkbookRow[] => grouped.get(sheet)?.get(number) || [];
    const issues:WorkbookIssue[] = [...parsed.issues],
      documents:ExchangePreviewDocument[] = [],
      numbers = new Set<string>();
    for (const root of parsed.rows.documents) {
      const number = root[numberKey];
      try {
        requireValue(
          typeof number === "string" && number.trim(),
          "缺少业务编号",
        );
        requireValue(!numbers.has(number), "文件内业务编号重复");
        numbers.add(number);
        const existingDemand = kind==="demands" && root.id ? demands.get(root.id) : null;
        const existingSettlement = kind==="settlements" && root.id ? finance.settlement(root.id) : null;
        const existing = existingDemand || existingSettlement;
        const matchingStarted = performance.now();
        if (
          kind === "demands" &&
          root.operation_name &&
          (!existingDemand || root.operation_name !== existingDemand.operation_snapshot)
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
          !existing || (kind==="demands" ? existingDemand?.demand_no===number : existingSettlement?.number===number),
          "业务编号与稳定标识不一致",
        );
        if (kind === "demands" && !existing)
          requireValue(
            !exchangePersistence.demandNumberExists(number),
            "业务编号已存在，更新必须携带稳定标识",
          );
        if (kind === "settlements" && !existing)
          requireValue(
            !exchangePersistence.settlementNumberExists(root.project_id, number),
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
              ? existingDemand?.current_version
              : existingSettlement?.version?.version_no || 0,
            root.expected_version,
          );
        if (kind === "settlements" && existingSettlement)
          expectedVersion(
            existingSettlement.draft?.edit_version || 0,
            root.expected_edit_version,
          );
        if (projectId)
          requireValue(
            (root.project_id || existingSettlement?.project_id) === projectId,
            "文件单据不属于当前子项目",
          );
        const payload:Record<string,unknown> = {
          ...(kind === "demands" ? existingDemand : existingSettlement?.draft?.document || {}),
          ...clean(root),
        };
        const detailKeys:DetailKind[] = kind==="demands" ? ["work_locations","materials"] : ["items","resolutions"];
        for (const key of detailKeys) {
          for (const row of rowsFor(key, number)) {
            try {
              Object.assign(
                row,
                resolveDetails(
                  key,
                  row,
                  typeof payload.project_id==="string" ? payload.project_id : existingSettlement?.project_id,
                  existingDemand,
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
                  error instanceof Error ? error.message : "明细校验失败",
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
          const priorDetails=payload[key];
          requireValue(priorDetails === undefined || (Array.isArray(priorDetails) && priorDetails.every(isObject)), "既有正式明细结构错误", 422);
          payload[key] = mergeDetails(key, Array.isArray(priorDetails) ? priorDetails : [], rows);
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
              const equipmentKind=row.location_kind==="span" ? "spans" : row.location_kind==="physical_tower" ? "physical" : "towers";
              requireValue(typeof row[key]==="string" && row[key], "作业位置身份不存在",404);
              system.equipment.get(equipmentKind,row[key]);
            } catch (error) {
              issues.push(
                issue(row._sheet, row._row, key, row[key], error instanceof Error ? error.message : "设备身份校验失败"),
              );
            }
          }
          payload.sources = rowsFor("sources", number).length
            ? rowsFor("sources", number).map((row) => {
                const value = clean(row);
                delete value.demand_no;
                return value;
              })
            : existingDemand?.sources || [];
          const sourceInputs=payload.sources;
          requireValue(Array.isArray(sourceInputs) && sourceInputs.every(isObject), "需求来源格式无效");
          for (const source of sourceInputs)
            if (source.id) {
              requireValue(typeof source.id === "string", "来源身份必须是字符串");
              requireValue(exchangePersistence.sourceExists(source.id), "来源标识不存在");
              requireValue(
                !exchangePersistence.sourceHasSupersedingAudit(source.id),
                "来源已有更正或删除，须刷新后重新核对",
                409,
              );
            }
          requireValue(typeof payload.operation_id === "string", "请选择作业操作类型");
          const operation = catalog.get("operations",payload.operation_id,Boolean(existingDemand));
          const adopted = exchangePersistence.operationAdoptedVersion(
            payload.operation_id,
            typeof payload.operation_version === "number" ? payload.operation_version : (existingDemand?.operation_version || operation.version),
          );
          requireValue(adopted && typeof adopted.fields_json === "string" && typeof adopted.pricing_features_json === "string", "正式操作定义的采用版本缺失",409);
          const definitions:OperationField[] = JSON.parse(adopted.fields_json);
          const declaredFeatures:PricingFeatureDeclaration[] = JSON.parse(adopted.pricing_features_json);
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
              const workLocations=payload.work_locations;
              requireValue(Array.isArray(workLocations) && workLocations.every(isObject),"正式作业位置结构不合法");
              const location = workLocations.find((item) => identity("work_locations", item) === identity("work_locations", sourceRow));
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
              const version = exchangePersistence.factorAdoptedVersion(
                factor.id, declared.factor_version);
              requireValue(version,"价格特征冻结版本不存在",409);
              const definition = validateFactorDefinition(JSON.parse(version.fields_json));
              const rawFeatures=location.site_features_json;
              const decodedFeatures:unknown = typeof rawFeatures==="string" ? JSON.parse(rawFeatures) : (rawFeatures ?? {});
              requireValue(isObject(decodedFeatures),"现场价格特征结构无效");
              const actual:Record<string,unknown>={...decodedFeatures};
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
              location.site_features_json = actual;
            } catch (error) {
              issues.push(
                issue(row._sheet, row._row, "value", row.value, error instanceof Error ? error.message : "价格特征未通过验证"),
              );
              throw error;
            }
          }

          const originalCustom=existingDemand?.custom_fields ?? payload.custom_fields ?? {};
          requireValue(isObject(originalCustom), "补充字段必须为对象");
          const customFields:Record<string,unknown>={...originalCustom};
          payload.custom_fields=customFields;
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
                ([true, false, "是", "否", "true", "false", "1", "0"] as unknown[]).includes(value),
                "是或否字段取值错误",
              );
              value = ([true, "是", "true", "1"] as unknown[]).includes(value);
            }
            customFields[definition.key] = value;
          }
          const validationStarted = performance.now();
          normalized = demands.normalize(payload, existingDemand);
          const duplicates = demands.findDuplicates(
            normalized.operation_id,
            normalized.work_locations,
            existingDemand?.id,
          );
          requireValue(
            !duplicates.length,
            "存在同操作同位置疑似重复需求，须在线复核后处理",
            409,
            { duplicates:duplicates.map(item=>item.demand_no) },
          );
          validationMs += performance.now() - validationStarted;
          Object.assign(payload, normalized);
        } else {
          const settlementProject=typeof payload.project_id==="string" && payload.project_id ? payload.project_id : existingSettlement?.project_id;
          requireValue(settlementProject,"请明确结算所属子项目");
          finance.validateDraft(settlementProject,financeSettlementDraft(payload));
        }
        const change = differences(
          kind === "demands" && existingDemand
            ? {...demands.normalize(existingDemand, existingDemand)}
            : {...(existingSettlement?.draft?.document || {})},
          kind === "demands" && normalized ? {...normalized} : payload,
        );
        if (
          kind === "demands" &&
          existingDemand &&
          Array.isArray(payload.sources) &&
          payload.sources.some(
            (source:unknown) => isObject(source) && (
              !source.id ||
              !existingDemand.sources.some(
                (old) =>
                  old.id === source.id &&
                  (["description","discovered_on"] as const).every(
                    (field) =>
                      source[field] === undefined ||
                      source[field] === old[field],
                  ),
              )) ,
          )
        )
          change.push({
            field: "sources",
            before: existingDemand.sources,
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
            (error instanceof Error && error.message.includes("版本"))
              ? "expected_version"
              : Object.keys(error instanceof BusinessError ? error.fields : {})[0] ||
                  (kind === "demands" ? "operation_name" : "project_name"),
            root,
            error instanceof Error ? error.message : "导入文档不符合当前规则",
          ),
        );
      }
    }
    for (const [key, rows] of Object.entries(parsed.rows))
      if (key !== "documents")
        for (const row of rows)
          if (!numbers.has(String(row[numberKey]??"")))
            issues.push(
              issue(
                row._sheet,
                row._row,
                numberKey,
                row[numberKey],
                "明细未对应文件中的业务单据",
              ),
            );
    const seenLocations = new Map<string,ExchangePreviewDocument>();
    for (const doc of documents)
      if (kind === "demands" && doc.action === "create") {
        const locations=doc.payload.work_locations;
        requireValue(Array.isArray(locations) && locations.every(isObject),"新增需求的位置列表无效");
        for (const loc of locations) {
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
      }
    const invalidNumbers = new Set<string>();
    for (const problem of issues) {
      const source = sourceByPosition.get(problem.sheet + "\0" + problem.row);
      if (source) invalidNumbers.add(String(source[numberKey] ?? ""));
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
  async function preview(actor:Actor,kind:WorkbookKind,buffer:Buffer,options:ExchangePreviewOptions = {}) {
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
    exchangePersistence.createBatch({
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
  function counts(prepared:ExchangePrepareResult) {
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
  function commit(actor:Actor,token:string,input:ExchangeCommitInput) {
    authorize(actor, "write");
    return system.idempotent(
      actor,
      input.request_key,
      { token, atomic: Boolean(input.atomic) },
      () => {
        const batch = exchangePersistence.batch(token);
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
          results:ExchangeCommitResult["results"] = [],
          failures:WorkbookIssue[] = [...prepared.issues];
        requireValue(
          !input.atomic || !failures.length,
          "整批提交包含预检错误，全部未写入",
          422,
          { issues: failures.map(problem => `${problem.sheet} 第${problem.row}行：${problem.reason}`) },
        );
        const execute = () => {
          for (const document of prepared.documents) {
            try {
              const result = system.database.transaction(() => {
                if (document.action === "unchanged")
                  return { id: document.id, unchanged: true };
                if ("kind" in document) return assets.execute(actor, document);
                if (body.kind === "demands")
                  return demands.save(actor, document.payload, document.id || undefined, {batchId:token});
                const projectId=document.payload.project_id;
                requireValue(typeof projectId==="string" && projectId.length>0,"结算导入缺少项目身份");
                return finance.saveDraft(actor,projectId,financeSettlementDraft(document.payload),document.id||undefined);
              });
              requireValue(typeof result.id==="string","提交后业务身份无效");
              const resultNumber = "demand_no" in result && typeof result.demand_no==="string" ? result.demand_no
                : "number" in result && typeof result.number==="string" ? result.number : document.number;
              results.push({number:resultNumber,id:result.id,action:document.action});
            } catch (error) {
              if (input.atomic) throw error;
              failures.push(
                issue(
                  document.sheet,
                  document.row,
                  "document",
                  document.number,
                  error instanceof Error ? error.message : "批量提交失败",
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
        exchangePersistence.submitBatch(token, batch.version, {
          draft_json: JSON.stringify({ ...body, result }),
          updated_at: now(),
          idempotency_key: input.request_key,
          payload_sha256: body.sha256,
        });
        catalog.audit(actor, "exchange", token, "commit", null, result);
        return result;
      },
    );
  }
  function lookupRows():Record<string,unknown>[] {
    type LookupRecord={id:string;label:string;status:string;model?:string;specification?:string};
    const result:Record<string,unknown>[]=[];
    const group=(title:string,records:LookupRecord[])=>{
      for(const record of records){
        if(record.status==="inactive"||record.status==="retired")continue;
        result.push({kind:title,id:record.id,name:record.label,
          model:record.model,specification:record.specification});
      }
    };
    group("操作类型",system.standards.operations());
    group("物理杆塔",system.equipment.list("physical"));
    group("逻辑杆塔",system.equipment.list("towers"));
    group("档距",system.equipment.list("spans"));
    group("物资",system.materials.list());
    group("线路",system.equipment.list("lines"));
    group("计量单位",system.dictionaries.list("units"));
    return result;
  }
  const exporter=createExchangeExporter(system,lookupRows);
  async function exportData(actor:Actor,kind:WorkbookKind,options:ExchangeExportOptions={}):Promise<Buffer> {
    return kind==="assets" ? assets.exportData(actor,options):exporter(actor,kind,options);
  }
  return {
    preview,
    commit,
    exportData,
    template(actor:Actor,kind:WorkbookKind,projectId?:string|null) {
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
    results(actor:Actor,token:string) {
      authorize(actor, "read");
      const batch = exchangePersistence.batch(token);
      requireValue(batch && batch.created_by === actor.id, "批次不存在", 404);
      const body:unknown=JSON.parse(batch.draft_json);
      requireValue(isObject(body)&&isObject(body.result),"批次尚未提交",409);
      const rawResult=body.result;
      requireValue(Array.isArray(rawResult.results)&&rawResult.results.every(isObject)&&
        Array.isArray(rawResult.issues)&&rawResult.issues.every(isObject)&&
        typeof rawResult.submitted_at==="string","正式批次结果结构无效",409);
      const result=rawResult as unknown as ExchangeCommitResult;
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
    errors(actor:Actor,token:string) {
      authorize(actor, "read");
      const batch = exchangePersistence.batch(token);
      requireValue(batch && batch.created_by === actor.id, "批次不存在", 404);
      const body:unknown = JSON.parse(batch.draft_json);
      requireValue(isObject(body),"预检批次结构无效",409);
      const chosen = isObject(body.result) ? body.result.issues : body.issues;
      requireValue(Array.isArray(chosen)&&chosen.every(row=>isObject(row)&&
        typeof row.sheet==="string"&&typeof row.row==="number"&&typeof row.field==="string"&&
        typeof row.reason==="string"&&typeof row.suggestion==="string"),
        "预检失败列表格式无效",409);
      return errorsWorkbook(chosen as WorkbookIssue[]);
    },
  };
}

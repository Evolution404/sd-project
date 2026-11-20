import { attributeCells } from "./attribute-cells.js";
import {
  parseWorkbook,
  makeWorkbook,
  makeBusinessReport,
  errorsWorkbook,
  issue,
  attributeKey,
} from "./workbook.js";
import { createAssetExchange } from "./assets.js";
import { createReferences } from "./references.js";
import { cleanRow as clean, detailIdentity as identity, mergeDetails, differences } from "./details.js";
import { authorize, id, now, digest } from "../../platform/auth/service.js";
import { requireValue, expectedVersion } from "../../shared/errors/business-error.js";
import type { ExchangePorts } from "./ports.js";
import type {Actor} from "../../shared/types/contracts.js";
import type {DemandRecord} from "../../shared/types/demands.js";
import type {ParsedWorkbook,ParsedWorkbookRow,WorkbookKind,WorkbookIssue,ExchangeCommitResult,
  ExchangeMode,ExchangePreviewOptions,ExchangeExportOptions,
  ExchangePreviewDocument,ExchangePrepareResult,ExchangeCommitInput} from "../../shared/types/exchange.js";
import {BusinessError} from "../../shared/errors/business-error.js";
import {isObject} from "../../shared/types/contracts.js";
import type {DetailKind} from "./details.js";
import {financeSettlementDraft} from "../finance/draft-input.js";
import {createExchangeExporter} from "./export.js";
export function createExchange(system:ExchangePorts) {
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
    const numberKey = kind === "demands" ? "import_ref" : "number",
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
      const originalIssueCount=issues.length;
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
          !existing || (kind==="demands" ? (!root.demand_no || existingDemand?.demand_no===root.demand_no) : existingSettlement?.number===number),
          "业务编号与稳定标识不一致",
        );
        if (kind === "demands" && !existing)
          requireValue(!root.demand_no, "新增需求正式编号须留空，由服务端生成");
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
          ...(kind === "demands" ? existingDemand : existingSettlement?.draft?.document ||
            (existingSettlement?.version ? {
              ...existingSettlement.version, items: existingSettlement.items, resolutions: existingSettlement.resolutions,
            } : {})),
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
                delete value.import_ref;
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
          requireValue(adopted, "正式操作定义的采用版本缺失",409);
          const definitions = system.standards.operationAttributes(payload.operation_id, adopted.version).items;
          payload.attributes = { ...existingDemand?.attributes, ...attributeCells(definitions, "demand", root) };
          const locationRefs = new Set<string>();
          const workLocations = payload.work_locations;
          requireValue(Array.isArray(workLocations) && workLocations.every(isObject), "作业位置结构无效");
          for (const row of rowsFor("work_locations", number)) {
            requireValue(typeof row.location_ref === "string" && row.location_ref.trim(), "作业位置缺少稳定的位置关联号");
            requireValue(!locationRefs.has(row.location_ref), "同一需求的位置关联号冲突");
            locationRefs.add(row.location_ref);
            const location = workLocations.find(item => identity("work_locations",item) === identity("work_locations",row));
            if (location && row.action !== "delete") {
              const prior = isObject(location.attributes) ? location.attributes : {};
              location.attributes = { ...prior, ...attributeCells(definitions, "location", row) };
            }
          }
          // Every dynamic column must belong to this adopted operation and level.
          for (const row of [root,...rowsFor("work_locations",number)])
            for (const column of Object.keys(row).filter(key=>key.startsWith("attribute_"))) {
              const scope = row === root ? "demand" : "location";
              requireValue(definitions.some(field=>field.key===attributeKey(column) && field.scope===scope), "附加属性列不属于本需求采用的正式操作定义或层级");
            }
          if (root.primary_source !== undefined || root.discovered_on !== undefined) {
            const sources = payload.sources;
            requireValue(Array.isArray(sources), "来源结构无效");
            const existingPrimary = existingDemand?.sources.find(item=>item.id===root.primary_source_id);
            requireValue(!root.primary_source_id || existingPrimary, "主要来源身份与本需求不一致",409);
            const primary = { id: existingPrimary?.id, description: root.primary_source ?? existingPrimary?.description,
              discovered_on: root.discovered_on ?? existingPrimary?.discovered_on };
            payload.sources = [...sources.filter(item=>!isObject(item)||item.id!==primary.id),primary];
          }
          const validationStarted = performance.now();
          try { normalized = demands.normalize(payload, existingDemand); }
          catch (failure) {
            if (failure instanceof BusinessError) {
              const path=Object.keys(failure.fields)[0];
              if (path) {
                let source=root, field=path;
                const position=/^work_locations\.(\d+)\.(.+)$/.exec(path);
                if (position) {
                  const item=workLocations[Number(position[1])];
                  source=rowsFor("work_locations",number).find(row=>identity("work_locations",row)===identity("work_locations",item))||root;
                  field=position[2];
                }
                const key=field.startsWith("attributes.") ? field.slice(11) : null;
                const column=key ? "attribute_"+Buffer.from(key).toString("hex") : field;
                const raw=isObject(source._raw_values)?source._raw_values[column]:source[column];
                issues.push(issue(source._sheet,source._row,key?definitions.find(item=>item.key===key)?.label||key:field,raw,failure.message));
              }
            }
            throw failure;
          }
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
          if (payload.mode === "按项目总额") payload.mode = "project_total";
          if (payload.mode === "按子费用") payload.mode = "itemized";
          if (payload.mode === "itemized" && root.amount_fen === undefined) delete payload.amount_fen;
          Object.assign(payload, finance.validateDraft(settlementProject, financeSettlementDraft(payload)));
        }
        const settlementFacts = (input: Record<string, unknown>) => {
          const { expected_version, expected_edit_version, number: _number, project_id,
            change_type, ...facts } = financeSettlementDraft(input);
          return {
            ...facts, change_type: change_type === "void" ? "void" : undefined,
            funding_version_id: facts.funding_version_id || null,
            basis: facts.basis || "", reason: facts.reason || "", settlement_on: facts.settlement_on || null,
            items: facts.items?.map(item => ({ ...item, project_scope_id: item.project_scope_id || null,
              unit_price_fen: item.unit_price_fen ?? null, work_mode: item.work_mode || null,
              quantity_scaled: item.quantity_scaled ?? 0, evidence: item.evidence || "" })),
          };
        };
        const previousSettlement = existingSettlement?.draft?.document || (existingSettlement?.version
          ? { ...existingSettlement.version, items: existingSettlement.items, resolutions: existingSettlement.resolutions }
          : undefined);
        const change = differences(
          kind === "demands" && existingDemand
            ? {...demands.normalize(existingDemand, existingDemand)}
            : previousSettlement ? settlementFacts({ ...previousSettlement }) : {},
          kind === "demands" ? normalized ? {...normalized} : payload : settlementFacts(payload),
        );
        if (
          kind === "demands" &&
          existingDemand &&
          Array.isArray(payload.sources) &&
          payload.sources.some(
            (source:unknown) => isObject(source) && (
              source.action === "delete" || !source.id ||
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
        if (issues.length === originalIssueCount) issues.push(
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
      if (source) {
        invalidNumbers.add(String(source[numberKey] ?? ""));
        if (kind === "demands") {
          problem.import_ref = String(source.import_ref || "");
          const root = parsed.rows.documents.find(row => row.import_ref === source.import_ref);
          problem.demand_no = String(root?.demand_no || "");
          problem.location_ref = String(source.location_ref || "");
        }
      }
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
    const numberKey = kind === "demands" ? "import_ref" : "number";
    if (kind === "settlements") {
      const documentsByRow = new Map(parsed.rows.documents.map(root => [root._row, root]));
      for (const root of parsed.rows.documents) root[numberKey] ||= "row-" + root._row;
      for (const [sheet, rows] of Object.entries(parsed.rows))
        if (sheet !== "documents") for (const row of rows) {
          if (row[numberKey]) continue;
          const root = row.document_row ? documentsByRow.get(Number(row.document_row))
            : parsed.rows.documents.length === 1 ? parsed.rows.documents[0] : null;
          if (root) row[numberKey] = root[numberKey];
          else parsed.issues.push(issue(row._sheet,row._row,"document_row",row.document_row,"多结算单明细须明确归属"));
        }
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
    if (kind === "demands") system.training.record(actor.id,
      prepared.issues.length ? "excel_invalid_preview" : "excel_valid_preview", token);
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
      missing_devices: prepared.issues.filter(x=>/未匹配|不存在/.test(x.reason)).length,
      ambiguous_locations: prepared.issues.filter(x=>/歧义/.test(x.reason)).length,
      format_errors: prepared.issues.filter(x=>/格式|须为|必须为/.test(x.reason)).length,
      precision_errors: prepared.issues.filter(x=>/精度|小数|整数数量/.test(x.reason)).length,
      conflicts: prepared.issues.filter((x) => x.field === "expected_version")
        .length,
    };
  }
  function commit(actor:Actor,token:string,input:ExchangeCommitInput) {
    authorize(actor, "write");
    const committed = system.idempotent(
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
              const result = exchangePersistence.withDocumentSavepoint(() => {
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
              results.push({
                ...("kind" in document ? { entity_kind: document.kind } : {}),
                ...(body.kind === "demands" ? { import_ref: document.number } : {}),
                number: resultNumber, id: result.id, action: document.action,
              });
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
    if (committed.kind === "demands" && committed.results.some(result =>
      result.action === "create" || result.action === "update"))
      system.training.record(actor.id, "excel_commit", token);
    return committed;
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
    projectReport(actor: Actor, ids: string[]) {
      const records = system.projects.selectedProjectReport(actor, ids);
      const finances = system.finance.summariesForPortfolio(system.projects.dashboardPortfolio(ids));
      return makeBusinessReport("projects", records.map(({ id, ...record }) => {
        const summary = finances.get(id);
        requireValue(summary, "项目财务概要不存在", 409);
        return { ...record, "核定实际费用（元）": summary.actual_cost_fen / 100,
          "累计生效结算（元）": summary.settlement_fen / 100,
          "结算进度": summary.settlement_progress_percent == null ? "待核定费用基数" : summary.settlement_progress_percent + "%",
          "超结算（元）": summary.excess_settlement_fen == null ? null : summary.excess_settlement_fen / 100 };
      }));
    },
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
        { lookups: lookupRows(), attributes: kind === "demands" ? system.standards.operations().flatMap(operation=>system.standards.operationAttributes(operation.id,operation.version).items) : [] },
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
          导入关联号: row.import_ref || "",
          正式编号: row.number,
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

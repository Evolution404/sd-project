import { exchangeReportScope } from "../../shared/exchange-display.js";
import type {Actor} from "../../shared/types/contracts.js";
import type { ExchangePorts } from "./ports.js";
import type {WorkbookKind,WorkbookRow,ExchangeExportOptions} from "../../shared/types/exchange.js";
import type {DemandRecord} from "../../shared/types/demands.js";
import {settlementModeLabels, type SettlementMode, type SettlementWorkflow} from "../../shared/types/finance-workflows.js";
import type {OperationAttribute} from "../../shared/types/operation-attributes.js";
import {isObject} from "../../shared/types/contracts.js";
import {authorize} from "../../platform/auth/service.js";
import {requireValue} from "../../shared/errors/business-error.js";
import {decimalText} from "../../shared/decimal.js";
import {demandDisplayStatus} from "../../shared/demand-display-status.js";
import {makeWorkbook,makeBusinessReport,MAX_DOCUMENTS,attributeColumn} from "./workbook.js";
import {createReferences} from "./references.js";

type WorksheetRows = Record<"documents"|"work_locations"|"materials"|"sources"|
  "items"|"resolutions",WorkbookRow[]>;
function emptyRows():WorksheetRows {
  return {documents:[],work_locations:[],materials:[],sources:[],items:[],
    resolutions:[]};
}
function scopeDescription(system:ExchangePorts,scopeId:string|null|undefined):string|undefined {
  if (!scopeId) return undefined;
  const demandId=system.exchangePersistence.scopeDemandId(scopeId);
  requireValue(demandId,"结算已采用需求范围不存在",404);
  return system.demands.get(demandId,true).problem_description;
}
function reportDemand(system:ExchangePorts,records:DemandRecord[], options: ExchangeExportOptions):Promise<Buffer> {
  return makeBusinessReport("demands",
    records.map(record=>({
      需求编号:record.demand_no,操作类型:record.operation_snapshot,
      作业对象:record.work_object_snapshot,问题描述:record.problem_description,
      验收标准:record.completion_standard,预计解决时间:record.expected_on||"",工作量:decimalText(record.quantity_scaled,4),
      计量单位:record.unit_snapshot,需求状态:demandDisplayStatus(record.status,Boolean(record.binding)),
      位置数量:record.work_locations.length,正式版本:record.current_version,
      来源依据:record.sources.map(source=>source.description).join("；"),
    })),
    records.flatMap(record=>record.work_locations.map(location=>({
      需求编号:record.demand_no,线路:location.location_snapshot_json.line_name,
      作业位置:location.location_snapshot_json.location_label||
        location.location_snapshot_json.physical_code||
        location.location_snapshot_json.tower_no||location.span_id,
      工作量:decimalText(location.quantity_scaled,4),计量单位:record.unit_snapshot,
      作业方式:location.work_mode==="outage"?"停电":location.work_mode==="non_outage"?"不停电":"未明确",
      附加属性: Object.entries(location.attributes).map(([key,value]) => {
        const field = system.standards.operationAttributes(record.operation_id,record.operation_version).items.find(item=>item.key===key);
        return (field?.label || key)+"="+String(value);
      }).join(" / "),
    }))),
    exchangeReportScope(options, records.length),
  );
}
function reportSettlement(system:ExchangePorts,records:SettlementWorkflow[], options: ExchangeExportOptions):Promise<Buffer> {
  const statuses = {draft:"未提交", submit:"待审核", approve:"已批准", return:"已退回", reject:"已驳回", voided:"已注销"};
  const projects = system.projects.dashboardPortfolio(
    [...new Set(records.map(record => record.project_id))], Boolean(options.listQuery?.deleted));
  const projectById = new Map(projects.map(project => [project.id, project]));
  const summaries = system.finance.summariesForPortfolio(projects);
  const {versions, resolutions} = system.finance.effectiveSettlementReport(records.map(record => record.id));
  const recordsById = new Map(records.map(record => [record.id, record]));
  const modeLabel = (mode: SettlementMode | undefined) => mode ? settlementModeLabels[mode] : "";
  return makeBusinessReport("settlements",records.map(record=>{
    const project=projectById.get(record.project_id);
    requireValue(project,"结算所属项目不存在或已删除",409);
    const adopted=versions.get(record.id);
    return {
      结算编号:record.number,子项目编号:project.code,子项目当前名称:project.name,
      最新正式版本:record.version?.version_no||0,
      结算状态:statuses[record.status],
      草稿状态:record.draft?"有草稿":"无草稿",
      "本次草稿金额（元）":record.draft?
        record.draft.document.amount_fen / 100 : null,
      "最近提交金额（元）":record.version ? record.version.amount_fen / 100 : null,
      "当前已批准金额（元）":adopted ? adopted.amount_fen / 100 : null,
      当前生效版本:adopted?.version_no ?? "",
      当前生效结算方式:modeLabel(adopted?.mode),
      当前生效结算日期:adopted?.settlement_on ?? "",
      当前生效结算依据:adopted?.basis ?? "",
      最近提交方式:modeLabel(record.version?.mode),
      最近提交日期:record.version?.settlement_on ?? "",
      最近提交依据:record.version?.basis ?? "",
      草稿结算方式:modeLabel(record.draft?.document.mode),
      草稿结算日期:record.draft?.document.settlement_on ?? "",
      草稿结算依据:record.draft?.document.basis ?? "",
    };
  }), resolutions.map(row => ({
    结算编号:recordsById.get(row.settlement_id)?.number,
    生效结算版本:versions.get(row.settlement_id)?.version_no,
    需求编号:row.demand_no,
    解决量:decimalText(row.resolved_quantity_scaled,4),
    计量单位:row.unit,
    解决依据:row.evidence,
  })), exchangeReportScope(options, records.length), projects.map(project => {
    const summary = summaries.get(project.id);
    requireValue(summary, "项目财务概要不存在", 409);
    return {
      项目编号: project.code,
      项目名称: project.name,
      "核定实际费用（元）": summary.actual_cost_fen / 100,
      "累计生效结算（元）": summary.settlement_fen / 100,
      结算进度: summary.settlement_progress_percent == null ? "待核定费用基数" : summary.settlement_progress_percent / 100,
      "待结算（元）": summary.unsettled_cost_fen == null ? null : summary.unsettled_cost_fen / 100,
      "超结算（元）": summary.excess_settlement_fen == null ? null : summary.excess_settlement_fen / 100,
    };
  }));
}
function exportDemands(system:ExchangePorts,records:DemandRecord[],lookups:()=>Record<string,unknown>[]):Promise<Buffer> {
  const rows=emptyRows();
  const schemas=new Map<string,OperationAttribute>();
  const cells=(values: Record<string,unknown>)=>Object.fromEntries(Object.entries(values).map(([key,value])=>[attributeColumn(key),value]));
  for(const [index,record] of records.entries()){
    const importRef="XQ"+String(index+1).padStart(3,"0");
    const adopted=system.standards.operationAttributes(record.operation_id,record.operation_version).items;
    for(const field of adopted) schemas.set(field.scope+"/"+field.key,field);
    rows.documents.push({ ...record,import_ref:importRef,expected_version:record.current_version,
      operation_name:record.operation_snapshot,...cells(record.attributes),
      primary_source_id:record.sources[0]?.id,primary_source:record.sources[0]?.description,discovered_on:record.sources[0]?.discovered_on });
    rows.work_locations.push(...record.work_locations.map((location,index)=>({
      ...location,import_ref:importRef,location_ref:"WZ"+String(index+1).padStart(3,"0"),...cells(location.attributes),
      specification:location.location_snapshot_json.specification||"",action:"upsert" as const,
      line_name:location.location_snapshot_json.line_name,tower_no:location.location_snapshot_json.tower_no||undefined,
      asset_no:location.location_snapshot_json.asset_no||undefined,
    })));
    rows.materials.push(...record.materials.map(material=>({ ...material,import_ref:importRef,
      material_name:material.material_name,material_model:material.model,material_specification:material.specification,
      unit_name:material.unit_snapshot,action:"upsert" as const })));
    rows.sources.push(...record.sources.slice(1).map(source=>({...source,import_ref:importRef,action:"upsert" as const})));
  }
  return makeWorkbook("demands",rows,{lookups:lookups(),attributes:[...schemas.values()]});
}
function exportSettlements(system:ExchangePorts,records:SettlementWorkflow[],lookups:()=>Record<string,unknown>[]):Promise<Buffer> {
  const rows=emptyRows();
  const refs=createReferences(system);
  for(const record of records){
    const project=system.projects.get(record.project_id);
    const draft=record.draft?.document;
    const doc=draft||record.version||{};
    rows.documents.push({
      ...doc,mode: "mode" in doc ? doc.mode === "project_total" ? "按项目总额" : "按子费用" : undefined,
      amount_fen: (draft || record.version)?.mode === "project_total" ? (draft || record.version)?.amount_fen : undefined,
      id:record.id,number:record.number,
      project_name:project.name,project_id:record.project_id,
      expected_version:record.version?.version_no||0,
      expected_edit_version:record.draft?.edit_version||0,
    });
    const itemRows:unknown[]=draft?.items||record.items;
    for(const candidate of itemRows){
      requireValue(isObject(candidate),"导出结算明细格式无效");
      const nodeId=candidate.cost_node_id;
      const scopeId=candidate.project_scope_id;
      rows.items.push({
        ...candidate,number:record.number,
        cost_node_path:typeof nodeId==="string"?refs.costPath(record.project_id,nodeId):undefined,
        demand_description:typeof scopeId==="string"?scopeDescription(system,scopeId):undefined,
        action:"upsert",
      });
    }
    const resolutionRows:unknown[]=draft?.resolutions||record.resolutions;
    for(const candidate of resolutionRows){
      requireValue(isObject(candidate),"导出解决量明细格式无效");
      const scopeId=candidate.project_scope_id;
      rows.resolutions.push({
        ...candidate,number:record.number,
        demand_description:typeof scopeId==="string"?scopeDescription(system,scopeId):undefined,
        action:"upsert",
      });
    }
  }
  return makeWorkbook("settlements",rows,{lookups:lookups()});
}
export function createExchangeExporter(system:ExchangePorts,lookups:()=>Record<string,unknown>[]) {
  return async (actor:Actor,kind:WorkbookKind,options:ExchangeExportOptions={}):Promise<Buffer>=>{
    authorize(actor,"read");
    if(kind==="assets")throw new Error("设备导出由设备专用服务处理");
    const ids = [...new Set(options.ids || [])];
    requireValue(ids.length <= MAX_DOCUMENTS, "导出超过5000张，请收窄筛选条件");
    const query = {
      q: "", filters: {}, sort: "created_at", direction: "desc" as const, deleted: false,
      ...options.listQuery, page: 1, page_size: MAX_DOCUMENTS + 1,
    };
    if (kind === "demands") {
      const listed = ids.length ? ids : system.demands.search(query).items.map(row => row.id);
      requireValue(listed.length <= MAX_DOCUMENTS, "导出超过5000张，请收窄筛选条件");
      const records = listed.map(id => system.demands.get(id, ids.length > 0 || query.deleted));
      requireValue(!options.projectId || records.every(row => row.binding?.project_id === options.projectId),
        "导出范围包含不属于当前项目的需求", 409);
      return options.report ? reportDemand(system, records, options) : exportDemands(system, records, lookups);
    }
    const records = ids.length
      ? system.finance.selectedSettlements(ids, query)
      : system.finance.searchSettlements(options.projectId, query).items;
    requireValue(!ids.length || records.length === new Set(ids).size, "所选结算已变化，请刷新后重选", 409);
    requireValue(records.length <= MAX_DOCUMENTS, "导出超过5000张，请收窄筛选条件");
    requireValue(!options.projectId || records.every(row => row.project_id === options.projectId),
      "导出范围包含不属于当前项目的结算", 409);
    return options.report ? reportSettlement(system, records, options) : exportSettlements(system, records, lookups);
  };
}

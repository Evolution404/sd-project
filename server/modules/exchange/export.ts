import type {Actor} from "../../shared/types/contracts.js";
import type {System} from "../../bootstrap.js";
import type {WorkbookKind,WorkbookRow,ExchangeExportOptions} from "../../shared/types/exchange.js";
import type {DemandRecord} from "../../shared/types/demands.js";
import type {SettlementWorkflow} from "../../shared/types/finance-workflows.js";
import type {OperationAttribute} from "../../shared/types/operation-attributes.js";
import {isObject} from "../../shared/types/contracts.js";
import {authorize} from "../../platform/auth/service.js";
import {requireValue} from "../../shared/errors/business-error.js";
import {decimalText} from "../../shared/decimal.js";
import {makeWorkbook,makeBusinessReport,MAX_DOCUMENTS,attributeColumn} from "./workbook.js";
import {createReferences} from "./references.js";

type WorksheetRows = Record<"documents"|"work_locations"|"materials"|"sources"|
  "items"|"resolutions",WorkbookRow[]>;
function emptyRows():WorksheetRows {
  return {documents:[],work_locations:[],materials:[],sources:[],items:[],
    resolutions:[]};
}
function sumScaled(rows:readonly unknown[],field:string):bigint {
  return rows.reduce<bigint>((sum,row)=>{
    requireValue(isObject(row),"正式结算费用明细结构无效");
    const value=row[field]??0;
    requireValue(typeof value==="number"&&Number.isSafeInteger(value),
      "结算正式金额或工作量必须是安全整数");
    return sum+BigInt(value);
  },0n);
}
function usable<T extends {id:string}>(rows:T[],options:ExchangeExportOptions,projectId:(row:T)=>string|null):T[] {
  return rows.filter(row=>
    (!options.projectId||projectId(row)===options.projectId)&&
    (!options.ids?.length||options.ids.includes(row.id))&&
    (!options.query||JSON.stringify(row).includes(options.query))
  );
}
function scopeDescription(system:System,scopeId:string|null|undefined):string|undefined {
  if (!scopeId) return undefined;
  const demandId=system.exchangePersistence.scopeDemandId(scopeId);
  requireValue(demandId,"结算已采用需求范围不存在",404);
  return system.demands.get(demandId,true).problem_description;
}
function effectiveVersion(system:System,key:string):{items:unknown[];resolutions:unknown[]} {
  return system.finance.effectiveSettlementExport(key);
}
function reportDemand(system:System,records:DemandRecord[]):Promise<Buffer> {
  const statuses:Record<string,string>={pending:"待确认",active:"有效",returned:"退回",cancelled:"已取消"};
  return makeBusinessReport("demands",
    records.map(record=>({
      需求编号:record.demand_no,操作类型:record.operation_snapshot,
      作业对象:record.work_object_snapshot,问题描述:record.problem_description,
      验收标准:record.completion_standard,工作量:decimalText(record.quantity_scaled,4),
      计量单位:record.unit_snapshot,需求状态:statuses[record.status]||record.status,
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
  );
}
function reportSettlement(system:System,records:SettlementWorkflow[]):Promise<Buffer> {
  const statuses:Record<string,string>={submit:"待审核",approve:"已批准",return:"已退回",reject:"已驳回"};
  return makeBusinessReport("settlements",records.map(record=>{
    const project=system.projects.get(record.project_id);
    const adopted=effectiveVersion(system,record.id);
    return {
      结算编号:record.number,子项目编号:project.code,子项目当前名称:project.name,
      最新正式版本:record.version?.version_no||0,
      最新审核状态:statuses[record.review?.action||""]||"未提交",
      草稿状态:record.draft?"有草稿":"无草稿",
      "本次草稿金额（元）":record.draft?
        decimalText(sumScaled(record.draft.document.items,"amount_fen"),2):"",
      "当前已批准金额（元）":decimalText(sumScaled(adopted.items,"amount_fen"),2),
      当前新增解决量:decimalText(sumScaled(adopted.resolutions,"resolved_quantity_scaled"),4),
      结算日期:record.version?.settlement_on||record.draft?.document.settlement_on||"",
      结算依据:record.version?.basis||record.draft?.document.basis||"",
    };
  }));
}
function exportDemands(system:System,records:DemandRecord[],lookups:()=>Record<string,unknown>[]):Promise<Buffer> {
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
function exportSettlements(system:System,records:SettlementWorkflow[],lookups:()=>Record<string,unknown>[]):Promise<Buffer> {
  const rows=emptyRows();
  const refs=createReferences(system);
  for(const record of records){
    const project=system.projects.get(record.project_id);
    const draft=record.draft?.document;
    const doc=draft||record.version||{};
    rows.documents.push({
      ...doc,id:record.id,number:record.number,
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
export function createExchangeExporter(system:System,lookups:()=>Record<string,unknown>[]) {
  return async (actor:Actor,kind:WorkbookKind,options:ExchangeExportOptions={}):Promise<Buffer>=>{
    authorize(actor,"read");
    if(kind==="assets")throw new Error("设备导出由设备专用服务处理");
    if(kind==="demands"){
      const items=usable(system.demands.list(),options,row=>row.binding?.project_id||null);
      requireValue(items.length<=MAX_DOCUMENTS,"导出超过5000张，请收窄筛选条件");
      const records=items.map(item=>system.demands.get(item.id));
      return options.report?reportDemand(system,records):exportDemands(system,records,lookups);
    }
    const records=usable(system.finance.allSettlements(),options,row=>row.project_id);
    requireValue(records.length<=MAX_DOCUMENTS,"导出超过5000张，请收窄筛选条件");
    return options.report?reportSettlement(system,records):exportSettlements(system,records,lookups);
  };
}

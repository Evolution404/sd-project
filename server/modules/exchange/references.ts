import { requireValue } from "../../shared/errors/business-error.js";
import type { CatalogService } from "../catalog/service.js";
import type { CatalogKind } from "../../shared/types/catalog.js";
import type { ExchangeReferenceRepository, ExchangeProjectCandidate,
  ExchangeScopeCandidate, ExchangeCostPath } from "../../database/repositories/exchange.js";

/** Read DTOs for business-name resolution; there is no universal mutable catalog model. */
interface BusinessReference {
  id: string;
  name?: string;
  title?: string;
  code?: string;
  status?: string;
  line_id?: string;
  tower_no?: string;
  asset_no?: string;
  voltage_level_id?: string;
  physical_tower_id?: string;
  start_tower_id?: string;
  end_tower_id?: string;
  [field: string]: unknown;
}
interface WorkbookLocation {
  location_kind: "physical_tower" | "logical_tower" | "span";
  line_name?: string | null;
  voltage_name?: string | null;
  tower_no?: string | null;
  asset_no?: string | null;
  end_tower_no?: string | null;
  logical_tower_id?: string | null;
  physical_tower_id?: string | null;
  span_id?: string | null;
  context_line_id?: string | null;
  [field: string]: unknown;
}
type ReferencesSystem = {
  catalog: CatalogService;
  exchangeReferences: ExchangeReferenceRepository;
  projects: { get: (id: string) => { id: string; name: string } };
};
export function createReferences({ catalog, exchangeReferences:repo, projects }: ReferencesSystem) {
  const lists = new Map<CatalogKind, BusinessReference[]>();
  const indexes = new Map<string, Map<unknown, BusinessReference[]>>();
  const projectCandidates = new Map<string, ExchangeProjectCandidate[]>();
  const projectScopes = new Map<string, ExchangeScopeCandidate[]>();
  const projectCostPaths = new Map<string, Map<string, ExchangeCostPath[]>>();
  const projectCostIds = new Map<string, Map<string, string>>();

  function list(kind: CatalogKind): BusinessReference[] {
    let rows = lists.get(kind);
    if (!rows) {
      rows = (catalog.list(kind) as unknown as BusinessReference[])
        .filter(row => row.status !== "inactive" && row.status !== "retired");
      lists.set(kind, rows);
    }
    return rows;
  }
  function indexed(kind: CatalogKind, key: string, value: unknown): BusinessReference[] {
    const indexKey = kind + "/" + key;
    let index = indexes.get(indexKey);
    if (!index) {
      index = new Map<unknown, BusinessReference[]>();
      for (const row of list(kind)) {
        const item = key === "line_tower" ? row.line_id + "\0" + row.tower_no : row[key];
        const entries = index.get(item) ?? [];
        entries.push(row);
        index.set(item,entries);
      }
      indexes.set(indexKey,index);
    }
    return index.get(value) ?? [];
  }
  function unique<T extends {id:string}>(rows: readonly T[], description: string, selectedId?:string|null): T {
    const selected = selectedId ? rows.find(row=>row.id===selectedId):undefined;
    requireValue(selected || rows.length===1,
      rows.length ? `${description}存在同名或同号歧义，请在系统核对真实对象后使用维护导出` :
      `${description}未匹配已有业务对象`);
    return selected ?? rows[0]!;
  }
  function named(kind:CatalogKind,name?:string|null,selectedId?:string|null,
    filters:Record<string,unknown>={}):BusinessReference {
    if (!name && selectedId)
      return catalog.get(kind,selectedId,true) as unknown as BusinessReference;
    return unique(
      indexed(kind,kind==="prices"?"title":"name",name).filter(row=>
        Object.entries(filters).every(([key,value])=>!value||row[key]===value)),
      catalog.definitions[kind].title+"“"+(name||"未填写")+"”",selectedId);
  }
  function line(name?:string|null,voltageName?:string|null,selectedId?:string|null):BusinessReference {
    const voltage=voltageName?named("voltages",voltageName).id:null;
    return unique(indexed("lines","name",name).filter(row=>
      !voltage||row.voltage_level_id===voltage),
      "线路“"+(name||"未填写")+"”",selectedId);
  }
  function location(row:WorkbookLocation):WorkbookLocation {
    const result={...row};
    const key=row.location_kind==="span"?"span_id":
      row.location_kind==="physical_tower"?"physical_tower_id":"logical_tower_id";
    if(!row.line_name&&!row.tower_no&&!row.asset_no)return result;
    const selectedLine=row.line_name?line(row.line_name,row.voltage_name):null;
    if(row.location_kind==="physical_tower"&&row.asset_no&&!row.tower_no) {
      result[key]=unique(indexed("physical","asset_no",row.asset_no),
        "物理杆塔资产号",row[key]).id;
      return result;
    }
    requireValue(selectedLine&&row.tower_no,
      "请填写线路名称及杆塔号，独立实物可使用真实资产铭牌号");
    const start=unique(indexed("towers","line_tower",
      selectedLine.id+"\0"+String(row.tower_no)),
      String(selectedLine.name)+"的杆塔“"+row.tower_no+"”",row.logical_tower_id);
    if(row.location_kind==="span") {
      requireValue(row.end_tower_no,"档距须填写起点杆塔号及终点杆塔号");
      const end=unique(list("towers").filter(tower=>
        tower.line_id===selectedLine.id&&tower.tower_no===String(row.end_tower_no)),
        "终点杆塔");
      result.span_id=unique(list("spans").filter(span=>
        span.line_id===selectedLine.id&&
        ((span.start_tower_id===start.id&&span.end_tower_id===end.id)||
        (span.start_tower_id===end.id&&span.end_tower_id===start.id))),
        "两杆塔间档距",row.span_id).id;
    } else if(row.location_kind==="physical_tower"){
      requireValue(start.physical_tower_id,"所选杆塔尚无真实实物关联");
      result.physical_tower_id=start.physical_tower_id;
      result.context_line_id=selectedLine.id;
    } else result.logical_tower_id=start.id;
    return result;
  }
  function project(name?:string|null,selectedId?:string|null):ExchangeProjectCandidate {
    if(!name&&selectedId)return projects.get(selectedId);
    const key=name??"";
    let rows=projectCandidates.get(key);
    if(!rows){rows=repo.exchangeProjectCandidates(key);projectCandidates.set(key,rows);}
    return unique(rows,"子项目“"+(name||"未填写")+"”",selectedId);
  }
  function scope(projectId:string,problem?:string|null,selectedId?:string|null):ExchangeScopeCandidate {
    let rows=projectScopes.get(projectId);
    if(!rows){rows=repo.exchangeScopeCandidates(projectId);projectScopes.set(projectId,rows);}
    return unique(rows.filter(row=>!problem||row.problem_description===problem),
      "项目内需求“"+(problem||"未填写")+"”",selectedId);
  }
  function ensureCostPaths(projectId:string):void {
    if(projectCostPaths.has(projectId))return;
    const byPath=new Map<string,ExchangeCostPath[]>(),
      byId=new Map<string,string>();
    for(const row of repo.exchangeCostPaths(projectId)) {
      const entries=byPath.get(row.full_path)??[];
      entries.push(row);byPath.set(row.full_path,entries);byId.set(row.id,row.full_path);
    }
    projectCostPaths.set(projectId,byPath);
    projectCostIds.set(projectId,byId);
  }
  function costNode(projectId:string,path:string):ExchangeCostPath {
    ensureCostPaths(projectId);
    const matched=projectCostPaths.get(projectId)?.get(path)??[];
    requireValue(matched.length===1,"费用科目完整路径未精确匹配唯一科目");
    return matched[0]!;
  }
  function costPath(projectId:string,nodeId:string):string {
    ensureCostPaths(projectId);
    return projectCostIds.get(projectId)?.get(nodeId)??"";
  }
  return {named,line,location,project,scope,costNode,costPath,unique};
}
export type ExchangeReferences=ReturnType<typeof createReferences>;

import { isObject } from "../../shared/types/contracts.js";
import { requireValue } from "../../shared/errors/business-error.js";
import { MAX_PROJECT_PROFILE_BATCH } from "../../shared/types/projects.js";
import type {
  ProjectManagementInput, ProjectProfileBatchRow, ProjectFromDemandInput, ProjectVersionAction,
  ProjectLinkInput, ProjectLinkBatchInput, ProjectReleaseInput,
  ProjectApprovalInput, ProjectApprovalScopeInput,
  ProjectApprovedMaterialInput, ProjectApprovedLocationInput,
} from "../../shared/types/projects.js";

/** HTTP DTO parsing checks shape and type; domain services own the business rules. */
function stringValue(value: unknown, label: string): string {
  requireValue(typeof value === "string" && value.trim().length > 0, label + "必须填写");
  return value;
}
function numberValue(value: unknown, label: string): number {
  requireValue(typeof value === "number" && Number.isSafeInteger(value), label + "必须是整数");
  return value;
}
function optionalText(value: unknown, label: string): string | null | undefined {
  requireValue(value === undefined || value === null || typeof value === "string",
    label + "必须为文本");
  return value;
}
function optionalNumber(value: unknown, label: string): number | null | undefined {
  requireValue(value === undefined || value === null ||
    (typeof value === "number" && Number.isSafeInteger(value)), label + "必须为整数");
  return value;
}

export function parseProjectManagement(input: Record<string, unknown>): ProjectManagementInput {
  for (const key of ["name","framework_id","agreement_id","owner_id","manager_id",
    "category_id","managing_unit_id","planned_start_on","planned_end_on",
    "preliminary_estimate_basis","reason"] as const)
    optionalText(input[key], key);
  optionalNumber(input.expected_version,"项目档案版本");
  optionalNumber(input.expected_funding_version,"执行协议关联版本");
  optionalNumber(input.preliminary_estimate_fen,"项目预估金额");
  return input as ProjectManagementInput;
}
const profileFields = new Set(["name", "framework_id", "agreement_id", "owner_id", "manager_id", "category_id",
  "managing_unit_id", "planned_start_on", "planned_end_on", "preliminary_estimate_basis", "preliminary_estimate_fen",
  "reason", "expected_version", "expected_funding_version"]);
export function parseProjectProfileBatch(input: Record<string, unknown>): ProjectProfileBatchRow[] {
  requireValue(Array.isArray(input.rows) && input.rows.length >= 1 && input.rows.length <= MAX_PROJECT_PROFILE_BATCH,
    "请提供1至" + MAX_PROJECT_PROFILE_BATCH + "条项目档案");
  const ids = new Set<string>(), refs = new Set<string>();
  return input.rows.map((row: unknown) => {
    requireValue(isObject(row) && Object.keys(row).every(key => ["id", "ref", "values"].includes(key)) &&
      isObject(row.values) && Object.keys(row.values).every(key => profileFields.has(key)),
    "批量档案包含未授权的字段");
    const ref = stringValue(row.ref, "档案行标识");
    requireValue(ref.length <= 128 && !refs.has(ref), "档案行标识重复或无效");
    refs.add(ref);
    const values = parseProjectManagement(row.values);
    if (row.id === undefined) {
      requireValue(values.expected_version === undefined && values.expected_funding_version === undefined, "新增档案不可指定已有版本");
      return { ref, values };
    }
    const id = stringValue(row.id, "子项目");
    requireValue(id.length <= 128 && !ids.has(id) && Number.isSafeInteger(values.expected_version) &&
      Number(values.expected_version) > 0 && Number.isSafeInteger(values.expected_funding_version) &&
      Number(values.expected_funding_version) >= 0, "档案修订须使用不同项目及有效档案、资金版本");
    ids.add(id);
    return { ref, id, values };
  });
}

export function parseProjectFromDemand(input:Record<string,unknown>):ProjectFromDemandInput {
  const profile=parseProjectManagement(input);
  return {
    ...profile,
    demand_id:stringValue(input.demand_id,"专业需求"),
    expected_demand_version:numberValue(input.expected_demand_version,"专业需求版本"),
  };
}
export function parseProjectVersion(input:Record<string,unknown>):ProjectVersionAction {
  return {
    expected_version:numberValue(input.expected_version,"项目版本"),
    reason:optionalText(input.reason,"说明") ?? undefined,
  };
}
export function parseProjectLink(input:Record<string,unknown>):ProjectLinkInput {
  requireValue(!Object.hasOwn(input,"quantity_scaled"),
    "项目只允许整体承接需求，不接受部分承接数量",422);
  return {
    demand_id:stringValue(input.demand_id,"专业需求"),
    expected_version:numberValue(input.expected_version,"需求版本"),
    reason:optionalText(input.reason,"说明") ?? undefined,
  };
}
export function parseProjectLinkBatch(input:Record<string,unknown>):ProjectLinkBatchInput {
  requireValue(Array.isArray(input.links) && input.links.length > 0 &&
    input.links.length <= 100, "请勾选1～100条完整需求后统一关联",422);
  const links=input.links.map((value:unknown,index:number)=>{
    requireValue(isObject(value),"第"+(index+1)+"条需求关联信息无效",422);
    return parseProjectLink(value);
  });
  requireValue(new Set(links.map(row=>row.demand_id)).size===links.length,
    "关联清单有重复需求，请取消重复选择",422);
  return {links};
}
export function parseProjectRelease(input:Record<string,unknown>):ProjectReleaseInput {
  return {
    expected_event_seq:numberValue(input.expected_event_seq,"关联版本"),
    reason:optionalText(input.reason,"说明") ?? undefined,
  };
}
function parseLocation(input:unknown, index:number):ProjectApprovedLocationInput {
  requireValue(isObject(input),"批准位置第"+index+"项必须为对象");
  return {
    location_item_no:numberValue(input.location_item_no,"批准位置序号"),
    approved_quantity_scaled:numberValue(input.approved_quantity_scaled,"批准位置数量"),
  };
}
function parseMaterial(input:unknown,index:number):ProjectApprovedMaterialInput {
  requireValue(isObject(input),"批准物资第"+index+"项必须为对象");
  return {
    material_id:stringValue(input.material_id,"物资"),
    quantity_scaled:numberValue(input.quantity_scaled,"批准物资数量"),
  };
}
function parseScope(input:unknown,index:number):ProjectApprovalScopeInput {
  requireValue(isObject(input),"批准需求范围第"+index+"项必须为对象");
  requireValue(Array.isArray(input.locations),"批准作业位置必须为列表");
  requireValue(input.materials === undefined || Array.isArray(input.materials),
    "批准物资必须为列表");
  requireValue(Boolean(input.project_scope_id) !== Boolean(input.demand_id), "请选择已有项目范围或新增候选需求");
  const materials=input.materials?.map((mat,i)=>parseMaterial(mat,i));
  const ids=new Set(materials?.map(mat=>mat.material_id)??[]);
  requireValue(ids.size===(materials?.length??0),"批准物资不可重复");
  let expected_material_versions:Record<string,string>|undefined;
  if(input.expected_material_versions!==undefined){
    requireValue(isObject(input.expected_material_versions),"批准物资版本必须为对象");
    const versions=input.expected_material_versions;
    requireValue(Object.keys(versions).length===ids.size&&Object.keys(versions).every(id=>ids.has(id)),"批准物资版本必须与所选物资一致");
    expected_material_versions=Object.fromEntries([...ids].map(id=>[id,stringValue(versions[id],"批准物资版本")]));
  }
  return {
    project_scope_id:input.project_scope_id === undefined ? undefined : stringValue(input.project_scope_id,"批准范围"),
    demand_id:input.demand_id === undefined ? undefined : stringValue(input.demand_id,"候选需求"),
    demand_version:numberValue(input.demand_version,"需求正式版本"),
    approved_amount_fen:optionalNumber(input.approved_amount_fen,"批准金额"),
    locations:input.locations.map((loc,i)=>parseLocation(loc,i)),
    materials,
    expected_material_versions,
  };
}
export function parseProjectApproval(input:Record<string,unknown>):ProjectApprovalInput {
  requireValue(Array.isArray(input.scopes),"请提供批准需求范围");
  requireValue(input.confirm_changes === undefined || typeof input.confirm_changes === "boolean",
    "批准变更确认必须为是或否");
  return {
    expected_version:numberValue(input.expected_version,"项目版本"),
    expected_approval_version_id:optionalText(input.expected_approval_version_id,"批准基线"),
    approved_budget_fen:numberValue(input.approved_budget_fen,"批准预算"),
    confirm_changes:input.confirm_changes,
    scopes:input.scopes.map((scope,i)=>parseScope(scope,i)),
    basis:optionalText(input.basis,"批准依据") ?? undefined,
    reason:optionalText(input.reason,"变更理由") ?? undefined,
  };
}

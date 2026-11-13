import { isObject } from "../../shared/types/contracts.js";
import { requireValue } from "../../shared/errors/business-error.js";
import type {
  ProjectManagementInput, ProjectFromDemandInput, ProjectVersionAction,
  ProjectLinkInput, ProjectReleaseInput, ProjectFundingInput,
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
export function parseProjectRelease(input:Record<string,unknown>):ProjectReleaseInput {
  return {
    expected_event_seq:numberValue(input.expected_event_seq,"关联版本"),
    reason:optionalText(input.reason,"说明") ?? undefined,
  };
}
export function parseProjectFunding(input:Record<string,unknown>):ProjectFundingInput {
  return {
    ...parseProjectVersion(input),
    agreement_id:optionalText(input.agreement_id,"执行协议"),
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
  return {
    project_scope_id:stringValue(input.project_scope_id,"批准范围"),
    demand_version:numberValue(input.demand_version,"需求正式版本"),
    approved_amount_fen:optionalNumber(input.approved_amount_fen,"批准金额"),
    locations:input.locations.map((loc,i)=>parseLocation(loc,i)),
    materials:input.materials?.map((mat,i)=>parseMaterial(mat,i)),
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
    change_code:optionalText(input.change_code,"变更编号") ?? undefined,
    basis:optionalText(input.basis,"批准依据") ?? undefined,
    reason:optionalText(input.reason,"变更理由") ?? undefined,
  };
}

import { applyNativeListQuery, type NativeListOptions } from "@/utils/business/native-list-query";
import type { PriceRulePreview, PriceRuleRecord, PriceRuleVersion, PricingMode } from "../../../../server/shared/types/price-rules";
import type { AttributeCondition } from "../../../../server/shared/types/operation-attributes";
import { componentPayload, formulaPayload, priceQuantity, readComponents, readFormula,
  type PriceComponent, type PriceFormula } from "./price-formula";
import { yuanToFen } from "./funding";
import { randomRequestId } from "@/utils/business/request-id";
import type { QuoteResult } from "../../../../server/shared/types/pricing";
export type { QuoteResult } from "../../../../server/shared/types/pricing";

export interface QuoteInput {
  expected_version: number;
  approval_scope_version_id: string;
  pricing_date: string;
  selections: Record<string, string>;
  selection_basis: Record<string, string>;
  bases: Record<string, Record<string, string | number>>;
  confirm?: boolean;
  preview_hash?: string;
}
export type { PricingMode };
export type PriceRule = PriceRuleRecord;
export interface PriceForm {
  title: string;
  status: "active" | "inactive";
  operation_id: string;
  pricing_scope: PriceRuleRecord["pricing_scope"];
  work_mode: PriceRuleRecord["work_mode"];
  voltage_level_id: string | null;
  tower_material: string | null;
  specification: string;
  price_source: string;
  price_date: string;
  effective_on: string;
  basis: string;
  reason: string;
  adoptLatest: boolean;
  formula: PriceFormula;
  components: PriceComponent[];
  conditions: Record<string, AttributeCondition>;
}
interface Page<T>{items:T[];total:number}
async function req<T>(uri:string,method="GET",data?:unknown):Promise<T>{
  const result=await fetch(uri,{method,credentials:"same-origin",
    ...(method==="GET"?{}:{headers:{"Content-Type":"application/json",
      "Idempotency-Key":randomRequestId()},body:JSON.stringify(data??{})})});
  const json:unknown=await result.json().catch(()=>({}));
  if(!result.ok)throw Error(typeof json==="object"&&json!==null&&"message" in json
    ?String(json.message):"HTTP "+result.status);
  return json as T;
}
export function quoteProjectScope(demandId:string,input:QuoteInput):Promise<QuoteResult>{
  return req("/api/demands/"+encodeURIComponent(demandId)+"/quote","POST",input);
}
const path="/api/catalog/prices";
export function listPrices(q:{page?:number;size?:number;keyword?:string} & NativeListOptions={}):Promise<Page<PriceRule>>{
  const query=new URLSearchParams({page:String(q.page||1),page_size:String(q.size||20),
    q:q.keyword||"",sort:"created_at",direction:"desc"});
  applyNativeListQuery(query, q);
  return req(path+"?"+query);
}
export const getPrice=(id:string,includeDeleted=false):Promise<PriceRule>=>req(path+"/"+encodeURIComponent(id)+(includeDeleted?"?deleted=true":""));
export const priceHistory = (id: string): Promise<{ item: PriceRule; versions: PriceRuleVersion[] }> =>
  req(path + "/" + encodeURIComponent(id) + "?history=true");

function priceInput(data: PriceForm, previous?: PriceRule) {
  if (!data.operation_id) throw Error("请选择有效操作类型");
  const result = formulaPayload(data.formula);
  return {
    title: data.title.trim(), operation_id: data.operation_id, status: data.status,
    ...(previous ? { expected_version: previous.version_no } : {}),
    adopt_latest_operation_version: data.adoptLatest,
    pricing_mode: data.formula.mode, pricing_scope: data.pricing_scope, work_mode: data.work_mode,
    voltage_level_id: data.voltage_level_id || null, tower_material: data.tower_material || null,
    specification: data.specification || "",
    base_fee_fen: result.base, unit_price_fen: result.unit, calculation_params_json: result.parameters,
    quantity_brackets_json: result.brackets,
    fee_components_json: data.formula.mode === "composite" ? data.components.map(componentPayload) : [],
    additional_conditions_json: data.conditions,
    price_source: data.price_source, price_date: data.price_date, effective_on: data.effective_on,
    basis: data.basis, reason: data.reason,
  };
}
export function savePrice(data: PriceForm, previous?: PriceRule) {
  return req<PriceRule>(path + (previous ? "/" + encodeURIComponent(previous.id) : ""), "POST", priceInput(data, previous));
}
export function previewPrice(data: PriceForm, quantity: string, bases: Record<string, string>, previous?: PriceRule) {
  return req<PriceRulePreview>(path + "/preview", "POST", {
    ...priceInput(data, previous), existing_id: previous?.id,
    sample_quantity_scaled: priceQuantity(quantity, "试算数量"),
    sample_bases: Object.fromEntries(Object.entries(bases).filter(([, value]) => value.trim())
      .map(([key, value]) => [key, yuanToFen(value)])),
  });
}
export function loadPriceForm(row?: PriceRule): PriceForm {
  return {
    title: row?.title ?? "", status: row?.status ?? "active", operation_id: row?.operation_id ?? "",
    pricing_scope: row?.pricing_scope ?? "work_location", work_mode: row?.work_mode ?? "both",
    voltage_level_id: row?.voltage_level_id ?? null, tower_material: row?.tower_material ?? null,
    specification: row?.specification ?? "", price_source: row?.price_source ?? "",
    price_date: row?.price_date ?? "", effective_on: row?.effective_on ?? "", basis: row?.basis ?? "",
    reason: "", adoptLatest: false, formula: readFormula(row), components: row ? readComponents(row) : [],
    conditions: JSON.parse(row?.additional_conditions_json || "{}"),
  };
}

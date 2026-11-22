import { parseListQuery } from "../../platform/http/list-query.js";
import type { RouteContext } from "../../platform/http/context.js";
import { requireValue } from '../../shared/errors/business-error.js';
import { isObject } from "../../shared/types/contracts.js";
import type {WorkbookKind,ExchangeMode,ExchangeCommitInput} from "../../shared/types/exchange.js";
function kindValue(kind:string):WorkbookKind {
  requireValue(kind==="assets"||kind==="demands"||kind==="settlements","不支持的Excel业务类型",404);
  return kind;
}
function exchangeMode(value:string|null):ExchangeMode {
  const mode=value||"mixed";
  requireValue(mode==="create"||mode==="update"||mode==="mixed","不支持的导入模式");
  return mode;
}
function commitRequest(input:unknown):ExchangeCommitInput {
  requireValue(isObject(input),"提交批次请求必须是JSON对象");
  requireValue(typeof input.request_key==="string"&&input.request_key.length>0,"必须提供幂等请求键");
  requireValue(input.atomic===undefined||typeof input.atomic==="boolean","批次原子选项必须是布尔值");
  return {request_key:input.request_key,atomic:input.atomic===true};
}
function exportSelection(read: boolean, input: unknown, search: URLSearchParams): string[] {
  if (read) return search.getAll("id");
  requireValue(isObject(input) && Array.isArray(input.ids) && input.ids.length > 0 &&
    input.ids.length <= 5000 && input.ids.every(id => typeof id === "string" && id.length > 0 && id.length <= 128),
    "请选择 1 至 5000 条有效记录后下载");
  return input.ids;
}
export async function handleExchange(context: RouteContext): Promise<{
    result: unknown;
} | undefined> {
    const { resource, actor, read, key, sub, input, url, res, workbook, exchange } = context;
    let result: unknown;
    switch (resource) {
        case "exchange":
            if (sub === "template") {
                const assetKind = url.searchParams.get("asset_kind");
                requireValue(assetKind === null || assetKind === "lines" || assetKind === "physical" || assetKind === "towers" || assetKind === "spans", "设备分类无效");
                await workbook(res, exchange.template(actor, kindValue(key), url.searchParams.get("project_id"), assetKind || undefined), ({ assets: "设备台账", demands: "需求", settlements: "结算" } as Record<string, string>)[key] + "模板");
                return;
            }
            if (sub === "export") {
                requireValue(read || context.method === "POST", "请求方法无效", 405);
                const ids = exportSelection(read, input, url.searchParams);
                if (key === "projects") {
                    await workbook(res, exchange.projectReport(actor, ids, parseListQuery(url.searchParams)), "子项目清单");
                    return;
                }
                const assetKind = url.searchParams.get("asset_kind");
                requireValue(assetKind === null || assetKind === "lines" || assetKind === "physical" || assetKind === "towers" || assetKind === "spans", "设备导出分类无效");
                await workbook(res, exchange.exportData(actor, kindValue(key), {
                    ids,
                    projectId: url.searchParams.get("project_id") || undefined,
                    listQuery: parseListQuery(url.searchParams),
                    assetKind: assetKind || undefined,
                    report: url.searchParams.get("report") === "true",
                }), ({ assets: "设备台账", demands: "需求", settlements: "结算" } as Record<string, string>)[key] + (url.searchParams.get("report") === "true" ? "报表" : "数据维护"));
                return;
            }
            if (sub === "preview") {
                requireValue(Buffer.isBuffer(input), "请上传xlsx文件");
                result = await exchange.preview(actor, kindValue(key), input, {
                    mode: exchangeMode(url.searchParams.get("mode")),
                    newSettlement: url.searchParams.get("new_settlement") === "true",
                    projectId: url.searchParams.get("project_id") || undefined,
                });
            }
            else if (sub === "commit")
                result = exchange.commit(actor, key, commitRequest(input));
            else if (sub === "results" && read) {
                await workbook(res, exchange.results(actor, key), "导入结果");
                return;
            }
            else if (sub === "correction" && !read) {
                requireValue(Buffer.isBuffer(input), "请提供本次检查的原文件");
                await workbook(res, exchange.correction(actor, key, input), "待修正的原表");
                return;
            }
            else if (sub === "errors" && read) {
                await workbook(res, exchange.errors(actor, key), "导入问题");
                return;
            }
            else
                requireValue(false, "交换动作不存在", 404);
            break;
    }
    return { result };
}

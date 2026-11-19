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
export async function handleExchange(context: RouteContext): Promise<{
    result: unknown;
} | undefined> {
    const { resource, actor, read, key, sub, input, url, res, workbook, exchange } = context;
    let result: unknown;
    switch (resource) {
        case "exchange":
            if (sub === "template") {
                await workbook(res, exchange.template(actor, kindValue(key), url.searchParams.get("project_id")), ({ assets: "设备台账", demands: "需求", settlements: "结算" } as Record<string, string>)[key] + "模板");
                return;
            }
            if (sub === "export") {
                if (key === "projects") {
                    requireValue(read, "仅支持查询子项目清单", 405);
                    await workbook(res, exchange.projectReport(actor, url.searchParams.getAll("id")), "所选子项目清单");
                    return;
                }
                const assetKind = url.searchParams.get("asset_kind");
                requireValue(assetKind === null || assetKind === "lines" || assetKind === "physical" || assetKind === "towers" || assetKind === "spans", "设备导出分类无效");
                await workbook(res, exchange.exportData(actor, kindValue(key), {
                    ids: url.searchParams.getAll("id"),
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
                    projectId: url.searchParams.get("project_id") || undefined,
                });
            }
            else if (sub === "commit")
                result = exchange.commit(actor, key, commitRequest(input));
            else if (sub === "results" && read) {
                await workbook(res, exchange.results(actor, key), "导入结果");
                return;
            }
            else if (sub === "errors") {
                await workbook(res, exchange.errors(actor, key), "导入问题");
                return;
            }
            else
                requireValue(false, "交换动作不存在", 404);
            break;
    }
    return { result };
}

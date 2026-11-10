import type { RouteContext } from "../../platform/http/context.js";
import { requireValue } from '../../shared/errors/business-error.js';

export async function handleExchange(context: RouteContext): Promise<{ result: unknown } | undefined> {
  const { resource, actor, read, key, sub, input, url, res, workbook, exchange } = context;
  let result: unknown;
  switch (resource) {
case "exchange":
          if (sub === "template") {
            await workbook(
              res,
              exchange.template(actor, key, url.searchParams.get("project_id")),
              ({ assets: "设备台账", demands: "需求", settlements: "结算" } as Record<string, string>)[key] + "模板",
            );
            return;
          }
          if (sub === "export") {
            await workbook(
              res,
              exchange.exportData(actor, key, {
                ids: url.searchParams.getAll("id"),
                projectId: url.searchParams.get("project_id"),
                query: url.searchParams.get("q") || "",
                report: url.searchParams.get("report") === "true",
              }),
              ({ assets: "设备台账", demands: "需求", settlements: "结算" } as Record<string, string>)[key] + (url.searchParams.get("report") === "true" ? "报表" : "数据维护"),
            );
            return;
          }
          if (sub === "preview") {
            requireValue(Buffer.isBuffer(input), "请上传xlsx文件");
            result = await exchange.preview(actor, key, input, {
              mode: url.searchParams.get("mode") || "mixed",
              projectId: url.searchParams.get("project_id"),
            });
          } else if (sub === "commit")
            result = exchange.commit(actor, key, input);
          else if (sub === "results" && read) {
            await workbook(res, exchange.results(actor, key), "导入结果");
            return;
          } else if (sub === "errors") {
            await workbook(res, exchange.errors(actor, key), "导入问题");
            return;
          } else requireValue(false, "交换动作不存在", 404);
          break;
  }
  return { result };
}

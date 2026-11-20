import { parseListQuery } from "../../platform/http/list-query.js";
import { isObject } from "../../shared/types/contracts.js";
import type { RouteContext } from "../../platform/http/context.js";
import { requireValue } from '../../shared/errors/business-error.js';
import { authorize } from '../../platform/auth/service.js';
export async function handleManagement(context: RouteContext): Promise<{
    result: unknown;
} | undefined> {
    const { resource, system, actor, read, key, method, input, deleted, url, mutate, page } = context;
    requireValue(isObject(input), "请求正文必须为JSON对象", 400);
    let result: unknown;
    switch (resource) {
        case "users":
            authorize(actor, "admin");
            result = read
                ? page(system.management.users(actor, deleted), url.searchParams)
                : mutate("admin", () => system.management.saveUser(actor, input, key, method));
            break;
        case "access-policy":
            authorize(actor,"admin");
            requireValue(!key && !context.sub, "访问限制配置不接受其他路径",404);
            requireValue(read || method==="POST", "访问限制配置只支持读取或修改",405);
            result=read ? system.management.accessPolicy(actor)
                : mutate("admin",()=>system.management.setAccessPolicy(actor,input));
            break;
        case "ips":
            authorize(actor, "admin");
            result = read
                ? page(system.management.ips(actor), url.searchParams)
                : mutate("admin", () => system.management.saveIp(actor, input, key, method));
            break;
        case "audit":
            authorize(actor, "admin");
            result = read
                ? key
                    ? system.management.audits(actor, deleted, key)
                    : system.management.searchAuditEvents(actor, parseListQuery(url.searchParams))
                : mutate("admin", () => system.management.annotateAudit(actor, input, key, method));
            break;
        case "permissions":
            authorize(actor, "admin");
            requireValue(read, "权限定义只读", 405);
            result = system.management.permissions(actor);
            break;
    }
    return { result };
}

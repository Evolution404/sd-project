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
        case "menus":
            requireValue(read, "菜单接口只允许读取", 405);
            requireValue(!context.sub && (!key || key==="routes"), "不支持的菜单资源", 404);
            result = system.management.menuRoutes(actor);
            break;
        case "users":
            authorize(actor, "user.manage");
            result = read
                ? key ? system.management.userDetail(actor, key, deleted)
                  : page(system.management.users(actor, deleted), url.searchParams, ["status"])
                : mutate("user.manage", () => system.management.saveUser(actor, input, key, method, true));
            break;
        case "roles":
            authorize(actor,"role.manage");
            if(read) {
                requireValue(!context.sub,"未知角色子资源",404);
                result=key ? system.management.role(actor,key)
                    : page(system.management.roles(actor),url.searchParams);
            } else if(key && !context.sub && method==="DELETE") {
                result=mutate("role.manage",()=>system.management.deleteRole(actor,key,input));
            } else if(key && context.sub==="permissions" && method==="PUT") {
                result=mutate("role.manage",()=>system.management.setRolePermissions(actor,key,input));
            } else {
                requireValue(!context.sub,"未知角色操作",404);
                requireValue(method==="POST" || method==="PUT" || method==="PATCH",
                    "仅支持创建或修改角色",405);
                result=mutate("role.manage",()=>system.management.saveRole(actor,input,key||undefined));
            }
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
            authorize(actor, read ? "audit.read" : "admin");
            result = read
                ? key === "security"
                    ? system.management.searchSecurityEvents(actor, parseListQuery(url.searchParams))
                    : key
                    ? system.management.audits(actor, deleted, key)
                    : system.management.searchAuditEvents(actor, parseListQuery(url.searchParams))
                : mutate("admin", () => system.management.annotateAudit(actor, input, key, method));
            break;
        case "permissions":
            authorize(actor, "role.manage");
            requireValue(read, "权限定义只读", 405);
            result = system.management.permissions(actor);
            break;
    }
    return { result };
}

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
                    : page(system.management.audits(actor, deleted), url.searchParams)
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

import { isObject } from "../../shared/types/contracts.js";
import { requireValue } from "../../shared/errors/business-error.js";
import type { RouteContext } from "../../platform/http/context.js";
export async function handlePricing(context: RouteContext): Promise<{
    result: unknown;
} | undefined> {
    const { resource, system, actor, key, method, input, mutate } = context;
    requireValue(isObject(input), "请求正文必须为JSON对象", 400);
    let result: unknown;
    switch (resource) {
        case "charges":
            result = mutate("write", () => key
                ? method === "DELETE"
                    ? system.pricing.removeCharge(actor, key)
                    : system.pricing.reviseCharge(actor, key, input)
                : system.pricing.addCharge(actor, input));
            break;
    }
    return { result };
}

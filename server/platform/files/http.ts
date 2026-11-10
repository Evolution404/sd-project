import { isObject } from "../../shared/types/contracts.js";
import { requireValue } from "../../shared/errors/business-error.js";
import type { RouteContext } from "../http/context.js";
export async function handleFiles(context: RouteContext): Promise<{
    result: unknown;
} | undefined> {
    const { resource, actor, read, key, method, input, deleted, url, res, mutate, evidence } = context;
    requireValue(isObject(input), "请求正文必须为JSON对象", 400);
    let result: unknown;
    switch (resource) {
        case "evidence":
            if (read && key) {
                const { file, bytes } = evidence.download(actor, key);
                res.writeHead(200, {
                    "Content-Type": "application/octet-stream",
                    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
                    "Cache-Control": "no-store",
                });
                res.end(bytes);
                return;
            }
            if (read)
                result = evidence.list(actor, url.searchParams.get("owner_kind"), url.searchParams.get("owner_id"), deleted);
            else if (method === "DELETE")
                result = mutate("admin", () => evidence.remove(actor, key));
            else if (key)
                result = mutate("write", () => evidence.revise(actor, key, input.note));
            else
                result = mutate("write", () => evidence.upload(actor, input));
            break;
    }
    return { result };
}

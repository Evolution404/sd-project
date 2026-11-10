import { requireValue } from "../../shared/errors/business-error.js";
import { id } from "../../platform/auth/service.js";
export function validateOperationFields({ values, previous, get, repo }) {
    const oldFields = previous ? JSON.parse(previous.fields_json) : [];
    const fields = JSON.parse(values.fields_json).map((field) => ({
        ...field,
        key: field.key ||
            oldFields.find((old) => old.label === field.label)?.key ||
            id(),
    }));
    values.fields_json = JSON.stringify(fields);
    requireValue(Array.isArray(fields), "附加字段须为完整字段清单");
    requireValue(new Set(fields.map((field) => field.key)).size === fields.length, "附加字段身份不能重复");
    requireValue(new Set(fields.map((field) => field.label)).size === fields.length, "附加字段名称不能重复");
    for (const field of fields)
        requireValue(field &&
            typeof field.key === "string" &&
            field.key &&
            typeof field.label === "string" &&
            field.label.trim() &&
            ["text", "number", "boolean", "date", "select"].includes(field.type) &&
            typeof field.required === "boolean" &&
            (field.type !== "select" ||
                (Array.isArray(field.options) &&
                    field.options.length > 0 &&
                    field.options.every((value) => typeof value === "string"))), "请完整填写附加字段名称、类型及可选内容");
    const features = JSON.parse(values.pricing_features_json);
    requireValue(Array.isArray(features), "计价所需信息须为完整特征清单");
    const originals = JSON.parse(previous?.pricing_features_json || "[]");
    const used = new Set();
    for (const declared of features) {
        requireValue(declared && typeof declared.factor_id === "string" &&
            Number.isSafeInteger(declared.factor_version) &&
            typeof declared.required === "boolean", "请选择正式价格特征并明确是否计价必需");
        requireValue(!used.has(declared.factor_id), "同一操作不能重复声明价格特征");
        used.add(declared.factor_id);
        const factor = repo.find("dictionary_items", "id", declared.factor_id);
        const version = repo.where("dictionary_item_versions", {
            item_id: declared.factor_id,
            version: declared.factor_version,
        })[0];
        requireValue(factor?.type_id === "price_factor" && version, "计价所需信息必须引用有效的价格特征");
        const previousSame = originals.some((old) => old.factor_id === declared.factor_id &&
            old.factor_version === declared.factor_version &&
            old.source === declared.source &&
            old.required === declared.required);
        requireValue(declared.source === "manual" || previousSame, "新增计价所需信息只能使用现场填写，台账属性请在价格适用条件中配置");
        if (!previousSame) {
            const current = get("factors", declared.factor_id);
            requireValue(current.status === "active" &&
                current.version === declared.factor_version, "价格特征已更新或停用，请刷新后重新选择", 409);
        }
    }
}

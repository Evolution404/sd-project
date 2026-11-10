import { requireValue } from "../../shared/errors/business-error.js";
import { validateFactorDefinition } from "./features.js";
export function validateFactorFields({ values, previous, get, repo }) {
    const definition = JSON.parse(values.fields_json);
    const unchangedLegacy = previous?.fields_json === values.fields_json;
    validateFactorDefinition(definition, { allowLegacyAsset: unchangedLegacy });
    const builtIn = new Set(["电压等级", "线路电压等级", "塔型",
        "物理杆塔塔型", "停电方式", "作业方式", "作业位置", "归属范围",
        "工作量", "数量", "规格", "作业规格", "操作类型"]);
    requireValue(!builtIn.has(String(values.name).trim()), "该条件已有正式业务字段，请在参考价格适用条件中直接配置");
    if (definition.unit_id) {
        const identity = repo.find("dictionary_items", "id", definition.unit_id);
        const adopted = repo.where("dictionary_item_versions", {
            item_id: definition.unit_id, version: definition.unit_version,
        })[0];
        requireValue(identity?.type_id === "unit" && adopted, "整数计量单位版本不存在或不是正式计量单位");
        const old = previous && JSON.parse(previous.fields_json);
        const unchangedUnit = old?.unit_id === definition.unit_id &&
            old?.unit_version === definition.unit_version;
        if (!unchangedUnit) {
            const current = get("units", definition.unit_id);
            requireValue(current.status === "active" &&
                current.version === definition.unit_version, "整数计量单位已更新或停用，请重新选择", 409);
        }
    }
}

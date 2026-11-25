import { api } from "./client";

import { requireAdoptedQuantityPrecision, type UnitVersionPrecision }
  from "../utils/adopted-unit-precision";
export interface UnitHistoryPrecision {
  versions: UnitVersionPrecision[];
}
export type UnitReference = { unit_id: string; unit_version: number };
export async function readAdoptedQuantityPrecision(unitId: string, unitVersion: number): Promise<number> {
  if (!unitId) throw Error("尚未选择正式计量单位");
  const response = await api<UnitHistoryPrecision>(
    "/catalog/units/" + encodeURIComponent(unitId) + "?history=true",
  );
  return requireAdoptedQuantityPrecision(response.versions, unitVersion);
}
export async function readCurrentMaterialPrecision(materialId: string): Promise<number> {
  if (!materialId) throw Error("未选择物资");
  const master = await api<{ unit_id: string }>(
    "/catalog/materials/" + encodeURIComponent(materialId) + "?deleted=true",
  );
  if (!master.unit_id) throw Error("物资未配置正式计量单位");
  const unit = await api<{ version: number }>(
    "/catalog/units/" + encodeURIComponent(master.unit_id) + "?deleted=true",
  );
  return readAdoptedQuantityPrecision(master.unit_id, unit.version);
}

import { requireValue } from "./errors/business-error.js";

/** Quantities remain exact integers scaled by 10,000 in Schema113. */
export const QUANTITY_SCALE_DECIMALS = 4;
export type QuantityPrecision = 0 | 1 | 2 | 3 | 4;

export function validateQuantityPrecision(value: unknown): QuantityPrecision {
  requireValue(
    typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 4,
    "数量小数位数必须为0至4之间的整数",
    422,
    { quantity_precision: "请选择整数或1至4位小数" },
  );
  return value as QuantityPrecision;
}

/** A unit's adopted formal version always contains an explicit quantity precision. */
export function quantityPrecisionFromFields(fieldsJson: string): QuantityPrecision {
  const fields: unknown = JSON.parse(fieldsJson);
  requireValue(fields !== null && typeof fields === "object" && !Array.isArray(fields) &&
    Object.hasOwn(fields, "quantity_precision"),
    "计量单位正式版本缺少数量精度，请重建开发测试数据", 422,
    { quantity_precision: "正式单位版本必须明确整数或0至4位小数" });
  return validateQuantityPrecision((fields as Record<string, unknown>).quantity_precision);
}

/** Preserve independent unit extension facts in the next formal version. */
export function unitFieldsWithPrecision(previousJson: string | undefined, input: unknown): string {
  const precision = validateQuantityPrecision(input);
  const previous: unknown = JSON.parse(previousJson || "[]");
  const extensions: Record<string, unknown> =
    previous && typeof previous === "object" && !Array.isArray(previous)
      ? { ...previous as Record<string, unknown> }
      : {};
  return JSON.stringify({ ...extensions, quantity_precision: precision });
}

export function assertQuantityPrecision(
  scaled: number,
  fieldsJson: string,
  unitName: string,
  fieldPath: string,
): number {
  const precision = quantityPrecisionFromFields(fieldsJson);
  const factor = 10 ** (QUANTITY_SCALE_DECIMALS - precision);
  const message = precision === 0
    ? `${unitName}只允许整数数量`
    : `${unitName}最多允许${precision}位小数`;
  requireValue(
    Number.isSafeInteger(scaled) && scaled % factor === 0,
    message,
    422,
    { [fieldPath]: message },
  );
  return scaled;
}

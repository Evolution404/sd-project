export class BusinessError extends Error {
  constructor(message, status = 422, fields = {}) { super(message); this.status = status; this.fields = fields; }
}
export function requireValue(condition, message, status = 422, fields) {
  if (!condition) throw new BusinessError(message, status, fields);
}
export function expectedVersion(actual, expected) {
  requireValue(Number.isSafeInteger(expected) && actual === expected, '版本冲突，请刷新后重新核对', 409);
}
export function integer(value, label, minimum = 0) {
  requireValue(Number.isSafeInteger(value) && value >= minimum, `${label}必须为大于等于${minimum}的安全整数`);
  return value;
}
export function text(value, label) {
  requireValue(typeof value === 'string' && value.trim().length > 0, `请填写${label}`);
  return value.trim();
}

export type Row = Record<string, any>
export class ApiError extends Error {
  fields: Row
  constructor(message: string, fields: Row = {}) { super(message); this.fields = fields }
}
export async function api<T = Row>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch('/api' + path, {
    method, credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(method !== 'GET' ? { 'Idempotency-Key': crypto.randomUUID() } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
  const result = await response.json()
  if (!response.ok) throw new ApiError(result.message || '请求失败', result.fields)
  return result
}
export async function download(path: string, filename: string) {
  const response = await fetch('/api' + path, { credentials: 'same-origin' })
  if (!response.ok) throw new Error((await response.json()).message)
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url)
}
export const money = (value: number | null | undefined) => value == null ? '未核定' : (value / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const quantity = (value: number | undefined) => ((value || 0) / 10000).toLocaleString('zh-CN', { maximumFractionDigits: 4 })
export const statusText: Row = { active: '有效', pending: '待确认', returned: '已退回', cancelled: '已取消', inactive: '停用', retired: '退役', draft: '草稿', reserve: '储备', stocked: '已入库', approved: '已批准', closed: '已结项', approve: '已审核', submit: '待审核', return: '退回', reject: '驳回' }

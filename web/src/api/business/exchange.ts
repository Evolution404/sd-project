import type {
  ExchangeCommitResult,
  ExchangeMode,
  ExchangePreview as FullExchangePreview,
  WorkbookKind,
  WorkbookPrimitive,
} from "../../../../server/shared/types/exchange";

import type { EquipmentBulkKind } from "../../../../server/shared/equipment-bulk";

export type { ExchangeCommitResult, ExchangeMode, WorkbookKind };
export type ExchangePreview = Omit<FullExchangePreview, "documents"> & {
  documents: Pick<FullExchangePreview["documents"][number], "id" | "number" | "action" | "sheet" | "row">[];
};
const excelType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const api = "/api/exchange";

async function checkedResponse(path: string, options?: RequestInit) {
  const response = await fetch(api + path, { ...options, credentials: "same-origin" });
  if (response.ok) return response;
  const error: unknown = await response.json().catch(() => undefined);
  throw Error(
    error && typeof error === "object" && "message" in error
      ? String(error.message)
      : `Excel 请求失败（HTTP ${response.status}）`,
  );
}

export async function previewWorkbook(
  kind: WorkbookKind,
  file: File,
  query: URLSearchParams,
  signal?: AbortSignal,
): Promise<ExchangePreview> {
  query.set("view", "summary");
  const response = await checkedResponse("/" + kind + "/preview?" + query, {
    method: "POST",
    headers: { "Content-Type": excelType },
    body: file,
    signal,
  });
  return response.json() as Promise<ExchangePreview>;
}

export type DemandWorksheetTables = Record<"documents" | "work_locations" | "materials" | "sources", Record<string, WorkbookPrimitive | string[]>[]>;

export async function previewDemandWorksheet(mode: "create" | "update", rows: DemandWorksheetTables): Promise<ExchangePreview> {
  const response = await checkedResponse("/demands/worksheet-preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, rows }),
  });
  return response.json() as Promise<ExchangePreview>;
}

export async function previewAssetWorksheet(kind: EquipmentBulkKind, rows: Record<string, string>[]): Promise<ExchangePreview> {
  const result = await checkedResponse("/assets/worksheet-preview", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, rows }),
  });
  return result.json() as Promise<ExchangePreview>;
}

export async function commitWorkbook(
  token: string,
  requestKey: string,
  atomic: boolean,
): Promise<ExchangeCommitResult> {
  const response = await checkedResponse("/" + encodeURIComponent(token) + "/commit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ request_key: requestKey, atomic }),
  });
  return response.json() as Promise<ExchangeCommitResult>;
}

export async function downloadWorkbook(path: string, source?: File, selectedIds?: readonly string[]) {
  if(selectedIds!==undefined && (!selectedIds.length||selectedIds.length>5000||new Set(selectedIds).size!==selectedIds.length))throw Error("请选择1至5000条不同记录");
  if(source&&selectedIds!==undefined)throw Error("不能同时上传文件和指定导出记录");
  const response = await checkedResponse(
    path,
    source
      ? {
          method: "POST",
          headers: { "Content-Type": excelType },
          body: source,
        }
      : selectedIds!==undefined ? {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ids:selectedIds})} : undefined,
  );
  const filename = response.headers
    .get("content-disposition")
    ?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename ? decodeURIComponent(filename) : "业务数据.xlsx";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

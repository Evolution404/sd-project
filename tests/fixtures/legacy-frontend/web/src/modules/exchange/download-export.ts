import { download } from "../../shared/api/client";

export function downloadExport(path: string, selectedIds?: readonly string[]) {
  return download(path, undefined, selectedIds === undefined ? undefined : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: selectedIds }),
  });
}

import { ElMessageBox } from "element-plus";

// Shared form-close guard: comparison is intentionally based on the editable
// draft, not the server-backed formal row or transient loading flags.
export function useDialogDraftGuard(readDraft: () => unknown) {
  let initial = "";
  function fingerprint() {
    return JSON.stringify(readDraft(), (key, value) =>
      key.startsWith("price_features_load") || key === "price_features_loading"
        ? undefined : value);
  }
  function capture() { initial = fingerprint(); }
  function isChanged() { return initial !== "" && fingerprint() !== initial; }
  async function confirmClose(done: () => void) {
    if (!isChanged()) { done(); return; }
    try {
      await ElMessageBox.confirm(
        "当前内容尚未保存，退出后本次修改将丢失。",
        "放弃未保存的修改？",
        { type: "warning", confirmButtonText: "放弃修改", cancelButtonText: "继续编辑" },
      );
      done();
    } catch {
      // The user chose to keep editing.
    }
  }
  return { capture, isChanged, confirmClose };
}

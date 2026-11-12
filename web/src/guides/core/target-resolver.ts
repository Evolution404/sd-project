/** Explanatory targets only. Never call click(), submit() or mutate business UI. */
export function resolveGuideTarget(selector:string): HTMLElement|null {
  if (!selector) return null;
  if (!/^[.#\[\]\w\-="': >]+$/.test(selector) || selector.length > 180)
    return null;
  try {
    const elements=document.querySelectorAll<HTMLElement>(selector);
    const activeDialog=Array.from(document.querySelectorAll<HTMLElement>(".el-dialog"))
      .reverse().find(node=>visible(node));
    const candidates=Array.from(elements);
    if (activeDialog) {
      const inDialog=candidates.find(node => activeDialog.contains(node) && visible(node));
      if (inDialog) return inDialog;
    }
    return candidates.find(visible) ?? null;
  } catch { return null; }
}
function visible(node:HTMLElement) {
  const rect=node.getBoundingClientRect();
  return rect.width>0 && rect.height>0 && getComputedStyle(node).visibility!=="hidden";
}

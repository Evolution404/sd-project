/** Explanatory targets only. Never call click(), submit() or mutate business UI. */
const overlaySelector = ".el-dialog, .business-detail-dialog";
export function resolveGuideTarget(selector:string): HTMLElement|null {
  if (!selector) return null;
  if (!/^[.#\[\]\w\-="': >]+$/.test(selector) || selector.length > 180)
    return null;
  try {
    const elements=document.querySelectorAll<HTMLElement>(selector);
    const activeDialog=Array.from(document.querySelectorAll<HTMLElement>(overlaySelector))
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


/**
 * Never choose an arbitrary list row. Active business dialogs take precedence
 * over background pages; visible teleported Element Plus menus remain eligible.
 * Help positioning never clicks or changes any business record.
 */
export function resolveGuideActionTarget(actionId:string):HTMLElement|null {
  if (!/^[a-z][a-z0-9-]{1,40}\.[a-z][a-z0-9-]{1,50}$/.test(actionId))
    return null;
  const matches=Array.from(document.querySelectorAll<HTMLElement>(
    '[data-guide-action="'+actionId+'"]',
  )).filter(visible);
  const dialog=Array.from(document.querySelectorAll<HTMLElement>(overlaySelector))
    .filter(visible).at(-1);
  const scoped=dialog
    ? matches.filter(node=>dialog.contains(node) ||
      !!node.closest(".el-dropdown__popper"))
    : matches.filter(node=>!node.closest(overlaySelector));
  return scoped.length===1?scoped[0]:null;
}

/** Explanatory targets only. Never call click(), submit() or mutate business UI. */
const overlaySelector = ".el-dialog, .business-detail-dialog";
const workspaceSelector = overlaySelector + ", .business-work-surface";
export function hasActiveGuideWorkspace(): boolean {
  return Array.from(document.querySelectorAll<HTMLElement>(workspaceSelector)).some(visible);
}
export function resolveGuideTarget(selector:string): HTMLElement|null {
  if (!selector) return null;
  if (!/^[.#\[\]\w\-="': >]+$/.test(selector) || selector.length > 180)
    return null;
  try {
    const activeDialog = Array.from(document.querySelectorAll<HTMLElement>(overlaySelector)).filter(visible).at(-1);
    const main = document.querySelector("main.workspace");
    const activeWork = Array.from(main?.querySelectorAll<HTMLElement>(".business-work-surface") ?? []).find(visible);
    const root = activeDialog ?? activeWork ?? main;
    return Array.from(root?.querySelectorAll<HTMLElement>(selector) ?? []).find(visible) ?? null;
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

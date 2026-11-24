/** Explanatory targets only. Never click or submit business controls. */
const overlaySelector = ".el-dialog, .business-detail-dialog";

function visible(node: HTMLElement) {
  const rect = node.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && getComputedStyle(node).visibility === "visible";
}

function activeDialog() {
  return Array.from(document.querySelectorAll<HTMLElement>(overlaySelector))
    .filter(visible).sort((a,b) => overlayOrder(a) - overlayOrder(b)).at(-1);
}

function overlayOrder(node: HTMLElement) {
  return Number(getComputedStyle(node.closest(".el-overlay") ?? node).zIndex) || 0;
}

function activeWork() {
  return Array.from(document.querySelectorAll<HTMLElement>("main.workspace .business-work-surface"))
    .filter(visible).at(-1);
}

export function isGuideRecordOpen(kind: "demand" | "project", id: string | null | undefined): boolean {
  const dialog = activeDialog();
  return Boolean(id && dialog && Array.from(dialog.querySelectorAll<HTMLElement>('[data-guide-record]'))
    .some(node => visible(node) && node.dataset.guideRecord === kind + "/" + id));
}

export function hasActiveGuideWorkspace(): boolean {
  return Boolean(activeDialog() || activeWork());
}

export function resolveGuideTarget(selector: string): HTMLElement | null {
  if (!/^[.#\[\]\w\-="': >]+$/.test(selector) || selector.length > 180) return null;
  try {
    const root = activeDialog() ?? activeWork() ?? document.querySelector("main.workspace");
    return Array.from(root?.querySelectorAll<HTMLElement>(selector) ?? []).find(visible) ?? null;
  } catch { return null; }
}

export function resolveGuideAction(actionId: string) {
  if (!/^[a-z][a-z0-9-]{1,40}\.[a-z][a-z0-9-]{1,50}$/.test(actionId)) return null;
  const workspace = activeDialog() ?? activeWork() ?? document.querySelector("main.workspace");
  if (!workspace) return null;
  const anchors = Array.from(document.querySelectorAll<HTMLElement>(
    '[data-guide-action="'+actionId+'"]',
  )).filter(node => {
    if (!visible(node)) return false;
    const menu = node.closest<HTMLElement>(".el-dropdown__popper");
    if (!menu) return workspace.contains(node) && (!node.closest(overlaySelector) || node.closest(overlaySelector) === workspace);
    const triggerId = menu.querySelector("[aria-labelledby]")?.getAttribute("aria-labelledby");
    const trigger = triggerId ? document.getElementById(triggerId) : null;
    return Boolean(trigger && workspace.contains(trigger));
  });
  if (anchors.length === 1) {
    const node = anchors[0]!;
    return { node, menu:false, reason: node.matches(":disabled, [aria-disabled=true], .is-disabled")
      ? node.title || "当前记录或账号暂不能办理，请查看前置条件。"
      : "" };
  }
  if (anchors.length > 1) return null;
  const menus = Array.from(workspace.querySelectorAll<HTMLElement>(
    '[data-guide-menu~="'+actionId+'"]',
  )).filter(visible);
  return menus.length === 1 ? {node:menus[0]!,menu:true,reason:""} : null;
}

export function resolveGuideActionTarget(actionId: string) {
  return resolveGuideAction(actionId)?.node ?? null;
}

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useEventListener } from "@vueuse/core";
import { ElFocusTrap } from "element-plus/es/components/focus-trap/index.mjs";

const props = defineProps<{
  available: boolean;
  name: string;
  finishEditing: () => Promise<void> | undefined;
  focusWorksheet: () => void;
}>();
const viewport = ref<HTMLElement>();
const expanded = ref(false);
const reservedHeight = ref(0);
let nativeRequestPending = false;
let ownsNativeFullscreen = false;
let layoutVersion = 0;

function releaseNativeFullscreen() {
  if (!ownsNativeFullscreen) return;
  ownsNativeFullscreen = false;
  if (document.fullscreenElement === document.documentElement) {
    return document.exitFullscreen().catch(() => {});
  }
}

async function finishLayout(nativeTransition?: Promise<void>) {
  const version = ++layoutVersion;
  await Promise.all([props.finishEditing(), nativeTransition]);
  await nextTick();
  if (version !== layoutVersion || !props.available) return;
  const active = document.activeElement;
  if (active === document.body || viewport.value?.contains(active)) props.focusWorksheet();
}

function collapse() {
  if (!expanded.value) return;
  expanded.value = false;
  return finishLayout(releaseNativeFullscreen());
}

function toggle() {
  if (expanded.value) {
    collapse();
    return;
  }
  if (!props.available || !viewport.value) return;
  reservedHeight.value = viewport.value.getBoundingClientRect().height;
  expanded.value = true;
  let nativeTransition: Promise<void> | undefined;
  // Use the document root so native spreadsheet popups and business pickers
  // teleported to body remain available in browser fullscreen.
  if (document.fullscreenEnabled && !document.fullscreenElement && !nativeRequestPending) {
    nativeRequestPending = true;
    nativeTransition = document.documentElement.requestFullscreen().then(() => {
      nativeRequestPending = false;
      ownsNativeFullscreen = document.fullscreenElement === document.documentElement;
      if (!expanded.value) return releaseNativeFullscreen();
    }, () => { nativeRequestPending = false; });
  }
  return finishLayout(nativeTransition);
}

function allowPointerFocus(event: CustomEvent<{ focusReason: string }>) {
  // Match Element Plus dialogs so pointer interaction can reach portalled controls.
  if (event.detail?.focusReason === "pointer") event.preventDefault();
}

useEventListener(document, "fullscreenchange", () => {
  if (ownsNativeFullscreen && !document.fullscreenElement) collapse();
});
watch(() => props.available, available => { if (!available) collapse(); });
watch(expanded, (active, _previous, onCleanup) => {
  const overlay = viewport.value?.closest(".el-overlay");
  if (!active || !overlay) return;
  const zIndex = Number.parseInt(getComputedStyle(overlay).zIndex, 10);
  if (!Number.isFinite(zIndex)) return;
  // Univer places anchored sheet menus in a portal on body. In an Element Plus
  // dialog that portal must share the host dialog's stacking level.
  const property = "--worksheet-dialog-layer";
  document.body.style.setProperty(property, String(zIndex));
  onCleanup(() => document.body.style.removeProperty(property));
});
onBeforeUnmount(() => {
  layoutVersion++;
  expanded.value = false;
  void releaseNativeFullscreen();
});
</script>

<template>
  <div :style="expanded ? { minHeight: reservedHeight + 'px' } : undefined">
    <div ref="viewport" class="worksheet-viewport" :data-worksheet-fullscreen="expanded ? '' : undefined"
      :role="expanded ? 'dialog' : undefined" :aria-label="expanded ? name + '全屏' : undefined"
      :aria-modal="expanded ? true : undefined" tabindex="-1">
      <slot :expanded="expanded" :toggle="toggle" />
    </div>
    <ElFocusTrap v-if="expanded && viewport" :focus-trap-el="viewport" trapped loop
      @focusout-prevented="allowPointerFocus" @focus-after-trapped="$event.preventDefault()"
      @focus-after-released="$event.preventDefault()" />
  </div>
</template>

<style>
.worksheet-viewport {
  position: relative;
  display: flow-root;
}
.worksheet-viewport[data-worksheet-fullscreen] {
  position: fixed;
  inset: 0;
  z-index: 1010;
  display: flex;
  flex-direction: column;
  padding: 16px;
  background: var(--content-bg);
  overflow: hidden;
  overscroll-behavior: contain;
}
body:has(.el-overlay [data-worksheet-fullscreen]) > div > [data-u-comp="rect-popup"] {
  z-index: var(--worksheet-dialog-layer, 1020) !important;
}
.worksheet-viewport[data-worksheet-fullscreen] :is(.worksheet-frame, .settlement-work-frame) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.worksheet-viewport[data-worksheet-fullscreen] :is(.worksheet-canvas, .settlement-work-canvas) {
  flex: 1;
  min-height: 0;
  height: auto;
}
</style>

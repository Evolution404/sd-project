<script setup lang="ts">
import {
  ref,
  onMounted,
  onUnmounted,
  watch,
  computed,
  provide,
} from "vue";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import { Fold, Expand, Sunny, Moon, Menu as MenuIcon } from "@element-plus/icons-vue";
import type { Actor } from "../../../server/shared/types/contracts";
import { api } from "../shared/api/client";
import { useRoute, useRouter } from "vue-router";
import NavigationMenu from "./NavigationMenu.vue";
import { navigationItems } from "./navigation";
const route = useRoute(), router = useRouter();
const active = computed(() => String(route.name || "dashboard"));
const user = ref<Actor | null>(null),
  ready = ref(false),
  login = ref({ username: "", password: "" }),
  error = ref(""),
  busy = ref(false);
provide("currentUser", user);
const menu = navigationItems;
type Appearance = "system" | "light" | "dark";
const initialAppearance = localStorage.getItem("sd-appearance");
const appearance = ref<Appearance>(
  initialAppearance === "light" || initialAppearance === "dark"
    ? initialAppearance : "system",
);
const appearanceMedia = window.matchMedia("(prefers-color-scheme: dark)");
const systemDark = ref(appearanceMedia.matches);
const darkAppearance = computed(() =>
  appearance.value === "dark" || (appearance.value === "system" && systemDark.value),
);
function systemAppearanceChanged(event: MediaQueryListEvent) {
  systemDark.value = event.matches;
}
watch([appearance, systemDark], () => {
  document.documentElement.classList.toggle("dark", darkAppearance.value);
  document.documentElement.style.colorScheme = darkAppearance.value ? "dark" : "light";
  localStorage.setItem("sd-appearance", appearance.value);
}, { immediate: true });
onMounted(() => appearanceMedia.addEventListener("change", systemAppearanceChanged));
onUnmounted(() => appearanceMedia.removeEventListener("change", systemAppearanceChanged));
const MIN_SIDEBAR_WIDTH = 208;
const MAX_SIDEBAR_WIDTH = 400;
const DEFAULT_SIDEBAR_WIDTH = 240;
function constrainSidebarWidth(value: number) {
  return Math.round(Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, value)));
}
const sidebarCollapsed = ref(localStorage.getItem("sd-sidebar-collapsed") === "true");
const storedSidebarWidth = Number(localStorage.getItem("sd-sidebar-width"));
const sidebarWidth = ref(constrainSidebarWidth(
  Number.isFinite(storedSidebarWidth) && storedSidebarWidth > 0
    ? storedSidebarWidth : DEFAULT_SIDEBAR_WIDTH,
));
const sidebarResizing = ref(false);
const mobileNavigation = ref(false);
const sidebarSize = computed(() => sidebarCollapsed.value ? "68px" : sidebarWidth.value + "px");
watch(sidebarCollapsed, value => {
  localStorage.setItem("sd-sidebar-collapsed", String(value));
  if (value) endSidebarResize();
});
watch(sidebarWidth, value => localStorage.setItem("sd-sidebar-width", String(value)));
let resizingPointerId: number | null = null;
let initialResizeX = 0;
let initialResizeWidth = DEFAULT_SIDEBAR_WIDTH;
function moveSidebarResize(event: PointerEvent) {
  if (event.pointerId !== resizingPointerId) return;
  sidebarWidth.value = constrainSidebarWidth(initialResizeWidth + event.clientX - initialResizeX);
}
function endSidebarResize(event?: PointerEvent) {
  if (event && event.pointerId !== resizingPointerId) return;
  if (resizingPointerId === null) return;
  resizingPointerId = null;
  sidebarResizing.value = false;
  document.documentElement.classList.remove("sidebar-is-resizing");
  window.removeEventListener("pointermove", moveSidebarResize);
  window.removeEventListener("pointerup", endSidebarResize);
  window.removeEventListener("pointercancel", endSidebarResize);
  window.removeEventListener("blur", cancelSidebarResize);
}
function cancelSidebarResize() {
  endSidebarResize();
}
function startSidebarResize(event: PointerEvent) {
  if (sidebarCollapsed.value || event.button !== 0 || resizingPointerId !== null) return;
  event.preventDefault();
  resizingPointerId = event.pointerId;
  initialResizeX = event.clientX;
  initialResizeWidth = sidebarWidth.value;
  sidebarResizing.value = true;
  document.documentElement.classList.add("sidebar-is-resizing");
  window.addEventListener("pointermove", moveSidebarResize);
  window.addEventListener("pointerup", endSidebarResize);
  window.addEventListener("pointercancel", endSidebarResize);
  window.addEventListener("blur", cancelSidebarResize);
}
function resizeSidebarByKeyboard(event: KeyboardEvent) {
  const next = event.key === "ArrowLeft" ? sidebarWidth.value - (event.shiftKey ? 32 : 8)
    : event.key === "ArrowRight" ? sidebarWidth.value + (event.shiftKey ? 32 : 8)
    : event.key === "Home" ? MIN_SIDEBAR_WIDTH
    : event.key === "End" ? MAX_SIDEBAR_WIDTH : null;
  if (next === null) return;
  event.preventDefault();
  sidebarWidth.value = constrainSidebarWidth(next);
}
onUnmounted(() => endSidebarResize());
function selectMenu(key: string) {
  void router.push({ name: key });
  mobileNavigation.value = false;
}
watch([user, () => route.name], () => {
  if (user.value && route.name === "system" && user.value.role !== "admin")
    void router.replace({ name: "dashboard" });
});
async function signIn() {
  busy.value = true;
  error.value = "";
  try {
    user.value = await api<Actor>("/login", "POST", login.value);
    login.value.password = "";
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function logout() {
  await api("/logout", "POST", {});
  user.value = null;
}
const expired = () => {
  user.value = null;
};
window.addEventListener("session-expired", expired);
onUnmounted(() => window.removeEventListener("session-expired", expired));
onMounted(async () => {
  try {
    user.value = await api<Actor>("/session");
  } catch {
  } finally {
    ready.value = true;
  }
});
</script>
<template>
  <ElConfigProvider :locale="zhCn"
    ><div v-if="ready && !user" class="login">
      <div class="login-card">
        <div class="section-caption">输电运检 · 业务工作台</div>
        <h1>输电项目全流程管理</h1>
        <p>登录内网工作区</p>
        <ElAlert
          v-if="error"
          :title="error"
          type="error"
          :closable="false"
          class="error-banner"
        /><ElForm
          :model="login"
          label-position="top"
          novalidate
          @submit.prevent="signIn"
          ><ElFormItem label="用户名" required
            ><ElInput
              v-model="login.username"
              autocomplete="username"
              @keyup.enter="signIn" /></ElFormItem
          ><ElFormItem label="密码" required
            ><ElInput
              v-model="login.password"
              type="password"
              autocomplete="current-password"
              @keyup.enter="signIn" /></ElFormItem
          ><ElButton type="primary" :loading="busy" @click="signIn"
            >登录</ElButton
          ></ElForm
        >
      </div>
    </div>
    <div v-else-if="user" class="shell" :class="{ 'is-resizing-sidebar': sidebarResizing }"
      :style="{ '--sidebar-width': sidebarSize }">
      <aside class="navigation" :class="{ 'is-collapsed': sidebarCollapsed }">
        <div class="navigation-top">
          <div class="brand"><div class="brand-mark">电</div><div v-if="!sidebarCollapsed" class="brand-name">输电项目管理<small>全流程业务工作区</small></div></div>
          <ElTooltip :content="sidebarCollapsed ? '展开导航' : '折叠导航'" placement="right">
            <ElButton class="collapse-button" text circle :aria-label="sidebarCollapsed ? '展开导航' : '折叠导航'" @click="sidebarCollapsed = !sidebarCollapsed"><ElIcon><Expand v-if="sidebarCollapsed" /><Fold v-else /></ElIcon></ElButton>
          </ElTooltip>
        </div>
        <NavigationMenu :active="active" :collapsed="sidebarCollapsed" :admin="user.role === 'admin'" @select="selectMenu" />
        <div v-if="!sidebarCollapsed" class="sidebar-resize-grip" role="separator"
          tabindex="0" aria-label="拖动调整侧栏宽度"
          aria-orientation="vertical" :aria-valuemin="MIN_SIDEBAR_WIDTH"
          :aria-valuemax="MAX_SIDEBAR_WIDTH" :aria-valuenow="sidebarWidth"
          title="拖动侧栏边缘调整宽度；方向键微调，双击恢复默认"
          @pointerdown="startSidebarResize" @keydown="resizeSidebarByKeyboard"
          @dblclick="sidebarWidth = DEFAULT_SIDEBAR_WIDTH" />
      </aside>
      <main class="workspace">
        <header class="topbar">
          <div class="topbar-heading"><ElButton class="mobile-menu" text circle aria-label="打开导航" @click="mobileNavigation = true"><ElIcon><MenuIcon /></ElIcon></ElButton><p>{{ menu.find(item => item.key === active)?.title || "输电项目管理" }}</p></div>
          <div class="account-actions">
            <ElPopover placement="bottom-end" trigger="click" :width="245">
              <div class="appearance-heading">界面外观</div>
              <ElRadioGroup v-model="appearance" size="small">
                <ElRadioButton value="system">跟随系统</ElRadioButton>
                <ElRadioButton value="light">浅色</ElRadioButton>
                <ElRadioButton value="dark">深色</ElRadioButton>
              </ElRadioGroup>
              <template #reference>
                <ElButton text circle aria-label="外观设置">
                  <ElIcon><Moon v-if="darkAppearance" /><Sunny v-else /></ElIcon>
                </ElButton>
              </template>
            </ElPopover>
            <ElTag type="info">{{ user.username }}</ElTag
            ><ElButton text @click="logout">退出登录</ElButton>
          </div>
        </header>
        <RouterView v-if="active !== 'system' || user.role === 'admin'" v-slot="{ Component }">
          <component :is="Component" :key="active" v-bind="active === 'demands' ? { user } : {}" />
        </RouterView>
      </main>
      <ElDrawer v-model="mobileNavigation" title="业务导航" direction="ltr" size="min(320px, 90vw)" class="mobile-navigation-drawer">
        <NavigationMenu :active="active" :admin="user.role === 'admin'" @select="selectMenu" />
      </ElDrawer>
    </div>
  </ElConfigProvider>
</template>

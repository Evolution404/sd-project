<script setup lang="ts">
import {
  ref,
  onMounted,
  onUnmounted,
  watch,
  computed,
  defineAsyncComponent,
  provide,
} from "vue";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import { House, Document, FolderOpened, Wallet, Coin, Connection, Collection, Setting, Fold, Expand, Operation, Menu as MenuIcon } from "@element-plus/icons-vue";
import { api, type Row } from "./services/api";
const DashboardPage = defineAsyncComponent(
  () => import("./pages/DashboardPage.vue"),
);
const DemandPage = defineAsyncComponent(() => import("./pages/DemandPage.vue"));
const ProjectPage = defineAsyncComponent(
  () => import("./pages/ProjectPage.vue"),
);
const CatalogPage = defineAsyncComponent(
  () => import("./pages/CatalogPage.vue"),
);
const SystemPage = defineAsyncComponent(() => import("./pages/SystemPage.vue"));
const user = ref<Row | null>(null),
  ready = ref(false),
  active = ref("dashboard"),
  login = ref({ username: "", password: "" }),
  error = ref(""),
  busy = ref(false);
provide("currentUser", user);
const menu = [
  { key: "dashboard", title: "工作台", icon: House },
  { key: "demands", title: "专业需求", icon: Document },
  { key: "projects", title: "年度框架与子项目", icon: FolderOpened },
  { key: "funding", title: "执行协议与资金", icon: Wallet },
  { key: "finance", title: "实际费用与结算", icon: Coin },
  { key: "ledger", title: "输电设备台账", icon: Connection },
  { key: "standards", title: "作业标准与参考价格", icon: Collection },
  { key: "system", title: "系统管理", icon: Setting },
];
const sidebarCollapsed = ref(localStorage.getItem("sd-sidebar-collapsed") === "true");
const sidebarWidth = ref(Math.min(320, Math.max(208, Number(localStorage.getItem("sd-sidebar-width")) || 240)));
const mobileNavigation = ref(false);
const sidebarSize = computed(() => sidebarCollapsed.value ? "68px" : sidebarWidth.value + "px");
watch(sidebarCollapsed, value => localStorage.setItem("sd-sidebar-collapsed", String(value)));
watch(sidebarWidth, value => localStorage.setItem("sd-sidebar-width", String(value)));
function selectMenu(key: string) { active.value = key; mobileNavigation.value = false; }
async function signIn() {
  busy.value = true;
  error.value = "";
  try {
    user.value = await api("/login", "POST", login.value);
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
    user.value = await api("/session");
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
    <div v-else-if="user" class="shell" :style="{ '--sidebar-width': sidebarSize }">
      <aside class="navigation" :class="{ 'is-collapsed': sidebarCollapsed }">
        <div class="navigation-top">
          <div class="brand"><div class="brand-mark">电</div><div v-if="!sidebarCollapsed" class="brand-name">输电项目管理<small>全流程业务工作区</small></div></div>
          <ElTooltip :content="sidebarCollapsed ? '展开导航' : '折叠导航'" placement="right">
            <ElButton class="collapse-button" text circle :aria-label="sidebarCollapsed ? '展开导航' : '折叠导航'" @click="sidebarCollapsed = !sidebarCollapsed"><ElIcon><Expand v-if="sidebarCollapsed" /><Fold v-else /></ElIcon></ElButton>
          </ElTooltip>
        </div>
        <ElMenu :default-active="active" :collapse="sidebarCollapsed" :collapse-transition="false" @select="selectMenu">
          <ElMenuItem v-for="item in menu.filter(x => x.key !== 'system' || user?.role === 'admin')" :key="item.key" :index="item.key">
            <ElIcon><component :is="item.icon" /></ElIcon><template #title>{{ item.title }}</template>
          </ElMenuItem>
        </ElMenu>
        <ElPopover v-if="!sidebarCollapsed" placement="right-end" width="240" trigger="click">
          <div class="sidebar-size-label">导航宽度 {{ sidebarWidth }}px</div><ElSlider v-model="sidebarWidth" :min="208" :max="320" :step="8" :show-tooltip="false" />
          <template #reference><ElButton class="sidebar-settings" text><ElIcon><Operation /></ElIcon>调整侧栏宽度</ElButton></template>
        </ElPopover>
      </aside>
      <main class="workspace">
        <header class="topbar">
          <div class="topbar-heading"><ElButton class="mobile-menu" text circle aria-label="打开导航" @click="mobileNavigation = true"><ElIcon><MenuIcon /></ElIcon></ElButton><p>{{ menu.find(item => item.key === active)?.title || "输电项目管理" }}</p></div>
          <div>
            <ElTag type="info">{{ user.username }}</ElTag
            ><ElButton text @click="logout">退出登录</ElButton>
          </div>
        </header>
        <DashboardPage v-if="active === 'dashboard'" /><DemandPage
          v-else-if="active === 'demands'"
          :user="user"
        /><ProjectPage
          v-else-if="active === 'projects' || active === 'finance'"
          :key="active"
          :finance-only="active === 'finance'"
        /><CatalogPage
          v-else-if="active === 'funding'"
          :key="active"
          title="年度框架、协议与组织"
          :kinds="['frameworks', 'agreements', 'organizations', 'categories']"
        /><CatalogPage
          v-else-if="active === 'ledger'"
          :key="active"
          title="输电设备台账"
          :kinds="['lines', 'physical', 'towers', 'spans', 'voltages']"
        /><CatalogPage
          v-else-if="active === 'standards'"
          :key="active"
          title="作业标准与参考价格"
          :kinds="[
            'operations',
            'objects',
            'materials',
            'prices',
            'units',
            'factors',
            'priorities',
          ]"
        /><SystemPage v-else-if="active === 'system'" />
      </main>
      <ElDrawer v-model="mobileNavigation" title="业务导航" direction="ltr" size="min(320px, 90vw)" class="mobile-navigation-drawer">
        <ElMenu :default-active="active" @select="selectMenu"><ElMenuItem v-for="item in menu.filter(x => x.key !== 'system' || user?.role === 'admin')" :key="item.key" :index="item.key"><ElIcon><component :is="item.icon" /></ElIcon>{{ item.title }}</ElMenuItem></ElMenu>
      </ElDrawer>
    </div>
  </ElConfigProvider>
</template>

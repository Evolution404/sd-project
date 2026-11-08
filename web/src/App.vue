<script setup lang="ts">
import {
  ref,
  onMounted,
  onUnmounted,
  defineAsyncComponent,
  provide,
} from "vue";
import zhCn from "element-plus/es/locale/lang/zh-cn";
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
  { key: "dashboard", title: "工作台" },
  { key: "demands", title: "专业需求" },
  { key: "projects", title: "年度框架与子项目" },
  { key: "funding", title: "执行协议与资金" },
  { key: "finance", title: "实际费用与结算" },
  { key: "ledger", title: "输电设备台账" },
  { key: "standards", title: "作业标准与参考价格" },
  { key: "system", title: "系统管理" },
];
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
        <div class="section-caption">Transmission projects</div>
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
    <div v-else-if="user" class="shell">
      <aside class="navigation">
        <div class="brand">输电项目管理<small>PROJECT WORKSPACE</small></div>
        <ElMenu :default-active="active" @select="active = $event"
          ><ElMenuItem
            v-for="item in menu.filter(
              (x) => x.key !== 'system' || user?.role === 'admin',
            )"
            :key="item.key"
            :index="item.key"
            >{{ item.title }}</ElMenuItem
          ></ElMenu
        >
      </aside>
      <main class="workspace">
        <header class="topbar">
          <p>输电运检 · 全流程业务工作区</p>
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
      </main></div
  ></ElConfigProvider>
</template>

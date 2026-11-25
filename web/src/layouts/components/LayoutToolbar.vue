<template>
  <div :class="['layout-toolbar', toolbarToneClass]">
    <template v-if="isDesktop">
      <div class="layout-toolbar__item layout-toolbar__item--search">
        <CommandPalette />
      </div>

      <div class="layout-toolbar__item">
        <div class="fullscreen-trigger" @click="toggleFullscreen">
          <div :class="`i-svg:` + (isFullscreen ? 'fullscreen-exit' : 'fullscreen')" />
        </div>
      </div>

      <div class="layout-toolbar__item">
        <SizeSelect />
      </div>


      <div v-if="showTenantSwitcher" class="layout-toolbar__item">
        <TenantSwitcher @change="handleTenantChange" />
      </div>
    </template>

    <div v-if="guideActor.id" class="layout-toolbar__item">
      <el-button text :icon="QuestionFilled" aria-label="使用指引" title="使用指引（F1）" @click="guideOpen=true">
        <span class="hidden xl:inline">使用指引</span>
      </el-button>
    </div>
    <div class="layout-toolbar__item layout-toolbar__item--profile">
      <el-dropdown trigger="click">
        <div class="layout-user">
          <div class="layout-user__avatar">
            <img v-if="userStore.userInfo.avatar" :src="userStore.userInfo.avatar" class="layout-user__avatar-img" />
            <el-icon v-else :size="18"><UserFilled /></el-icon>
          </div>
          <span class="layout-user__name">{{ userStore.userInfo.nickname }}</span>
        </div>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item @click="handleProfileClick">
              {{ t("navbar.profile") }}
            </el-dropdown-item>
            <el-dropdown-item v-if="appConfig.oidcEnabled" @click="handleIdentityClick">
              {{ t("navbar.identity") }}
            </el-dropdown-item>
            <el-dropdown-item divided @click="logout">
              {{ t("navbar.logout") }}
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <div v-if="defaults.showSettings" class="layout-toolbar__item" @click="handleSettingsClick">
      <div class="i-svg:setting" />
    </div>
    <GuideHost v-if="guideActor.id" :key="guideActor.id" v-model:open="guideOpen"
      :actor="guideActor" :route-key="guideRouteKey(route.name)" />
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { UserFilled, QuestionFilled } from "@element-plus/icons-vue";
import GuideHost from "@/guides/components/GuideHost.vue";
import { guideRouteKey } from "@/guides/core/navigation";
import { useRoute, useRouter } from "vue-router";
import { appConfig, defaults } from "@/settings";
import { DeviceEnum, SidebarColor, ThemeMode, LayoutMode } from "@/enums/settings";
import { useAppStore, useSettingsStore, useUserStore } from "@/stores";

import { useTenantStoreHook } from "@/stores/tenant";

const { t } = useI18n();
const appStore = useAppStore();
const settingStore = useSettingsStore();
const userStore = useUserStore();
const tenantStore = useTenantStoreHook();
const { isFullscreen, toggle: toggleFullscreen } = useFullscreen();

const route = useRoute();
const router = useRouter();
const guideOpen=ref(false);
const guideActor=computed(()=>({id:String(userStore.userInfo.userId??""),roles:userStore.userInfo.roles}));
watch(()=>guideActor.value.id,()=>{guideOpen.value=false});
useEventListener(window,"keydown",(event:KeyboardEvent)=>{
  if(event.key==="F1"&&guideActor.value.id){event.preventDefault();guideOpen.value=true;}
});

const isDesktop = computed(() => appStore.device === DeviceEnum.DESKTOP);

const canSwitchTenant = computed(() => userStore.userInfo?.canSwitchTenant === true);

const showTenantSwitcher = computed(() => {
  if (!canSwitchTenant.value) {
    return false;
  }
  return tenantStore.tenantList.length > 1;
});

/**
 * 切换租户，成功后刷新页面
 */
function handleTenantChange(tenantId: number) {
  tenantStore.switchTenant(tenantId).then(
    () => {
      ElMessage.success("切换租户成功");
      window.location.href = "/";
    },
    (error: unknown) => {
      const message = error instanceof Error ? error.message : "切换租户失败";
      ElMessage.error(message);
    },
  );
}

/**
 * 打开个人中心页面
 */
function handleProfileClick() {
  router.push({ name: "Profile" });
}

/**
 * 打开个人中心的认证身份区块
 */
function handleIdentityClick() {
  router.push({ name: "Profile", query: { tab: "identity" } });
}

const toolbarToneClass = computed(() => {
  const { resolvedTheme, sidebarColorScheme, layout } = settingStore;

  if (resolvedTheme === ThemeMode.DARK) {
    return "layout-toolbar--light";
  }

  const isHeaderMenuLayout = layout === LayoutMode.TOP || layout === LayoutMode.MIX;
  if (isHeaderMenuLayout && sidebarColorScheme === SidebarColor.CLASSIC_BLUE) {
    return "layout-toolbar--light";
  }

  return "layout-toolbar--dark";
});

/**
 * 退出登录
 */
async function logout() {
  try {
    await ElMessageBox.confirm("确定注销并退出系统吗？", "提示", {
      confirmButtonText: "确定",
      cancelButtonText: "取消",
      type: "warning",
      lockScroll: false,
    });
  } catch {
    return;
  }

  let logoutUrl: string | null = null;
  try {
    logoutUrl = await userStore.logout();
  } catch {
    // 请求拦截器已提示；本地状态已清理，继续回登录页
  }

  if (logoutUrl) {
    // 交回认证中心统一登出，由认证中心回跳登录页
    window.location.href = logoutUrl;
    return;
  }

  const redirect = ["/404", "/401"].includes(route.path) ? "/" : route.fullPath;
  router.push(`/login?redirect=${encodeURIComponent(redirect)}`);
}

/**
 * 打开系统设置页面
 */
function handleSettingsClick() {
  settingStore.settingsVisible = true;
}
</script>

<style lang="scss" scoped>
.layout-toolbar {
  --layout-toolbar-color: var(--el-text-color-secondary);
  --layout-toolbar-hover-color: var(--el-color-primary);
  --layout-toolbar-hover-bg: var(--el-fill-color-light);

  display: flex;
  gap: 4px;
  align-items: center;
  min-height: 36px;

  &__item {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 36px;
    height: 36px;
    padding: 0 6px;
    color: var(--layout-toolbar-color);
    text-align: center;
    cursor: pointer;
    border-radius: var(--radius-control);
    transition:
      background-color 0.16s,
      color 0.16s;

    > [class*="i-svg:"] {
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .fullscreen-trigger {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
    }

    :deep(.el-dropdown),
    :deep(.el-tooltip) {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 36px;
      color: inherit !important;
    }

    :deep(.el-tooltip__trigger),
    :deep(.fullscreen-trigger),
    :deep(.size-trigger),
    :deep(.notice__trigger) {
      color: inherit;
    }

    :deep([class*="i-svg:"]),
    :deep(.el-icon) {
      --color: currentColor;

      font-size: 18px;
      line-height: 1;
      color: currentColor !important;
      transition: color 0.16s;
    }

    :deep([class*="i-svg:"]) {
      background-color: currentColor !important;
    }

    &:hover {
      color: var(--layout-toolbar-hover-color);
      background: var(--layout-toolbar-hover-bg);
    }
  }

  &__item--search {
    color: var(--el-text-color-secondary);

    &:hover {
      background: transparent;
    }
  }

  &__item--profile {
    padding-right: 4px;
    padding-left: 4px;

    &:hover {
      background: transparent;
    }
  }
}

.layout-user {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 36px;
  padding: 0 6px 0 2px;

  &__avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 30px;
    height: 30px;
    overflow: hidden;
    border-radius: 50%;
  }

  &__avatar-img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center;
  }

  &__name {
    margin-left: 8px;
    line-height: 1;
    font-size: 13px;
    color: currentColor;
    white-space: nowrap;
    transition: color 0.3s;
  }
}

.layout-toolbar--light {
  --layout-toolbar-color: var(--menu-text);
  --layout-toolbar-hover-color: var(--menu-active-text);
  --layout-toolbar-hover-bg: var(--menu-hover);

  .layout-user__name {
    color: currentColor;
  }

  ::v-deep(.tenant-switcher__trigger) {
    color: currentColor;
    background: transparent;
  }
  ::v-deep(.tenant-switcher__trigger .tenant-switcher__icon) {
    color: currentColor;
  }
  ::v-deep(.tenant-switcher__trigger:hover) {
    color: var(--layout-toolbar-hover-color);
    background: var(--layout-toolbar-hover-bg);
  }
  ::v-deep(.tenant-switcher__trigger:hover .tenant-switcher__icon) {
    color: currentColor;
  }
}

.layout-toolbar--dark {
  --layout-toolbar-color: var(--el-text-color-secondary);
  --layout-toolbar-hover-color: var(--el-color-primary);
  --layout-toolbar-hover-bg: var(--el-fill-color-light);

  .layout-user__name {
    color: var(--el-text-color-regular);
  }

  ::v-deep(.tenant-switcher__trigger) {
    color: var(--el-text-color-regular);
    background: transparent;
  }
  ::v-deep(.tenant-switcher__trigger .tenant-switcher__icon) {
    color: currentColor;
  }
  ::v-deep(.tenant-switcher__trigger:hover) {
    color: var(--layout-toolbar-hover-color);
    background: var(--layout-toolbar-hover-bg);
  }
  ::v-deep(.tenant-switcher__trigger:hover .tenant-switcher__icon) {
    color: currentColor;
  }
}

::v-deep(.el-dropdown-menu) {
  [class*="i-svg:"] {
    color: var(--el-text-color-regular) !important;

    &:hover {
      color: var(--el-color-primary) !important;
    }
  }
}
</style>

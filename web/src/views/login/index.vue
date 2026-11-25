<template>
  <div class="login-page">
    <div class="login-toolbar"><ThemeSwitcher /></div>
    <div class="login-layout">
      <div class="login-brand">
        <div class="login-brand__header">
          <el-image :src="logo" class="login-brand__logo" />
          <div class="login-brand__identity">
            <span class="login-brand__name">{{ appConfig.title }}</span>
            <span class="login-brand__version">v{{ appConfig.version }}</span>
          </div>
        </div>
        <div class="login-brand__hero">
          <el-tag class="login-brand__tag" type="primary" effect="plain" round>输电业务管理</el-tag>
          <h1 class="login-brand__title">项目全流程管理</h1>
          <div class="login-brand__features">
            <div class="login-brand__feature"><span class="login-brand__feature-text">需求、项目、结算和设备管理</span></div>
          </div>
        </div>
      </div>
      <div class="login-card">
        <div class="login-card__inner">
          <div class="login-card__form">
            <h2 class="login-card__title">欢迎回来</h2>
            <p class="login-card__desc">请使用系统账号登录</p>
            <el-alert v-if="error" :title="error" type="error" :closable="false" />
            <el-form
ref="formRef" :model="loginForm" :rules="loginRules" size="large"
              :validate-on-rule-change="false" novalidate>
              <el-form-item prop="username">
                <el-input
v-model.trim="loginForm.username" placeholder="用户名"
                  :prefix-icon="User" @keyup.enter="submit" />
              </el-form-item>
              <el-form-item prop="password">
                <el-input
v-model="loginForm.password" type="password" show-password
                  placeholder="密码" :prefix-icon="Lock" @keyup.enter="submit" />
              </el-form-item>
              <el-button
type="primary" class="login-card__submit" size="large"
                :loading="loading" @click="submit">登录</el-button>
            </el-form>
          </div>
        </div>
        <div class="login-footer">项目全流程管理</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: "LoginPage", inheritAttrs: false });
import { User, Lock } from "@element-plus/icons-vue";
import type { FormInstance } from "element-plus";
import { useRouter, useRoute } from "vue-router";
import { useUserStore } from "@/stores";
import { appConfig } from "@/settings";
import logo from "@/assets/images/logo.png";
const router = useRouter(), route = useRoute(), userStore = useUserStore();
const formRef=ref<FormInstance>();
const loading=ref(false),error=ref("");
const loginForm=reactive({username:"",password:""});
const loginRules={
  username:[{required:true,message:"请输入用户名",trigger:"blur"}],
  password:[{required:true,message:"请输入密码",trigger:"blur"}],
};
async function submit() {
  if(loading.value) return;
  const valid = await formRef.value?.validate().then(()=>true,()=>false);
  if(!valid) return;
  loading.value=true;error.value="";
  try {
    await userStore.login(loginForm);
    loginForm.password="";
    const dest=String(route.query.redirect||"/");
    await router.replace(dest.startsWith("/login")?"/":dest);
  } catch(cause) {error.value=(cause as Error).message}
  finally {loading.value=false}
}
</script>

<style lang="scss" scoped>
$text-primary: #273248;
$text-secondary: #667085;
$text-muted: #98a2b3;
$input-h: 44px;

.login-page {
  // 品牌色阶：从运行时主题色派生，切换主题色板（ArcoD/AntD/ElementD）时整页跟随
  --brand-strong: color-mix(in srgb, var(--el-color-primary), #000 15%);
  --brand-deep: color-mix(in srgb, var(--el-color-primary), #000 45%);

  position: relative;
  display: flex;
  min-height: 100vh;
  overflow: auto;
  /* 浅色渐变底色；桌面端被品牌区背景与白色卡片完全覆盖，窄屏两区透明后透出 */
  background: linear-gradient(
    180deg,
    #ffffff 0%,
    color-mix(in srgb, var(--el-color-primary) 16%, #fff) 100%
  );
}

.login-toolbar {
  position: fixed;
  top: 28px;
  right: 32px;
  z-index: 10;
  display: flex;
  gap: 12px;
  align-items: center;

  :deep(*) {
    cursor: pointer;
  }
}

.login-layout {
  display: flex;
  flex: 1;
  min-height: 100%;
}

.login-brand {
  position: relative;
  display: flex;
  flex: 0 0 65%;
  flex-direction: column;
  min-height: 100vh;
  padding: 28px 64px 48px;
  overflow: hidden;
  // 白云蓝海渐变（原 bg.svg）：白 → 主题色浅蓝，各 stop 按主题色混合比例派生
  background: linear-gradient(
    180deg,
    #fff 0%,
    color-mix(in srgb, var(--el-color-primary) 3%, #fff) 16%,
    color-mix(in srgb, var(--el-color-primary) 5%, #fff) 32%,
    color-mix(in srgb, var(--el-color-primary) 6%, #fff) 48%,
    color-mix(in srgb, var(--el-color-primary) 8%, #fff) 62%,
    color-mix(in srgb, var(--el-color-primary) 15%, #fff) 76%,
    color-mix(in srgb, var(--el-color-primary) 25%, #fff) 88%,
    color-mix(in srgb, var(--el-color-primary) 42%, #fff) 100%
  );
  animation: login-pane-in 0.36s ease-out both;

  // 浅色网格纹理 + 双角晕染：与暗色纹理、首页欢迎卡同一套视觉语言
  &::before {
    position: absolute;
    inset: 0;
    pointer-events: none;
    content: "";
    background-image:
      linear-gradient(
        to right,
        color-mix(in srgb, var(--el-color-primary) 6%, transparent) 1px,
        transparent 1px
      ),
      linear-gradient(
        to bottom,
        color-mix(in srgb, var(--el-color-primary) 6%, transparent) 1px,
        transparent 1px
      );
    background-size: 56px 56px;
    mask-image: radial-gradient(720px 420px at 20% 46%, #000 0%, transparent 75%);
  }

  &::after {
    position: absolute;
    inset: 0;
    pointer-events: none;
    content: "";
    background:
      radial-gradient(
        560px 260px at 84% 10%,
        color-mix(in srgb, var(--el-color-primary) 10%, transparent),
        transparent 70%
      ),
      radial-gradient(
        480px 240px at 6% 94%,
        color-mix(in srgb, var(--chart-2) 8%, transparent),
        transparent 72%
      );
  }

  &__header,
  &__hero {
    position: relative;
    z-index: 1;
  }

  &__header {
    display: flex;
    gap: 14px;
    align-items: center;
  }

  &__logo {
    box-sizing: border-box;
    width: 42px;
    height: 42px;
    padding: 5px;
    background: color-mix(in srgb, var(--el-color-primary) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--el-color-primary) 18%, transparent);
    border-radius: 12px;
  }

  &__identity {
    display: inline-flex;
    gap: 10px;
    align-items: center;
    min-width: 0;
  }

  &__name {
    font-size: 24px;
    font-weight: 600;
    line-height: 1;
    color: var(--brand-deep);
  }

  &__version {
    display: inline-flex;
    align-items: center;
    height: 22px;
    padding: 0 8px;
    font-size: 12px;
    font-weight: 600;
    line-height: 1;
    color: color-mix(in srgb, var(--brand-deep) 80%, transparent);
    background: color-mix(in srgb, var(--el-color-primary) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--el-color-primary) 16%, transparent);
    border-radius: 999px;
  }

  &__hero {
    display: flex;
    flex: 1;
    flex-direction: column;
    justify-content: center;
    width: min(760px, 100%);
    padding: 40px 0 60px;

    // 徽标 / 标题 / 特性依次浮现，backwards 不占用终帧 transform
    > * {
      animation: login-hero-in 0.45s cubic-bezier(0.22, 1, 0.36, 1) backwards;
    }

    > :nth-child(1) {
      animation-delay: 0.1s;
    }

    > :nth-child(2) {
      animation-delay: 0.16s;
    }

    > :nth-child(3) {
      animation-delay: 0.22s;
    }
  }

  &__tag {
    gap: 8px;
    // 去掉 main 包装层后 tag 成为 hero 的 flex 子项，防止被 stretch 拉满宽度
    align-self: flex-start;
    height: 32px;
    padding: 0 15px 0 13px;
    margin-bottom: 20px;
    font-size: 12px;
    font-weight: 700;
    color: var(--brand-strong);
    background: color-mix(in srgb, var(--el-color-primary) 8%, transparent);
    border-color: color-mix(in srgb, var(--el-color-primary) 16%, transparent);

    :deep(.el-tag__content) {
      display: inline-flex;
      gap: 8px;
      align-items: center;
    }
  }

  &__tag-dot {
    display: inline-block;
    flex-shrink: 0;
    width: 7px;
    height: 7px;
    background: var(--el-color-primary);
    border-radius: 50%;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--el-color-primary) 16%, transparent);
  }

  &__title {
    margin: 0;
    font-size: 36px;
    font-weight: 800;
    line-height: 1.15;
    color: var(--brand-deep);
    letter-spacing: 0;
  }

  &__desc {
    max-width: 560px;
    margin: 0;
    font-size: 18px;
    line-height: 1.6;
    color: #475569;
  }

  &__features {
    display: inline-flex;
    align-items: center;
    width: fit-content;
    max-width: 100%;
    margin-top: 32px;
  }

  &__feature {
    position: relative;
    display: inline-flex;
    gap: 10px;
    align-items: center;
    height: 32px;
    padding: 0 15px;
    font-size: 14px;
    font-weight: 600;
    color: color-mix(in srgb, var(--brand-deep) 85%, transparent);
    background: transparent;

    &:first-child {
      padding-left: 0;
    }

    &:not(:last-child)::after {
      position: absolute;
      top: 9px;
      right: 0;
      width: 1px;
      height: 14px;
      content: "";
      background: color-mix(in srgb, var(--el-color-primary) 18%, transparent);
    }
  }

  &__feature-mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    color: var(--brand-strong);
    background: color-mix(in srgb, var(--el-color-primary) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--el-color-primary) 16%, transparent);
    border-radius: 6px;
  }

  &__feature-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    color: var(--brand-strong);
  }

  &__feature-text {
    line-height: 1;
    white-space: nowrap;
  }
}

.login-card {
  position: relative;
  z-index: 1;
  display: flex;
  flex: 0 0 35%;
  flex-direction: column;
  align-items: center;
  padding: 0 0 32px;
  background: #fff;
  animation: login-pane-in 0.36s ease-out 0.04s both;

  &__inner {
    box-sizing: border-box;
    display: flex;
    flex: 1;
    flex-direction: column;
    justify-content: center;
    width: 100%;
    max-width: 430px;
    padding: 0 20px;
  }

  &__form {
    width: 100%;
  }

  &__title {
    margin: 0 0 10px;
    font-size: 28px;
    font-weight: 750;
    line-height: 1.1;
    color: $text-primary;
    letter-spacing: 0;
  }

  &__desc {
    margin: 10px 0 28px;
    font-size: 15px;
    color: $text-muted;
  }

  &__prefix-icon {
    display: inline-flex;
    width: 14px;
    height: 14px;
    color: var(--el-text-color-placeholder);
  }

  &__captcha {
    position: relative;
    box-sizing: border-box;
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    width: 108px;
    height: $input-h;
    padding: 0;
    overflow: hidden;
    font: inherit;
    cursor: pointer;
    background: var(--el-fill-color-blank);
    border: 1px solid var(--el-border-color);
    border-radius: var(--el-border-radius-base);
    transition: border-color 0.2s;

    &:hover {
      border-color: var(--el-color-primary);

      img {
        opacity: 0.35;
      }

      .login-card__captcha-refresh {
        opacity: 1;
      }
    }

    &:focus-visible {
      outline: 2px solid color-mix(in srgb, var(--el-color-primary) 55%, transparent);
      outline-offset: 2px;
    }

    img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: contain;
      transition: opacity 0.15s;
    }
  }

  &__captcha-refresh {
    position: absolute;
    color: var(--el-color-primary);
    opacity: 0;
    transition: opacity 0.15s;
  }

  &__options {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 22px;
    font-size: 14px;
    color: $text-secondary;

    a {
      font-weight: 500;
      color: var(--el-color-primary);
      cursor: pointer;
      transition: opacity 0.15s;

      &:hover {
        opacity: 0.8;
      }
    }
  }

  &__submit {
    width: 100%;
    height: 44px;
    font-size: 16px;
    font-weight: 600;
    border-radius: 8px;
    box-shadow: var(--brand-shadow);
    transition:
      box-shadow 0.16s,
      transform 0.16s;

    &:hover {
      box-shadow: var(--brand-shadow-hover);
      transform: translateY(-1px);
    }

    &:active {
      transform: translateY(0);
    }

    &:focus-visible {
      outline: 2px solid color-mix(in srgb, var(--el-color-primary) 55%, transparent);
      outline-offset: 2px;
    }
  }

  &__demo {
    margin-top: 20px;

    &-title {
      margin-bottom: 10px;
      font-size: 12px;
      color: $text-muted;
    }

    &-chip {
      height: 28px;
      padding: 0 12px;
      font-size: 12px;
      color: $text-secondary;
      cursor: pointer;
      background: color-mix(in srgb, var(--el-color-primary) 5%, transparent);
      border: 1px solid color-mix(in srgb, var(--el-color-primary) 16%, transparent);
      border-radius: 999px;
      transition:
        color 0.2s,
        background 0.2s,
        border-color 0.2s;

      &:hover {
        color: var(--el-color-primary);
        background: color-mix(in srgb, var(--el-color-primary) 10%, transparent);
        border-color: color-mix(in srgb, var(--el-color-primary) 40%, transparent);
      }

      &:focus-visible {
        outline: 2px solid color-mix(in srgb, var(--el-color-primary) 55%, transparent);
        outline-offset: 2px;
      }
    }
  }

  /* 半透明白底按钮，在渐变背景上保持可见；hover 时提实并加深投影 */
  &__alt {
    margin-top: 28px;

    &-divider {
      display: flex;
      gap: 12px;
      align-items: center;
      margin-bottom: 14px;
      font-size: 13px;
      color: $text-muted;

      &::before,
      &::after {
        flex: 1;
        height: 1px;
        content: "";
        background: color-mix(in srgb, var(--brand-deep) 12%, transparent);
      }
    }

    &-btn {
      display: flex;
      flex: 1;
      gap: 8px;
      align-items: center;
      justify-content: center;
      height: 44px;
      padding: 0;
      font-size: 14px;
      color: $text-secondary;
      cursor: pointer;
      background: rgb(255 255 255 / 80%);
      border: 1px solid color-mix(in srgb, var(--brand-deep) 10%, transparent);
      border-radius: 8px;
      box-shadow: 0 1px 2px color-mix(in srgb, var(--brand-deep) 6%, transparent);
      backdrop-filter: blur(4px);
      transition:
        color 0.2s,
        background 0.2s,
        border-color 0.2s,
        box-shadow 0.2s;

      &:hover {
        color: var(--el-color-primary);
        background: #fff;
        border-color: color-mix(in srgb, var(--el-color-primary) 35%, transparent);
        box-shadow: 0 4px 12px color-mix(in srgb, var(--el-color-primary) 14%, transparent);
      }

      &:focus-visible {
        outline: 2px solid color-mix(in srgb, var(--el-color-primary) 55%, transparent);
        outline-offset: 2px;
      }
    }

    &-icon {
      width: 16px;
      height: 16px;
    }
  }
}

:deep(.el-form-item) {
  margin-bottom: 14px;
}

:deep(.el-input__wrapper) {
  height: $input-h;
}

.login-footer {
  flex-shrink: 0;
  font-size: 12px;
  color: $text-muted;
}

.dark .login-page {
  background: #0b1020;
}

.dark .login-brand {
  // 深蓝渐变底（原 bg-dark.svg），暗色下不随主题色变化
  background: linear-gradient(135deg, #0f1a33 0%, #0c1428 55%, #0a1020 100%);

  // 网格纹理（原 bg-dark.svg pattern）：白色细线 + 上浓下淡遮罩
  &::before {
    position: absolute;
    inset: 0;
    content: "";
    background-image:
      linear-gradient(rgb(255 255 255 / 5%) 1px, transparent 1px),
      linear-gradient(90deg, rgb(255 255 255 / 5%) 1px, transparent 1px);
    background-size: 72px 72px;
    mask-image: linear-gradient(
      to bottom,
      rgb(0 0 0 / 90%) 0%,
      rgb(0 0 0 / 30%) 70%,
      transparent 100%
    );
  }

  // 暗色已有深蓝渐变与网格，不再叠加浅色晕染
  &::after {
    display: none;
  }

  &__logo {
    background: rgb(255 255 255 / 10%);
    border-color: rgb(255 255 255 / 20%);
  }

  &__name {
    color: rgb(255 255 255 / 92%);
  }

  &__version {
    color: rgb(255 255 255 / 85%);
    background: rgb(255 255 255 / 10%);
    border-color: rgb(255 255 255 / 16%);
  }

  &__tag {
    color: #fff;
    background: rgb(255 255 255 / 8%);
    border-color: rgb(255 255 255 / 16%);
  }

  &__tag-dot {
    background: #fff;
    box-shadow: 0 0 0 3px rgb(255 255 255 / 18%);
  }

  &__title {
    color: #fff;
  }

  &__desc {
    color: rgb(255 255 255 / 65%);
  }

  &__feature {
    color: rgb(255 255 255 / 85%);

    &:not(:last-child)::after {
      background: rgb(255 255 255 / 18%);
    }
  }

  &__feature-mark {
    color: #fff;
    background: rgb(255 255 255 / 10%);
    border-color: rgb(255 255 255 / 16%);
  }

  &__feature-icon {
    color: #fff;
  }
}

.dark .login-card {
  background: #0b1020;

  &__title {
    color: rgb(255 255 255 / 85%);
  }

  &__desc {
    color: rgb(255 255 255 / 30%);
  }

  &__demo-title {
    color: rgb(255 255 255 / 35%);
  }

  &__demo-chip {
    color: rgb(255 255 255 / 70%);
    background: rgb(255 255 255 / 6%);
    border-color: rgb(255 255 255 / 14%);

    &:hover {
      color: #fff;
      background: rgb(255 255 255 / 12%);
      border-color: rgb(255 255 255 / 28%);
    }
  }

  &__alt-divider {
    color: rgb(255 255 255 / 20%);

    &::before,
    &::after {
      background: rgb(255 255 255 / 12%);
    }
  }

  &__alt-btn {
    color: rgb(255 255 255 / 65%);
    background: rgb(255 255 255 / 6%);
    border-color: rgb(255 255 255 / 12%);
    box-shadow: none;

    &:hover {
      color: #fff;
      background: rgb(255 255 255 / 12%);
      border-color: rgb(255 255 255 / 24%);
    }
  }
}

.dark .login-footer {
  color: rgb(255 255 255 / 15%);
}

.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all 0.2s ease;
}

.fade-slide-enter-from,
.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(6px);
}

@keyframes login-pane-in {
  from {
    opacity: 0;
    filter: blur(4px);
  }

  to {
    opacity: 1;
    filter: blur(0);
  }
}

@keyframes login-hero-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }

  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .login-brand,
  .login-card,
  .login-brand__hero > * {
    animation: none;
  }
}

@media (max-width: 1024px) {
  .login-layout {
    flex-direction: column;
  }

  .login-toolbar {
    position: absolute;
    top: 37px;
  }

  .login-brand {
    flex: none;
    height: auto;
    min-height: auto;
    padding: 28px 40px 32px;
    background: transparent;

    &::before,
    &::after {
      display: none;
    }

    &__hero {
      display: none;
    }
  }

  /* 深色品牌区的渐变与网格纹理不适合窄屏，透出页面底色 */
  .dark .login-brand {
    background: none;

    &::before {
      display: none;
    }
  }

  /* 卡片占满剩余高度并透出页面渐变，inner 沿用全局的垂直居中，页脚沉底 */
  .login-card {
    flex: 1;
    padding: 40px 48px 32px;
    background: transparent;
  }

  .dark .login-card {
    background: transparent;
  }
}

@media (max-width: 640px) {
  .login-toolbar {
    top: 33px;
    right: 20px;
  }

  .login-brand {
    padding: 24px 24px 28px;

    /* 版本号移到名称下方，避免与右上角工具栏图标重叠 */
    &__identity {
      flex-direction: column;
      gap: 6px;
      align-items: flex-start;
    }

    &__name {
      font-size: 20px;
      white-space: nowrap;
    }
  }

  .login-card {
    padding: 32px 24px 24px;

    &__inner {
      width: 100%;
      padding: 0;
    }
  }
}
</style>

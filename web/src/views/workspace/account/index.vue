<template>
  <div class="profile-page" v-loading="loading">
    <el-alert v-if="loadError" class="mb-3" type="error" :title="loadError" :closable="false">
      <el-button link @click="load">重新读取</el-button>
    </el-alert>
    <template v-if="profile">
      <section class="profile-hero">
        <div class="profile-hero__body">
          <div class="profile-avatar">
            <el-avatar :size="72"><el-icon><UserFilled /></el-icon></el-avatar>
          </div>
          <div class="profile-hero__info">
            <h2 class="profile-hero__name">{{ profile.display_name || profile.username }}</h2>
            <p class="profile-hero__desc">{{ profile.username }}</p><p v-if="profile.employee_no" class="profile-hero__desc">工号：{{ profile.employee_no }}</p>
            <div class="profile-hero__meta">账号创建于 {{ formatBeijingDateTime(profile.created_at) }}</div>
          </div>
        </div>
        <div class="profile-hero__actions">
          <el-button type="primary" :icon="Lock" @click="openPassword">修改密码</el-button>
        </div>
      </section>
      <div class="profile-page__layout">
        <aside class="profile-page__side">
          <section class="profile-card">
            <header class="profile-card__header">
              <h3 class="profile-card__title">角色权限</h3>
              <span class="profile-card__extra">{{ profile.permission_count }} 项权限</span>
            </header>
            <div class="profile-tags">
              <el-tag v-for="role in profile.role_names" :key="role" effect="light">{{ role }}</el-tag>
            </div>
          </section>
        </aside>
        <main class="profile-page__main">
          <section class="profile-card">
            <header class="profile-card__header">
              <h3 class="profile-card__title">有效登录会话</h3>
              <el-button :loading="loading" @click="load">刷新</el-button>
            </header>
            <el-table :data="sessions" row-key="id" border>
              <el-table-column label="登录时间" min-width="154">
                <template #default="{ row }">{{ formatBeijingDateTime(row.created_at) }}</template>
              </el-table-column>
              <el-table-column label="到期时间" min-width="154">
                <template #default="{ row }">{{ formatBeijingDateTime(row.expires_at) }}</template>
              </el-table-column>
              <el-table-column label="状态" width="102">
                <template #default="{ row }"><el-tag v-if="row.current" type="success">当前会话</el-tag><span v-else>有效</span></template>
              </el-table-column>
              <el-table-column label="操作" width="108">
                <template #default="{ row }">
                  <el-button link type="danger" :disabled="busy" @click="revoke(row.id)">结束会话</el-button>
                </template>
              </el-table-column>
            </el-table>
          </section>
        </main>
      </div>
    </template>
    <el-dialog v-model="passwordOpen" title="修改密码" width="min(90vw, 520px)"
      append-to-body :close-on-click-modal="false" :close-on-press-escape="!busy" :show-close="!busy">
      <el-form label-position="top" novalidate :disabled="busy">
        <el-form-item label="当前密码" required><el-input v-model="password.current" type="password" show-password autocomplete="current-password" /></el-form-item>
        <el-form-item label="新密码" required><el-input v-model="password.new" type="password" show-password autocomplete="new-password" /></el-form-item>
        <el-form-item label="确认新密码" required><el-input v-model="password.confirm" type="password" show-password autocomplete="new-password" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="busy" @click="passwordOpen = false">取消</el-button>
        <el-button type="primary" :loading="busy" @click="savePassword">保存并重新登录</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Lock, UserFilled } from "@element-plus/icons-vue";
import { useUserStore } from "@/stores/user";
import { formatBeijingDateTime } from "@/utils/business/datetime";
import { accountProfile, ownSessions, revokeOwnSession, changeAccountPassword, type AccountProfile, type OwnSession } from "@/api/business/session";

const userStore = useUserStore();
const profile = ref<AccountProfile>();
const sessions = ref<OwnSession[]>([]);
const loading = ref(false), loadError = ref("");
const busy = ref(false), passwordOpen = ref(false);
const password = reactive({ current: "", new: "", confirm: "" });

async function load() {
  if (loading.value) return;
  loading.value = true;
  loadError.value = "";
  try {
    const [account, activeSessions] = await Promise.all([accountProfile(), ownSessions()]);
    profile.value = account;
    sessions.value = activeSessions;
  } catch (cause) { loadError.value = (cause as Error).message; }
  finally { loading.value = false; }
}
async function revoke(id: string) {
  if (busy.value) return;
  busy.value = true;
  try {
    await ElMessageBox.confirm("结束所选会话后，该浏览器需要重新登录。", "结束会话", { type: "warning" });
    const result = await revokeOwnSession(id);
    if (result.current) await userStore.redirectToLogin();
    else await load();
  } catch (cause) {
    if (cause !== "cancel" && cause !== "close") ElMessage.error((cause as Error).message);
  } finally { busy.value = false; }
}
function openPassword() {
  Object.assign(password, { current: "", new: "", confirm: "" });
  passwordOpen.value = true;
}
async function savePassword() {
  if (busy.value) return;
  if (!password.current || !password.new || password.new !== password.confirm) {
    ElMessage.error("请填写当前密码，并确认两次新密码一致");
    return;
  }
  busy.value = true;
  try {
    await changeAccountPassword(password.current, password.new);
    Object.assign(password, { current: "", new: "", confirm: "" });
    passwordOpen.value = false;
    await userStore.redirectToLogin();
  } catch (cause) { ElMessage.error((cause as Error).message); }
  finally { busy.value = false; }
}
onMounted(load);
</script>

<style lang="scss" scoped>
.profile-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 100%;
  padding: 16px;
}

.profile-hero,
.profile-card {
  background: var(--content-bg);
  border: 1px solid var(--card-border);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
}

.profile-hero {
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
}

.profile-hero__body,
.profile-hero__title,
.profile-hero__meta,
.profile-hero__actions,
.profile-hero__meta-item {
  display: flex;
  align-items: center;
}

.profile-hero__body {
  gap: 16px;
  min-width: 0;
}

.profile-hero__info {
  min-width: 0;
}

.profile-hero__title {
  flex-wrap: wrap;
  gap: 10px;
}

.profile-hero__name {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  line-height: 30px;
  color: var(--el-text-color-primary);
}

.profile-hero__desc {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.profile-hero__meta {
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.profile-hero__meta-item {
  gap: 4px;
}

.profile-hero__actions {
  flex-shrink: 0;
  gap: 8px;
}

.profile-avatar {
  position: relative;
  flex-shrink: 0;
}

.profile-avatar__action {
  position: absolute;
  right: -2px;
  bottom: -2px;
  border: 2px solid var(--content-bg);
}

.profile-avatar__input {
  display: none;
}

.profile-page__layout {
  display: grid;
  grid-template-columns: minmax(280px, 340px) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.profile-page__side,
.profile-page__main {
  display: grid;
  gap: 16px;
  min-width: 0;
}

.profile-page__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(260px, 340px);
  gap: 16px;
}

.profile-card {
  padding: 18px 20px;
}

.profile-card__header {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 14px;
}

.profile-card__title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  line-height: 22px;
  color: var(--el-text-color-primary);
}

.profile-card__desc {
  margin: 3px 0 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.profile-card__extra,
.profile-empty {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

.profile-info {
  display: grid;
  gap: 10px;
  margin: 0;
}

.profile-info__item {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  min-height: 34px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--el-border-color-extra-light);
}

.profile-info__item:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.profile-info__label {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.profile-info__value {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13px;
  color: var(--el-text-color-primary);
  white-space: nowrap;
}

.profile-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.profile-stats__item {
  display: flex;
  gap: 10px;
  align-items: center;
  min-width: 0;
  padding: 12px;
  background: var(--el-fill-color-lighter);
  border: 1px solid var(--el-border-color-extra-light);
  border-radius: 8px;
}

.profile-stats__body {
  min-width: 0;
}

.profile-stats__label,
.profile-stats__value {
  display: block;
}

.profile-stats__label {
  margin-bottom: 2px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.profile-stats__value {
  font-size: 20px;
  line-height: 24px;
  color: var(--el-text-color-primary);
}

.profile-stats__value em {
  display: inline;
  margin-left: 2px;
  font-size: 12px;
  font-style: normal;
  font-weight: 400;
  color: var(--el-text-color-secondary);
}

.profile-icon {
  display: flex;
  flex: 0 0 36px;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  font-size: 18px;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  border-radius: 8px;
}

.profile-icon--large {
  flex-basis: 40px;
  width: 40px;
  height: 40px;
  font-size: 20px;
}

.profile-icon--success {
  color: var(--el-color-success);
  background: var(--el-color-success-light-9);
}

.profile-icon--warning {
  color: var(--el-color-warning);
  background: var(--el-color-warning-light-9);
}

.profile-icon--info {
  color: var(--el-color-info);
  background: var(--el-fill-color-light);
}

.profile-security,
.profile-login,
.profile-status {
  display: grid;
  gap: 12px;
}

.profile-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.profile-security__item {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 12px 14px;
  border: 1px solid var(--el-border-color-extra-light);
  border-radius: 8px;
}

.profile-security__body,
.profile-login__body,
.profile-status__body {
  min-width: 0;
}

.profile-security__title {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.profile-security__desc {
  margin: 4px 0 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}

.profile-security__actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.profile-security__actions .el-button + .el-button {
  margin-left: 0;
}

.profile-login__item {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  min-height: 44px;
}

.profile-login__device,
.profile-login__meta,
.profile-login__time,
.profile-status__title,
.profile-status__desc {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-login__device,
.profile-status__title {
  font-size: 13px;
  color: var(--el-text-color-primary);
}

.profile-login__meta,
.profile-login__time,
.profile-status__desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.profile-status__item {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  min-height: 38px;
  color: var(--el-color-success);
}

.profile-status__item.is-warning {
  color: var(--el-color-warning);
}

.profile-status__title {
  margin-bottom: 2px;
}

.is-muted {
  color: var(--el-text-color-placeholder);
}

@media (width <= 1200px) {
  .profile-page__layout,
  .profile-page__grid {
    grid-template-columns: 1fr;
  }
}

@media (width <= 768px) {
  .profile-page {
    padding: 12px;
  }

  .profile-hero {
    align-items: flex-start;
  }

  .profile-hero,
  .profile-hero__body,
  .profile-hero__actions {
    flex-direction: column;
  }

  .profile-hero__actions {
    align-items: stretch;
    width: 100%;
  }

  .profile-hero__actions .el-button {
    width: 100%;
    margin-left: 0;
  }

  .profile-security__item,
  .profile-login__item {
    grid-template-columns: 40px minmax(0, 1fr);
  }

  .profile-security__actions,
  .profile-login__time {
    grid-column: 2;
    justify-self: start;
  }
}

@media (width <= 520px) {
  .profile-stats,
  .profile-info__item {
    grid-template-columns: 1fr;
  }

  .profile-info__item {
    gap: 4px;
  }
}
</style>

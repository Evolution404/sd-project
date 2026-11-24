<template>
  <main class="min-h-screen flex items-center justify-center p-4">
    <el-card class="w-full max-w-md">
      <template #header><h1>更改临时密码</h1></template>
      <el-alert v-if="error" :title="error" type="error" :closable="false" class="mb-3" />
      <el-form label-position="top" novalidate @submit.prevent="submit">
        <el-form-item label="临时密码" required>
          <el-input v-model="currentPassword" type="password" autocomplete="current-password" show-password />
        </el-form-item>
        <el-form-item label="新密码" required>
          <el-input v-model="newPassword" type="password" autocomplete="new-password" show-password />
        </el-form-item>
        <el-form-item label="再次输入新密码" required>
          <el-input v-model="repeatPassword" type="password" autocomplete="new-password" show-password />
        </el-form-item>
        <el-button type="primary" native-type="submit" :loading="saving">保存并重新登录</el-button>
        <el-button :disabled="saving" @click="leave">退出登录</el-button>
      </el-form>
    </el-card>
  </main>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useUserStore } from "@/stores";
import { changeAccountPassword } from "@/api/business/session";

const router = useRouter(), route = useRoute();
const user = useUserStore();
const saving = ref(false), error = ref("");
const currentPassword = ref(""), newPassword = ref(""), repeatPassword = ref("");
async function toLogin() {
  const redirect = route.query.redirect;
  await router.replace({ path: "/login", query: { redirect } });
}
async function submit() {
  if (saving.value) return;
  if (!currentPassword.value || !newPassword.value || newPassword.value !== repeatPassword.value) {
    error.value = "请输入临时密码，并确认两次新密码一致";
    return;
  }
  saving.value = true;
  error.value = "";
  try {
    await changeAccountPassword(currentPassword.value, newPassword.value);
    user.resetAllState();
    await toLogin();
  } catch (cause) {
    error.value = (cause as Error).message;
  } finally {
    saving.value = false;
  }
}
async function leave() {
  try {
    await user.logout();
    await toLogin();
  } catch (cause) {
    error.value = (cause as Error).message;
  }
}
</script>

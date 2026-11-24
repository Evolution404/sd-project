<script setup lang="ts">
import { useRouter } from "vue-router";
const router = useRouter();
</script>
<template>
  <ElResult icon="warning" title="页面不存在" sub-title="请检查地址或从导航重新进入业务模块。">
    <template #extra><ElButton type="primary" @click="router.push('/dashboard')">返回工作台</ElButton></template>
  </ElResult>
</template>

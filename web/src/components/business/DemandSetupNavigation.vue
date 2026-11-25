<template>
  <el-alert v-if="token" type="info" title="专业需求草稿已暂存" :closable="false" class="mb-3">
    <div class="mt-2 flex flex-wrap gap-2">
      <el-button @click="open('Dictionaries')">配置计量单位</el-button>
      <el-button @click="open('Operations','objects')">配置作业对象</el-button>
      <el-button @click="open('Operations','operations')">配置操作类型</el-button>
      <el-button @click="open('Ledger')">登记设备</el-button>
      <el-button @click="open('Frameworks')">配置年度框架</el-button>
      <el-button type="primary" @click="open('DemandEditor')">返回需求草稿</el-button>
    </div>
  </el-alert>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
const route = useRoute();
const router = useRouter();
const token = computed(() => typeof route.query.resumeDemand === "string" && /^[0-9a-f]{32}$/.test(route.query.resumeDemand)
  ? route.query.resumeDemand : undefined);
function open(name: "Dictionaries" | "Operations" | "Ledger" | "Frameworks" | "DemandEditor", setupTab?: string) {
  return router.push({ name, query: { resumeDemand: token.value, ...(setupTab && { setupTab }) } });
}
</script>

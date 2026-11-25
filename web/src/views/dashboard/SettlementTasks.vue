<template>
  <el-card v-if="visibleGroups.length" shadow="never">
    <template #header><h2 class="text-lg font-semibold">结算待办</h2></template>
    <section v-for="group in visibleGroups" :key="group.title" :aria-label="group.title">
      <h3 class="mb-2 font-medium">{{ group.title }}</h3>
      <el-alert v-if="group.error" type="error" :title="group.error" :closable="false" class="mb-2">
        <el-button link type="primary" :disabled="loading" @click="load">重新读取结算待办</el-button>
      </el-alert>
      <el-table v-if="group.rows.length" :data="group.rows" row-key="id" border class="mb-3">
        <el-table-column label="结算编号" min-width="150">
          <template #default="{ row }">
            <router-link :to="reviewRoute(row.id, row.project_id)" custom v-slot="{ href, navigate }">
              <el-link :href="href" type="primary" @click="navigate">{{ row.number }}</el-link>
            </router-link>
          </template>
        </el-table-column>
        <el-table-column prop="project_name" label="所属项目" min-width="200" />
        <el-table-column prop="project_code" label="项目编号" min-width="150" />
      </el-table>
    </section>
  </el-card>
</template>

<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, ref } from "vue";
import { listSettlements, type SettlementRow } from "@/api/business/finance";
import { useUserStore } from "@/stores/user";

type TaskStatus = "submit" | "return";
const tasks = [
  { status: "submit", permission: "settlement.approve", title: "审核结算" },
  { status: "return", permission: "write", title: "处理退回结算" },
] as const;
const user = useUserStore();
const records = ref<Partial<Record<TaskStatus, { rows: SettlementRow[]; error: string }>>>({});
const groups = computed(() => tasks.filter(task => user.userInfo.perms.includes(task.permission))
  .map(task => ({ ...task, rows: records.value[task.status]?.rows ?? [], error: records.value[task.status]?.error ?? "" })));
const visibleGroups = computed(() => groups.value.filter(group => group.rows.length || group.error));
const loading = ref(false);
let refreshOnReturn = false;
let sequence = 0;

function reviewRoute(settlementId: string, projectId: string) {
  return { name: "SettlementReview", params: { settlementId }, query: { project: projectId, source: "dashboard" } };
}

async function load() {
  if (loading.value) return;
  const request = ++sequence;
  loading.value = true;
  const result = await Promise.all(groups.value.map(async ({ status, rows }) => {
    try {
      const response = await listSettlements({ size: 5, status });
      return [status, { rows: response.items, error: "" }] as const;
    } catch (cause) {
      return [status, { rows, error: (cause as Error).message }] as const;
    }
  }));
  if (request === sequence) {
    records.value = Object.fromEntries(result);
    loading.value = false;
  }
}

onMounted(load);
onDeactivated(() => { refreshOnReturn = true; loading.value = false; sequence++; });
onActivated(() => {
  if (!refreshOnReturn) return;
  refreshOnReturn = false;
  void load();
});
</script>

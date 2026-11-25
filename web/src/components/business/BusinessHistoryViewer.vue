<template>
  <el-skeleton v-if="loading && !page" animated :rows="7" />
  <el-alert v-else-if="failure" type="error" :title="failure" :closable="false">
    <el-button link type="primary" @click="load()">重新加载</el-button>
    <el-button v-if="trail.length" link type="primary" @click="back">返回上一条历史</el-button>
  </el-alert>
  <template v-else-if="page">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div class="flex flex-wrap items-center gap-2">
        <h2 class="text-lg font-semibold">{{ page.name }}</h2>
        <el-tag v-if="page.status" effect="plain">{{ page.status }}</el-tag>
      </div>
      <el-button v-if="trail.length" @click="back">返回上一条历史</el-button>
    </div>
    <el-descriptions v-if="page.context?.length" :column="2" border class="mb-3">
      <el-descriptions-item v-for="fact in page.context" :key="fact.label" :label="fact.label">
        {{ display(fact.value) }}
      </el-descriptions-item>
    </el-descriptions>
    <el-row v-loading="loading" :gutter="16">
      <el-col :span="9">
        <section aria-label="办理时间线">
          <el-select v-model="category" aria-label="历史类别" class="mb-3" clearable placeholder="全部类别"
            @change="load(1, '')">
            <el-option v-for="item in page.categories" :key="item" :value="item" :label="item" />
          </el-select>
          <el-timeline class="pl-2">
            <el-timeline-item v-for="item in page.items" :key="item.id"
              :timestamp="formatBeijingDateTime(item.time)" :type="item.tone">
              <el-button link :type="item.id === page.selected?.id ? 'primary' : 'info'"
                class="history-event" @click="load(page.page, item.id)">{{ item.title }}</el-button>
              <small v-if="item.badge" class="block">{{ item.badge }}</small>
            </el-timeline-item>
          </el-timeline>
          <Pagination v-if="page.total > 10" :page="page.page" :limit="10" :total="page.total"
            layout="prev, pager, next" :pager-count="3" @update:page="load($event, '')" />
        </section>
      </el-col>
      <el-col :span="15">
        <section v-if="page.selected" aria-label="正式历史事实">
          <h3 class="mb-2 font-semibold">{{ page.selected.title }}</h3>
          <div class="mb-3 text-[var(--el-text-color-secondary)]">
            <span>记录时间：{{ formatBeijingDateTime(page.selected.time) }}</span><span class="ml-3">操作人：{{ page.selected.actor || "—" }}</span>
          </div>
          <p v-if="page.selected.reason" class="mb-2">{{ page.selected.reason }}</p>
          <el-descriptions v-if="page.selected.facts?.length" :column="1" border>
            <el-descriptions-item v-for="fact in page.selected.facts" :key="fact.label" :label="fact.label">
              {{ display(fact.value) }}
            </el-descriptions-item>
          </el-descriptions>
          <div v-for="table in page.selected.tables ?? []" :key="table.title" class="mt-4">
            <h4 class="mb-2 font-medium">{{ table.title }}</h4>
            <el-table :data="table.rows" border max-height="300">
              <el-table-column v-for="(label, index) in table.columns" :key="label + index" :label="label" min-width="116">
                <template #default="{ row }">{{ display(row[index]) }}</template>
              </el-table-column>
            </el-table>
          </div>
          <div v-if="page.selected.links?.length || page.selected.files?.length" class="mt-3 flex flex-wrap gap-2">
            <el-button v-for="(link, index) in page.selected.links ?? []" :key="link.target.kind + link.target.id + index"
              link type="primary" @click="follow(link.target)">{{ link.label }}</el-button>
            <el-link v-for="file in page.selected.files ?? []" :key="file.id" :href="file.removed ? undefined : '/api/evidence/' + encodeURIComponent(file.id)"
              :disabled="file.removed" type="primary">{{ file.name }}{{ file.removed ? "（已移除）" : "" }}</el-link>
          </div>
        </section>
        <el-empty v-else description="暂无历史记录" />
      </el-col>
    </el-row>
  </template>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import type { HistoryPage, HistoryTarget, HistoryValue } from "../../../../server/shared/types/history";
import Pagination from "@/components/Pagination/index.vue";
import { projectMoney } from "@/api/business/projects";
import { formatBeijingDateTime, formatVisibleDateTime } from "@/utils/business/datetime";
import { formatScaledDecimal } from "@/utils/business/fixed-scale";

const props = defineProps<{ target: HistoryTarget }>();
const target = ref<HistoryTarget>(props.target);
const trail = ref<Array<{ target: HistoryTarget; page: HistoryPage; category: string }>>([]);
const category = ref("");
const page = ref<HistoryPage>();
const loading = ref(false), failure = ref("");
let request: AbortController | undefined;

function display(value: HistoryValue | undefined) {
  if (value == null || value === "") return "—";
  if (typeof value !== "object") return String(formatVisibleDateTime(value));
  if (value.format === "time") return formatBeijingDateTime(value.value);
  if (typeof value.value !== "number") return "—";
  switch (value.format) {
    case "money": return projectMoney(value.value);
    case "quantity": return [formatScaledDecimal(value.value, 4), value.unit].filter(Boolean).join(" ");
    case "metres": return formatScaledDecimal(value.value, 3) + " " + (value.unit || "米");
    case "percent": return value.value + "%";
  }
}
async function load(index = 1, entry = target.value.entry || "", focus = false) {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  const current = target.value;
  const query = new URLSearchParams({ page: String(index), entry, category: category.value });
  if (current.project) query.set("project", current.project);
  loading.value = true;
  failure.value = "";
  try {
    const response = await fetch("/api/history/" + current.kind + "/" + encodeURIComponent(current.id) + "?" + query, {
      credentials: "same-origin", signal: controller.signal,
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.message || "历史读取失败");
    if (controller.signal.aborted) return;
    page.value = result as HistoryPage;
    if (focus) {
      await nextTick();
      document.querySelector(".el-drawer:has([aria-label='正式历史事实']) .el-drawer__body")?.scrollTo(0, 0);
    }
  } catch (cause) {
    if (!controller.signal.aborted) failure.value = (cause as Error).message;
  } finally {
    if (request === controller) loading.value = false;
  }
}
async function follow(next: HistoryTarget) {
  if (!page.value) return;
  trail.value.push({ target: target.value, page: page.value, category: category.value });
  target.value = next;
  category.value = "";
  page.value = undefined;
  await load(1, next.entry || "", true);
}
function back() {
  const prior = trail.value.pop();
  if (!prior) return;
  request?.abort();
  target.value = prior.target;
  page.value = prior.page;
  category.value = prior.category;
  failure.value = "";
  loading.value = false;
}
watch(() => props.target, current => {
  target.value = current;
  trail.value = [];
  page.value = undefined;
  category.value = "";
  void load();
}, { immediate: true });
onBeforeUnmount(() => request?.abort());
</script>

<style scoped>
.history-event {
  max-width: 100%;
  justify-content: flex-start;
  height: auto;
  white-space: normal;
  text-align: left;
}
</style>

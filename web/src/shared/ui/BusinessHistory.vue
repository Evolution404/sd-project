<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { ArrowLeft, ArrowRight, Clock, Filter, Paperclip } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import type { HistoryAttachment, HistoryEntry, HistoryKind, HistoryLink, HistoryPage, HistoryTarget } from "../../../../server/shared/types/history";
import { api, download } from "../api/client";
import { formatBeijingDateTime } from "../utils/datetime";
import { compareHistory, historyValue } from "../utils/history-display";
import HistoryFactsTable from "./HistoryFactsTable.vue";

const props = defineProps<{
  recordKind: HistoryKind;
  recordId: string;
  projectId?: string;
  initialEntry?: string;
  reveal?: boolean;
}>();
const current = ref<HistoryTarget>({ kind: props.recordKind, id: props.recordId, project: props.projectId, entry: props.initialEntry });
const trail = ref<{ target: HistoryTarget; result: HistoryPage; category: string; person: string;
  dates: string[] | null; scrollTop: number }[]>([]);
const result = ref<HistoryPage | null>(null);
const loading = ref(false);
const failure = ref("");
const category = ref("");
const person = ref("");
const dates = ref<string[] | null>(null);
const showFilter = ref(false);
const showCompare = ref(false);
const compareFrom = ref("");
const compareTo = ref("");
const comparison = ref<ReturnType<typeof compareHistory> | null>(null);
const comparisonError = ref("");
const comparing = ref(false);
const root = ref<HTMLElement>();
const detail = ref<HTMLElement>();
let request: AbortController | undefined;
let comparisonRequest: AbortController | undefined;
const selected = computed(() => result.value?.selected ?? null);
const hasFilter = computed(() => !!category.value || !!person.value || !!dates.value?.length);
const comparableGroups = computed(() => {
  const seen = new Set<string>();
  const groups = new Set<string>();
  for (const item of result.value?.versions ?? []) {
    if (!item.versionGroup) continue;
    if (seen.has(item.versionGroup)) groups.add(item.versionGroup);
    seen.add(item.versionGroup);
  }
  return groups;
});
const canCompare = computed(() => comparableGroups.value.size > 0);
const compareChoices = computed(() => {
  const items = result.value?.versions.filter(item => item.versionGroup && comparableGroups.value.has(item.versionGroup)) ?? [];
  return [...items].sort((a, b) => (b.version ?? 0) - (a.version ?? 0));
});
const fromChoices = computed(() => {
  const group = compareChoices.value.find(item => item.id === compareTo.value)?.versionGroup;
  return compareChoices.value.filter(item => item.versionGroup === group && item.id !== compareTo.value);
});

function path(target: HistoryTarget, options: Record<string, string> = {}) {
  const query = new URLSearchParams(options);
  if (target.project) query.set("project", target.project);
  return `/history/${target.kind}/${encodeURIComponent(target.id)}?${query}`;
}
async function load(page = 1, entry = "", focus = false) {
  request?.abort();
  const token = new AbortController();
  request = token;
  loading.value = true;
  failure.value = "";
  try {
    const next = await api<HistoryPage>(path(current.value, {
      page: String(page), entry, category: category.value, actor: person.value,
      start: dates.value?.[0] ?? "", end: dates.value?.[1] ?? "",
    }), "GET", undefined, token.signal);
    if (token.signal.aborted) return;
    result.value = next;
    if (focus) {
      await nextTick();
      detail.value?.focus({ preventScroll: true });
      if (detail.value && (root.value?.clientWidth ?? 0) <= 730)
        detail.value.scrollIntoView({ block: "nearest" });
    }
  } catch (error) {
    if (!token.signal.aborted) failure.value = (error as Error).message;
  } finally {
    if (request === token) loading.value = false;
  }
}
function choose(entry: string) {
  if (entry !== selected.value?.id || failure.value) void load(result.value?.page ?? 1, entry, true);
}
function resetFilters() {
  category.value = ""; person.value = ""; dates.value = null;
}
function scrollSurface() {
  return root.value?.closest<HTMLElement>(".el-drawer__body, .el-dialog__body") ?? null;
}
function openLink({ target }: HistoryLink) {
  if (!result.value) return;
  if (current.value.kind === target.kind && current.value.id === target.id
      && target.entry === selected.value?.id) return;
  trail.value.push({ target: current.value, result: result.value, category: category.value, person: person.value,
    dates: dates.value, scrollTop: scrollSurface()?.scrollTop ?? 0 });
  current.value = target;
  result.value = null;
  resetFilters();
  closeComparison();
  void load(1, target.entry, true);
}
function goBack() {
  const state = trail.value.pop();
  if (!state) return;
  request?.abort();
  current.value = state.target;
  result.value = state.result;
  category.value = state.category; person.value = state.person; dates.value = state.dates;
  failure.value = ""; loading.value = false;
  closeComparison();
  void nextTick(() => {
    const surface = scrollSurface();
    if (surface) surface.scrollTop = state.scrollTop;
  });
}
function closeComparison() {
  comparisonRequest?.abort();
  showCompare.value = false;
  comparison.value = null;
  comparisonError.value = "";
  comparing.value = false;
}
function chooseComparison() {
  const version = compareChoices.value.find(entry => entry.id === selected.value?.id)
    ?? compareChoices.value.find(entry => compareChoices.value.some(other => other.versionGroup === entry.versionGroup && other.id !== entry.id));
  if (!version) return;
  showCompare.value = true;
  compareTo.value = version.id;
  choosePrevious();
  if (compareFrom.value) void runComparison();
}
function choosePrevious() {
  const version = compareChoices.value.find(entry => entry.id === compareTo.value)?.version ?? 0;
  compareFrom.value = fromChoices.value.find(entry => (entry.version ?? 0) < version)?.id ?? fromChoices.value[0]?.id ?? "";
  comparison.value = null;
}
async function runComparison() {
  comparisonRequest?.abort();
  const token = new AbortController();
  comparisonRequest = token;
  comparisonError.value = "";
  comparing.value = true;
  try {
    const getVersion = async (entry: string): Promise<HistoryEntry> => {
      const data = await api<HistoryPage>(path(current.value, { entry }), "GET", undefined, token.signal);
      if (data.selected?.id !== entry) throw new Error("未找到所选版本，请刷新历史后再试");
      return data.selected;
    };
    const [before, after] = await Promise.all([getVersion(compareFrom.value), getVersion(compareTo.value)]);
    if (!token.signal.aborted) comparison.value = compareHistory(before, after);
  } catch (error) {
    if (!token.signal.aborted) comparisonError.value = (error as Error).message;
  } finally {
    if (comparisonRequest === token) comparing.value = false;
  }
}
async function readFile(file: HistoryAttachment) {
  try { await download("/evidence/" + encodeURIComponent(file.id), file.name); }
  catch (error) { ElMessage.error((error as Error).message); }
}

watch(() => [props.recordKind, props.recordId, props.projectId, props.initialEntry] as const, ([kind, id, project, entry]) => {
  current.value = { kind, id, project, entry };
  result.value = null;
  trail.value = [];
  resetFilters();
  closeComparison();
  if (id) {
    void load(1, entry);
    if (props.reveal) void nextTick(() => {
      root.value?.scrollIntoView({ block: "nearest" });
      root.value?.focus({ preventScroll: true });
    });
  }
}, { immediate: true });
onBeforeUnmount(() => { request?.abort(); comparisonRequest?.abort(); });
</script>

<template>
  <section ref="root" class="record-history" tabindex="-1" aria-label="历史记录" :aria-busy="loading">
    <ElButton v-if="trail.length" class="history-back" text :icon="ArrowLeft" @click="goBack">返回上一条记录</ElButton>
    <ElAlert v-if="failure" type="error" :closable="false" show-icon title="读取历史失败">
      <p>{{ failure }}</p>
      <ElButton text @click="load(result?.page, selected?.id || current.entry)">重新读取</ElButton>
    </ElAlert>
    <ElSkeleton v-if="loading && !result" :rows="7" animated />
    <template v-if="result">
      <header class="history-heading">
        <div class="history-heading-icon"><ElIcon><Clock /></ElIcon></div>
        <div class="history-heading-content">
          <div class="history-heading-title">
            <h3>{{ result.name }}</h3>
            <ElTag v-if="result.status" effect="plain" round>{{ result.status }}</ElTag>
          </div>
          <dl v-if="result.context?.some(field => field.value !== null)" class="history-context">
            <div v-for="item in result.context?.filter(field => field.value !== null)" :key="item.label">
              <dt>{{ item.label }}</dt><dd>{{ historyValue(item.value) }}</dd>
            </div>
          </dl>
        </div>
        <div v-if="result.categories.length || canCompare" class="history-controls">
          <ElButton v-if="canCompare" plain @click="showCompare ? closeComparison() : chooseComparison()">
            {{ showCompare ? "返回时间线" : "对比版本" }}
          </ElButton>
          <ElButton v-if="result.categories.length && !showCompare" :icon="Filter" :type="hasFilter ? 'primary' : 'default'"
            :aria-expanded="showFilter" plain @click="showFilter = !showFilter">筛选</ElButton>
        </div>
      </header>

      <ElForm v-if="showFilter && !showCompare" class="history-filters" label-position="top" novalidate @submit.prevent="load()">
        <ElFormItem label="事项类型"><ElSelect v-model="category" clearable placeholder="全部事项" aria-label="事项类型">
          <ElOption v-for="value in result.categories" :key="value" :label="value" :value="value" />
        </ElSelect></ElFormItem>
        <ElFormItem label="操作人"><ElInput v-model="person" clearable placeholder="输入操作人" aria-label="操作人" /></ElFormItem>
        <ElFormItem label="日期"><ElDatePicker v-model="dates" type="daterange" value-format="YYYY-MM-DD"
          start-placeholder="开始日期" end-placeholder="结束日期" /></ElFormItem>
        <div class="history-form-actions">
          <ElButton v-if="hasFilter" @click="resetFilters(); load()">清除</ElButton>
          <ElButton native-type="submit" type="primary" :loading="loading">查询</ElButton>
        </div>
      </ElForm>

      <section v-if="showCompare" class="history-comparison">
        <h4>比较正式版本</h4>
        <ElForm class="history-filters" label-position="top" novalidate @submit.prevent="runComparison">
          <ElFormItem label="原版本"><ElSelect v-model="compareFrom" aria-label="原版本" @change="comparison = null">
            <ElOption v-for="item in fromChoices" :key="item.id" :label="'第 ' + item.version + ' 版'" :value="item.id" />
          </ElSelect></ElFormItem>
          <ElFormItem label="对比版本"><ElSelect v-model="compareTo" aria-label="对比版本" @change="choosePrevious">
            <ElOption v-for="item in compareChoices" :key="item.id" :label="item.versionGroup + ' · 第 ' + item.version + ' 版'" :value="item.id" />
          </ElSelect></ElFormItem>
          <div class="history-form-actions">
            <ElButton native-type="submit" type="primary" :disabled="!compareFrom || !compareTo" :loading="comparing">比较</ElButton>
          </div>
        </ElForm>
        <ElAlert v-if="comparisonError" type="error" :title="comparisonError" :closable="false" />
        <template v-if="comparison">
          <HistoryFactsTable v-if="comparison.fields.length" scope="diff" :table="{ title: '基本信息变化', columns: ['项目', '原值', '新值'],
            rows: comparison.fields.map(change => [change.label, change.before, change.after]) }" />
          <HistoryFactsTable v-for="table in comparison.tables" :key="table.title" scope="diff" :table="table" />
          <ElEmpty v-if="!comparison.fields.length && !comparison.tables.length" :image-size="75" description="所选版本的可核对内容一致" />
        </template>
      </section>
      <div v-else-if="selected" class="history-workspace">
        <nav class="history-activity" aria-label="办理时间线" v-loading="loading">
          <div class="history-activity-heading"><strong>办理时间线</strong><span>{{ result.total }} 条</span></div>
          <ul>
            <li v-for="item in result.items" :key="item.id">
              <ElButton class="history-item" text :class="{ 'history-item-current': item.id === selected.id }"
                :aria-current="item.id === selected.id ? 'true' : undefined" @click="choose(item.id)">
                <span class="history-item-dot" :class="'history-tone-' + (item.tone || 'info')" />
                <span class="history-item-content">
                  <span class="history-item-title">{{ item.title }}</span>
                  <span v-if="item.summary" class="history-item-summary">{{ item.summary }}</span>
                  <span class="history-item-meta">{{ formatBeijingDateTime(item.time) }}<span v-if="item.actor"> · {{ item.actor }}</span></span>
                </span>
                <ElIcon><ArrowRight /></ElIcon>
              </ElButton>
            </li>
          </ul>
          <ElPagination v-if="result.total > 10" small layout="prev, pager, next" :pager-count="3"
            :page-size="10" :current-page="result.page" :total="result.total" @current-change="page => load(page)" />
        </nav>
        <article ref="detail" class="history-detail" tabindex="-1" aria-label="事项详情">
          <header>
            <div class="history-detail-title">
              <h4>{{ selected.title }}</h4>
              <ElTag v-if="selected.badge" size="small" effect="light" :type="selected.tone || 'info'">{{ selected.badge }}</ElTag>
            </div>
            <p class="history-byline">{{ formatBeijingDateTime(selected.time) }}<span v-if="selected.actor"> · {{ selected.actor }}</span>
              <span v-if="selected.version"> · 第 {{ selected.version }} 版</span>
            </p>
          </header>
          <p v-if="selected.reason" class="history-reason"><strong>办理说明</strong><span>{{ selected.reason }}</span></p>
          <HistoryFactsTable v-if="selected.changes?.length" scope="event" :table="{ title: '本次变化', columns: ['事项', '原值', '新值'],
            rows: selected.changes.map(change => [change.label, change.before, change.after]) }" />
          <dl v-if="selected.facts?.length" class="history-fact-grid">
            <div v-for="item in selected.facts" :key="item.label">
              <dt>{{ item.label }}</dt><dd>{{ historyValue(item.value) }}</dd>
            </div>
          </dl>
          <HistoryFactsTable v-for="table in selected.tables" :key="table.title" :scope="current.kind" :table="table" />
          <section v-if="selected.links?.length || selected.files?.length" class="history-evidence">
            <h4>关联记录与凭据</h4>
            <div>
              <ElButton v-for="link in selected.links" :key="link.label" link type="primary" @click="openLink(link)">
                {{ link.label }}
              </ElButton>
              <ElButton v-for="file in selected.files" :key="file.id" link type="primary" :icon="Paperclip" @click="readFile(file)">
                {{ file.name }}{{ file.removed ? "（已移除，历史附件）" : "" }}
              </ElButton>
            </div>
          </section>
        </article>
      </div>
      <ElEmpty v-else :image-size="95" :description="hasFilter ? '没有符合条件的记录' : '暂无历史记录'" />
    </template>
  </section>
</template>

<style scoped>
.record-history { display: grid; gap: 14px; min-width: 0; container-type: inline-size; }
.history-back { justify-self: start; }
.history-heading { display: flex; align-items: flex-start; gap: 14px; padding: 17px 18px; border: 1px solid var(--el-border-color-light); border-radius: 12px; background: var(--el-fill-color-lighter); }
.history-heading-icon { display: grid; flex: 0 0 36px; place-items: center; height: 36px; border-radius: 9px; background: var(--el-color-primary-light-9); color: var(--el-color-primary); font-size: 18px; }
.history-heading-content { min-width: 0; flex: 1; }
.history-heading-title, .history-detail-title { display: flex; align-items: center; flex-wrap: wrap; column-gap: 10px; row-gap: 5px; }
.history-heading h3, .history-detail h4, .history-comparison h4 { margin: 0; color: var(--el-text-color-primary); font-weight: 700; overflow-wrap: anywhere; }
.history-heading h3, .history-detail-title h4 { font-size: 17px; line-height: 1.4; }
.history-context, .history-fact-grid { display: flex; flex-wrap: wrap; gap: 8px 20px; margin: 8px 0 0; }
.history-context div, .history-fact-grid div { min-width: 0; }
.history-context dt, .history-fact-grid dt { margin-bottom: 4px; color: var(--el-text-color-secondary); font-size: 12px; }
.history-context dd, .history-fact-grid dd { margin: 0; color: var(--el-text-color-primary); font-weight: 550; overflow-wrap: anywhere; }
.history-controls { display: flex; gap: 8px; flex-wrap: wrap; }
.history-controls .el-button + .el-button, .history-evidence .el-button + .el-button { margin-left: 0; }
.history-workspace { display: grid; grid-template-columns: minmax(232px, .73fr) minmax(0, 1.65fr); align-items: start; gap: 14px; min-width: 0; }
.history-activity, .history-detail, .history-comparison { min-width: 0; border: 1px solid var(--el-border-color-light); background: var(--el-bg-color); border-radius: 12px; }
.history-activity { padding: 13px 8px 10px; }
.history-activity-heading { display: flex; justify-content: space-between; gap: 7px; margin: 0 8px 8px; color: var(--el-text-color-primary); }
.history-activity-heading span, .history-item-meta { color: var(--el-text-color-secondary); font-size: 11px; }
.history-activity ul { list-style: none; padding: 0; margin: 0 0 6px; }
.history-item { width: 100%; height: auto; min-height: 54px; padding: 9px 8px; justify-content: flex-start; border-radius: 8px; white-space: normal; text-align: left; }
.history-item :deep(> span) { width: 100%; display: flex; align-items: center; gap: 8px; }
.history-item-current { background: var(--el-color-primary-light-9); color: var(--el-color-primary); }
.history-item-content { flex: 1; min-width: 0; display: grid; gap: 3px; overflow-wrap: anywhere; }
.history-item-title { font-size: 13px; font-weight: 660; }
.history-item-summary { color: var(--el-text-color-regular); font-size: 12px; font-weight: 400; }
.history-item-meta { font-weight: 400; font-variant-numeric: tabular-nums; }
.history-item-dot { flex: 0 0 7px; height: 7px; border-radius: 50%; background: var(--el-color-info); }
.history-tone-success { background: var(--el-color-success); }
.history-tone-warning { background: var(--el-color-warning); }
.history-tone-danger { background: var(--el-color-danger); }
.history-detail, .history-comparison { padding: clamp(12px, 2.5vw, 20px); display: grid; gap: 17px; scroll-margin-top: 14px; }
.history-detail:focus { outline: 2px solid var(--el-color-primary-light-5); outline-offset: -2px; }
.history-byline { margin: 6px 0 0; color: var(--el-text-color-secondary); font-size: 12px; }
.history-reason { display: grid; gap: 6px; margin: 0; padding: 10px 12px; background: var(--el-fill-color-lighter); border-left: 3px solid var(--el-color-primary-light-5); overflow-wrap: anywhere; }
.history-fact-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); padding: 12px; background: var(--el-fill-color-lighter); border-radius: 8px; margin: 0; }
.history-filters { display: flex; gap: 8px 14px; align-items: flex-end; flex-wrap: wrap; }
.history-filters :deep(.el-form-item) { margin-bottom: 0; min-width: 145px; }
.history-filters :deep(.el-select) { min-width: 145px; }
.history-form-actions { display: flex; justify-content: flex-end; }
.history-evidence > div { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 8px; }
.history-evidence :deep(.el-button) { white-space: normal; text-align: left; height: auto; min-height: 26px; line-height: 1.45; }
@container (max-width: 730px) {
  .history-workspace { grid-template-columns: minmax(0, 1fr); }
  .history-heading { flex-wrap: wrap; }
  .history-controls { flex-basis: 100%; }
  .history-activity ul { max-height: 178px; overflow-y: auto; }
}
</style>

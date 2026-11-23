<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import type { FacetPage, FacetValue, GridFilter, GridSelection, GridSelectionRule } from "../../../../server/shared/types/contracts";

export type LoadFacetPage = (field: string, term: string, offset: number, limit: number,
  selection: GridSelection, signal: AbortSignal) => Promise<FacetPage>;

const props = defineProps<{
  label: string;
  field: string;
  selected?: GridFilter;
  sort?: "asc" | "desc" | "";
  hasSort: boolean;
  getValues: LoadFacetPage;
}>();
const emit = defineEmits<{
  apply: [field: string, selection: GridFilter | null];
  sort: [field: string, direction: "asc" | "desc" | ""];
  close: [];
}>();
const saved = props.selected;
const initialTerm = saved && !Array.isArray(saved) ? saved.term : "";
const term = ref(initialTerm);
const selection = shallowRef<GridSelection>(Array.isArray(saved)
  ? { all: false, term: "", rules: saved.map(value => ({ value, checked: true })) }
  : saved ?? { all: true, term: "", rules: [] });
const input = ref<{ focus: () => void }>();
const options = shallowRef<FacetPage["items"]>([]);
const counts = shallowRef({ total: 0, checked: 0, checkedRows: 0 });
const loading = ref(true);
const loadError = ref("");
let request: AbortController | undefined;
let delay: ReturnType<typeof setTimeout> | undefined;
const allChecked = computed(() => counts.value.total > 0 && counts.value.checked === counts.value.total);
const someChecked = computed(() => counts.value.checked > 0 && !allChecked.value);

async function load(mode: "first" | "more" | "summary") {
  clearTimeout(delay);
  request?.abort();
  const current = new AbortController();
  request = current;
  loading.value = true;
  loadError.value = "";
  try {
    const offset = mode === "more" ? options.value.length : 0;
    const page = await props.getValues(props.field, term.value, offset, mode === "summary" ? 0 : 100,
      selection.value, current.signal);
    if (current.signal.aborted) return;
    counts.value = { total: page.total, checked: page.checked, checkedRows: page.checkedRows };
    if (mode === "first") options.value = page.items;
    if (mode === "more") options.value = [...options.value, ...page.items];
  } catch (failure) {
    if (!current.signal.aborted) loadError.value = (failure as Error).message;
  } finally {
    if (!current.signal.aborted) loading.value = false;
  }
}

function setSelection(next: GridSelection, matches: (value: FacetValue) => boolean, checked: boolean) {
  if (next.rules.length >= 256 || encodeURIComponent(JSON.stringify(next)).length > 7500) {
    loadError.value = "当前筛选条件过长。请取消本次修改，或清除此列后缩小搜索范围。";
    return;
  }
  selection.value = next;
  options.value = options.value.map(item => matches(item.value) ? { ...item, checked } : item);
  void load("summary");
}

function append(rule: GridSelectionRule, matches: (value: FacetValue) => boolean) {
  const previous = selection.value;
  const rules = previous.rules.filter(item => "value" in rule
    ? !("value" in item && item.value === rule.value)
    : !("term" in item && item.term === rule.term && !item.outside));
  if (previous.term) rules.push({ term: previous.term, outside: true, checked: false });
  rules.push(rule);
  setSelection({ all: previous.all, term: "", rules }, matches, rule.checked);
}

function toggleAll(checked: boolean) {
  if (!term.value) setSelection({ all: checked, term: "", rules: [] }, () => true, checked);
  else append({ term: term.value, checked }, () => true);
}

function apply() {
  if (loading.value || loadError.value) return;
  if (counts.value.checked === 0) {
    emit("apply", props.field, counts.value.total === 0 && !term.value ? null : []);
    return;
  }
  if (allChecked.value) {
    emit("apply", props.field, term.value ? { all: true, rules: [], term: term.value } : null);
    return;
  }
  const current = selection.value;
  const rules = current.term && current.term !== term.value
    ? [...current.rules, { term: current.term, outside: true, checked: false }]
    : current.rules;
  emit("apply", props.field, { all: current.all, rules, term: term.value });
}

watch(term, () => {
  request?.abort();
  clearTimeout(delay);
  options.value = [];
  counts.value = { total: 0, checked: 0, checkedRows: 0 };
  loading.value = true;
  delay = setTimeout(() => void load("first"), 150);
}, { flush: "sync" });
onMounted(() => {
  input.value?.focus();
  void load("first");
});
onBeforeUnmount(() => {
  clearTimeout(delay);
  request?.abort();
});
</script>
<template>
  <div class="excel-filter-menu" role="dialog" :aria-label="label + '筛选与排序'" data-source-style="pms-20261028">
    <div class="excel-filter-head">
      <strong>{{ label }}</strong>
      <ElButton text :aria-label="'关闭' + label + '筛选'" @click="emit('close')">×</ElButton>
    </div>
    <div class="excel-filter-sorts">
      <ElButton text :type="sort === 'asc' ? 'primary' : 'default'" @click="emit('sort', field, 'asc')">↑ 升序排列</ElButton>
      <ElButton text :type="sort === 'desc' ? 'primary' : 'default'" @click="emit('sort', field, 'desc')">↓ 降序排列</ElButton>
      <ElButton text :disabled="!hasSort" @click="emit('sort', field, '')">清除排序</ElButton>
    </div>
    <div class="excel-filter-search">
      <ElInput ref="input" v-model="term" :aria-label="'搜索' + label + '候选值'" :maxlength="128"
        clearable placeholder="输入要筛选的内容…" @keydown.enter.prevent="apply" />
    </div>
    <div class="excel-filter-all">
      <ElCheckbox :model-value="allChecked" :indeterminate="someChecked"
        :disabled="!counts.total" @change="toggleAll(Boolean($event))">全选搜索结果</ElCheckbox>
      <span>{{ counts.total }} 项</span>
    </div>
    <div class="excel-filter-values" :aria-busy="loading">
      <div v-if="!options.length && !loadError" class="excel-filter-empty">{{ loading ? "正在加载…" : "无匹配值" }}</div>
      <div v-for="item in options" :key="JSON.stringify(item.value)" class="excel-filter-item">
        <ElCheckbox :model-value="item.checked" @change="append({ value: item.value, checked: Boolean($event) }, value => value === item.value)">
          <span :title="item.value ?? '(空值)'">{{ item.value === null ? '(空值)' : item.value }}</span>
        </ElCheckbox>
        <span class="excel-filter-count">{{ item.count }}</span>
      </div>
      <ElButton v-if="options.length < counts.total" text :loading="loading" @click="load('more')">加载更多候选值</ElButton>
    </div>
    <div class="excel-filter-summary" aria-live="polite">
      <template v-if="loadError"><span role="alert">{{ loadError }}</span> <ElButton link @click="load('first')">重新加载</ElButton></template>
      <template v-else>已选 {{ counts.checked }} 项 · 对应 {{ counts.checkedRows }} 行</template>
    </div>
    <div class="excel-filter-footer">
      <ElButton link type="primary" @click="emit('apply', field, null)">清除此列筛选</ElButton>
      <div class="excel-filter-footer-actions">
        <ElButton @click="emit('close')">取消</ElButton>
        <ElButton type="primary" :disabled="loading || Boolean(loadError)" @click="apply">确定</ElButton>
      </div>
    </div>
  </div>
</template>
<style scoped>
.excel-filter-menu {
  display: flex;
  flex-direction: column;
  width: min(330px, calc(100vw - 20px));
  max-height: calc(100dvh - 20px);
  background: var(--facet-surface);
  color: var(--facet-ink);
  border: 1px solid var(--facet-border);
  border-radius: 9px;
  box-shadow: 0 10px 40px var(--facet-shadow);
  overflow: auto;
  font-size: 12px;
}
.excel-filter-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 13px;
  border-bottom: 1px solid var(--facet-divider);
}
.excel-filter-head strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.excel-filter-head .el-button {
  --el-button-text-color: var(--facet-muted);
  min-height: 24px;
  height: 24px;
  font-size: 20px;
  padding: 0 4px;
}
.excel-filter-sorts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 3px;
  padding: 7px;
  border-bottom: 1px solid var(--facet-divider);
}
.excel-filter-sorts .el-button {
  --el-button-text-color: var(--facet-control);
  --el-button-hover-text-color: var(--facet-control);
  --el-fill-color-light: var(--facet-hover);
  justify-content: flex-start;
  margin: 0;
  border-radius: 4px;
  min-height: 32px;
  padding: 8px 9px;
  font-size: 12px;
  font-weight: 400;
}
.excel-filter-sorts .el-button.is-text:not(.is-disabled).el-button--primary {
  background: var(--facet-selected);
  color: var(--facet-accent);
}
.excel-filter-sorts .el-button:last-child {
  grid-column: 1 / -1;
  min-height: 23px;
  height: 23px;
  font-size: 11px;
}
.excel-filter-search { padding: 11px 12px 6px; }
.excel-filter-search .el-input {
  --el-input-bg-color: var(--facet-surface);
  --el-input-border-color: var(--facet-input);
  --el-input-hover-border-color: var(--facet-input);
  --el-input-focus-border-color: var(--facet-accent);
  --el-input-text-color: var(--facet-ink);
  --el-input-placeholder-color: var(--facet-muted);
  --el-input-height: 32px;
  font-size: 12px;
}
.excel-filter-search :deep(.el-input__wrapper) { border-radius: 5px; padding: 1px 9px; }
.excel-filter-all,
.excel-filter-item { display: flex; align-items: center; justify-content: space-between; gap: 7px; }
.excel-filter-all { padding: 8px 12px; font-size: 11px; color: var(--facet-muted); }
.excel-filter-all .el-checkbox { height: 19px; }
.excel-filter-all :deep(.el-checkbox__label) { font-size: 11px; }
.excel-filter-values { overflow: auto; min-height: 44px; max-height: 225px; margin: 0 8px; padding: 2px 3px; scrollbar-width: thin; }
.excel-filter-item { min-height: 29px; padding: 3px 2px; border-radius: 3px; }
.excel-filter-item:hover { background: var(--facet-hover); }
.excel-filter-menu .el-checkbox {
  --el-checkbox-text-color: var(--facet-control);
  --el-checkbox-checked-text-color: var(--facet-ink);
  --el-checkbox-checked-bg-color: var(--facet-action);
  --el-checkbox-checked-input-border-color: var(--facet-action);
  --el-checkbox-input-border-color: var(--facet-input);
  --el-checkbox-input-border-color-hover: var(--facet-action);
  --el-checkbox-bg-color: var(--facet-surface);
  min-width: 0;
  margin: 0;
}
.excel-filter-item .el-checkbox { height: 23px; }
.excel-filter-item :deep(.el-checkbox__label) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.excel-filter-count,
.excel-filter-empty,
.excel-filter-summary { color: var(--facet-muted); font-variant-numeric: tabular-nums; }
.excel-filter-count { font-size: 10px; }
.excel-filter-empty { padding: 8px 3px; }
.excel-filter-summary { min-height: 32px; padding: 9px 13px; font-size: 11px; }
.excel-filter-summary [role="alert"] { color: var(--el-color-danger); }
.excel-filter-footer {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 10px 12px;
  border-top: 1px solid var(--facet-divider);
  background: var(--facet-footer);
}
.excel-filter-footer > .el-button { margin-right: auto; color: var(--facet-accent); font-size: 11px; }
.excel-filter-footer-actions { display: flex; gap: 6px; }
.excel-filter-footer .el-button + .el-button { margin-left: 0; }
.excel-filter-footer-actions .el-button { min-height: 30px; height: 30px; padding: 7px 11px; font-size: 12px; }
.excel-filter-footer-actions .el-button--primary {
  --el-button-bg-color: var(--facet-action);
  --el-button-border-color: var(--facet-action);
  --el-button-hover-bg-color: var(--facet-action-hover);
  --el-button-hover-border-color: var(--facet-action-hover);
  --el-button-text-color: #fff;
  --el-button-hover-text-color: #fff;
}
</style>

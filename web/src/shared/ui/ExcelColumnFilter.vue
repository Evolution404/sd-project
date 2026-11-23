<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { ElMessage } from "element-plus";

export type FacetValue = string | null;
export interface FacetPage {
  items: { value: FacetValue; count: number }[];
  total: number;
  offset: number;
  limit: number;
}
const props = defineProps<{
  label: string;
  field: string;
  selected?: FacetValue[];
  sort?: "asc" | "desc" | "";
  getValues: (field: string, term: string, offset: number) => Promise<FacetPage>;
}>();
const emit = defineEmits<{
  (e: "apply", field: string, values: FacetValue[] | null): void;
  (e: "sort", field: string, direction: "asc" | "desc" | ""): void;
  (e: "close"): void;
}>();
const term = ref("");
const options = ref<FacetPage["items"]>([]);
const total = ref(0);
const loading = ref(false);
const selection = ref<FacetValue[]>([]);
const unrestricted = ref(true);
let request = 0;
const known = computed(() => new Set(selection.value));
const visible = computed(() => options.value);
const selectedCount = computed(() => unrestricted.value ? total.value :
  options.value.filter(item => known.value.has(item.value)).reduce((sum, item) => sum + item.count, 0));
function checked(value: FacetValue) {
  return unrestricted.value || known.value.has(value);
}
async function load(reset = false) {
  const seq = ++request;
  if (reset) options.value = [];
  const offset = options.value.length;
  loading.value = true;
  try {
    const page = await props.getValues(props.field, term.value, offset);
    if (seq !== request) return;
    total.value = page.total;
    options.value = [...options.value, ...page.items];
  } catch (failure) {
    if (seq === request) ElMessage.error((failure as Error).message);
  } finally {
    if (seq === request) loading.value = false;
  }
}
async function ensureAll() {
  let values = [...options.value];
  if (total.value > 256) {
    ElMessage.warning("候选值超过256项，请先搜索收窄范围后再批量选择");
    return null;
  }
  while (values.length < total.value) {
    const page = await props.getValues(props.field, term.value, values.length);
    if (!page.items.length) break;
    values = values.concat(page.items);
  }
  return values;
}
async function toggle(value: FacetValue, yes: boolean) {
  if (unrestricted.value) {
    const all = await props.getValues(props.field, "", 0);
    if (all.total > 256) {
      ElMessage.warning("当前列候选值过多，请先搜索，再按具体候选值筛选");
      return;
    }
    let values = all.items;
    while (values.length < all.total) {
      const next = await props.getValues(props.field, "", values.length);
      if (!next.items.length) return;
      values = values.concat(next.items);
    }
    selection.value = values.map(item => item.value);
    unrestricted.value = false;
  }
  if (yes) selection.value = [...new Set([...selection.value, value])];
  else selection.value = selection.value.filter(item => item !== value);
}
const allVisible = computed(() => visible.value.length > 0 && visible.value.every(item => checked(item.value)));
const partialVisible = computed(() => visible.value.some(item => checked(item.value)) && !allVisible.value);
async function toggleAll(yes: boolean) {
  if (!yes && unrestricted.value) {
    const all = await props.getValues(props.field, "", 0);
    if (all.total > 256) {
      ElMessage.warning("当前列候选值过多，请缩小搜索范围");
      return;
    }
    let values = all.items;
    while (values.length < all.total) {
      const next = await props.getValues(props.field, "", values.length);
      if (!next.items.length) return;
      values = values.concat(next.items);
    }
    selection.value = values.map(item => item.value);
    unrestricted.value = false;
  }
  if (yes) {
    const matches = await ensureAll();
    if (!matches) return;
    selection.value = [...new Set([...selection.value, ...matches.map(item => item.value)])];
    unrestricted.value = false;
  } else {
    selection.value = selection.value.filter(value => !options.value.some(item => item.value === value));
    // Search with more than one page: remove all matching values, not just first page.
    if (total.value > options.value.length) {
      const matches = await ensureAll();
      if (matches) selection.value = selection.value.filter(value => !matches.some(item => item.value === value));
    }
  }
}
function apply() {
  emit("apply", props.field, unrestricted.value ? null : [...selection.value]);
}
function reset() {
  emit("apply", props.field, null);
}
watch(term, () => { void load(true); });
watch(() => props.field, () => { request++; term.value = ""; }, { flush: "sync" });
watch(() => props.selected, value => {
  unrestricted.value = value === undefined;
  selection.value = [...(value ?? [])];
}, { immediate: true, deep: true });
void nextTick(() => load(true));
</script>
<template>
  <div class="excel-filter-menu" role="dialog" :aria-label="label + '筛选与排序'">
    <div class="excel-filter-head">
      <strong>{{ label }}</strong>
      <ElButton text :aria-label="'关闭' + label + '筛选'" @click="emit('close')">✕</ElButton>
    </div>
    <div class="excel-filter-sorts">
      <ElButton text :type="sort === 'asc' ? 'primary' : 'default'" @click="emit('sort',field,'asc')">↑ 升序排列</ElButton>
      <ElButton text :type="sort === 'desc' ? 'primary' : 'default'" @click="emit('sort',field,'desc')">↓ 降序排列</ElButton>
      <ElButton text :disabled="!sort" @click="emit('sort',field,'')">清除排序</ElButton>
    </div>
    <div class="excel-filter-body">
      <ElInput v-model="term" :aria-label="'搜索' + label + '候选值'" clearable placeholder="输入要筛选的内容..." />
      <div class="excel-filter-all">
        <ElCheckbox :model-value="allVisible" :indeterminate="partialVisible"
          @change="toggleAll(Boolean($event))">全选搜索结果</ElCheckbox>
        <span>{{ total }} 项</span>
      </div>
      <div class="excel-filter-values">
        <div v-if="!loading && !options.length" class="excel-filter-empty">无匹配值</div>
        <div v-for="item in options" :key="item.value ?? '__empty__'" class="excel-filter-item">
          <ElCheckbox :model-value="checked(item.value)" @change="toggle(item.value,Boolean($event))">
            <span :title="item.value ?? '(空值)'">{{ item.value === null ? '(空值)' : item.value }}</span>
          </ElCheckbox>
          <span class="excel-filter-count">{{ item.count }}</span>
        </div>
        <ElButton v-if="options.length < total" text :loading="loading" @click="load()">加载更多候选值</ElButton>
      </div>
      <div class="excel-filter-summary">
        {{ unrestricted ? '未限制候选值' : '已选 ' + selection.length + ' 项' }} · 当前候选对应 {{ selectedCount }} 行
      </div>
    </div>
    <div class="excel-filter-footer">
      <ElButton link type="primary" @click="reset">清除此列筛选</ElButton>
      <div class="excel-filter-footer-actions">
        <ElButton @click="emit('close')">取消</ElButton>
        <ElButton type="primary" @click="apply">确定</ElButton>
      </div>
    </div>
  </div>
</template>
<style scoped>
.excel-filter-menu{width:min(330px,calc(100vw - 22px));background:var(--surface);color:var(--ink);border:1px solid var(--edge);box-shadow:0 10px 36px rgba(21,36,53,.16);border-radius:10px;overflow:hidden;font-size:14px}
.excel-filter-head{display:flex;justify-content:space-between;align-items:center;padding:13px 14px;border-bottom:1px solid var(--edge)}
.excel-filter-sorts{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:10px;border-bottom:1px solid var(--edge)}
.excel-filter-sorts .el-button{justify-content:flex-start;margin:0}
.excel-filter-sorts .el-button:nth-child(3){grid-column:1/-1}
.excel-filter-body{padding:10px 12px 6px}
.excel-filter-all,.excel-filter-item{display:flex;align-items:center;justify-content:space-between;gap:12px}
.excel-filter-all{padding:11px 2px 7px;color:var(--muted);font-size:12px}
.excel-filter-values{overflow-y:auto;height:200px;max-height:30vh;scrollbar-width:thin}
.excel-filter-item{min-height:31px}
.excel-filter-item .el-checkbox{min-width:0}
.excel-filter-item :deep(.el-checkbox__label){overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.excel-filter-count,.excel-filter-summary{color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}
.excel-filter-empty{color:var(--muted);padding:12px 0}
.excel-filter-summary{padding:10px 1px}
.excel-filter-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;padding:12px;border-top:1px solid var(--edge);background:var(--surface-subtle)}
.excel-filter-footer-actions{display:flex;gap:6px}
.excel-filter-footer .el-button+.el-button{margin-left:0}
</style>

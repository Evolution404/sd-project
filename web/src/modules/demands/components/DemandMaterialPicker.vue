<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { newClientId } from "../../../shared/utils/id";
import { api } from "../../../shared/api/client";
import { readCurrentMaterialPrecision } from "../../../shared/api/quantity-precision";
import type { Page } from "../../../../../server/shared/types/contracts";
import type { MaterialRecord } from "../../../../../server/shared/types/master-data";
import type { MaterialDraft } from "../types/demand";
import BusinessTable, { type TableColumn } from "../../../shared/ui/BusinessTable.vue";

const props = defineProps<{ open: boolean; existing: MaterialDraft[] }>();
const emit = defineEmits<{
  "update:open": [value: boolean];
  add: [rows: MaterialDraft[]];
}>();

const query = ref("");
const appliedQuery = ref("");
const page = ref(1);
const total = ref(0);
const candidates = ref<MaterialRecord[]>([]);
const loading = ref(false);
const saving = ref(false);
const sort = ref("");
const direction = ref<"asc" | "desc">("asc");
const filters = ref<Record<string, string>>({});
const chosen = ref<Record<string, MaterialRecord>>({});
let requestSeq = 0;
const pageSize = 30;
const columns: TableColumn[] = [
  {key:"selected",label:"选择",minWidth:94,customHeader:true,sortable:false,filterable:false,hideable:false},
  {key:"name",label:"物资名称",minWidth:220,sortable:true,filterable:true},
  {key:"model",label:"型号",minWidth:180,sortable:true,filterable:true},
  {key:"specification",label:"规格",minWidth:200,sortable:true,filterable:true},
  {key:"unit_id_label",label:"计量单位",minWidth:150,sortable:true,filterable:true},
];
const existingIds = computed(() => new Set(props.existing.map(row => row.material_id)));
const available = computed(() => candidates.value.filter(row => !existingIds.value.has(row.id) && row.status === "active" && !row.deleted));
const selectedCount = computed(() => Object.keys(chosen.value).length);
const preview = computed(() => Object.values(chosen.value).slice(0, 18));
const selectedInPage = computed(() => available.value.filter(row => !!chosen.value[row.id]).length);
const pageAll = computed(() => available.value.length > 0 && selectedInPage.value === available.value.length);
const partlySelected = computed(() => selectedInPage.value > 0 && !pageAll.value);

watch(() => props.open, open => {
  ++requestSeq;
  if (!open) return;
  query.value = "";
  appliedQuery.value = "";
  page.value = 1;
  sort.value = "";
  direction.value = "asc";
  filters.value = {};
  chosen.value = {};
  candidates.value = [];
  total.value = 0;
  void load();
});

function applySearch() {
  const q = query.value.trim();
  if (q !== appliedQuery.value) appliedQuery.value = q;
  page.value = 1;
  void load();
}
function tableSort(value: { key: string; order: string }) {
  sort.value = columns.some(col => col.key === value.key && col.sortable)
    ? value.key : "";
  direction.value = value.order === "descending" ? "desc" : "asc";
  page.value = 1;
  void load();
}
function tableFilter(value: Record<string, string>) {
  filters.value = Object.fromEntries(Object.entries(value)
    .filter(([key, val]) => columns.some(col => col.key === key && col.filterable) && val?.trim()));
  page.value = 1;
  void load();
}
async function load() {
  const seq = ++requestSeq;
  loading.value = true;
  try {
    const params = new URLSearchParams({
      page: String(page.value), page_size: String(pageSize), q: appliedQuery.value,
      deleted:"false", sort: sort.value || "name", direction: direction.value,
      filters: JSON.stringify({status:"active",...filters.value}),
    });
    const result = await api<Page<MaterialRecord>>("/catalog/materials?" + params);
    if (seq !== requestSeq || !props.open) return;
    candidates.value = result.items;
    total.value = result.total;
  } catch (error) {
    if (seq === requestSeq) {
      candidates.value = [];
      total.value = 0;
      ElMessage.error("查询物资台账失败：" + (error as Error).message);
    }
  } finally {
    if (seq === requestSeq) loading.value = false;
  }
}
function choose(row: MaterialRecord, active: boolean) {
  if (saving.value || loading.value || existingIds.value.has(row.id) || row.status !== "active" || row.deleted) return;
  if (active) chosen.value[row.id] = row;
  else delete chosen.value[row.id];
}
function choosePage(active: boolean) {
  available.value.forEach(row => choose(row, active));
}
async function add() {
  if (!selectedCount.value || saving.value) return;
  saving.value = true;
  try {
    // Preflight every material's current identity and unit precision, then
    // atomically add all selected rows to the parent editor's in-memory draft.
    const items = await Promise.all(Object.values(chosen.value).map(async selected => {
      if (existingIds.value.has(selected.id)) throw Error(selected.name + " 已在当前需求中");
      const item = await api<MaterialRecord>("/catalog/materials/" + selected.id);
      if (item.deleted || item.status !== "active") throw Error(item.name + " 已停用或删除，不能新增选用");
      const precision = await readCurrentMaterialPrecision(item.id);
      const draft: MaterialDraft = {
        id:newClientId(), material_id:item.id, name:item.name,
        model:item.model, specification:item.specification,
        unit:item.unit_id_label, quantity_scaled:10000, precision,
      };
      return draft;
    }));
    emit("add", items);
    emit("update:open", false);
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <ElDialog
    :model-value="open"
    title="添加预计物资"
    width="min(1100px,96vw)"
    append-to-body
    :close-on-click-modal="false"
    :close-on-press-escape="!saving"
    :show-close="!saving"
    @update:model-value="value => { if (!value && !saving) emit('update:open',false); }"
  >
    <div class="material-picker-search">
      <ElInput v-model="query" clearable placeholder="按物资名称、型号、规格或计量单位搜索"
        :disabled="saving" @keyup.enter="applySearch" @change="applySearch" />
      <ElButton type="primary" plain :loading="loading" @click="applySearch">查询</ElButton>
      <ElButton :disabled="loading || saving || !available.length" @click="choosePage(true)">全选本页</ElButton>
      <ElButton :disabled="loading || saving || !selectedCount" @click="choosePage(false)">取消本页选择</ElButton>
    </div>
    <p class="muted material-picker-hint">
      可点击表头筛选物资名称、型号、规格和计量单位；翻页及修改查询不会丢失之前的选择。
      已经添加到当前需求的物资不可重复选择，已停用或删除的物资不会显示。
    </p>
    <BusinessTable
      :rows="candidates"
      :columns="columns"
      table-key="demand:material-picker"
      :max-height="380"
      :actions-width="0"
      :loading="loading"
      sort-mode="remote"
      filter-mode="remote"
      :filter-state="filters"
      :sort-state="{prop:sort,order:sort ? (direction === 'asc' ? 'ascending' : 'descending') : null}"
      @sort-change="tableSort"
      @filter-change="tableFilter"
    >
      <template #header="{ column }">
        <ElCheckbox v-if="column.key === 'selected'" :model-value="pageAll"
          :indeterminate="partlySelected" :disabled="!available.length || loading || saving"
          :aria-label="pageAll ? '取消全选本页物资' : '全选本页物资'"
          @change="choosePage(Boolean($event))">{{ pageAll ? "取消本页" : "全选本页" }}</ElCheckbox>
      </template>
      <template #cell="{row,column,value}">
        <ElCheckbox v-if="column.key === 'selected'"
          :model-value="!!chosen[row.id] || existingIds.has(row.id)"
          :disabled="loading || saving || existingIds.has(row.id) || row.status !== 'active' || row.deleted"
          :aria-label="'选择物资：' + row.name + ' ' + row.model"
          @change="choose(row,Boolean($event))" />
        <span v-else-if="column.key === 'name'">
          {{ row.name }}
          <ElTag v-if="existingIds.has(row.id)" size="small" type="info" effect="plain">已添加</ElTag>
        </span>
        <span v-else>{{ value || "—" }}</span>
      </template>
    </BusinessTable>
    <div class="material-picker-pager">
      <span class="muted">当前条件下共 {{ total }} 项可用物资</span>
      <ElPagination v-model:current-page="page" :page-size="pageSize" :total="total"
        layout="prev, pager, next, total" :disabled="saving || loading" @current-change="load" />
    </div>
    <div class="material-picker-selected">
      <div class="material-picker-selected-heading">
        <strong>已选 {{ selectedCount }} 种物资</strong>
        <ElButton v-if="selectedCount" text type="primary" :disabled="saving" @click="chosen = {}">清空全部选择</ElButton>
      </div>
      <div class="material-picker-tags">
        <ElTag v-for="item in preview" :key="item.id" closable :disable-transitions="true"
          @close="delete chosen[item.id]">{{ item.name }}{{ item.model ? ' · ' + item.model : '' }}</ElTag>
        <span v-if="selectedCount > preview.length" class="muted">另有 {{ selectedCount - preview.length }} 种已保留</span>
      </div>
      <p v-if="!selectedCount" class="muted">在上方表格勾选需要的物资；可分多次查询和翻页后统一添加。</p>
    </div>
    <template #footer>
      <span class="muted material-picker-footer-note">添加后可在需求表格中逐项修改预计数量</span>
      <ElButton :disabled="saving" @click="emit('update:open',false)">取消</ElButton>
      <ElButton data-guide-action="demands.material-add-confirm" type="primary"
        :loading="saving" :disabled="!selectedCount || loading || saving" @click="add">添加已选物资（{{selectedCount}}）</ElButton>
    </template>
  </ElDialog>
</template>
<style scoped>
.material-picker-search{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.material-picker-search>.el-input{flex:1 1 270px;min-width:210px;max-width:480px}
.material-picker-search>.el-button+.el-button{margin-left:0}
.material-picker-hint{font-size:12px;line-height:1.6;margin:8px 0 12px}
.material-picker-pager{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:12px 0}
.material-picker-selected{border:1px solid var(--edge);border-radius:12px;padding:12px 14px;background:var(--surface-subtle);margin-top:10px}
.material-picker-selected-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px}
.material-picker-selected-heading strong{font-size:13px}
.material-picker-tags{display:flex;gap:7px;flex-wrap:wrap;align-items:center}
.material-picker-selected p{font-size:12px;margin:0}
.material-picker-footer-note{font-size:12px;margin-right:auto}
@media(max-width:680px){.material-picker-footer-note{flex-basis:100%}.material-picker-search>.el-input{max-width:none}}
</style>

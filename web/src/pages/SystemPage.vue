<script setup lang="ts">
import { useRoute, useRouter } from "vue-router";
import { useListRoute } from "../services/page-navigation";
const route = useRoute(), router = useRouter();
import RowActions from "../components/RowActions.vue";
import { ref, onMounted, computed, watch } from "vue";
import BusinessTable, { type TableColumn } from "../components/BusinessTable.vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { api, statusText, type Row } from "../services/api";
const tab = computed({
  get: () => String(route.params.tab || 'users'),
  set: value => { void router.push({ name: 'system', params: { tab: value }, query: {} }); },
});
const
  rows = ref<Row[]>([]),
  total = ref(0),
  page = ref(1),
  sortKey = ref(""),
  sortDirection = ref("desc"),
  columnFilters = ref<Record<string, string>>({}),
  dialog = ref(false),
  form = ref<Row>({}),
  editing = ref<Row | null>(null);
const tableColumns = computed<TableColumn[]>(() => {
  if (tab.value === "users") return [
    { key: "username", label: "账号", minWidth: 170 },
    { key: "role", label: "角色" },
    { key: "status", label: "状态" },
  ];
  if (tab.value === "ips") return [
    { key: "ip", label: "IP 地址", minWidth: 180 },
    { key: "note", label: "说明", minWidth: 220 },
  ];
  return [
    { key: "created_at", label: "登记时间", minWidth: 190 },
    { key: "entity", label: "业务对象" },
    { key: "action", label: "动作" },
    { key: "actor_username", label: "操作人", minWidth: 190 },
  ];
});
watch(tab, () => {
  void load();
});
function tableSort(value: { key: string; order: string }) {
  sortKey.value = value.key;
  sortDirection.value = value.order === "ascending" ? "asc" : "desc";
  page.value = 1;
  load();
}
function tableFilter(value: Record<string, string>) {
  columnFilters.value = value;
  page.value = 1;
  load();
}
async function load() {
  const q = new URLSearchParams({
    page_size: "30", page: String(page.value),
    sort: sortKey.value || "created_at", direction: sortDirection.value,
    filters: JSON.stringify(columnFilters.value),
  });
  const response = await api("/" + tab.value + "?" + q.toString());
  rows.value = response.items;
  total.value = response.total;
}
function edit(row?: Row) {
  editing.value = row || null;
  form.value = row
    ? { ...row, password: "" }
    : {
        username: "",
        password: "",
        role: "viewer",
        status: "active",
        ip: "",
        note: "",
      };
  dialog.value = true;
}
async function save() {
  try {
    await api(
      "/" + tab.value + (editing.value ? "/" + editing.value.id : ""),
      "POST",
      form.value,
    );
    dialog.value = false;
    await load();
  } catch (e) {
    ElMessage.error((e as Error).message);
  }
}
async function remove(row: Row) {
  try {
    await ElMessageBox.confirm(
      "删除后正常列表移除，原始身份和历史保留。",
      "确认删除",
    );
    await api("/" + tab.value + "/" + row.id, "DELETE", {});
    await load();
  } catch (e) {
    if (e instanceof Error) ElMessage.error(e.message);
  }
}
useListRoute({ page, sort: sortKey, direction: sortDirection, filters: columnFilters }, load);
onMounted(load);
</script>
<template>
  <div class="page-heading">
    <div>
      <div class="section-caption">系统管理</div>
      <h1>系统管理</h1>
      <p>账号角色、内网访问与操作审计。</p>
    </div>
    <div class="page-heading-actions">
      <ElButton v-if="tab !== 'audit'" type="primary" @click="edit()">新增</ElButton>
    </div>
  </div>
  <ElTabs v-model="tab"
    ><ElTabPane label="用户与角色" name="users" /><ElTabPane
      label="IP白名单"
      name="ips" /><ElTabPane label="操作审计" name="audit"
  /></ElTabs>
  <div class="panel">
    <BusinessTable :rows="rows" :columns="tableColumns" :table-key="'system:' + tab" :filter-state="columnFilters"
        :sort-state="{ prop: sortKey, order: sortKey ? (sortDirection === 'asc' ? 'ascending' : 'descending') : null }"
      @sort-change="tableSort" @filter-change="tableFilter">
      <template #cell="{ row, column }">
        <span v-if="['role','status','action'].includes(column.key)">{{ statusText[row[column.key]] || row[column.key] || '—' }}</span>
        <span v-else>{{ row[column.key] ?? '—' }}</span>
      </template>
      <template v-if="tab !== 'audit'" #actions="{ row }">
        <RowActions :actions="[
          { label: '编辑', run: () => edit(row) },
          { label: '删除', danger: true, run: () => remove(row) },
        ]" />
      </template>
    </BusinessTable>
    <ElPagination v-model:current-page="page" :page-size="30" :total="total"
      layout="prev,pager,next,total" @current-change="load" />
  </div>
  <ElDialog
    v-model="dialog"
    :title="
      tab === 'users' ? '用户账号' : tab === 'ips' ? 'IP授权' : '审计说明'
    "
    width="620px"
    ><ElForm :model="form" label-position="top" novalidate
      ><template v-if="tab === 'users'"
        ><ElFormItem label="用户名" required
          ><ElInput v-model="form.username" /></ElFormItem
        ><ElFormItem label="密码（编辑留空保持）" :required="!editing"
          ><ElInput v-model="form.password" type="password" /></ElFormItem
        ><ElFormItem label="角色" required
          ><ElSelect v-model="form.role"
            ><ElOption label="管理员" value="admin" /><ElOption
              label="编辑人员"
              value="editor" /><ElOption
              label="审核人员"
              value="verifier" /><ElOption
              label="只读人员"
              value="viewer" /></ElSelect></ElFormItem
        ><ElFormItem label="账号状态"
          ><ElSelect v-model="form.status"
            ><ElOption label="启用" value="active" /><ElOption
              label="禁用"
              value="disabled" /></ElSelect></ElFormItem></template
      ><template v-else-if="tab === 'ips'"
        ><ElFormItem label="完整IP地址" required
          ><ElInput v-model="form.ip" /></ElFormItem
        ><ElFormItem label="说明"
          ><ElInput v-model="form.note" /></ElFormItem></template
      ><template v-else
        ><ElFormItem label="手工记录或纠错说明" required
          ><ElInput
            v-model="form.message"
            type="textarea" /></ElFormItem></template></ElForm
    ><template #footer
      ><ElButton @click="dialog = false">取消</ElButton
      ><ElButton type="primary" @click="save">保存</ElButton></template
    ></ElDialog
  >
</template>

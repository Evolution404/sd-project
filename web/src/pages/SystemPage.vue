<script setup lang="ts">
import { useRoute, useRouter } from "vue-router";
import { useListRoute } from "../services/page-navigation";
import { useDialogDraftGuard } from "../services/dialog-draft";
import { useAccess } from "../services/access";
const route = useRoute(), router = useRouter();
import RowActions from "../components/RowActions.vue";
import { ref, onMounted, computed, watch } from "vue";
import BusinessTable, { type TableColumn } from "../components/BusinessTable.vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { api, statusText, type Row } from "../services/api";
const can = useAccess();
const tab = computed({
  get: () => String(route.params.tab || 'users'),
  set: value => { void router.push({ name: 'system', params: { tab: value }, query: {} }); },
});
const
  rows = ref<Row[]>([]),
  listLoading = ref(false),
  total = ref(0),
  page = ref(1),
  sortKey = ref(""),
  sortDirection = ref("desc"),
  columnFilters = ref<Record<string, string>>({}),
  dialog = ref(false),
  saving = ref(false),
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
let loadSequence = 0;
async function load() {
  const sequence = ++loadSequence;
  listLoading.value = true;
  try {
    const q = new URLSearchParams({
      page_size: "30", page: String(page.value),
      sort: sortKey.value || "created_at", direction: sortDirection.value,
      filters: JSON.stringify(columnFilters.value),
    });
    const response = await api("/" + tab.value + "?" + q.toString());
    if (sequence !== loadSequence) return;
    rows.value = response.items;
    total.value = response.total;
  } catch (error) {
    if (sequence === loadSequence) ElMessage.error((error as Error).message);
  } finally {
    if (sequence === loadSequence) listLoading.value = false;
  }
}
const formRef = ref();
const formErrors = ref<Row>({});
const draftGuard = useDialogDraftGuard(() => form.value);
function closeEditor() { void draftGuard.confirmClose(() => { dialog.value = false; }); }
function beforeEditorClose(done: () => void) { void draftGuard.confirmClose(done); }
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
  formErrors.value = {};
  dialog.value = true;
  draftGuard.capture();
}
async function save() {
  if (saving.value) return;
  saving.value = true;
  try {
    if (!(await formRef.value?.validate().catch(() => false))) {
      ElMessage.warning("请先完善必填信息");
      return;
    }
    await api(
      "/" + tab.value + (editing.value ? "/" + editing.value.id : ""),
      "POST",
      form.value,
    );
    ElMessage.success("系统管理数据已保存，正在刷新列表");
    await load();
    dialog.value = false;
  } catch (e) {
    formErrors.value = (e as Row).fields || {};
    ElMessage.error((e as Error).message);
  } finally {
    saving.value = false;
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
      <ElButton v-if="tab !== 'audit'" type="primary" :disabled="!can('admin')" @click="edit()">{{ tab === 'users' ? '新增用户' : '新增授权IP' }}</ElButton>
    </div>
  </div>
  <ElTabs v-model="tab"
    ><ElTabPane label="用户与角色" name="users" /><ElTabPane
      label="IP白名单"
      name="ips" /><ElTabPane label="操作审计" name="audit"
  /></ElTabs>
  <div class="panel">
    <BusinessTable :loading="listLoading" :rows="rows" :columns="tableColumns" :table-key="'system:' + tab" :filter-state="columnFilters"
        :sort-state="{ prop: sortKey, order: sortKey ? (sortDirection === 'asc' ? 'ascending' : 'descending') : null }"
      @sort-change="tableSort" @filter-change="tableFilter">
      <template #cell="{ row, column }">
        <span v-if="['role','status','action'].includes(column.key)">{{ statusText[row[column.key]] || row[column.key] || '—' }}</span>
        <span v-else>{{ row[column.key] ?? '—' }}</span>
      </template>
      <template v-if="tab !== 'audit'" #actions="{ row }">
        <RowActions :actions="[
          { label: '编辑', disabled: !can('admin'), run: () => edit(row) },
          { label: '删除', danger: true, disabled: !can('admin'), run: () => remove(row) },
        ]" />
      </template>
    </BusinessTable>
    <ElPagination v-model:current-page="page" :page-size="30" :total="total"
      layout="prev,pager,next,total" @current-change="load" />
  </div>
  <ElDialog append-to-body
    v-model="dialog"
    :title="(editing ? '编辑' : '新增') + (tab === 'users' ? '用户账号' : 'IP授权')"
    width="620px" :before-close="beforeEditorClose" :close-on-click-modal="false"
    ><ElForm ref="formRef" :model="form" label-position="top" novalidate
      ><template v-if="tab === 'users'"
        ><ElFormItem label="用户名" prop="username" :error="formErrors.username"
          :rules="[{ required: true, message: '请填写用户名', trigger: 'blur' }]" required
          ><ElInput v-model="form.username" /></ElFormItem
        ><ElFormItem :label="editing ? '新密码（不修改请留空）' : '初始密码'" prop="password"
          :error="formErrors.password"
          :rules="editing ? [] : [{ required: true, message: '请填写初始密码', trigger: 'blur' }]"
          :required="!editing"
          ><ElInput v-model="form.password" type="password" /></ElFormItem
        ><ElFormItem label="角色" prop="role" :rules="[{ required: true, message: '请选择角色' }]" required
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
        ><ElFormItem label="完整IP地址" prop="ip" :error="formErrors.ip"
          :rules="[{ required: true, message: '请填写IP地址', trigger: 'blur' }]" required
          ><ElInput v-model="form.ip" placeholder="例如 192.168.1.20（单个IP，不使用网段）" /></ElFormItem
        ><ElFormItem label="说明"
          ><ElInput v-model="form.note" /></ElFormItem></template
      ><template v-else
        ><ElFormItem label="手工记录或纠错说明" required
          ><ElInput
            v-model="form.message"
            type="textarea" /></ElFormItem></template></ElForm
    ><template #footer
      ><ElButton @click="closeEditor">取消</ElButton
      ><ElButton type="primary" :loading="saving" @click="save">保存</ElButton></template
    ></ElDialog
  >
</template>

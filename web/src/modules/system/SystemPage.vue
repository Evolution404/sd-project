<script setup lang="ts">
import BusinessDetailDialog from "../../shared/ui/BusinessDetailDialog.vue";
import BusinessHistory from "../../shared/ui/BusinessHistory.vue";
import { useRoute, useRouter } from "vue-router";
import { useListRoute } from "../../shared/composables/use-list-route";
import { useDialogDraftGuard } from "../../shared/forms/use-dialog-draft";
import { useAccess } from "../../shared/composables/use-access";
const route = useRoute(), router = useRouter();
import AccessLogs from "./AccessLogs.vue";
import RowActions from "../../shared/ui/RowActions.vue";
import { ref, onMounted, computed, watch } from "vue";
import BusinessTable, { type TableColumn } from "../../shared/ui/BusinessTable.vue";
import { formatVisibleDateTime } from "../../shared/utils/datetime";
import { ElMessage, ElMessageBox } from "element-plus";
import { api, statusText, type Row } from "../../shared/api/client";
const can = useAccess();
interface SystemRow extends Row {
  id:string;
  username?:string;
  password?:string;
  role?:string;
  status?:string;
  ip?:string;
  note?:string;
  message?:string;
}
interface AccessPolicy {
  ip_restriction_enabled: boolean;
  version: number;
  updated_at: string | null;
}
const accessPolicy = ref<AccessPolicy | null>(null);
const policyLoading = ref(false);
const policySaving = ref(false);
let policyRequest = 0;
async function loadAccessPolicy() {
  const sequence = ++policyRequest;
  policyLoading.value = true;
  try {
    const policy = await api<AccessPolicy>("/access-policy");
    if (sequence === policyRequest) accessPolicy.value = policy;
  } catch (error) {
    if (sequence === policyRequest) ElMessage.error((error as Error).message);
  } finally {
    if (sequence === policyRequest) policyLoading.value = false;
  }
}
async function changeIpRestriction(enabled: string | number | boolean) {
  if (!accessPolicy.value || policySaving.value || typeof enabled !== "boolean") return;
  if (enabled) {
    try {
      await ElMessageBox.confirm(
        "开启后，仅允许已配置的IP地址及服务器本机访问。请先确认当前电脑的IP已添加至白名单，否则可能无法继续远程访问。",
        "确认开启访问限制",
        { type: "warning", confirmButtonText: "确认开启", cancelButtonText: "取消" },
      );
    } catch { return; }
  }
  policySaving.value = true;
  try {
    accessPolicy.value = await api<AccessPolicy>("/access-policy", "POST", {
      ip_restriction_enabled: enabled,
      expected_version: accessPolicy.value.version,
    });
    ElMessage.success(enabled ? "访问限制已开启" : "访问限制已关闭");
  } catch (error) {
    ElMessage.error((error as Error).message);
    await loadAccessPolicy();
  } finally {
    policySaving.value = false;
  }
}
const tab = computed({
  get: () => String(route.params.tab || 'users'),
  set: value => { void router.push({ name: 'system', params: { tab: value }, query: {} }); },
});
const
  rows = ref<SystemRow[]>([]),
  listLoading = ref(false),
  total = ref(0),
  page = ref(1),
  sortKey = ref(""),
  sortDirection = ref("desc"),
  columnFilters = ref<Record<string, string>>({}),
  dialog = ref(false),
  saving = ref(false),
  form = ref<Partial<SystemRow>>({}),
  editing = ref<SystemRow | null>(null);
const selectedAudit = ref<SystemRow | null>(null);
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
  if (tab.value === "ips") void loadAccessPolicy();
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
  if (tab.value === "access-logs") return;
  const sequence = ++loadSequence;
  listLoading.value = true;
  try {
    const q = new URLSearchParams({
      page_size: "30", page: String(page.value),
      sort: sortKey.value || "created_at", direction: sortDirection.value,
      filters: JSON.stringify(columnFilters.value),
    });
    const response = await api<{ items: SystemRow[]; total: number }>("/" + tab.value + "?" + q.toString());
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
const formErrors = ref<Record<string,string>>({});
const draftGuard = useDialogDraftGuard(() => form.value);
function closeEditor() { void draftGuard.confirmClose(() => { dialog.value = false; }); }
function beforeEditorClose(done: () => void) { void draftGuard.confirmClose(done); }
function edit(row?: SystemRow) {
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
    formErrors.value = (e as {fields?:Record<string,string>}).fields || {};
    ElMessage.error((e as Error).message);
  } finally {
    saving.value = false;
  }
}
async function remove(row: SystemRow) {
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
onMounted(() => {
  void load();
  if (tab.value === "ips") void loadAccessPolicy();
});
</script>
<template>
  <div class="page-heading">
    <div>
      <div class="section-caption">系统管理</div>
      <h1>系统管理</h1>
      <p>账号角色、内网访问、操作审计与访问日志。</p>
    </div>

  </div>
  <ElTabs v-model="tab"
    ><ElTabPane label="用户与角色" name="users" /><ElTabPane
      label="IP白名单"
      name="ips" /><ElTabPane label="操作审计" name="audit" /><ElTabPane label="访问日志" name="access-logs"
  /></ElTabs>
  <div v-if="tab === 'ips'" class="panel access-policy-settings">
    <div class="access-policy-row">
      <div>
        <strong>访问限制</strong>
        <p>开启后，仅允许白名单中的IP及服务器本机访问；关闭后不限制访问IP，仍须正常登录。</p>
      </div>
      <ElSwitch data-guide-action="system.ip"
        :model-value="accessPolicy?.ip_restriction_enabled ?? true"
        :loading="policyLoading || policySaving"
        :disabled="!can('admin') || !accessPolicy || policyLoading || policySaving"
        active-text="开启"
        inactive-text="关闭"
        aria-label="访问限制"
        @change="changeIpRestriction"
      />
    </div>
  </div>
  <AccessLogs v-if="tab === 'access-logs'" />
  <div v-else class="panel" :data-guide-action="tab === 'audit' ? 'system.audit' : undefined">
    <BusinessTable :loading="listLoading" :rows="rows" :columns="tableColumns" :table-key="'system:' + tab" :filter-state="columnFilters"
        :sort-state="{ prop: sortKey, order: sortKey ? (sortDirection === 'asc' ? 'ascending' : 'descending') : null }"
      @sort-change="tableSort" @filter-change="tableFilter">
      <template #toolbar="{ openSettings, clearFilters, hasActiveFilters }">
        <div class="unified-list-tools">
          <ElButton v-if="hasActiveFilters" link type="primary" @click="clearFilters">清除列筛选</ElButton>
          <div class="toolbar page-heading-actions">
            <ElButton :loading="listLoading" @click="load">刷新</ElButton>
            <ElButton class="business-column-setting-trigger" @click="openSettings">列设置</ElButton>
<ElButton :data-guide-action="tab === 'users' ? 'system.user' : 'system.ip'" v-if="can('admin') && ['users','ips'].includes(tab)" type="primary" @click="edit()">{{ tab === 'users' ? '新增用户' : '新增授权IP' }}</ElButton>

          </div>
        </div>
      </template>
      <template #cell="{ row, column }">
        <ElButton v-if="tab === 'audit' && column.key === 'created_at'" class="cell-link" link type="primary" @click="selectedAudit = row">{{ formatVisibleDateTime(row.created_at, 'created_at') }}</ElButton>
        <span v-else-if="['role','status','action'].includes(column.key)">{{ statusText[String(row[column.key])] || row[column.key] || '—' }}</span>
        <span v-else>{{ formatVisibleDateTime(row[column.key], column.key) ?? '—' }}</span>
      </template>
      <template v-if="['users','ips'].includes(tab)" #actions="{ row }">
        <RowActions :actions="[
          { label: '编辑', disabled: !can('admin'), run: () => edit(row) },
          { label: '删除', danger: true, disabled: !can('admin'), run: () => remove(row) },
        ]" />
      </template>
    </BusinessTable>
    <ElPagination v-model:current-page="page" :page-size="30" :total="total"
      layout="prev,pager,next,total" @current-change="load" />
  </div>
  <BusinessDetailDialog :open="!!selectedAudit" title="操作审计详情" @close="selectedAudit = null">
    <BusinessHistory v-if="selectedAudit" :value="selectedAudit" />
  </BusinessDetailDialog>
  <ElDialog append-to-body
    v-model="dialog"
    :title="(editing ? '编辑' : '新增') + (tab === 'users' ? '用户账号' : 'IP授权')"
    width="620px" :before-close="beforeEditorClose" :close-on-click-modal="false"
    ><ElForm ref="formRef" :model="form" label-position="top" novalidate
      ><template v-if="tab === 'users'"
        ><ElFormItem label="用户名" prop="username" :error="formErrors.username"
          :rules="[{ required: true, message: '请填写用户名', trigger: 'blur' }]" required
          ><ElInput v-model="form.username" /></ElFormItem
        ><ElFormItem data-guide-action="system.password" :label="editing ? '新密码（不修改请留空）' : '初始密码'" prop="password"
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
      ><ElButton data-guide-action="system.save" type="primary" :loading="saving" @click="save">保存</ElButton></template
    ></ElDialog
  >
</template>

<style scoped>
.access-policy-settings { margin-bottom: 16px; }
.access-policy-row { display: flex; align-items: center; justify-content: space-between; gap: 24px; }
.access-policy-row p { margin: 7px 0 0; color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.6; }
.access-policy-row strong { font-size: 15px; }
@media (max-width: 760px) {
  .access-policy-row { flex-wrap: wrap; gap: 12px; }
}
</style>

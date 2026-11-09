<script setup lang="ts">
import { ref, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { api, statusText, type Row } from "../services/api";
const tab = ref("users"),
  rows = ref<Row[]>([]),
  dialog = ref(false),
  form = ref<Row>({}),
  editing = ref<Row | null>(null);
async function load() {
  rows.value = (await api("/" + tab.value + "?page_size=200")).items;
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
onMounted(load);
</script>
<template>
  <div class="page-heading">
    <div>
      <div class="section-caption">System administration</div>
      <h1>系统管理</h1>
      <p>账号角色、内网访问与操作审计。</p>
    </div>
    <div class="page-heading-actions">
      <ElButton type="primary" @click="edit()">新增</ElButton>
    </div>
  </div>
  <ElTabs v-model="tab" @tab-change="load"
    ><ElTabPane label="用户与角色" name="users" /><ElTabPane
      label="IP白名单"
      name="ips" /><ElTabPane label="操作审计" name="audit"
  /></ElTabs>
  <div class="panel">
    <ElTable :data="rows"
      ><template v-if="tab === 'users'"
        ><ElTableColumn prop="username" label="账号" /><ElTableColumn
          label="角色"
          ><template #default="{ row }">{{
            statusText[row.role] || row.role
          }}</template></ElTableColumn
        ><ElTableColumn label="状态"
          ><template #default="{ row }">{{
            statusText[row.status] || row.status
          }}</template></ElTableColumn
        ></template
      ><template v-if="tab === 'ips'"
        ><ElTableColumn prop="ip" label="IP地址" /><ElTableColumn
          prop="note"
          label="说明" /></template
      ><template v-if="tab === 'audit'"
        ><ElTableColumn
          prop="created_at"
          label="登记时间"
          min-width="190" /><ElTableColumn
          prop="entity"
          label="业务对象" /><ElTableColumn
          prop="action"
          label="动作" /><ElTableColumn
          prop="actor_username"
          label="操作人"
          min-width="190" /></template
      ><ElTableColumn label="操作"
        ><template #default="{ row }"
          ><ElButton @click="edit(row)">编辑</ElButton
          ><ElButton type="danger" @click="remove(row)"
            >删除</ElButton
          ></template
        ></ElTableColumn
      ></ElTable
    >
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

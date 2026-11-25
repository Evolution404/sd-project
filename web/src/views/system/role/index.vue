<!-- 角色管理 -->
<template>
  <div class="page-container page-container--split role-page">
    <aside class="page-aside" :class="{ 'is-collapsed': sidebarCollapsed }">
      <div class="page-aside__inner">
        <div class="role-list">
          <div class="role-list__head">
            <el-input
              v-model="params.keywords"
              placeholder="搜索角色"
              clearable
              @input="handleSearchInput"
              @clear="handleSearch"
            >
              <template #prefix>
                <el-icon><Search /></el-icon>
              </template>
            </el-input>
            <el-button
              v-hasPerm="'role.manage'"
              type="primary"
              plain
              class="role-list__create"
              data-guide-action="system.role-create" @click="handleCreateClick()"
            >
              <el-icon><Plus /></el-icon>
              新增
            </el-button>
          </div>

          <el-scrollbar v-loading="loading" class="role-list__scroll">
            <div
              v-for="row in list"
              :key="row.id"
              class="role-list__item"
              :class="{
                'is-active': row.id === currentRole?.id,
                'is-disabled': row.status === CommonStatus.DISABLED,
              }"
              @click="handleRoleClick(row)"
            >
              <div class="role-list__info">
                <span class="role-list__title">
                  <span
                    class="status-dot"
                    :class="{ 'is-stopped': row.status !== CommonStatus.ENABLED }"
                  />
                  <span class="role-list__name" :title="row.name">{{ row.name }}</span>
                </span>
                <span class="role-list__meta">
                  <span class="role-list__code" :title="row.code">{{ row.code }}</span>
                  <span v-if="row.status !== CommonStatus.ENABLED" class="role-list__stopped">
                    停用
                  </span>
                </span>
              </div>
              <div class="aside-actions">
                <el-tooltip content="编辑" placement="top">
                  <el-button
                    v-hasPerm="'role.manage'"
                    link
                    class="is-edit"
                    data-guide-action="system.role-edit" @click.stop="handleEditClick(row.id)"
                  >
                    <el-icon><Edit /></el-icon>
                  </el-button>
                </el-tooltip>
                <el-tooltip content="删除" placement="top">
                  <el-button
                    v-if="!row.systemSeed"
                    v-hasPerm="'role.manage'"
                    link
                    class="is-delete"
                    data-guide-action="system.role-delete" @click.stop="handleDelete(row.id)"
                  >
                    <el-icon><Delete /></el-icon>
                  </el-button>
                </el-tooltip>
              </div>
            </div>

            <el-empty
              v-if="!loading && list.length === 0"
              :image-size="60"
              description="暂无角色"
            />
          </el-scrollbar>

          <div class="flex items-center justify-between gap-2 pt-2">
            <span class="text-12px text-[var(--el-text-color-secondary)]">共 {{ total }} 个</span>
            <el-pagination
              v-model:current-page="params.pageNum"
              :page-size="params.pageSize"
              :total="total"
              layout="prev, pager, next"
              size="small"
              background
              @current-change="handlePageChange"
            />
          </div>
        </div>
      </div>

      <el-button
        class="page-aside__toggle"
        :title="sidebarCollapsed ? '展开角色列表' : '收起角色列表'"
        :aria-label="sidebarCollapsed ? '展开角色列表' : '收起角色列表'"
        @click="sidebarCollapsed = !sidebarCollapsed"
      >
        <el-icon :size="14">
          <ArrowLeft v-if="!sidebarCollapsed" />
          <ArrowRight v-else />
        </el-icon>
      </el-button>
    </aside>

    <div class="page-main">
      <el-card v-if="currentRole" ref="permWrapperRef" class="page-content" shadow="never">
        <div class="role-perm__header">
          <span class="role-perm__title">功能权限</span>
          <el-tag type="primary" effect="plain">{{ currentRole.name }}</el-tag>

          <div class="role-perm__actions">
            <el-input
              v-model="permKeywords"
              class="role-perm__search"
              placeholder="权限名称"
              clearable
            >
              <template #prefix>
                <el-icon><Search /></el-icon>
              </template>
            </el-input>

            <el-segmented v-model="checkMode" :options="CHECK_MODE_OPTIONS" />

            <el-tooltip :content="isAllCollapsed ? '展开' : '收缩'" placement="top">
              <el-button class="page-icon-btn" @click="toggleAllGroups">
                <span v-if="isAllCollapsed" class="i-svg:add-box" />
                <span v-else class="i-svg:checkbox-indeterminate" />
              </el-button>
            </el-tooltip>

            <el-tooltip content="刷新" placement="top">
              <el-button class="page-icon-btn" @click="handleRefreshPerm">
                <el-icon><Refresh /></el-icon>
              </el-button>
            </el-tooltip>

            <el-button :disabled="permLoading || saving" data-guide-action="system.role-scopes" @click="openScopes">操作数据范围</el-button>

            <el-tooltip content="全屏" placement="top">
              <el-button class="page-icon-btn" @click="toggleFullscreen">
                <el-icon><FullScreen /></el-icon>
              </el-button>
            </el-tooltip>

            <el-button
              v-hasPerm="'role.manage'"
              type="primary"
              :loading="saving"
              :disabled="permLoading"
              data-guide-action="system.save" @click="handleSavePerm"
            >
              保存
            </el-button>
          </div>
        </div>

        <div class="page-table-wrapper">
          <el-table
            v-loading="permLoading"
            class="page-table"
            :data="displayRows"
            row-key="id"
            height="100%"
            border
            :row-class-name="resolveRowClass"
          >
            <el-table-column label="权限名称" min-width="240">
              <template #default="{ row }">
                <div
                  class="role-perm__cell"
                  :class="{ 'is-group': row.group }"
                  :style="{ paddingLeft: `${row.depth * 18}px` }"
                >
                  <el-icon
                    v-if="row.group"
                    class="role-perm__caret"
                    :size="14"
                    @click.stop="toggleGroup(row.id)"
                  >
                    <CaretBottom v-if="!collapsedIds.has(row.id)" />
                    <CaretRight v-else />
                  </el-icon>
                  <span v-else class="role-perm__caret-space" />
                  <el-checkbox
                    :model-value="permissionGroupChecked(row.id)"
                    :indeterminate="permissionGroupPartial(row.id)"
                    :disabled="checkMode === 'independent' || !permissionGroupIds(row.id).length"
                    @change="(checked) => handleNodeCheck(row.id, checked)"
                  />
                  <span class="role-perm__name" :title="row.name">{{ row.name }}</span>
                </div>
              </template>
            </el-table-column>

            <el-table-column label="权限项" min-width="360">
              <template #default="{ row }">
                <div class="flex flex-wrap gap-x-4 gap-y-1">
                  <el-checkbox
                    v-for="btn in row.buttons"
                    :key="btn.id"
                    :model-value="checkedIds.has(btn.id)"
                    @change="(checked) => handleNodeCheck(btn.id, checked)"
                  >
                    {{ btn.name }}
                  </el-checkbox>
                </div>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-card>

      <el-card v-else class="page-content" shadow="never">
        <el-empty description="请先在左侧选择角色" />
      </el-card>
    </div>

    <el-dialog
      v-model="dialogState.visible"
      :title="dialogState.title"
      width="600px"
      append-to-body
      @close="closeDialog"
    >
      <el-form ref="roleFormRef" :model="formData" :rules="rules" label-width="100px" novalidate>
        <el-form-item label="角色名称" prop="name">
          <el-input v-model="formData.name" placeholder="请输入角色名称" />
        </el-form-item>

        <el-form-item label="角色编码" prop="code">
          <el-input v-model="formData.code" placeholder="请输入角色编码" :disabled="Boolean(formData.id)" />
        </el-form-item>

        <el-form-item label="状态" prop="status">
          <el-radio-group v-model="formData.status">
            <el-radio :value="CommonStatus.ENABLED">正常</el-radio>
            <el-radio :value="CommonStatus.DISABLED">停用</el-radio>
          </el-radio-group>
        </el-form-item>

        <el-form-item label="排序" prop="sort">
          <el-input-number
            v-model="formData.sort"
            controls-position="right"
            :min="0"
            style="width: 100px"
          />
        </el-form-item>
        <el-form-item label="自动授予新权限">
          <el-switch v-model="formData.autoGrantNewPermissions" />
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <el-button type="primary" @click="handleSubmit">确定</el-button>
          <el-button @click="closeDialog">取消</el-button>
        </div>
      </template>
    </el-dialog>

    <el-dialog v-model="scopesOpen" title="操作数据范围" width="min(95vw, 800px)" append-to-body>
      <el-alert title="范围按单项操作授予。本人按项目责任人，组织按项目归口单位判断。"
        type="info" :closable="false" class="mb-3" />
      <el-table v-loading="scopeLoading" :data="scopeRows" row-key="permission_code" border>
        <el-table-column label="项目及财务操作" prop="name" min-width="160" />
        <el-table-column label="允许操作的数据" min-width="180">
          <template #default="{ row }">
            <el-select v-model="row.scope" :aria-label="row.name + '的数据范围'">
              <el-option v-for="mode in scopeModes" :key="mode.value" :label="mode.label" :value="mode.value" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="自定义组织" min-width="205">
          <template #default="{ row }">
            <el-select v-if="row.scope === 'custom'" v-model="row.organization_ids" multiple filterable
              :aria-label="row.name + '的自定义组织'" placeholder="请选择组织">
              <el-option v-for="org in scopeOrganizations" :key="org.value" :value="org.value" :label="org.label" />
            </el-select>
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="scopesOpen = false">取消</el-button>
        <el-button type="primary" :disabled="scopeLoading" data-guide-action="system.role-scopes-apply" @click="applyScopes">应用到待保存权限</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { useFullscreen } from "@vueuse/core";
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from "element-plus";
import {
  ArrowLeft,
  ArrowRight,
  CaretBottom,
  CaretRight,
  Delete,
  Edit,
  FullScreen,
  Plus,
  Refresh,
  Search,
} from "@element-plus/icons-vue";

import RoleAPI from "@/api/system/role";
import type { RoleDataScope, RoleForm, RoleItem, RoleQuery } from "@/api/system/role";
import type { OptionItem } from "@/api/common";
import type { MenuItem } from "@/api/system/menu";
import { usePageTable } from "@/composables";
import { useUserStore } from "@/stores";
import { CommonStatus } from "@/enums";
import { getPermissionTree } from "@/api/business/permission-tree";

defineOptions({
  name: "Role",
  inheritAttrs: false,
});
const currentUser = useUserStore();

// 左侧角色列表折叠状态
const sidebarCollapsed = ref(false);

const roleFormRef = ref<FormInstance>();
const permWrapperRef = ref<HTMLElement | null>(null);
const { toggle: toggleFullscreen } = useFullscreen(permWrapperRef);

// 左侧角色列表分页数据管理
const { loading, list, total, params, fetchData } = usePageTable<RoleItem, RoleQuery>({
  initialParams: {
    pageNum: 1,
    pageSize: 20,
    keywords: "",
  },
  request: RoleAPI.getPage,
});

// 当前选中角色，右侧权限表格据此联动
const currentRole = ref<RoleItem>();
const scopedCommands = [
  { permission_code: "write", name: "项目及结算编制" },
  { permission_code: "project.stock", name: "项目正式入库" },
  { permission_code: "project.approve", name: "项目正式立项批准" },
  { permission_code: "change.approve", name: "项目变更批准" },
  { permission_code: "project.close", name: "项目结项批准" },
  { permission_code: "settlement.approve", name: "结算正式批准" },
  { permission_code: "cost.confirm", name: "真实费用核定" },
];
const scopeModes = [
  { value: "all", label: "全部项目" },
  { value: "self", label: "本人负责的项目" },
  { value: "department", label: "本账号所属组织" },
  { value: "department_and_children", label: "本账号所属组织及下级" },
  { value: "custom", label: "自定义组织" },
];
const scopesOpen = ref(false);
const scopeLoading = ref(false);
const scopeRows = ref<Array<RoleDataScope & { name: string }>>([]);
const scopeOrganizations = ref<OptionItem[]>([]);
const chosenScopes = ref<RoleDataScope[]>([]);
let loadedScopes = "[]";

function canonicalScopes(scopes: RoleDataScope[]) {
  return scopes.map(({ permission_code, scope, organization_ids }) => ({
    permission_code, scope, organization_ids: [...organization_ids].sort(),
  })).sort((a, b) => a.permission_code.localeCompare(b.permission_code));
}

async function openScopes() {
  scopeRows.value = scopedCommands.filter(command => checkedIds.value.has(command.permission_code)).map(command => {
    const saved = chosenScopes.value.find(scope => scope.permission_code === command.permission_code);
    return { ...command, scope: saved?.scope ?? "all", organization_ids: [...(saved?.organization_ids ?? [])] };
  });
  scopesOpen.value = true;
  scopeLoading.value = true;
  try {
    scopeOrganizations.value = await RoleAPI.scopeOrganizations();
    const known = new Set(scopeOrganizations.value.map(option => String(option.value)));
    for (const id of new Set(scopeRows.value.flatMap(row => row.organization_ids))) {
      if (!known.has(id)) scopeOrganizations.value.push({ value: id, label: "历史组织 " + id });
    }
  } catch (cause) {
    scopesOpen.value = false;
    ElMessage.error((cause as Error).message);
  } finally {
    scopeLoading.value = false;
  }
}

function applyScopes() {
  if (scopeRows.value.some(row => row.scope === "custom" && !row.organization_ids.length)) {
    ElMessage.warning("请为每项自定义范围选择组织");
    return;
  }
  chosenScopes.value = canonicalScopes(scopeRows.value.filter(row => row.scope !== "all").map(row => ({
    ...row, organization_ids: row.scope === "custom" ? row.organization_ids : [],
  })));
  scopesOpen.value = false;
}
/**
 * 权限表格行，按钮权限挂在所属菜单行的 buttons 上而不单独成行
 */
interface PermRow {
  /** 节点 ID */
  id: string;
  /** 节点名称 */
  name: string;
  /** 是否为目录分组行 */
  group: boolean;
  /** 层级，仅用于缩进 */
  depth: number;
  /** 行内展示的按钮权限 */
  buttons: PermRow[];
}

/**
 * 整理菜单层级
 * 后端返回的可能是树，也可能是扁平列表，扁平数据按 parentId 复制节点后组装成树
 *
 * @param list 菜单列表
 * @returns 顶层菜单列表
 */
function normalizeMenuTree(list: MenuItem[]): MenuItem[] {
  const hasNested = list.some((menu) => (menu.children?.length ?? 0) > 0);
  if (hasNested) return list;

  const nodeMap = new Map<string, MenuItem>();
  list.forEach((menu) => nodeMap.set(String(menu.id), { ...menu }));

  const roots: MenuItem[] = [];
  nodeMap.forEach((menu) => {
    const parent = nodeMap.get(String(menu.parentId ?? "0"));
    if (parent) {
      parent.children = [...(parent.children ?? []), menu];
    } else {
      roots.push(menu);
    }
  });
  return roots;
}

/**
 * 一次返回行与索引；后代集合包含节点自身，重建不会保留旧索引
 */
function buildPermissionModel(nodes: MenuItem[]) {
  const ancestorsById = new Map<string, string[]>();
  const descendantIdsById = new Map<string, string[]>();

  /**
   * 按菜单层级构建权限表格行
   */
  function buildRows(nodes: MenuItem[], depth = 0, ancestors: string[] = []): PermRow[] {
    const rows: PermRow[] = [];

    nodes.forEach((node) => {
      const id = String(node.id);
      const children = node.children ?? [];
      const subMenus = children.filter((child) => child.type !== "B");
      const buttons: PermRow[] = children
        .filter((child) => child.type === "B")
        .map((child) => ({
          id: String(child.id),
          name: child.name ?? "",
          group: false,
          depth: depth + 1,
          buttons: [],
        }));

      rows.push({
        id,
        name: node.name ?? "",
        group: subMenus.length > 0,
        depth,
        buttons,
      });
      buttons.forEach((btn) => {
        ancestorsById.set(btn.id, [...ancestors, id]);
        descendantIdsById.set(btn.id, [btn.id]);
      });

      const childRows = buildRows(subMenus, depth + 1, [...ancestors, id]);
      rows.push(...childRows);

      ancestorsById.set(id, ancestors);
      descendantIdsById.set(id, [
        ...new Set([
          id,
          ...buttons.map((btn) => btn.id),
          ...childRows.flatMap((row) => descendantIdsById.get(row.id) ?? []),
        ]),
      ]);
    });

    return rows;
  }

  const rows = buildRows(normalizeMenuTree(nodes));
  return { rows, ancestorsById, descendantIdsById };
}

// 权限表格数据与勾选状态
const permRows = ref<PermRow[]>([]);
const checkedIds = ref(new Set<string>());
const permLoading = ref(false);
const saving = ref(false);
const permKeywords = ref("");

/**
 * 勾选模式：父子联动 / 节点独立
 */
type CheckMode = "linked" | "independent";

const CHECK_MODE_OPTIONS: { value: CheckMode; label: string }[] = [
  { value: "linked", label: "父子联动" },
  { value: "independent", label: "节点独立" },
];

const checkMode = ref<CheckMode>("linked");

// 折叠的目录 ID，折叠后其下菜单行不展示
const collapsedIds = ref(new Set<string>());

// 节点祖先链，勾选子级时用于回填父级
let ancestorsById = new Map<string, string[]>();
// 节点及其全部后代的 ID
let descendantIdsById = new Map<string, string[]>();

// 菜单树只请求一次，切换角色时复用
let menuTreeLoaded = false;

/**
 * 按关键字过滤权限行：命中行连同祖先链保留，目录名命中时展开整棵子树
 *
 * @param rows 权限表格行列表
 * @param keyword 权限名称关键字
 * @returns 过滤后的权限表格行列表
 */
function filterPermRows(rows: PermRow[], keyword: string): PermRow[] {
  const keywordText = keyword.trim();
  if (!keywordText) return rows;

  const matchedIds = new Set<string>();

  rows.forEach((row) => {
    const nameHit = row.name.includes(keywordText);
    if (!nameHit && !row.buttons.some((btn) => btn.name.includes(keywordText))) return;

    matchedIds.add(row.id);
    (ancestorsById.get(row.id) ?? []).forEach((id) => matchedIds.add(id));

    if (nameHit) {
      (descendantIdsById.get(row.id) ?? []).forEach((id) => matchedIds.add(id));
    }
  });

  return rows.filter((row) => matchedIds.has(row.id));
}

// 权限表格渲染数据
const displayRows = computed(() => {
  const rows = filterPermRows(permRows.value, permKeywords.value);
  // 搜索时全部展开，避免命中的菜单被折叠藏起来
  if (permKeywords.value || collapsedIds.value.size === 0) return rows;

  const visible: PermRow[] = [];
  let collapsedDepth: number | null = null;

  rows.forEach((row) => {
    if (collapsedDepth !== null && row.depth > collapsedDepth) return;

    collapsedDepth = null;
    visible.push(row);
    if (row.group && collapsedIds.value.has(row.id)) {
      collapsedDepth = row.depth;
    }
  });

  return visible;
});

// 带下级菜单行的节点
const collapsibleIds = computed(() =>
  permRows.value.filter((row) => row.group).map((row) => row.id),
);

// 带下级菜单行的节点是否都已折叠
const isAllCollapsed = computed(
  () =>
    collapsibleIds.value.length > 0 &&
    collapsibleIds.value.every((id) => collapsedIds.value.has(id)),
);

/**
 * 拉取菜单树并生成权限表格行
 */
async function loadMenuTree(): Promise<void> {
  if (menuTreeLoaded) return;

  const menuList = await getPermissionTree();
  const model = buildPermissionModel(menuList);
  permRows.value = model.rows;
  ancestorsById = model.ancestorsById;
  descendantIdsById = model.descendantIdsById;
  menuTreeLoaded = true;
}

/**
 * 分组行加浅底色，和菜单行区分开
 *
 * @param param0 表格行数据
 * @returns 行样式类名
 */
function resolveRowClass({ row }: { row: PermRow }): string {
  return row.group ? "role-perm__row--group" : "";
}

/**
 * 拉取指定角色已分配的菜单权限并回显
 *
 * @param roleId 角色 ID
 */
async function loadRolePerm(roleId?: string): Promise<void> {
  if (!roleId) return;

  permLoading.value = true;
  try {
    await loadMenuTree();
    const config = await RoleAPI.getPermissionConfiguration(roleId);
    if (currentRole.value?.id !== roleId) return;
    currentRole.value.version = config.version;
    checkedIds.value = new Set(config.permissions);
    chosenScopes.value = canonicalScopes(config.data_scopes);
    loadedScopes = JSON.stringify(chosenScopes.value);
  } finally {
    permLoading.value = false;
  }
}

/**
 * 拉取角色列表并保持右侧选中项有效
 *
 * @param preferRoleId 优先选中的角色 ID，缺省沿用当前选中项
 */
async function fetchRoles(preferRoleId?: string): Promise<void> {
  await fetchData();

  const targetId = preferRoleId ?? currentRole.value?.id;
  currentRole.value = list.value.find((row) => row.id === targetId) ?? list.value[0];
  await loadRolePerm(currentRole.value?.id);
}

/**
 * 按关键字查询角色
 */
function handleSearch(): void {
  params.pageNum = 1;
  fetchRoles();
}

// 输入即筛，避免用户以为搜索框没生效
const handleSearchInput = useDebounceFn(handleSearch, 300);

/**
 * 角色列表翻页
 */
function handlePageChange(): void {
  fetchRoles();
}

/**
 * 选中角色，右侧权限表格随之切换
 *
 * @param row 角色行
 */
async function handleRoleClick(row: RoleItem): Promise<void> {
  if (row.id === currentRole.value?.id) return;
  currentRole.value = row;
  await loadRolePerm(row.id);
}

/**
 * 勾选或取消权限节点
 * 父子联动时向下级联并回填父级，节点独立时只作用于当前节点
 *
 * @param nodeId 权限节点 ID
 * @param checked 是否勾选
 */
function handleNodeCheck(nodeId: string, checked: boolean | string | number): void {
  const isChecked = Boolean(checked);
  const ids=permissionGroupIds(nodeId);
  for(const id of ids){
    if(isChecked)checkedIds.value.add(id);
    else checkedIds.value.delete(id);
  }
}
const permissionIds = computed(()=>new Set(permRows.value.flatMap(row=>row.buttons.map(button=>button.id))));
function permissionGroupIds(nodeId:string){
  return (descendantIdsById.get(nodeId) ?? [nodeId]).filter(id=>permissionIds.value.has(id));
}
function permissionGroupChecked(nodeId:string){
  const ids=permissionGroupIds(nodeId);
  return ids.length>0 && ids.every(id=>checkedIds.value.has(id));
}
function permissionGroupPartial(nodeId:string){
  const ids=permissionGroupIds(nodeId);
  return ids.some(id=>checkedIds.value.has(id)) && !ids.every(id=>checkedIds.value.has(id));
}

/**
 * 折叠或展开指定目录
 *
 * @param groupId 目录 ID
 */
function toggleGroup(groupId: string): void {
  if (collapsedIds.value.has(groupId)) {
    collapsedIds.value.delete(groupId);
  } else {
    collapsedIds.value.add(groupId);
  }
}

/**
 * 一键折叠或展开全部目录
 */
function toggleAllGroups(): void {
  collapsedIds.value = isAllCollapsed.value ? new Set() : new Set(collapsibleIds.value);
}

/**
 * 重新拉取当前角色的菜单权限
 */
async function handleRefreshPerm(): Promise<void> {
  await loadRolePerm(currentRole.value?.id);
}

/**
 * 提交当前角色的菜单权限配置
 */
async function handleSavePerm(): Promise<void> {
  const role = currentRole.value;
  const roleId = role?.id;
  if (!roleId || saving.value) return;

  const labels = new Map(permRows.value.flatMap(row=>row.buttons.map(button=>[button.id,button.name] as const)));
  const availableCodes = new Set(labels.keys());
  const menuIds = Array.from(checkedIds.value).filter(code=>availableCodes.has(code));
  const scopes = chosenScopes.value.filter(scope => menuIds.includes(scope.permission_code));
  const scopesChanged = JSON.stringify(scopes) !== loadedScopes;

  saving.value = true;
  try {
    const preview = await RoleAPI.getPermissionPreview(roleId, menuIds, role.version);
    if (!preview.added.length && !preview.removed.length && !scopesChanged) {
      ElMessage.info("角色权限没有变化");
      return;
    }
    const names = (codes:string[]) => codes.map(code=>labels.get(code)||code).join("、");
    const details = [
      preview.added.length ? "新增 " + names(preview.added) : "",
      preview.removed.length ? "撤回 " + names(preview.removed) : "",
      scopesChanged ? "更新正式操作的数据范围" : "",
      `涉及 ${preview.memberCount} 个关联账号。保存后其现有登录会话将失效`,
    ].filter(Boolean).join("。") + "。";
    await ElMessageBox.confirm(details, "确认权限变更", { type:"warning",confirmButtonText:"保存权限" });
    await RoleAPI.updateRoleMenus(roleId, menuIds, scopes, role.version);
    if(currentUser.userInfo.roles.includes(roleId)) {
      ElMessage.success("权限已保存，当前账号会话失效，请重新登录");
      await currentUser.redirectToLogin();
    } else {
      ElMessage.success("分配权限成功");
      await fetchRoles(roleId);
    }
  } catch (cause) {
    if (cause !== "cancel" && cause !== "close") ElMessage.error((cause as Error).message);
  } finally {
    saving.value = false;
  }
}

const dialogState = reactive({
  title: "",
  visible: false,
});

const initialFormData: RoleForm = {
  sort: 1,
  status: CommonStatus.ENABLED,
  autoGrantNewPermissions: false,
};

const formData = reactive<RoleForm>({ ...initialFormData });

const rules: FormRules<RoleForm> = {
  name: [{ required: true, message: "请输入角色名称", trigger: "blur" }],
  code: [{ required: true, message: "请输入角色编码", trigger: "blur" }],
  status: [{ required: true, message: "请选择状态", trigger: "blur" }],
};

/**
 * 打开角色表单弹窗
 */
function openDialog(): void {
  dialogState.visible = true;
}

/**
 * 关闭角色表单弹窗
 * 同步清理表单数据和校验状态
 */
function closeDialog(): void {
  dialogState.visible = false;
  resetForm();
}

/**
 * 重置角色表单
 */
function resetForm(): void {
  roleFormRef.value?.resetFields();
  roleFormRef.value?.clearValidate();
  Object.keys(formData).forEach((key) => {
    delete (formData as Record<string, unknown>)[key];
  });
  Object.assign(formData, initialFormData);
}

/**
 * 打开新增角色弹窗
 * 部门下拉首次打开时请求，之后复用缓存
 */
async function handleCreateClick(): Promise<void> {
  dialogState.title = "新增角色";

  openDialog();
}

/**
 * 打开编辑角色弹窗
 *
 * @param roleId 角色 ID
 */
async function handleEditClick(roleId?: string): Promise<void> {
  if (!roleId) return;
  dialogState.title = "修改角色";

  const data = await RoleAPI.getFormData(roleId);
  Object.assign(formData, data);
  openDialog();
}

/**
 * 校验并提交角色表单
 *
 * 非自定义数据权限时丢弃部门 ID
 */
async function handleSubmit(): Promise<void> {
  const valid = await roleFormRef.value?.validate().then(
    () => true,
    () => false,
  );
  if (!valid) return;

  const submitData: RoleForm = { ...formData };
  loading.value = true;
  try {
    const roleId = formData.id;
    if (roleId) {
      await RoleAPI.update(roleId, submitData);
      ElMessage.success("修改成功");
    } else {
      await RoleAPI.create(submitData);
      ElMessage.success("新增成功");
    }
    closeDialog();
    fetchRoles(roleId);
  } finally {
    loading.value = false;
  }
}

/**
 * 删除角色，删除后右侧联动到剩余角色
 *
 * @param roleId 角色 ID
 */
async function handleDelete(roleId?: string): Promise<void> {
  if (!roleId) return;

  try {
    await ElMessageBox.confirm("确认删除该角色?", "警告", {
      confirmButtonText: "确定",
      cancelButtonText: "取消",
      type: "warning",
    });
  } catch {
    ElMessage.info("已取消删除");
    return;
  }

  loading.value = true;
  try {
    await RoleAPI.deleteByIds(roleId);
    ElMessage.success("删除成功");
    fetchRoles();
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  fetchRoles();
});
</script>

<style lang="scss" scoped>
.role-page {
  --page-aside-width: 280px;
}

.role-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 16px;

  &__head {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-bottom: 8px;

    :deep(.el-input) {
      flex: 1;
      min-width: 0;
    }
  }

  &__create {
    flex-shrink: 0;
  }

  &__scroll {
    flex: 1 1 auto;
    min-height: 0;
  }

  &__item {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    cursor: pointer;
    border-radius: var(--radius-control);
    transition: background-color 0.15s;

    &:hover {
      background-color: var(--el-fill-color-light);
    }

    &.is-active {
      background-color: var(--el-color-primary-light-9);
    }

    &.is-active::before {
      position: absolute;
      top: 6px;
      bottom: 6px;
      left: 0;
      width: 2px;
      content: "";
      background-color: var(--el-color-primary);
      border-radius: 1px;
    }
  }

  &__info {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-width: 0;
    line-height: 1.35;
  }

  &__title {
    display: flex;
    gap: 6px;
    align-items: center;
    min-width: 0;
  }

  &__name {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 14px;
    font-weight: 500;
    color: var(--el-text-color-primary);
    white-space: nowrap;
  }

  &__meta {
    display: flex;
    gap: 6px;
    align-items: center;
    min-width: 0;
  }

  &__code {
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 12px;
    color: var(--el-text-color-secondary);
    white-space: nowrap;
  }

  &__stopped {
    flex-shrink: 0;
    padding: 0 4px;
    font-size: 11px;
    line-height: 16px;
    color: var(--el-color-warning);
    background-color: var(--el-color-warning-light-9);
    border-radius: 3px;
  }

  &__item.is-active &__name {
    font-weight: 600;
    color: var(--el-color-primary);
  }

  &__item.is-disabled:not(.is-active) &__name {
    color: var(--el-text-color-secondary);
  }
}

.role-perm {
  &__header {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    align-items: center;
    padding-bottom: 16px;
    margin-bottom: 16px;
    border-bottom: 1px solid var(--border-color);
  }

  &__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    margin-left: auto;
  }

  // 类名控制宽度，UnoCSS 原子类会被按需注入的 .el-input 宽度覆盖
  &__search {
    width: 220px;
  }

  &__title {
    font-size: 14px;
    font-weight: 600;
    color: var(--el-text-color-primary);
  }

  &__cell {
    display: flex;
    gap: 8px;
    align-items: center;

    &.is-group {
      font-weight: 600;
    }

    .el-checkbox {
      margin-right: 0;
    }
  }

  &__caret {
    flex-shrink: 0;
    color: var(--el-text-color-secondary);
    cursor: pointer;

    &:hover {
      color: var(--el-color-primary);
    }
  }

  &__caret-space {
    flex-shrink: 0;
    width: 14px;
  }

  &__name {
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 13px;
    color: var(--el-text-color-primary);
    white-space: nowrap;
  }

  // 目录行做分组标题，浅底色把它和下面的菜单行区分开
  :deep(.role-perm__row--group) {
    background-color: var(--el-fill-color-light);

    td.el-table__cell {
      background-color: var(--el-fill-color-light);
    }
  }
}
</style>

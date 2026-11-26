<template>
  <div
    class="rounded bg-[var(--el-bg-color)] border border-[var(--el-border-color)] p-5 flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden"
  >
    <div class="flex flex-col md:flex-row justify-between gap-y-2.5 mb-2.5 shrink-0">
      <div class="toolbar-left flex gap-y-2.5 gap-x-2 md:gap-x-3 flex-wrap">
        <template v-for="btn in leftToolbarButtons" :key="btn.key">
          <slot
            v-if="isActionVisible(btn)"
            :name="'toolbar-action-' + btn.key"
            :action="getActionState(btn)"
          >
            <el-button
              v-bind="btn.buttonProps"
              :data-guide-action="crudGuideAction(tableConfig.stateKey,btn.key)"
              :disabled="isActionDisabled(btn)"
              :loading="isActionPending(btn)"
              @click="runAction(btn)"
            >
              {{ btn.label }}
            </el-button>
          </slot>
        </template>
      </div>
      <div class="toolbar-right flex gap-y-2.5 gap-x-2 md:gap-x-3 flex-wrap">
        <template v-for="btn in rightToolbarButtons" :key="btn.key">
          <el-popover
            v-if="btn.key === 'columns' && isActionVisible(btn)"
            placement="bottom"
            trigger="click"
          >
            <template #reference>
              <el-button
                v-bind="btn.buttonProps"
                data-guide-action="common.columns" :aria-label="btn.label"
                :title="btn.label"
                :disabled="isActionDisabled(btn)"
              />
            </template>
            <el-scrollbar max-height="350px">
              <template v-for="col in columns" :key="col.columnKey ?? col.prop ?? col.type">
                <el-checkbox
                  v-if="col.prop"
                  v-model="col.show"
                  :disabled="col.hideable === false"
                  :label="col.label"
                />
              </template>
              <el-button link data-guide-action="common.columns-reset" @click="restoreColumns">恢复默认列</el-button>
            </el-scrollbar>
          </el-popover>
          <slot
            v-else-if="btn.key !== 'columns' && isActionVisible(btn)"
            :name="'toolbar-action-' + btn.key"
            :action="getActionState(btn)"
          >
            <el-button
              v-bind="btn.buttonProps"
              :data-guide-action="btn.key === 'refresh' ? 'common.refresh' : btn.key === 'search' ? 'common.toggle-search' : crudGuideAction(tableConfig.stateKey,btn.key)" :aria-label="btn.label"
              :title="btn.label"
              :disabled="isActionDisabled(btn)"
              :loading="isActionPending(btn)"
              @click="runAction(btn)"
            />
          </slot>
        </template>
      </div>
    </div>

    <el-tabs v-if="statusColumn" :model-value="selectedStatus" class="shrink-0" @update:model-value="selectStatus">
      <el-tab-pane label="全部" name="all" />
      <el-tab-pane v-for="option in statusOptions" :key="String(option.value)"
        :label="option.text" :name="String(option.value)" />
    </el-tabs>

    <el-alert
      v-if="loadError || actionError"
      class="mb-4"
      type="error"
      :title="loadError || actionError"
      :closable="false"
    />
    <el-table data-guide-action="common.table"
      ref="elementTableRef"
      v-loading="loading"
      v-bind="tableConfig.table"
      :data="pageData"
      :row-key="rowKey"
      :default-sort="restoredSort ?? tableConfig.table?.defaultSort"
      class="flex-1 min-h-0"
      @header-dragend="handleHeaderDrag"
      @scroll="handleTableScroll"
      @selection-change="handleSelectionChange"
      @filter-change="handleFilterChange"
      @sort-change="handleSortChange"
    >
      <template v-for="col in columns" :key="col.columnKey ?? col.prop ?? col.type">
        <el-table-column v-if="col.show" v-bind="getColumnAttrs(col)">
          <template v-if="!col.type || col.type === 'default'" #header="scope">
            <slot :name="'header-' + (col.columnKey ?? col.prop)" v-bind="scope">
              <span class="crud-column-title" :title="col.label">{{ col.label }}</span>
            </slot>
          </template>
          <template
            v-if="!col.type || col.type === 'default' || col.type === 'expand'"
            #default="scope"
          >
            <el-tag v-if="scope.row.deleted && (col.prop==='status'||col.prop==='display_status')" type="info" effect="plain">已删除</el-tag>
            <template v-else-if="$slots['cell-' + col.prop]">
              <slot :name="'cell-' + col.prop" :prop="col.prop" v-bind="scope" />
            </template>
            <template v-else-if="col.cellType === 'image'">
              <template v-if="col.prop">
                <template v-if="Array.isArray(scope.row[col.prop])">
                  <template v-for="(item, index) in scope.row[col.prop]" :key="item">
                    <el-image
                      :src="item"
                      :preview-src-list="scope.row[col.prop]"
                      :initial-index="Number(index)"
                      :preview-teleported="true"
                      :style="`width: ${col.imageWidth ?? 40}px; height: ${col.imageHeight ?? 40}px`"
                    />
                  </template>
                </template>
                <template v-else>
                  <el-image
                    :src="scope.row[col.prop]"
                    :preview-src-list="[scope.row[col.prop]]"
                    :preview-teleported="true"
                    :style="`width: ${col.imageWidth ?? 40}px; height: ${col.imageHeight ?? 40}px`"
                  />
                </template>
              </template>
            </template>
            <template v-else-if="col.cellType === 'list'">
              <template v-if="col.prop">
                {{ (col.selectList ?? {})[scope.row[col.prop]] }}
              </template>
            </template>
            <template v-else-if="col.cellType === 'url'">
              <template v-if="col.prop">
                <el-link type="primary" :href="scope.row[col.prop]" target="_blank">
                  {{ scope.row[col.prop] }}
                </el-link>
              </template>
            </template>
            <template v-else-if="col.cellType === 'switch'">
              <template v-if="col.prop">
                <el-switch
                  v-model="scope.row[col.prop]"
                  :active-value="col.activeValue ?? 1"
                  :inactive-value="col.inactiveValue ?? 0"
                  :inline-prompt="true"
                  :active-text="col.activeText ?? ''"
                  :inactive-text="col.inactiveText ?? ''"
                  :validate-event="false"
                  :disabled="isCellDisabled(scope.row, col.prop)"
                  @change="handleModify(col.prop, scope.row[col.prop], scope.row)"
                />
              </template>
            </template>
            <template v-else-if="col.cellType === 'input'">
              <template v-if="col.prop">
                <el-input
                  v-model="scope.row[col.prop]"
                  :disabled="isCellDisabled(scope.row, col.prop)"
                  @blur="handleModify(col.prop, scope.row[col.prop], scope.row)"
                />
              </template>
            </template>
            <template v-else-if="col.cellType === 'price'">
              <template v-if="col.prop">
                {{ `${col.priceFormat ?? ""}${scope.row[col.prop]}` }}
              </template>
            </template>
            <template v-else-if="col.cellType === 'percent'">
              <template v-if="col.prop">{{ scope.row[col.prop] }}%</template>
            </template>
            <template v-else-if="col.cellType === 'icon'">
              <template v-if="col.prop">
                <template
                  v-if="
                    typeof scope.row[col.prop] === 'string' &&
                    scope.row[col.prop].startsWith('el-icon-')
                  "
                >
                  <el-icon>
                    <component :is="scope.row[col.prop].replace('el-icon-', '')" />
                  </el-icon>
                </template>
                <template v-else>
                  <div :class="'i-svg:' + (scope.row[col.prop] ?? '')" />
                </template>
              </template>
            </template>
            <template v-else-if="col.cellType === 'date'">
              <template v-if="col.prop">
                {{
                  scope.row[col.prop]
                    ? useDateFormat(scope.row[col.prop], col.dateFormat ?? "YYYY-MM-DD HH:mm:ss")
                        .value
                    : ""
                }}
              </template>
            </template>
            <template v-else-if="col.cellType === 'actions'">
              <template
                v-for="group in [getRowActionGroups(col, scope.row)]"
                :key="col.columnKey ?? col.prop ?? 'actions'"
              >
                <div v-if="group.inline.length" class="row-actions">
                  <el-button
                    v-for="action in group.inline"
                    :key="action.key"
                    link
                    size="small"
                    type="primary"
                    v-bind="action.buttonProps"
                    :data-guide-action="crudGuideAction(tableConfig.stateKey,action.key)"
                    :disabled="action.disabled"
                    :loading="action.loading"
                    @click="action.run"
                  >
                    {{ action.label }}
                  </el-button>
                  <el-dropdown v-if="group.overflow.length" trigger="click" placement="bottom-end">
                    <el-button link size="small" type="primary" aria-label="更多操作" :data-guide-menu="group.overflow.map(action=>crudGuideAction(tableConfig.stateKey,action.key)).filter(Boolean).join(' ')">
                      更多
                      <el-icon class="el-icon--right"><ArrowDown /></el-icon>
                    </el-button>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item
                          v-for="action in group.overflow"
                          :key="action.key"
                          :data-guide-action="crudGuideAction(tableConfig.stateKey,action.key)"
                          :disabled="action.disabled"
                          :style="
                            action.buttonProps?.type === 'danger'
                              ? { color: 'var(--el-color-danger)' }
                              : undefined
                          "
                          @click="action.run"
                        >
                          {{ action.label }}
                        </el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </div>
              </template>
            </template>
            <template v-else-if="col.cellType === 'custom'">
              <slot :name="col.slotName ?? col.prop" :prop="col.prop" v-bind="scope" />
            </template>
          </template>
        </el-table-column>
      </template>
    </el-table>

    <div v-if="showPagination" class="mt-4 shrink-0 min-w-0">
      <el-scrollbar :class="['h-8!', { 'flex-x-end': tableConfig?.pagePosition === 'right' }]">
        <el-pagination data-guide-action="common.pagination"
          v-bind="pagination"
          @size-change="handleSizeChange"
          @current-change="handleCurrentChange"
        />
      </el-scrollbar>
    </div>

    <el-dialog
      v-model="importModalVisible"
      :close-on-click-modal="!importing"
      :close-on-press-escape="!importing"
      :show-close="!importing"
      :align-center="true"
      title="导入数据"
      width="600px"
      style="padding-right: 0"
      @close="handleCloseImportModal"
    >
      <el-alert v-if="importError" :title="importError" type="error" :closable="false" />
      <el-scrollbar max-height="60vh">
        <el-form
          ref="importFormRef"
          novalidate
          style="padding-right: var(--el-dialog-padding-primary)"
          :model="importFormData"
          :rules="importFormRules"
        >
          <el-form-item label="文件" prop="files">
            <el-upload
              ref="uploadRef"
              v-model:file-list="importFormData.files"
              class="w-full"
              accept=".xlsx,.xls"
              :disabled="importing"
              :drag="true"
              :limit="1"
              :auto-upload="false"
              :on-exceed="handleFileExceed"
            >
              <el-icon class="el-icon--upload"><upload-filled /></el-icon>
              <div class="el-upload__text">
                <span>将文件拖到此处，或点击上传</span>
                <em>点击上传</em>
              </div>
              <template #tip>
                <div class="el-upload__tip">
                  *.xlsx / *.xls
                  <el-link
                    v-if="tableConfig.importTemplate"
                    type="primary"
                    icon="download"
                    underline="never"
                    @click="handleDownloadTemplate"
                  >
                    下载模板
                  </el-link>
                </div>
              </template>
            </el-upload>
          </el-form-item>
        </el-form>
      </el-scrollbar>
      <template #footer>
        <div style="padding-right: var(--el-dialog-padding-primary)">
          <el-button
            type="primary"
            :disabled="importFormData.files.length === 0"
            :loading="importing"
            @click="handleImportSubmit"
          >
            确定
          </el-button>
          <el-button :disabled="importing" @click="handleCloseImportModal">取消</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { hasPerm } from "@/utils/permission";
import { crudGuideAction } from "@/guides/registry/native-crud";
import { ArrowDown } from "@element-plus/icons-vue";
import { useDateFormat, useWindowSize } from "@vueuse/core";
import { useUserStore } from "@/stores";
import { useRoute,useRouter } from "vue-router";
import { readListState, writeListState, readColumnPreferences, writeColumnPreferences, listStateKey, listRouteIdentity, LIST_QUERY_KEY, encodeListUrl, decodeListUrl, type ListState, type FilterValue, type ColumnPreference } from "./utils/list-state";
import {
  genFileId,
  type FormInstance,
  type FormRules,
  type UploadInstance,
  type UploadRawFile,
  type UploadUserFile,
  type TableInstance,
} from "element-plus";
import { reactive, ref, computed, watch, nextTick, onMounted,onActivated,onDeactivated } from "vue";
import { cloneDeep } from "lodash-es";
import { downloadFile } from "@/utils/download";
import { readImportSummary } from "./utils/workbook";
import type {
  CrudTableConfig,
  CrudRecord,
  CrudRowActionEvent,
  CrudActionContext,
  CrudAction,
} from "./types";
import { buildSort, type TableSort } from "./utils/sort";
import type { SortExpression } from "@/api/common";

const props = defineProps<{
  tableConfig: CrudTableConfig;
  /** 由组合页面统一首次查询时关闭，默认自动加载 */
  autoLoad?: boolean;
}>();

const emit = defineEmits<{
  create: [];
  "toggle-search": [];
  "toolbar-action": [key: string];
  "filter-change": [data: CrudRecord];
  "row-action": [data: CrudRowActionEvent];
}>();

const config = computed(() => props.tableConfig);
const preferenceKey = listStateKey(useUserStore().userInfo.userId, props.tableConfig.stateKey);
const route=useRoute(), router=useRouter();
const routeIdentity=listRouteIdentity(route.fullPath);
const urlRestored=decodeListUrl(route.query[LIST_QUERY_KEY],props.tableConfig.stateKey);
const sessionRestored=preferenceKey?readListState(sessionStorage,preferenceKey):undefined;
const restored=preferenceKey?(urlRestored?{
  ...urlRestored,
  scroll:sessionRestored&&encodeListUrl(props.tableConfig.stateKey,sessionRestored)===encodeListUrl(props.tableConfig.stateKey,urlRestored)
    ?sessionRestored.scroll:urlRestored.scroll,
}:sessionRestored):undefined;
let routeActive=true;
onActivated(()=>{routeActive=true});
onDeactivated(()=>{routeActive=false});
const columnPreferences = readColumnPreferences(localStorage, preferenceKey);
const {width:viewportWidth}=useWindowSize();
const compact= computed(()=>Boolean(preferenceKey)&&viewportWidth.value<=960);
const columnIdentity=(col:CrudTableConfig["columns"][number])=>String(col.columnKey??col["column-key"]??col.prop??col.type??"");
const declaredColumns=props.tableConfig.columns;
let nativeReady=false;
onMounted(()=>{nativeReady=true});
const builtInActions: Record<string, Omit<CrudAction, "key">> = {
  create: { label: "新增", buttonProps: { icon: "plus", type: "success" }, permission: "create" },
  delete: { label: "删除", buttonProps: { icon: "delete", type: "danger" }, permission: "delete" },
  import: { label: "导入", buttonProps: { icon: "upload", type: "" }, permission: "import" },
  export: { label: "导出", buttonProps: { icon: "download", type: "" }, permission: "export" },
  refresh: { label: "刷新", buttonProps: { icon: "refresh", type: "" }, permission: "*:*:*" },
  columns: { label: "列设置", buttonProps: { icon: "operation", type: "" }, permission: "*:*:*" },
  search: { label: "搜索", buttonProps: { icon: "search", type: "" }, permission: "list" },
  view: { label: "查看", buttonProps: { icon: "view", type: "primary" }, permission: "update" },
  edit: { label: "编辑", buttonProps: { icon: "edit", type: "primary" }, permission: "update" },
};

const rowKey = props.tableConfig.rowKey ?? "id";
const permissionPrefix = computed(() => props.tableConfig.permissionPrefix);

/**
 * 有前缀时补全相对权限，完整权限原样保留
 */
function resolvePermission(permission: string | string[]): string | string[] {
  const resolve = (value: string) =>
    value.includes(":") || !permissionPrefix.value ? value : `${permissionPrefix.value}:${value}`;
  return Array.isArray(permission) ? permission.map(resolve) : resolve(permission);
}

/**
 * 未配置前缀时，单元格编辑不附加内置权限
 */
function hasActionPermission(action: string): boolean {
  return !permissionPrefix.value || hasPerm(resolvePermission(action));
}

/**
 * 将业务配置合并到内置按钮默认值
 */
function resolveActions(
  actions: Array<string | CrudAction>,
  buttonProps: CrudAction["buttonProps"] = {},
) {
  return actions.map((item) => {
    const isString = typeof item === "string";
    const key = isString ? item : item.key;
    const defaults = builtInActions[key];
    if (isString && !defaults) throw new Error(`未知内置按钮：${key}`);
    const defaultPermission =
      permissionPrefix.value || defaults?.permission === "*:*:*" ? defaults?.permission : undefined;
    const permission = isString ? defaultPermission : (item.permission ?? defaultPermission);
    if (!permission && permissionPrefix.value) throw new Error(`按钮 ${key} 缺少权限配置`);
    return {
      key,
      label: isString ? defaults.label : (item.label ?? defaults?.label),
      buttonProps: {
        ...buttonProps,
        ...defaults?.buttonProps,
        ...(!isString ? item.buttonProps : {}),
      },
      visible: isString ? true : (item.visible ?? true),
      disabled: isString ? false : (item.disabled ?? false),
      onClick: isString ? undefined : item.onClick,
      permission: permission ? resolvePermission(permission) : null,
    };
  });
}

/**
 * 已合并默认值的按钮配置
 */
type ResolvedAction = ReturnType<typeof resolveActions>[number];

/**
 * 取得当前行和勾选记录，供按钮条件及回调使用
 */
function getActionContext(row?: CrudRecord): CrudActionContext {
  return { row, selectedRows: selectedRows.value, selectedKeys: selectedKeys.value };
}

/**
 * 同时检查权限和业务显示条件
 */
function isActionVisible(button: ResolvedAction, row?: CrudRecord): boolean {
  if (button.permission && !hasPerm(button.permission)) return false;
  if(row?.deleted && button.permission !== "read")return false;
  return typeof button.visible === "function"
    ? button.visible(getActionContext(row))
    : button.visible;
}

/**
 * 工具栏和各行分别记录动作执行状态
 */
function getActionKey(button: ResolvedAction, row?: CrudRecord): string {
  return JSON.stringify([row ? row[rowKey] : null, button.key]);
}

/**
 * 判断动作是否正在执行
 */
function isActionPending(button: ResolvedAction, row?: CrudRecord): boolean {
  return pendingActions.has(getActionKey(button, row));
}

/**
 * 业务配置不能启用正在执行或尚不满足条件的按钮
 */
function isActionDisabled(button: ResolvedAction, row?: CrudRecord): boolean {
  const disabled =
    typeof button.disabled === "function"
      ? button.disabled(getActionContext(row))
      : button.disabled;
  return (
    !!button.buttonProps.disabled ||
    disabled ||
    isActionPending(button, row) ||
    (!row && button.key === "delete" && selectedKeys.value.length === 0) ||
    (button.key === "export" && (!canExport.value || exporting.value))
  );
}

/**
 * 提供按钮插槽的显示状态和执行方法
 */
function getActionState(button: ResolvedAction, row?: CrudRecord) {
  return {
    key: button.key,
    label: button.label,
    buttonProps: button.buttonProps,
    disabled: isActionDisabled(button, row),
    loading: isActionPending(button, row),
    run: () => runAction(button, row),
  };
}

/**
 * 筛选当前行可见动作
 */
function getRowActions(column: CrudTableConfig["columns"][number], row: CrudRecord) {
  return resolveActions(column.actions ?? ["edit", "delete"], { link: true, size: "small" })
    .filter((action) => isActionVisible(action, row))
    .map((action) => getActionState(action, row));
}

/**
 * 操作列默认直接显示的数量，0 表示全部显示
 */
function getActionLimit(column: CrudTableConfig["columns"][number]): number {
  const limit = column.maxVisibleActions;
  return typeof limit === "number" && Number.isInteger(limit) && limit >= 0 ? limit : 2;
}

/**
 * 按配置拆分行操作，超出直接显示上限的动作折叠到更多
 */
function getRowActionGroups(column: CrudTableConfig["columns"][number], row: CrudRecord) {
  const actions = getRowActions(column, row);
  const limit = compact.value && actions.length>2 ? 1 : getActionLimit(column);
  if (limit === 0 || actions.length <= limit) return { inline: actions, overflow: [] };
  return { inline: actions.slice(0, limit), overflow: actions.slice(limit) };
}

/**
 * 执行前检查条件，并等待自定义操作完成
 */
async function runAction(button: ResolvedAction, row?: CrudRecord): Promise<void> {
  if (!isActionVisible(button, row) || isActionDisabled(button, row)) return;
  const key = getActionKey(button, row);
  pendingActions.add(key);
  actionError.value = "";
  try {
    if (button.onClick) await button.onClick(getActionContext(row));
    else if (button.key === "delete" && config.value.deleteByIds)
      await handleDelete(row?.[rowKey], button.permission);
    else if (row) emit("row-action", { key: button.key, row });
    else await handleToolbar(button.key);
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : "操作失败，请重试";
  } finally {
    pendingActions.delete(key);
  }
}

const leftToolbarButtons = computed(() => {
  if (!config.value.toolbarActions || config.value.toolbarActions.length === 0) return [];
  return resolveActions(config.value.toolbarActions, {});
});

const rightToolbarButtons = computed(() => {
  if (!config.value.tableTools || config.value.tableTools.length === 0) return [];
  return resolveActions(config.value.tableTools, { circle: true });
});

const columns = ref(
  declaredColumns.map((source) => {
    const col = { ...source };
    if (preferenceKey && col.cellType === "actions") col.hideable = false;
    if (col.hideable === false) col.show = true;
    if (col.show === undefined) {
      col.show = true;
    }
    if (col.prop !== undefined && col.columnKey === undefined && col["column-key"] === undefined) {
      col.columnKey = col.prop;
    }
    if (
      col.type === "selection" &&
      col.reserveSelection === undefined &&
      col["reserve-selection"] === undefined
    ) {
      // 配合表格 row-key 实现跨页多选
      col.reserveSelection = true;
    }
    const pref=columnPreferences[columnIdentity(col)];
    if(pref&&col.hideable!==false&&col.cellType!=="actions"&&typeof pref.visible==="boolean")col.show=pref.visible;
    if(pref?.width&&col.cellType!=="actions"&&col.type!=="selection")col.width=pref.width;
    const oldStatus = col.prop === props.tableConfig.statusTabColumn ? restored?.query.status : undefined;
    const raw = restored?.filters[columnIdentity(col)] ?? (typeof oldStatus === "string" ? [oldStatus] : undefined);
    if(raw&&Array.isArray(col.filters)){
      const values=new Set(col.filters.map((option:{value:unknown})=>option.value));
      col.filteredValue=raw.filter(value=>values.has(value));
    }
    return col;
  }),
);
const loading = ref(false);
const loadError = ref("");
const actionError = ref("");
columns.value.forEach((column) => {
  if (column.onInit)
    void Promise.resolve()
      .then(() => column.onInit?.(column))
      .catch((error: unknown) => {
        actionError.value = error instanceof Error ? error.message : "列选项加载失败";
      });
});
const pendingActions = reactive(new Set<string>());
const sort = ref<SortExpression[]>();
const restoredSort=restored?.sort&&columns.value.some(col=>col.prop===restored.sort?.prop&&col.sortable==="custom"&&col.show)
  ?restored.sort:undefined;
let sortState:ListState["sort"]=restoredSort;
const initialSort = restoredSort ?? props.tableConfig.table?.defaultSort;
if (initialSort?.prop && initialSort.order) {
  const column = columns.value.find((col) => col.prop === initialSort.prop);
  if (column?.sortable === "custom") {
    sort.value = buildSort(initialSort, column.sortField ?? column.prop);
    if(initialSort.prop)sortState={prop:initialSort.prop,order:initialSort.order};
  }
}
const pageData = ref<CrudRecord[]>([]);
const confirmedRows = new Map<string | number, CrudRecord>();
const pendingCells = reactive(new Set<string>());
const defaultColumnVisibility = declaredColumns.map(col=>col.hideable===false||col.cellType==="actions"||col.show!==false);
function persistColumns(){
  const preferences:Record<string,ColumnPreference>={};
  for(const col of columns.value){
    const identity=columnIdentity(col);
    if(!identity||col.cellType==="actions"||col.type==="selection")continue;
    preferences[identity]={visible:col.show,width:typeof col.width==="number"?col.width:undefined};
  }
  writeColumnPreferences(localStorage,preferenceKey,preferences);
}
watch(()=>columns.value.map(col=>col.show),persistColumns);
function handleHeaderDrag(newWidth:number,_oldWidth:number,column:{property?:string;columnKey?:string}){
  const col=columns.value.find(item=>columnIdentity(item)===column.columnKey||item.prop===column.property);
  if(!col||col.cellType==="actions"||col.type==="selection")return;
  col.width=Math.max(64,Math.min(800,newWidth));persistColumns();
}

/**
 * 只向 Element Plus 传递列属性，保留自有元数据供渲染和请求使用
 */
function getColumnAttrs(column: CrudTableConfig["columns"][number]): CrudRecord {
  const attrs = { ...column };
  for (const key of [
    "show",
    "hideable",
    "sortField",
    "cellType",
    "actions",
    "maxVisibleActions",
    "slotName",
    "onInit",
    "filterJoin",
    "imageWidth",
    "imageHeight",
    "selectList",
    "activeValue",
    "inactiveValue",
    "activeText",
    "inactiveText",
    "inputType",
    "priceFormat",
    "dateFormat",
  ]) {
    Reflect.deleteProperty(attrs, key);
  }
  if(compact.value){
    if(attrs.fixed==="left"||attrs.fixed===true)attrs.fixed=false;
    if(column.cellType==="actions"){
      attrs.width=150;delete attrs.minWidth;
    }
  }
  return attrs;
}
const showPagination = props.tableConfig.pagination !== false;
const defaultPagination = {
  background: true,
  layout: "total, sizes, prev, pager, next, jumper",
  pageSize: 20,
  pageSizes: [10, 20, 30, 50],
  total: 0,
  currentPage: 1,
};
const pagination = reactive(
  typeof props.tableConfig.pagination === "object"
    ? { ...defaultPagination, ...props.tableConfig.pagination }
    : defaultPagination,
);
if(restored&&showPagination){
  if(pagination.pageSizes.includes(restored.size))pagination.pageSize=restored.size;
  pagination.currentPage=restored.page;
}
const paginationKeys = props.tableConfig.paginationKeys ?? {
  page: "pageNum",
  size: "pageSize",
};

const elementTableRef = ref<TableInstance>();

const selectedRows = ref<CrudRecord[]>([]);
const selectedKeys = ref<(number | string)[]>([]);
/**
 * 更新勾选记录及主键
 */
function handleSelectionChange(selection: CrudRecord[]) {
  selectedRows.value = selection;
  selectedKeys.value = selection.map(getRowKey);
}

/**
 * 列显隐只修改当前实例，恢复时使用声明初值
 */
function restoreColumns(): void {
  columns.value.forEach((col, index) => {
    col.show = defaultColumnVisibility[index];
    if(preferenceKey)col.width=declaredColumns[index].width;
  });
  persistColumns();
}

/**
 * 同步清理选中行、主键及界面状态
 */
function clearSelection(): void {
  selectedRows.value = [];
  selectedKeys.value = [];
  elementTableRef.value?.clearSelection();
}

/**
 * 读取当前勾选的记录
 */
function getSelection() {
  return selectedRows.value;
}

/**
 * 沿用已提交的条件查询，可选择回到第一页
 */
function refresh(resetPage = false): Promise<void> {
  return loadData(appliedQuery, resetPage);
}

/**
 * 删除指定行或勾选记录，成功后刷新列表
 */
async function handleDelete(
  id?: number | string,
  permission?: string | string[] | null,
): Promise<void> {
  const ids = id === undefined ? selectedKeys.value.join(",") : String(id);
  if (!ids) return;
  const action = props.tableConfig.deleteByIds;
  if (!action) throw new Error("未配置删除接口");
  const confirmed = await ElMessageBox.confirm("确认删除选中记录？", "提示", {
    confirmButtonText: "确定",
    cancelButtonText: "取消",
    type: "warning",
  }).then(
    () => true,
    () => false,
  );
  if (!confirmed || (permission && !hasPerm(permission))) return;
  await action(ids);
  clearSelection();
  ElMessage.success("删除成功");
  // 删除已成功，刷新失败可单独重试
  await refresh().catch(() => undefined);
}

// All workbook parsing and generation belongs to the server.
const exporting = ref(false);
const uploadRef = ref<UploadInstance>();
const importModalVisible = ref(false);
const importing = ref(false);
const importError = ref("");
const importFormRef = ref<FormInstance>();
const importFormData = reactive<{
  files: UploadUserFile[];
}>({
  files: [],
});
const importFormRules: FormRules = {
  files: [{ required: true, message: "请选择文件" }],
};

/**
 * 打开文件导入表单
 */
function handleOpenImportModal() {
  if (!props.tableConfig.importFile) throw new Error("未配置文件导入接口");
  importError.value = "";
  importModalVisible.value = true;
}
/**
 * 用新文件替换已选文件
 */
function handleFileExceed(files: File[]) {
  uploadRef.value!.clearFiles();
  const file = files[0] as UploadRawFile;
  file.uid = genFileId();
  uploadRef.value!.handleStart(file);
}
/**
 * 下载导入模板
 */
async function handleDownloadTemplate(): Promise<void> {
  const template = props.tableConfig.importTemplate;
  if (typeof template === "string") window.open(template);
  else if (typeof template === "function") downloadFile(await template());
  else ElMessage.error("未配置导入模板");
}

/**
 * 校验后导入文件，成功后刷新列表
 */
async function handleImportSubmit(): Promise<void> {
  if (importing.value) return;
  importing.value = true;
  importError.value = "";
  try {
    if (!(await importFormRef.value?.validate().catch(() => false))) return;
    const result = await importFile();
    const summary = readImportSummary(result);
    if (summary && summary.invalidCount > 0) {
      importError.value =
        "已导入 " +
        summary.validCount +
        " 条，无效 " +
        summary.invalidCount +
        " 条。请修正后重新选择文件。" +
        summary.messages.slice(0, 5).join("；");
      importFormData.files = [];
      if (summary.validCount > 0) await refresh(true).catch(() => undefined);
      return;
    }
    ElMessage.success("导入成功");
    handleCloseImportModal();
    await refresh(true).catch(() => undefined);
  } catch (error) {
    importError.value = error instanceof Error ? error.message : "导入失败，请重试";
  } finally {
    importing.value = false;
  }
}

/**
 * 关闭并重置导入表单
 */
function handleCloseImportModal() {
  importModalVisible.value = false;
  importFormRef.value?.resetFields();
  nextTick(() => {
    importFormRef.value?.clearValidate();
  });
}
/**
 * 将原文件交给导入接口处理
 */
async function importFile(): Promise<unknown> {
  const action = props.tableConfig.importFile;
  if (!action) throw new Error("未配置文件导入接口");
  const file = importFormData.files[0]?.raw;
  if (!file) throw new Error("请选择导入文件");
  return action(file);
}
/**
 * 执行内置工具，或发出自定义工具栏事件
 */
async function handleToolbar(key: string): Promise<void> {
  switch (key) {
    case "refresh":
      await refresh();
      break;
    case "search":
      emit("toggle-search");
      break;
    case "create":
      emit("create");
      break;
    case "delete":
      await handleDelete();
      break;
    case "import":
      handleOpenImportModal();
      break;
    case "export":
      await exportFile();
      break;
    default:
      emit("toolbar-action", key);
      break;
  }
}

/**
 * 保存单元格修改，失败时回滚未刷新的记录
 */
async function handleModify(
  field: string,
  value: boolean | string | number,
  row: CrudRecord,
): Promise<void> {
  const id = getRowKey(row);
  const original = confirmedRows.get(id);
  if (!original || Object.is(original[field], value) || isCellDisabled(row, field)) return;
  const action = props.tableConfig.updateField;
  if (!action) return;
  const key = JSON.stringify([id, field]);
  pendingCells.add(key);
  actionError.value = "";
  try {
    await action({ [rowKey]: id, field, value });
    if (confirmedRows.get(id) === original) {
      original[field] = cloneDeep(value);
      row[field] = cloneDeep(value);
    }
  } catch (error) {
    if (confirmedRows.get(id) === original && pageData.value.includes(row))
      row[field] = cloneDeep(original[field]);
    actionError.value = error instanceof Error ? error.message : "修改失败，请重试";
  } finally {
    pendingCells.delete(key);
  }
}

/**
 * 读取字符串或数字主键，缺失时抛错
 */
function getRowKey(row: CrudRecord): string | number {
  const value: unknown = row[rowKey];
  if (typeof value === "string" || typeof value === "number") return value;
  throw new Error("列表记录缺少有效主键：" + rowKey);
}

/**
 * 配置保存接口且有更新权限时允许编辑，保存中禁用
 */
function isCellDisabled(row: CrudRecord, field: string): boolean {
  return (
    !props.tableConfig.updateField ||
    !hasActionPermission("update") ||
    pendingCells.has(JSON.stringify([getRowKey(row), field]))
  );
}

/**
 * 切换每页条数并回到第一页
 */
function handleSizeChange(value: number) {
  pagination.pageSize = value;
  void refresh(true).catch(() => undefined);
}
/**
 * 切换页码并查询列表
 */
function handleCurrentChange(value: number) {
  pagination.currentPage = value;
  void refresh().catch(() => undefined);
}

let filterParams: CrudRecord = {};
const rawFilters = reactive<Record<string, FilterValue[]>>({});
const statusColumn = computed(() => props.tableConfig.statusTabColumn
  ? columns.value.find(col => col.prop === props.tableConfig.statusTabColumn && Array.isArray(col.filters))
  : undefined);
const statusOptions = computed(() => (statusColumn.value?.filters as { text: string; value: string }[] | undefined) ?? []);
const selectedStatus = computed(() => {
  const col = statusColumn.value;
  return col ? String(rawFilters[columnIdentity(col)]?.[0] ?? "all") : "all";
});
function selectStatus(status: string | number) {
  const col = statusColumn.value;
  if (!col || typeof status !== "string" || status === selectedStatus.value) return;
  const values = status === "all" ? [] : [status];
  col.filteredValue = values;
  handleFilterChange({ [columnIdentity(col)]: values });
}
for(const col of columns.value){
  if(!Array.isArray(col.filteredValue)||!col.filteredValue.length)continue;
  const key=columnIdentity(col);
  rawFilters[key]=[...col.filteredValue] as FilterValue[];
  filterParams[key]=col.filterJoin!==undefined?rawFilters[key].join(col.filterJoin):rawFilters[key];
}
/**
 * 转换表头筛选值；清空的列从累计条件中删除，再通知页面应用筛选
 */
function handleFilterChange(newFilters: Record<string, (string | number | boolean)[]>) {
  for (const key in newFilters) {
    const values = newFilters[key];
    if (!values || values.length === 0) {
      Reflect.deleteProperty(filterParams, key);
      Reflect.deleteProperty(rawFilters,key);
      continue;
    }
    const col = columns.value.find((col) => {
      return col.columnKey === key || col["column-key"] === key;
    });
    rawFilters[key]=[...values];
    filterParams[key] = col && col.filterJoin !== undefined ? values.join(col.filterJoin) : values;
  }
  if(nativeReady)emit("filter-change", { ...filterParams });
}

/**
 * 读取已转换的表头筛选条件
 */
function getFilters() {
  return filterParams;
}

let appliedQuery: CrudRecord = {};
let scrollState=restored?.scroll??{top:0,left:0};
let restoreScroll=Boolean(restored);
let successfulState:ListState|undefined;
function getRestoredQuery(){return restored?.query}
function persistState(){
  if(successfulState)writeListState(sessionStorage,preferenceKey,{...successfulState,scroll:scrollState});
}
function publishQueryUrl(){
  if(!successfulState||!preferenceKey||!routeActive||routeIdentity!==listRouteIdentity(route.fullPath))return;
  if(Array.from(document.querySelectorAll<HTMLElement>(".el-dialog,.el-drawer")).some(node=>node.getBoundingClientRect().height>0&&getComputedStyle(node).visibility==="visible"))return;
  const encoded=encodeListUrl(props.tableConfig.stateKey,successfulState);
  if(!encoded||route.query[LIST_QUERY_KEY]===encoded)return;
  // Avoid adding default metadata to every plain module URL. A user-applied query/page must be shareable.
  const meaningful=successfulState.page!==1||successfulState.size!==20||Boolean(successfulState.sort)||
    Object.keys(successfulState.filters).length>0||Object.values(successfulState.query).some(v=>v!==undefined&&v!==null&&v!==""&&(!Array.isArray(v)||v.length));
  if(!meaningful&&!route.query[LIST_QUERY_KEY])return;
  void router.replace({path:route.path,query:{...route.query,[LIST_QUERY_KEY]:meaningful?encoded:undefined},hash:route.hash}).catch(()=>undefined);
}
function handleTableScroll(event:{scrollTop:number;scrollLeft:number}){
  if(loading.value||restoreScroll||!successfulState)return;
  scrollState={top:event.scrollTop,left:event.scrollLeft};persistState();
}
let lastSuccessfulQuery: CrudRecord | undefined;
let pageSequence = 0;
const canExport = computed(
  () => !loading.value && !loadError.value && lastSuccessfulQuery !== undefined,
);
onScopeDispose(() => {
  routeActive=false;
  pageSequence += 1;
});

/**
 * 仅最新响应回填列表，成功查询同时记录导出所用条件
 */
async function loadData(query: CrudRecord = appliedQuery, resetPage = false): Promise<void> {
  const sequence = ++pageSequence;
  loading.value = true;
  loadError.value = "";
  appliedQuery = cloneDeep(query);
  if (resetPage) {
    pagination.currentPage = 1;
    scrollState={top:0,left:0};restoreScroll=false;
    clearSelection();
  }
  const params = {
    ...cloneDeep(query),
    ...cloneDeep(getFilters()),
    ...(showPagination
      ? {
          [paginationKeys.page]: pagination.currentPage,
          [paginationKeys.size]: pagination.pageSize,
        }
      : {}),
  };
  if (sort.value) params.sort = [...sort.value];
  else Reflect.deleteProperty(params, "sort");
  try {
    const data = await props.tableConfig.fetchData(params);
    if (sequence !== pageSequence) return;
    const rows = Array.isArray(data) ? data : data?.list;
    const total = Array.isArray(data) ? data.length : data?.total;
    if (!Array.isArray(rows) || !Number.isInteger(total) || total < 0)
      throw new Error("请在 fetchData 中将接口结果转换为数组或 { list, total }");
    const maxPage = Math.max(1, Math.ceil(total / pagination.pageSize));
    if (showPagination && pagination.currentPage > maxPage) {
      pagination.currentPage = maxPage;
      await loadData(query);
      return;
    }
    pageData.value = rows;
    pagination.total = total;
    confirmedRows.clear();
    pageData.value.forEach((row) => confirmedRows.set(getRowKey(row), cloneDeep(row)));
    lastSuccessfulQuery = cloneDeep(params);
    successfulState={query:cloneDeep(appliedQuery),sort:sortState,filters:cloneDeep(rawFilters),
      page:pagination.currentPage,size:pagination.pageSize,scroll:scrollState};
    if(restoreScroll){
      await nextTick();
      if(sequence!==pageSequence)return;
      elementTableRef.value?.setScrollTop(scrollState.top);
      elementTableRef.value?.setScrollLeft(scrollState.left);
      restoreScroll=false;
    }else if(resetPage){
      elementTableRef.value?.setScrollTop(0);
    }
    persistState();
    publishQueryUrl();
  } catch (error) {
    if (sequence === pageSequence)
      loadError.value = error instanceof Error ? error.message : "列表加载失败";
    throw error;
  } finally {
    if (sequence === pageSequence) loading.value = false;
  }
}

/**
 * 读取上次成功查询的条件，去除分页参数
 */
function getExportQuery(): CrudRecord {
  if (!canExport.value || !lastSuccessfulQuery) throw new Error("请先成功加载列表再导出");
  const params = cloneDeep(lastSuccessfulQuery);
  Reflect.deleteProperty(params, paginationKeys.page);
  Reflect.deleteProperty(params, paginationKeys.size);
  return params;
}

/**
 * 服务端导出期间禁止重复请求
 */
async function exportFile(): Promise<void> {
  if (exporting.value) return;
  const action = props.tableConfig.exportFile;
  if (!action) throw new Error("未配置文件导出接口");
  const params = getExportQuery();
  exporting.value = true;
  try {
    downloadFile(await action(params));
  } finally {
    exporting.value = false;
  }
}

/**
 * 应用远程排序；本地排序保留 Element Plus 原有行为
 */
async function handleSortChange(state: TableSort): Promise<void> {
  const column = columns.value.find((col) => col.prop === state.prop);
  if (column?.sortable !== "custom" && !(state.order === null && sort.value)) return;
  const next=buildSort(state, column?.sortField ?? state.prop);
  if(JSON.stringify(next)===JSON.stringify(sort.value))return;
  sort.value=next;
  sortState=state.prop&&state.order?{prop:state.prop,order:state.order}:undefined;
  if(nativeReady)await refresh(true).catch(()=>undefined);
}

/**
 * 清除表头筛选和内部条件，不发起查询
 */
function clearFilters(): void {
  filterParams = {};
  for(const key of Object.keys(rawFilters))delete rawFilters[key];
  if (statusColumn.value) statusColumn.value.filteredValue = [];
  elementTableRef.value?.clearFilter();
}

if (props.autoLoad !== false) void loadData().catch(() => undefined);

defineExpose({
  loadData,
  getRestoredQuery,
  exportFile,
  getFilters,
  getSelection,
  getExportQuery,
  canExport,
  refresh,
  clearFilters,
});
</script>

<style lang="scss" scoped>
.toolbar-left,
.toolbar-right {
  .el-button {
    margin-right: 0 !important;
    margin-left: 0 !important;
  }
}

:deep(.el-table__header .cell:has(> .crud-column-title)) {
  display: flex;
  align-items: center;
  white-space: nowrap;

  .caret-wrapper,
  .el-table__column-filter-trigger {
    flex-shrink: 0;
  }
}

.crud-column-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  align-items: center;
  white-space: nowrap;
}

.row-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}
</style>

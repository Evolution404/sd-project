<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import BusinessTable, { type TableColumn } from "../../../shared/ui/BusinessTable.vue";
import { api, quantity } from "../../../shared/api/client";
import type { Page } from "../../../../../server/shared/types/contracts";
import type { DemandListItem, DemandRecord } from "../../../../../server/shared/types/demands";

const props=defineProps<{open:boolean;projectId:string;existingIds:string[]}>();
const emit=defineEmits<{
  "update:open":[open:boolean];
  linked:[count:number];
}>();
const query=ref(""),appliedQuery=ref(""),page=ref(1),total=ref(0);
const candidates=ref<DemandListItem[]>([]);
const includePending=ref(false),loading=ref(false),saving=ref(false);
const sort=ref(""),direction=ref<"asc"|"desc">("desc");
const filters=ref<Record<string,string>>({});
const chosen=ref<Record<string,DemandListItem>>({});
const preview=ref<DemandRecord|null>(null),previewLoading=ref(false),previewError=ref("");
let requestSeq=0,previewSeq=0;
const pageSize=30;
const columns:TableColumn[]=[
  {key:"selected",label:"选择",minWidth:100,customHeader:true,sortable:false,filterable:false,hideable:false},
  {key:"demand_no",label:"需求编号",minWidth:180,sortable:true,filterable:true,hideable:false},
  {key:"operation_snapshot",label:"操作类型",minWidth:170,sortable:true,filterable:true},
  {key:"line_name_snapshot",label:"线路",minWidth:170,sortable:true,filterable:true},
  {key:"problem_description",label:"问题描述",minWidth:250,sortable:true,filterable:true},
  {key:"quantity_scaled",label:"需求总量",minWidth:120,sortable:true,filterable:false},
  {key:"location_count",label:"位置数",minWidth:100,sortable:false,filterable:false},
  {key:"status",label:"需求状态",minWidth:125,sortable:true,filterable:false},
];
const locationColumns:TableColumn[]=[
  {key:"item_no",label:"序号",minWidth:80},
  {key:"location_label",label:"作业位置",minWidth:230},
  {key:"line_name",label:"线路",minWidth:175},
  {key:"quantity_scaled",label:"位置工作量",minWidth:125},
  {key:"work_mode",label:"作业方式",minWidth:120},
];
const materialColumns:TableColumn[]=[
  {key:"material_name",label:"物资名称",minWidth:185},
  {key:"model",label:"型号",minWidth:160},
  {key:"specification",label:"规格",minWidth:160},
  {key:"quantity_scaled",label:"数量",minWidth:110},
];
const existing=computed(()=>new Set(props.existingIds));
const available=computed(()=>candidates.value.filter(row=>!existing.value.has(row.id)));
const selectedCount=computed(()=>Object.keys(chosen.value).length);
const selectedPreview=computed(()=>Object.values(chosen.value).slice(0,20));
const selectedOnPage=computed(()=>available.value.filter(row=>!!chosen.value[row.id]).length);
const allOnPage=computed(()=>available.value.length>0&&selectedOnPage.value===available.value.length);
const partialOnPage=computed(()=>selectedOnPage.value>0&&!allOnPage.value);
const locations=computed(()=>(preview.value?.work_locations||[]).map(loc=>({
  ...loc,
  location_label:loc.location_snapshot_json?.location_label||loc.location_snapshot_json?.physical_code||"—",
  line_name:loc.location_snapshot_json?.line_name||"—",
})));
watch(()=>props.open,open=>{
  ++requestSeq;++previewSeq;
  if(!open){preview.value=null;return;}
  query.value="";appliedQuery.value="";page.value=1;total.value=0;
  candidates.value=[];chosen.value={};includePending.value=false;
  sort.value="";direction.value="desc";filters.value={};
  preview.value=null;previewError.value="";
  void load();
});
function search(){
  appliedQuery.value=query.value.trim();
  page.value=1;
  void load();
}
function updateSort(value:{key:string;order:string}){
  sort.value=value.order&&columns.some(col=>col.key===value.key&&col.sortable)?value.key:"";
  direction.value=value.order==="ascending"?"asc":"desc";
  page.value=1;void load();
}
function updateFilters(value:Record<string,string>){
  filters.value=Object.fromEntries(Object.entries(value)
    .filter(([key,val])=>columns.some(col=>col.key===key&&col.filterable)&&!!val?.trim()));
  page.value=1;void load();
}
function changePending(){
  if(!includePending.value){
    chosen.value=Object.fromEntries(Object.entries(chosen.value).filter(([,row])=>row.status==="active"));
  }
  page.value=1;void load();
}
async function load(){
  const current=++requestSeq;
  loading.value=true;
  try{
    const params=new URLSearchParams({
      page:String(page.value),page_size:String(pageSize),q:appliedQuery.value,
      include_pending:String(includePending.value),sort:sort.value||"created_at",
      direction:direction.value,filters:JSON.stringify(filters.value),
    });
    const result=await api<Page<DemandListItem>>("/demands/candidates?"+params);
    if(current!==requestSeq||!props.open)return;
    candidates.value=result.items;
    total.value=result.total;
  }catch(error){
    if(current===requestSeq){
      candidates.value=[];total.value=0;
      ElMessage.error("读取待承接需求失败："+(error as Error).message);
    }
  }finally{if(current===requestSeq)loading.value=false;}
}
function choose(row:DemandListItem,selected:boolean){
  if(saving.value||loading.value||existing.value.has(row.id))return;
  if(selected){
    if(selectedCount.value>=100&&!chosen.value[row.id]){
      ElMessage.warning("每次最多关联100条需求，请分批操作");return;
    }
    chosen.value={...chosen.value,[row.id]:row};
  }else{
    const next={...chosen.value};
    delete next[row.id];
    chosen.value=next;
  }
}
function choosePage(selected:boolean){
  if(selected && selectedCount.value+
    available.value.filter(row=>!chosen.value[row.id]).length>100){
    ElMessage.warning("每批最多100条需求，请先减少选择");return;
  }
  for(const row of available.value)choose(row,selected);
}
async function viewDetail(row:DemandListItem){
  const seq=++previewSeq;
  preview.value=null;previewError.value="";previewLoading.value=true;
  try{
    const result=await api<DemandRecord>("/demands/"+encodeURIComponent(row.id));
    if(seq===previewSeq && props.open)preview.value=result;
  }catch(error){
    if(seq===previewSeq)previewError.value=(error as Error).message;
  }finally{if(seq===previewSeq)previewLoading.value=false;}
}
function closePreview(){++previewSeq;preview.value=null;previewError.value="";previewLoading.value=false;}
function close(){if(!saving.value){closePreview();emit("update:open",false);}}
async function submit(){
  if(saving.value||loading.value||!selectedCount.value||!props.projectId)return;
  saving.value=true;
  try{
    const links=Object.values(chosen.value).map(row=>({
      demand_id:row.id,expected_version:row.current_version,
    }));
    await api("/projects/"+encodeURIComponent(props.projectId)+"/link-batch","POST",{links});
    const count=links.length;
    ElMessage.success("已完整关联"+count+"条专业需求");
    closePreview();
    emit("update:open",false);
    emit("linked",count);
  }catch(error){
    ElMessage.error("批量关联未生效，全部需求保持原状："+(error as Error).message);
    // Candidate versions may now be stale; keep the selected list for review.
  }finally{saving.value=false;}
}
</script>

<template>
  <ElDialog :model-value="open" title="关联专业需求" append-to-body
    width="min(1380px,96vw)" :close-on-click-modal="false"
    :close-on-press-escape="!saving" :show-close="!saving"
    @update:model-value="value=>{if(!value)close();}">
    <div class="demand-picker-toolbar">
      <ElInput v-model="query" clearable :disabled="saving"
        placeholder="搜索需求编号、操作类型、线路或问题描述"
        @keyup.enter="search" @change="search" />
      <ElButton type="primary" plain :loading="loading" :disabled="saving" @click="search">查询</ElButton>
      <ElButton :disabled="saving||loading||!available.length" @click="choosePage(true)">全选本页</ElButton>
      <ElButton :disabled="saving||loading||!selectedOnPage" @click="choosePage(false)">取消本页选择</ElButton>
    </div>
    <div class="demand-picker-options">
      <ElCheckbox v-model="includePending" :disabled="saving" @change="changePending">
        包含待确认需求（确认有效后方可立项）
      </ElCheckbox>
      <span class="muted">符合条件 {{total}} 条，可跨页多选</span>
    </div>
    <p class="muted picker-hint">
      可按需求编号、操作类型、线路和问题描述搜索、筛选或排序；点“查看详情”核对设备位置及工作量。
      选中整条需求后一次关联，不能只承接其中部分位置或数量。
    </p>
    <BusinessTable :rows="candidates" :columns="columns" table-key="project:demand-batch-picker"
      :loading="loading" :max-height="410" :actions-width="120"
      sort-mode="remote" filter-mode="remote" :filter-state="filters"
      :sort-state="{prop:sort,order:sort ? (direction==='asc'?'ascending':'descending'):null}"
      @sort-change="updateSort" @filter-change="updateFilters">
      <template #header="{column}">
        <ElCheckbox v-if="column.key==='selected'" :model-value="allOnPage"
          :indeterminate="partialOnPage" :disabled="loading||saving||!available.length"
          :aria-label="allOnPage?'取消全选本页需求':'全选本页需求'"
          @change="choosePage(Boolean($event))">{{ allOnPage?'取消本页':'全选本页' }}</ElCheckbox>
      </template>
      <template #cell="{row,column}">
        <ElCheckbox v-if="column.key==='selected'" :model-value="!!chosen[row.id]||existing.has(row.id)"
          :disabled="loading||saving||existing.has(row.id)"
          :aria-label="'选择需求：'+row.demand_no"
          @change="choose(row,Boolean($event))" />
        <span v-else-if="column.key==='quantity_scaled'">{{quantity(row.quantity_scaled)}} {{row.unit_snapshot||''}}</span>
        <span v-else-if="column.key==='location_count'">{{row.work_locations?.length||0}}</span>
        <ElTag v-else-if="column.key==='status'" effect="plain"
          :type="row.status==='active'?'success':'warning'">{{row.status==='active'?'待承接':'待确认'}}</ElTag>
        <span v-else-if="column.key==='demand_no'">
          {{row.demand_no}} <ElTag v-if="chosen[row.id]" type="info" size="small">已选</ElTag>
        </span>
        <span v-else>{{row[column.key as keyof typeof row]||'—'}}</span>
      </template>
      <template #actions="{row}">
        <ElButton link type="primary" :aria-label="'查看需求详情：'+row.demand_no"
          @click="viewDetail(row)">查看详情</ElButton>
      </template>
    </BusinessTable>
    <div class="demand-picker-pager">
      <span class="muted">第 {{page}} 页 · 每页 {{pageSize}} 条</span>
      <ElPagination v-model:current-page="page" :page-size="pageSize" :total="total"
        layout="prev, pager, next, total" :disabled="loading||saving" @current-change="load" />
    </div>
    <div class="demand-picker-selection">
      <div class="demand-picker-selection-heading">
        <strong>已选 {{selectedCount}} 条专业需求</strong>
        <ElButton v-if="selectedCount" link type="primary" :disabled="saving"
          @click="chosen={}">清空全部选择</ElButton>
      </div>
      <div class="demand-picker-tags">
        <ElTag v-for="item in selectedPreview" :key="item.id" closable
          :disable-transitions="true" @close="choose(item,false)">
          {{item.demand_no}} · {{item.operation_snapshot}}
        </ElTag>
        <span v-if="selectedCount>selectedPreview.length" class="muted">
          另有 {{selectedCount-selectedPreview.length}} 条已保留
        </span>
      </div>
      <p v-if="!selectedCount" class="muted">请在上方表格勾选需求，可跨页保留选择后统一关联。</p>
      <p v-else-if="Object.values(chosen).some(row=>row.status==='pending')" class="muted">
        已选需求含待确认项；可以关联项目储备，正式立项前仍须确认其有效性。
      </p>
    </div>
    <template #footer>
      <span class="muted picker-footer-hint">一次提交，全部成功或全部回滚</span>
      <ElButton :disabled="saving" @click="close">取消</ElButton>
      <ElButton data-guide-action="projects.save" type="primary"
        :loading="saving" :disabled="saving||loading||!selectedCount"
        @click="submit">关联已选需求（{{selectedCount}}）</ElButton>
    </template>
  </ElDialog>
  <ElDialog :model-value="!!preview||previewLoading||!!previewError"
    append-to-body title="专业需求详情" width="min(980px,94vw)"
    :close-on-click-modal="false" @update:model-value="value=>{if(!value)closePreview();}">
    <ElSkeleton v-if="previewLoading" :rows="6" animated/>
    <ElAlert v-else-if="previewError" type="error" :title="previewError" :closable="false"/>
    <template v-else-if="preview">
      <ElDescriptions :column="2" border class="demand-picker-details">
        <ElDescriptionsItem label="需求编号">{{preview.demand_no}}</ElDescriptionsItem>
        <ElDescriptionsItem label="需求状态">
          {{preview.status==='active'?'待承接':preview.status==='pending'?'待确认':preview.status}}
        </ElDescriptionsItem>
        <ElDescriptionsItem label="操作类型">{{preview.operation_snapshot}}</ElDescriptionsItem>
        <ElDescriptionsItem label="需求版本">V{{preview.current_version}}</ElDescriptionsItem>
        <ElDescriptionsItem label="工作总量">{{quantity(preview.quantity_scaled)}} {{preview.unit_snapshot}}</ElDescriptionsItem>
        <ElDescriptionsItem label="位置数">{{preview.work_locations.length}}</ElDescriptionsItem>
        <ElDescriptionsItem label="问题描述" :span="2">{{preview.problem_description}}</ElDescriptionsItem>
        <ElDescriptionsItem label="验收标准" :span="2">{{preview.completion_standard||"—"}}</ElDescriptionsItem>
      </ElDescriptions>
      <h3>作业位置与数量</h3>
      <BusinessTable client-side table-key="project:demand-preview-locations"
        :rows="locations" :columns="locationColumns" :max-height="260" :actions-width="0">
        <template #cell="{row,column}">
          <span v-if="column.key==='quantity_scaled'">{{quantity(row.quantity_scaled)}}</span>
          <span v-else-if="column.key==='work_mode'">
            {{row.work_mode==='outage'?'停电':row.work_mode==='non_outage'?'不停电':'未明确'}}
          </span>
          <span v-else>{{row[column.key as keyof typeof row]||'—'}}</span>
        </template>
      </BusinessTable>
      <template v-if="preview.materials.length">
        <h3>预计物资</h3>
        <BusinessTable client-side table-key="project:demand-preview-materials"
          :rows="preview.materials" :columns="materialColumns" :max-height="220" :actions-width="0">
          <template #cell="{row,column}">
            <span v-if="column.key==='quantity_scaled'">{{quantity(row.quantity_scaled)}}</span>
            <span v-else>{{row[column.key as keyof typeof row]||'—'}}</span>
          </template>
        </BusinessTable>
      </template>
      <template v-if="preview.sources?.length">
        <h3>需求来源</h3>
        <p v-for="source in preview.sources" :key="source.id" class="muted">{{source.description}}</p>
      </template>
    </template>
    <template #footer><ElButton @click="closePreview">返回需求选择</ElButton></template>
  </ElDialog>
</template>
<style scoped>
.demand-picker-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.demand-picker-toolbar>.el-input{flex:1 1 300px;min-width:230px;max-width:680px}
.demand-picker-toolbar>.el-button+.el-button{margin-left:0}
.demand-picker-options{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:14px 0 3px}
.picker-hint{font-size:12px;line-height:1.6;margin:8px 0 12px}
.demand-picker-pager{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin:12px 0}
.demand-picker-selection{background:var(--surface-subtle);border:1px solid var(--edge);border-radius:12px;padding:12px 14px;margin-top:8px}
.demand-picker-selection-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}
.demand-picker-selection strong{font-size:13px}
.demand-picker-tags{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-top:9px}
.demand-picker-selection p{font-size:12px;margin:8px 0 0}
.picker-footer-hint{font-size:12px;margin-right:auto}
.demand-picker-details{margin-bottom:15px}
h3{font-size:14px;margin:17px 0 9px}
@media(max-width:700px){.picker-footer-hint{flex-basis:100%}.demand-picker-toolbar>.el-input{max-width:none}}
</style>

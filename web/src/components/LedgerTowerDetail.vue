<script setup lang="ts">
import {computed,ref,watch} from 'vue';
import {ElButton,ElCard,ElDescriptions,ElDescriptionsItem,ElEmpty,ElTable,ElTableColumn,ElTabPane,ElTabs,ElTag,ElTimeline,ElTimelineItem} from 'element-plus';
type Rec=Record<string,any>;
const props=defineProps<{tower:Rec;lineName:string;canWrite:boolean;canInsert:boolean;inCurrentLine:boolean}>();
const emit=defineEmits<{
 (e:'back'):void;(e:'edit'):void;(e:'insert'):void;
 (e:'bind'):void;(e:'replace'):void;(e:'remove'):void;
 (e:'selectShared',row:Rec):void;
}>();
const activeTab=ref('base');
watch(()=>props.tower.id,()=>activeTab.value='base');
const value=(v:any)=>v===null||v===undefined||String(v).trim()===''?'未填写':String(v);
const status=(s:string)=>s==='active'?'在用':s==='inactive'?'停用':s==='retired'?'已退役':s==='draft'?'待完善':s||'未知';
const fmtDate=(v:string)=>{if(!v)return '未填写';const d=new Date(v);return Number.isNaN(d.getTime())?v:d.toLocaleString('zh-CN')};
const fmtAmount=(n:any)=>Number.isFinite(Number(n))?(Number(n)/10000).toFixed(4).replace(/\.?0+$/,''):'待核实';
const fmtDistance=(n:any)=>n===null||n===undefined?'坐标不足，无法推算':fmtAmount(n)+' 米';
const relations=computed<Rec[]>(()=>props.tower.shared_with||[]);
const neighbours=computed<Rec[]>(()=>props.tower.spans||[]);
const history=computed<Rec[]>(()=>{
 const names=(props.tower.names||[]).map((x:Rec)=>({...x,_kind:'name'}));
 const bindings=(props.tower.bindings||[]).map((x:Rec)=>({...x,_kind:'binding'}));
 return [...names,...bindings].sort((a,b)=>String(b.valid_from||'').localeCompare(String(a.valid_from||'')));
});
const heading=(item:Rec)=>item._kind==='name'?'杆塔命名调整':
 item.change_kind==='replacement'?'实际换塔':item.change_kind==='correction'?'共塔关联纠正':'实体关联建立';
</script>
<template>
 <article class="tower-detail-page" aria-label="杆塔详情页面">
  <nav class="tower-detail-crumbs" aria-label="杆塔详情导航">
   <ElButton link type="primary" aria-label="关闭杆塔详情" @click="emit('back')">返回{{inCurrentLine?'杆塔列表':'查询结果'}}</ElButton>
   <span aria-hidden="true">/</span><span class="tower-truncate">{{lineName}}</span><span aria-hidden="true">/</span><strong>杆塔 {{tower.tower_no}}</strong>
  </nav>
  <header class="tower-detail-heading">
   <div class="tower-detail-heading-title">
    <p class="tower-detail-eyebrow">设备台账 / 杆塔详情</p>
    <h2>杆塔 {{tower.tower_no}}</h2>
    <div class="tower-detail-subtitle"><span>{{lineName}}</span><ElTag :type="tower.status==='active'?'success':'info'" effect="plain">{{status(tower.status)}}</ElTag><span v-if="relations.length>1">共塔关联 {{relations.length}} 个线路位置</span></div>
   </div>
   <div class="tower-detail-operations" v-if="canWrite&&inCurrentLine">
    <ElButton type="primary" @click="emit('edit')">编辑杆塔</ElButton>
    <ElButton :disabled="!canInsert" @click="emit('insert')">后插入</ElButton>
    <ElButton @click="emit('bind')">关联共塔</ElButton>
    <ElButton @click="emit('replace')">实际换塔</ElButton>
   </div>
  </header>
  <div class="tower-detail-metrics">
   <ElCard shadow="never"><span>管辖部门</span><strong>{{value(tower.management_department||'待核实')}}</strong></ElCard>
   <ElCard shadow="never"><span>结构 / 型号</span><strong>{{value(tower.physical?.tower_type)}} / {{value(tower.physical?.model)}}</strong></ElCard>
   <ElCard shadow="never"><span>实体关联</span><strong>{{relations.length>1?'共塔 · '+relations.length+' 个位置':'独立杆塔'}}</strong></ElCard>
   <ElCard shadow="never"><span>业务引用</span><strong>{{tower.demand_count||0}} 条需求</strong></ElCard>
  </div>
  <ElCard shadow="never" class="tower-detail-content">
   <ElTabs v-model="activeTab" class="tower-detail-tabs">
    <ElTabPane label="基础信息" name="base">
     <ElDescriptions border :column="2" class="tower-detail-descriptions">
      <ElDescriptionsItem label="线路名称">{{lineName}}</ElDescriptionsItem>
      <ElDescriptionsItem label="杆塔编号">{{tower.tower_no}}</ElDescriptionsItem>
      <ElDescriptionsItem label="管辖部门">{{value(tower.management_department||'待核实')}}</ElDescriptionsItem>
      <ElDescriptionsItem label="所属代维队">{{value(tower.maintenance_team)}}</ElDescriptionsItem>
      <ElDescriptionsItem label="回路位置">{{value(tower.circuit_position)}}</ElDescriptionsItem>
      <ElDescriptionsItem label="状态">{{status(tower.status)}}</ElDescriptionsItem>
      <ElDescriptionsItem label="结构类型">{{value(tower.physical?.tower_type)}}</ElDescriptionsItem>
      <ElDescriptionsItem label="杆塔型号">{{value(tower.physical?.model)}}</ElDescriptionsItem>
      <ElDescriptionsItem label="杆塔用途">{{value(tower.physical?.purpose)}}</ElDescriptionsItem>
      <ElDescriptionsItem label="塔高">{{tower.physical?.height_scaled==null?'未填写':fmtAmount(tower.physical.height_scaled)+' 米'}}</ElDescriptionsItem>
      <ElDescriptionsItem label="投运日期">{{value(tower.physical?.commissioned_on)}}</ElDescriptionsItem>
      <ElDescriptionsItem label="资产编号">{{value(tower.physical?.asset_no)}}</ElDescriptionsItem>
      <ElDescriptionsItem label="经度">{{value(tower.physical?.longitude)}}</ElDescriptionsItem>
      <ElDescriptionsItem label="纬度">{{value(tower.physical?.latitude)}}</ElDescriptionsItem>
     </ElDescriptions>
    </ElTabPane>
    <ElTabPane :label="'关联线路 ('+relations.length+')'" name="relations">
     <ElTable :data="relations" stripe row-key="id" empty-text="尚无关联线路">
      <ElTableColumn prop="line_name" label="线路" min-width="160" show-overflow-tooltip/>
      <ElTableColumn prop="tower_no" label="杆塔编号" min-width="130"/>
      <ElTableColumn label="回路位置" min-width="125"><template #default="{row}">{{value(row.circuit_position)}}</template></ElTableColumn>
      <ElTableColumn label="状态" width="94"><template #default="{row}">{{status(row.status)}}</template></ElTableColumn>
      <ElTableColumn label="操作" width="120"><template #default="{row}"><ElButton link type="primary" :disabled="row.id===tower.id" @click="emit('selectShared',row)">{{row.id===tower.id?'当前杆塔':'查看该位置'}}</ElButton></template></ElTableColumn>
     </ElTable>
     <p class="tower-detail-hint">一个实际杆塔只维护一份公共属性，线路位置和命名分别管理。</p>
    </ElTabPane>
    <ElTabPane :label="'相邻档距 ('+neighbours.length+')'" name="spans">
     <ElTable :data="neighbours" stripe row-key="id" empty-text="尚未建立相邻档距">
      <ElTableColumn prop="line_name" label="线路" min-width="145" show-overflow-tooltip/>
      <ElTableColumn prop="start_tower_no" label="起点杆塔" min-width="120"/>
      <ElTableColumn prop="end_tower_no" label="终点杆塔" min-width="120"/>
      <ElTableColumn label="推导长度" min-width="175"><template #default="{row}">{{fmtDistance(row.length_scaled)}}</template></ElTableColumn>
      <ElTableColumn label="状态" width="100"><template #default="{row}">{{status(row.status)}}</template></ElTableColumn>
      <ElTableColumn label="需求引用" width="106"><template #default="{row}">{{row.demand_count||0}} 条</template></ElTableColumn>
     </ElTable>
     <p class="tower-detail-hint">档距长度由两端杆塔坐标推算，不作为独立字段保存。</p>
    </ElTabPane>
    <ElTabPane :label="'变更历史 ('+history.length+')'" name="history">
     <ElTimeline v-if="history.length" class="tower-detail-timeline">
      <ElTimelineItem v-for="item in history" :key="item._kind+'-'+item.id" :timestamp="fmtDate(item.valid_from)" placement="top">
       <strong>{{heading(item)}}</strong>
       <p>{{item.tower_no||item.reason||'初始关联'}}</p>
       <p v-if="item.reason&&item.tower_no">{{item.reason}}</p>
      </ElTimelineItem>
     </ElTimeline>
     <ElEmpty v-else description="暂无命名或实体变更历史"/>
    </ElTabPane>
   </ElTabs>
  </ElCard>
  <footer class="tower-detail-footer">
   <span>该页面展示线路位置与实际杆塔的当前事实，编辑操作另行确认并保留历史。</span>
   <div class="tower-detail-footer-buttons">
    <ElButton v-if="canWrite&&inCurrentLine" type="danger" plain @click="emit('remove')">删除误录杆塔</ElButton>
    <ElButton @click="emit('back')">返回列表</ElButton>
   </div>
  </footer>
 </article>
</template>
<style scoped>
.tower-detail-page{min-width:0;width:100%;display:flex;flex-direction:column;gap:20px}
.tower-detail-crumbs{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--el-text-color-secondary);min-width:0;flex-wrap:wrap}
.tower-detail-crumbs strong{color:var(--el-text-color-primary)}
.tower-truncate{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:55%}
.tower-detail-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:22px;flex-wrap:wrap}
.tower-detail-eyebrow{font-size:12px;letter-spacing:.06em;color:var(--el-color-primary);margin:0 0 7px}
.tower-detail-heading h2{font-size:25px;line-height:1.35;margin:0}
.tower-detail-subtitle{display:flex;align-items:center;flex-wrap:wrap;gap:10px;color:var(--el-text-color-secondary);font-size:13px;margin-top:9px}
.tower-detail-operations,.tower-detail-footer-buttons{display:flex;flex-wrap:wrap;gap:8px}
.tower-detail-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.tower-detail-metrics :deep(.el-card__body){min-height:96px;display:flex;flex-direction:column;justify-content:center;gap:12px;padding:16px}
.tower-detail-metrics span{font-size:12px;color:var(--el-text-color-secondary)}
.tower-detail-metrics strong{font-size:15px;overflow-wrap:anywhere;line-height:1.55}
.tower-detail-content{min-width:0}.tower-detail-content :deep(.el-card__body){padding:18px 20px 24px}
.tower-detail-tabs{min-width:0}.tower-detail-descriptions{margin-top:10px}
.tower-detail-descriptions :deep(.el-descriptions__content){overflow-wrap:anywhere}
.tower-detail-tabs :deep(.el-table){width:100%}
.tower-detail-hint{font-size:12px;color:var(--el-text-color-secondary);margin-top:16px}
.tower-detail-timeline{margin:15px 0 0 12px}
.tower-detail-timeline p{font-size:13px;color:var(--el-text-color-secondary);margin:5px 0}
.tower-detail-footer{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:16px 0;border-top:1px solid var(--el-border-color-light);font-size:12px;color:var(--el-text-color-secondary)}
@media(max-width:1120px){.tower-detail-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:700px){.tower-detail-metrics{grid-template-columns:1fr}.tower-detail-heading h2{font-size:21px}.tower-detail-content :deep(.el-card__body){padding:12px}.tower-detail-descriptions :deep(.el-descriptions__table){table-layout:fixed}}
</style>

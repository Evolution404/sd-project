<script setup lang="ts">
import {ElButton,ElTable,ElTableColumn} from 'element-plus';
type Row=Record<string,any>;
defineProps<{overview:Row;demands:Row[]}>();
const emit=defineEmits<{(e:'navigate',section:string):void;(e:'openDemand',id:string):void}>();
const fmtQty=(n:number)=>(Number(n||0)/10000).toFixed(4).replace(/\.?0+$/,'');
</script>
<template>
<div class="stats"><div v-for="(label,key) in {lines:'线路',physical:'实体杆塔',logical:'逻辑杆塔',pending:'待核实需求',active:'有效需求'}" :key="key" class="stat"><small>{{label}}</small><strong>{{overview[key]??0}}</strong></div></div><section class="panel"><div class="section-header"><div><h2>待核实事项</h2><p class="muted">基于当前数据库实际记录</p></div><ElButton class="secondary" @click="emit('navigate','demands')">进入需求中心</ElButton></div><div v-if="!demands.filter(x=>x.status==='pending').length" class="empty">当前没有待核实需求</div><div v-else class="table-wrap"><ElTable :data="demands.filter(x=>x.status==='pending').slice(0,8)" >
<ElTableColumn><template #header>需求编号</template><template #default="{row,$index}"><template v-for="([d]) in [[row,$index]]"><div >{{d.demand_no}}</div></template></template></ElTableColumn>
<ElTableColumn><template #header>位置</template><template #default="{row,$index}"><template v-for="([d]) in [[row,$index]]"><div >{{d.line_name_snapshot}} {{d.tower_no_snapshot}}</div></template></template></ElTableColumn>
<ElTableColumn><template #header>操作</template><template #default="{row,$index}"><template v-for="([d]) in [[row,$index]]"><div >{{d.operation_snapshot}} · {{d.target_object}}</div></template></template></ElTableColumn>
<ElTableColumn><template #header>工作量</template><template #default="{row,$index}"><template v-for="([d]) in [[row,$index]]"><div >{{fmtQty(d.quantity_scaled)}} {{d.unit_snapshot}}</div></template></template></ElTableColumn>
<ElTableColumn><template #header></template><template #default="{row,$index}"><template v-for="([d]) in [[row,$index]]"><div ><ElButton class="link" @click="emit('navigate','demands');emit('openDemand',d.id)">查看</ElButton></div></template></template></ElTableColumn></ElTable></div></section>
</template>

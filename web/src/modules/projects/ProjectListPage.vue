<script setup lang="ts">
import {ElButton,ElTable,ElTableColumn} from 'element-plus';
import StatusTag from '../../shared/components/StatusTag.vue';
type Row=Record<string,any>;
defineProps<{projects:Row[];title:string;canCreate:boolean}>();
const emit=defineEmits<{(e:'create'):void;(e:'open',value:Row):void}>();
const money=(fen:number|null|undefined)=>fen==null?'—':(fen/100).toFixed(2);
</script>
<template>
<section class="panel">
    <div class="section-header"><div><h2>{{title}}</h2><p class="muted">管理：年度框架 → 子项目 → 检修计划 → 专业需求；资金：年度框架 → 协行协议 → 子项目 → 检修计划</p></div><ElButton v-if="canCreate" class="primary" @click="emit('create')">新增{{title}}</ElButton></div>
    <div class="table-wrap"><ElTable :data="projects" >
<ElTableColumn><template #header>名称</template><template #default="{row,$index}"><template v-for="([x]) in [[row,$index]]"><div >{{x.name}}</div></template></template></ElTableColumn>
<ElTableColumn><template #header>所属框架/协议</template><template #default="{row,$index}"><template v-for="([x]) in [[row,$index]]"><div >{{x.framework_name}} / {{x.agreement_name||'协议待落实'}}</div></template></template></ElTableColumn>
<ElTableColumn><template #header>已批准预算 (元)</template><template #default="{row,$index}"><template v-for="([x]) in [[row,$index]]"><div >{{money(x.approved_budget_fen)}}</div></template></template></ElTableColumn>
<ElTableColumn><template #header>状态</template><template #default="{row,$index}"><template v-for="([x]) in [[row,$index]]"><div ><StatusTag :status="x.status"/></div></template></template></ElTableColumn>
<ElTableColumn><template #header>操作</template><template #default="{row,$index}"><template v-for="([x]) in [[row,$index]]"><div ><ElButton class="link" @click="emit('open',x)">需求范围与阶段</ElButton></div></template></template></ElTableColumn><template #empty><div class="empty">暂无记录，请从创建框架开始</div></template></ElTable></div>
   </section>
</template>

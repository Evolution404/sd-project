<script setup lang="ts">
import {ElCheckbox} from 'element-plus';
type Tower=Record<string,any>;
const props=defineProps<{towers:Tower[];selected:Record<string,boolean>;excluded:Record<string,boolean>}>();
const emit=defineEmits<{(e:'select',id:string,checked:boolean):void}>();
</script>
<template>
 <div class="tower-grid" aria-label="杆塔选择">
  <label v-for="tower in towers" :key="tower.id" class="tower-card"
    :class="{checked:!!selected[tower.id]&&!excluded[tower.id]}">
   <ElCheckbox :model-value="!!selected[tower.id]&&!excluded[tower.id]"
    :aria-label="'选择杆塔 '+tower.tower_no"
    @change="value=>emit('select',tower.id,!!value)"/>
   <span><strong>{{tower.tower_no}}</strong><small v-if="tower.circuit_position">{{tower.circuit_position}}</small></span>
  </label>
  <p v-if="!towers.length" class="empty">当前筛选下暂无可选的启用杆塔</p>
 </div>
</template>

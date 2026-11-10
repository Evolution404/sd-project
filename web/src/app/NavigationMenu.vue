<script setup lang="ts">
import { computed } from "vue";
import { navigation, navigationGroup } from "./navigation";
const props = defineProps<{ active: string; collapsed?: boolean; admin: boolean }>();
const emit = defineEmits<{ select: [key: string] }>();
const groups = computed(() => navigation.map(group => ({
  ...group, items: group.items.filter(item => !item.adminOnly || props.admin),
})).filter(group => group.items.length));
</script>
<template>
  <ElMenu :key="active + String(collapsed)" :default-active="active"
    :default-openeds="['group-' + navigationGroup(active)]" :collapse="collapsed"
    :collapse-transition="false" unique-opened @select="key => emit('select', key)">
    <template v-for="group in groups" :key="group.key">
      <ElMenuItem v-if="group.key === 'home'" index="dashboard">
        <ElIcon><component :is="group.items[0].icon" /></ElIcon><template #title>工作台</template>
      </ElMenuItem>
      <ElSubMenu v-else :index="'group-' + group.key">
        <template #title><ElIcon><component :is="group.items[0].icon" /></ElIcon><span>{{ group.title }}</span></template>
        <ElMenuItem v-for="item in group.items" :key="item.key" :index="item.key">
          <ElIcon><component :is="item.icon" /></ElIcon><template #title>{{ item.title }}</template>
        </ElMenuItem>
      </ElSubMenu>
    </template>
  </ElMenu>
</template>

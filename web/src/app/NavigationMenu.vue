<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import type { MenuInstance } from "element-plus";
import { navigation, navigationGroup } from "./navigation";

const props = defineProps<{ active: string; collapsed?: boolean; admin: boolean }>();
const emit = defineEmits<{ select: [key: string] }>();
const storageKey = "sd-navigation-open-groups";
const defaults = ["business", "funds", "assets", "standards", "configuration"];
const validGroups = new Set(defaults);

function restoredGroups(): string[] {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored === null) return defaults;
    const parsed: unknown = JSON.parse(stored);
    if (Array.isArray(parsed)) return parsed.filter((value): value is string =>
      typeof value === "string" && validGroups.has(value));
  } catch {
    // Invalid older preferences must not hide the navigation.
  }
  return defaults;
}
const openGroups = ref(restoredGroups());
const menuRef = ref<MenuInstance>();
let menuInitialized = false;
const groups = computed(() => navigation.map(group => ({
  ...group, items: group.items.filter(item => !item.adminOnly || props.admin),
})).filter(group => group.items.length));
const initialOpeneds = openGroups.value.map(group => "group-" + group);
function remember() {
  localStorage.setItem(storageKey, JSON.stringify(openGroups.value));
}
function opened(index: string) {
  if (!menuInitialized) return;
  const key = index.replace(/^group-/, "");
  if (!validGroups.has(key) || openGroups.value.includes(key)) return;
  openGroups.value = [...openGroups.value, key];
  remember();
}
function closed(index: string) {
  if (props.collapsed) return;
  const key = index.replace(/^group-/, "");
  if (!validGroups.has(key) || !openGroups.value.includes(key)) return;
  openGroups.value = openGroups.value.filter(value => value !== key);
  remember();
}
onMounted(async () => {
  await nextTick();
  // Element Plus auto-opens ancestors of default-active. The explicit saved
  // closed state takes precedence until the user navigates to another item.
  for (const group of defaults) {
    if (!openGroups.value.includes(group)) menuRef.value?.close("group-" + group);
  }
  menuInitialized = true;
});
watch(() => props.active, (active, previous) => {
  if (active === previous) return;
  const group = navigationGroup(active);
  if (group === "home" || openGroups.value.includes(group)) return;
  openGroups.value = [...openGroups.value, group];
  remember();
  void nextTick(() => menuRef.value?.open("group-" + group));
});
watch(() => props.collapsed, collapsed => {
  if (collapsed) return;
  void nextTick(() => openGroups.value.forEach(group => menuRef.value?.open("group-" + group)));
});
</script>

<template>
  <nav class="navigation-menu-scroll" aria-label="业务模块">
    <ElMenu ref="menuRef" class="business-navigation-menu" :default-active="active"
      :default-openeds="initialOpeneds" :collapse="collapsed" :collapse-transition="false"
      @open="opened" @close="closed" @select="key => emit('select', key)">
      <template v-for="group in groups" :key="group.key">
        <ElMenuItem v-if="group.key === 'home'" index="dashboard" class="nav-home-item">
          <ElIcon><component :is="group.items[0].icon" /></ElIcon>
          <template #title><span class="nav-group-label">工作台</span></template>
        </ElMenuItem>
        <ElSubMenu v-else :index="'group-' + group.key" class="nav-group">
          <template #title>
            <ElIcon><component :is="group.icon" /></ElIcon>
            <span class="nav-group-label">{{ group.title }}</span>
          </template>
          <ElMenuItem v-for="item in group.items" :key="item.key" :index="item.key" class="nav-leaf-item">
            <ElIcon><component :is="item.icon" /></ElIcon>
            <template #title><span class="nav-leaf-label">{{ item.title }}</span></template>
          </ElMenuItem>
        </ElSubMenu>
      </template>
    </ElMenu>
  </nav>
</template>

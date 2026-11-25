<!-- Adapted from vue3-element-admin 4.13.0 src/layouts/components/LayoutNavbar.vue.
     Upstream MIT; use app-owned navigation/permissions rather than upstream Pinia. -->
<script setup lang="ts">
import { Fold, Expand, Menu as MenuIcon } from "@element-plus/icons-vue";
defineProps<{title:string;collapsed:boolean}>();
const emit=defineEmits<{toggle:[];openNavigation:[]}>();
</script>
<template>
  <header class="topbar layout-navbar">
    <div class="topbar-heading layout-navbar__left">
      <ElButton text circle class="mobile-menu" aria-label="打开导航"
        @click="emit('openNavigation')"><ElIcon><MenuIcon/></ElIcon></ElButton>
      <ElButton class="layout-navbar__hamburger" text circle
        :aria-label="collapsed?'展开导航':'折叠导航'" @click="emit('toggle')">
        <ElIcon><Expand v-if="collapsed"/><Fold v-else/></ElIcon>
      </ElButton>
      <p aria-label="当前模块">{{ title }}</p>
    </div>
    <div class="layout-navbar__actions"><slot name="actions" /></div>
  </header>
</template>
<style scoped>
.layout-navbar{display:flex;align-items:center;justify-content:space-between;
  height:54px;padding:0 10px 0 2px;background:var(--content-bg);
  border-bottom:1px solid var(--border-color)}
.layout-navbar__left,.layout-navbar__actions{display:flex;align-items:center;gap:8px}
.layout-navbar__left p{font-size:14px;font-weight:600;color:var(--ink)}
@media(max-width:760px){.layout-navbar__hamburger{display:none}}
</style>

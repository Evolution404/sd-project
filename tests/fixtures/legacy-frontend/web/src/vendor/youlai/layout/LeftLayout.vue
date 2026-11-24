<!-- Adapted from vue3-element-admin 4.13.0 src/layouts/modes/LeftLayout.vue
     upstream commit 38189e5fdf7f7b98eac283001b2a089a89f11889, MIT. -->
<script setup lang="ts">
defineProps<{collapsed: boolean; sidebarWidth: string; resizing?: boolean}>();
</script>
<template>
  <div class="shell layout-root layout--left" :class="{
    'is-sidebar-open':!collapsed, 'is-sidebar-collapsed':collapsed,
    'is-resizing-sidebar':resizing
  }" :style="{'--sidebar-width':sidebarWidth}">
    <aside class="navigation layout-sidebar" :class="{'is-collapsed':collapsed}">
      <div class="layout-sidebar__inner">
        <slot name="sidebar" />
      </div>
    </aside>
    <main class="workspace layout-main">
      <slot name="navbar" />
      <slot />
    </main>
  </div>
</template>
<style scoped>
.layout-root{background:var(--page-bg)}
.layout-sidebar{background:var(--menu-background);color:var(--menu-text);border-right:1px solid var(--card-border);z-index:8}
.layout-sidebar__inner{display:flex;flex-direction:column;height:100%;min-width:0}
.layout-main{min-width:0}
.layout-root:not(.is-resizing-sidebar){transition:grid-template-columns .28s}
@media(max-width:760px){.layout-sidebar{display:none}}
</style>

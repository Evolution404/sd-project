<!-- Adapted from vue3-element-admin 4.13.0 src/layouts/components/LayoutSidebar.vue.
     Menu entries and expanded-group persistence are supplied by our own NavigationMenu. -->
<script setup lang="ts">
import NavigationMenu from "../../../app/NavigationMenu.vue";
defineProps<{active:string;collapsed:boolean;admin:boolean}>();
const emit=defineEmits<{select:[key:string]}>();
</script>
<template>
  <div class="layout-sidebar__menu">
    <ElScrollbar>
      <NavigationMenu :active="active" :collapsed="collapsed" :admin="admin"
        @select="emit('select',$event)" />
    </ElScrollbar>
  </div>
</template>
<style scoped>
.layout-sidebar__menu{flex:1;min-width:0;min-height:0}
.layout-sidebar__menu :deep(.el-scrollbar){height:100%}
.layout-sidebar__menu :deep(.navigation-menu-scroll){overflow:visible;max-height:none;padding:2px 2px 20px 0}
.layout-sidebar__menu :deep(.el-scrollbar__bar.is-horizontal){display:none}
.layout-sidebar__menu :deep(.el-menu){border:0;background:transparent}
</style>

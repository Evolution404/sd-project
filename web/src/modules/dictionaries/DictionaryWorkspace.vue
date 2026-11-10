<script setup lang="ts">
import { useRoute } from "vue-router";
import CatalogPage from "../catalog/CatalogPage.vue";
import OrganizationWorkspace from "./components/OrganizationWorkspace.vue";
const route = useRoute();
</script>
<template>
  <OrganizationWorkspace
    v-if="route.params.kind === 'organizations'"
  /><CatalogPage
    v-else
    title="基础数据"
    :kinds="['voltages', 'units', 'priorities', 'categories', 'organizations']"
  />
</template>

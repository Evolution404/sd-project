<script setup lang="ts">
import { useRoute } from "vue-router";
import CatalogPage from "../catalog/CatalogPage.vue";
import EquipmentPage from "../equipment/EquipmentPage.vue";
import OrganizationWorkspace from "./components/OrganizationWorkspace.vue";
const route = useRoute();
</script>
<template>
  <OrganizationWorkspace
    v-if="route.params.kind === 'organizations'"
  /><EquipmentPage v-else-if="!route.params.kind || route.params.kind === 'voltages'" voltage /><CatalogPage
    v-else
    title="基础数据"
    :kinds="['voltages', 'units', 'priorities', 'categories', 'organizations']"
  />
</template>

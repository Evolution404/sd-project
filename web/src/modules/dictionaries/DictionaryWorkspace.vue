<script setup lang="ts">
import { useRoute } from "vue-router";
import EquipmentPage from "../equipment/EquipmentPage.vue";
import OrganizationWorkspace from "./components/OrganizationWorkspace.vue";
import DictionaryPage from "./DictionaryPage.vue";
import DictionaryTabs from "./DictionaryTabs.vue";
const route = useRoute();
</script>
<template>
  <OrganizationWorkspace v-if="route.params.kind === 'organizations'"
    ><template #tabs><DictionaryTabs /></template
  ></OrganizationWorkspace>
  <EquipmentPage
    v-else-if="!route.params.kind || route.params.kind === 'voltages'"
    voltage
    ><template #tabs><DictionaryTabs /></template
  ></EquipmentPage>
  <DictionaryPage v-else :key="String(route.params.kind)"
    ><template #tabs><DictionaryTabs /></template
  ></DictionaryPage>
</template>

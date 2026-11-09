<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api, type Row } from "../services/api";
import { fieldName, factText, visibleFact } from "../services/display";
const props = defineProps<{ value: unknown }>();
const labels = ref<Row>({}),
  actors = ref<Row>({});
const sections = computed(() =>
  Array.isArray(props.value)
    ? [["versions", props.value]]
    : Object.entries((props.value || {}) as Row),
);
const records = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [value];
onMounted(async () => {
  const [definitions, people, businessLabels] = await Promise.all([
    api("/catalogs"),
    api<Row[]>("/actors?history=true"),
    api("/display-labels"),
  ]);
  for (const definition of Object.values(definitions) as Row[])
    for (const field of [...definition.rootFields, ...definition.fields])
      labels.value[field.key] = field.label;
  Object.assign(labels.value, businessLabels);
  actors.value = Object.fromEntries(
    people.map((person) => [person.id, person.username]),
  );
});
</script>
<template>
  <ElCollapse>
    <ElCollapseItem
      v-for="[key, section] in sections"
      :key="String(key)"
      :title="fieldName(String(key))"
      :name="String(key)"
    >
      <ElEmpty
        v-if="Array.isArray(section) && !section.length"
        description="暂无历史记录"
      />
      <div
        v-for="(record, index) in records(section)"
        :key="index"
        class="panel"
      >
        <ElDescriptions
          v-if="record && typeof record === 'object'"
          :column="1"
          border
        >
          <ElDescriptionsItem
            v-for="[field, value] in Object.entries(record).filter(([field]) =>
              visibleFact(field),
            )"
            :key="field"
            :label="fieldName(field, labels)"
            >{{ factText(value, field, labels, actors) }}</ElDescriptionsItem
          >
        </ElDescriptions>
        <p v-else>{{ factText(record) }}</p>
      </div>
    </ElCollapseItem>
  </ElCollapse>
</template>

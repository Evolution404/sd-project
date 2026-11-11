import { createRouter, createWebHashHistory } from "vue-router";
const funding = () => import("../modules/funding/FundingPage.vue");
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/dashboard" },
    { path: "/dashboard", name: "dashboard", component: () => import("../modules/dashboard/DashboardPage.vue") },
    { path: "/demands", name: "demands", component: () => import("../modules/demands/DemandPage.vue") },
    { path: "/projects", name: "projects", component: () => import("../modules/projects/ProjectPage.vue") },
    { path: "/finance/:kind(costs|settlements|reconciliations|projects)?", name: "finance", component: () => import("../modules/finance/FinancePage.vue") },
    { path: "/frameworks", name: "frameworks", component: funding, props: { kind: "frameworks" } },
    { path: "/agreements", name: "agreements", component: funding, props: { kind: "agreements" } },
    { path: "/ledger/:kind(lines|physical|towers|spans)?", name: "ledger", component: () => import("../modules/equipment/EquipmentPage.vue"),
      props: {} },
    { path: "/materials", name: "materials", component: () => import("../modules/materials/MaterialsPage.vue") },
    { path: "/standards/:kind(operations|objects)?", name: "standards", component: () => import("../modules/work-standards/WorkStandardsPage.vue"),
      props: { title: "作业标准", kinds: ["operations", "objects"] } },
    { path: "/pricing/:kind(prices|factors)?", name: "pricing", component: () => import("../modules/pricing/PricingPage.vue"),
      props: { title: "参考价格", kinds: ["prices", "factors"] } },
    { path: "/dictionaries/:kind(voltages|units|priorities|categories|organizations)?", name: "dictionaries", component: () => import("../modules/dictionaries/DictionaryWorkspace.vue"),
      props: { title: "基础数据", kinds: ["voltages", "units", "priorities", "categories", "organizations"] } },
    { path: "/system/:tab(users|ips|audit)?", name: "system", component: () => import("../modules/system/SystemPage.vue") },
    { path: "/:pathMatch(.*)*", name: "missing", component: () => import("./RouteMissingPage.vue") },
  ],
});

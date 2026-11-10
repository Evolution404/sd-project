import { createRouter, createWebHashHistory } from "vue-router";
const catalog = () => import("../modules/catalog/CatalogPage.vue");
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/dashboard" },
    { path: "/dashboard", name: "dashboard", component: () => import("../modules/dashboard/DashboardPage.vue") },
    { path: "/demands", name: "demands", component: () => import("../modules/demands/DemandPage.vue") },
    { path: "/projects", name: "projects", component: () => import("../modules/projects/ProjectPage.vue") },
    { path: "/finance/:kind(costs|settlements|reconciliations|projects)?", name: "finance", component: () => import("../modules/finance/FinancePage.vue") },
    { path: "/frameworks", name: "frameworks", component: catalog, props: { title: "年度框架", kinds: ["frameworks"] } },
    { path: "/agreements", name: "agreements", component: catalog, props: { title: "执行协议", kinds: ["agreements"] } },
    { path: "/ledger/:kind(lines|physical|towers|spans)?", name: "ledger", component: catalog,
      props: { title: "输电设备台账", kinds: ["lines", "physical", "towers", "spans"] } },
    { path: "/materials", name: "materials", component: catalog, props: { title: "物资管理", kinds: ["materials"] } },
    { path: "/standards/:kind(operations|objects)?", name: "standards", component: catalog,
      props: { title: "作业标准", kinds: ["operations", "objects"] } },
    { path: "/pricing/:kind(prices|factors)?", name: "pricing", component: catalog,
      props: { title: "参考价格", kinds: ["prices", "factors"] } },
    { path: "/dictionaries/:kind(voltages|units|priorities|categories|organizations)?", name: "dictionaries", component: catalog,
      props: { title: "基础数据", kinds: ["voltages", "units", "priorities", "categories", "organizations"] } },
    { path: "/system/:tab(users|ips|audit)?", name: "system", component: () => import("../modules/system/SystemPage.vue") },
    { path: "/:pathMatch(.*)*", name: "missing", component: () => import("./RouteMissingPage.vue") },
  ],
});

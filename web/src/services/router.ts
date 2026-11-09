import { createRouter, createWebHashHistory } from "vue-router";

const catalog = () => import("../pages/CatalogPage.vue");
const project = () => import("../pages/ProjectPage.vue");
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/dashboard" },
    { path: "/dashboard", name: "dashboard", component: () => import("../pages/DashboardPage.vue") },
    { path: "/demands", name: "demands", component: () => import("../pages/DemandPage.vue") },
    { path: "/projects", name: "projects", component: project },
    { path: "/finance", name: "finance", component: project, props: { financeOnly: true } },
    { path: "/funding/:kind(frameworks|agreements|organizations|categories)?", name: "funding", component: catalog,
      props: { title: "年度框架、协议与组织", kinds: ["frameworks", "agreements", "organizations", "categories"] } },
    { path: "/ledger/:kind(lines|physical|towers|spans|voltages)?", name: "ledger", component: catalog,
      props: { title: "输电设备台账", kinds: ["lines", "physical", "towers", "spans", "voltages"] } },
    { path: "/standards/:kind(operations|objects|materials|prices|units|factors|priorities)?", name: "standards", component: catalog,
      props: { title: "作业标准与参考价格", kinds: ["operations", "objects", "materials", "prices", "units", "factors", "priorities"] } },
    { path: "/system/:tab(users|ips|audit)?", name: "system", component: () => import("../pages/SystemPage.vue") },
    { path: "/:pathMatch(.*)*", name: "missing", component: () => import("../pages/RouteMissingPage.vue") },
  ],
});

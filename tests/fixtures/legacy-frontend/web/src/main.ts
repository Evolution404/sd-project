import { createApp } from "vue";
import "./styles/element-plus";
import "tabulator-tables/dist/css/tabulator.min.css";
import "./styles/theme.css";
// MIT upstream theme: vue3-element-admin v4.13.0 (source retained in docs/vendor).
import "./vendor/youlai/theme.scss";
import App from "./app/App.vue";
import { router } from "./app/router";
const app = createApp(App).use(router);
router.isReady().then(() => app.mount("#app"));

import { createApp } from "vue";
import "./styles/element-plus";
import "tabulator-tables/dist/css/tabulator.min.css";
import "./styles/theme.css";
import App from "./app/App.vue";
import { router } from "./app/router";
const app = createApp(App).use(router);
router.isReady().then(() => app.mount("#app"));

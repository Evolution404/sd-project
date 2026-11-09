import { createApp } from "vue";
import "./styles/element-plus";
import "./styles/theme.css";
import App from "./App.vue";
import { router } from "./services/router";
const app = createApp(App).use(router);
router.isReady().then(() => app.mount("#app"));

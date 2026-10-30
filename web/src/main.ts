import {createApp,h} from 'vue';
import {ElConfigProvider} from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import './styles/element-plus';
import './styles/ui-tokens.css';
import './style.css';
import App from './App.vue';

// Single application-wide Element Plus provider.
createApp({render:()=>h(ElConfigProvider,{locale:zhCn,size:'default'},{default:()=>h(App)})}).mount('#app');

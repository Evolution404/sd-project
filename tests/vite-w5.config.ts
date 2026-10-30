import {defineConfig} from 'vite';
import vue from '@vitejs/plugin-vue';
// Dedicated browser harness: does not modify production Vite config or App.vue.
export default defineConfig({
 plugins:[vue()],
 server:{host:'127.0.0.1',proxy:{'/api':{target:process.env.W5_TEST_API_URL||'http://127.0.0.1:8787',changeOrigin:false}}}
});

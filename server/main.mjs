// Single server entry: HTTP routes are importable without starting a listener.
import {app} from './http/router.mjs';
import {dataRoot} from './database/index.mjs';
export {app};
if(process.env.SD_DISABLE_LISTEN!=='1'){
 const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT||8787);
 app.listen(port,host,()=>console.log('SD Project listening on http://'+host+':'+port+', DATA_DIR='+dataRoot));
}

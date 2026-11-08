import { createSystem } from './application/system.mjs';
import { httpServer } from './http/server.mjs';
const system=createSystem(),server=httpServer(system);
const port=Number(process.env.PORT||8787),host=process.env.HOST||'127.0.0.1';
server.listen(port,host,()=>console.log(`SCHEMA113_READY http://${host}:${port} data=${system.database.directory}`));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>{system.close();process.exit(0);}));

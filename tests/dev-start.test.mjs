import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn,execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

const version=Number(readFileSync(new URL('../server/db.mjs',import.meta.url),'utf8')
 .match(/^const SCHEMA_VERSION=(\d+);/m)?.[1]);

test('make dev selects an isolated directory matching the canonical schema, without migrating old data',{
 skip:process.platform==='win32'
},()=>{
 assert.ok(version>0);
 const dry=execFileSync('make',['-n','dev'],{encoding:'utf8'});
 assert.match(dry,new RegExp('\\.local-test-data/schema-'+version+'\\b'));
 assert.doesNotMatch(dry,/current-101/);
});

test('developer startup avoids wildcard-port collisions and keeps occupied ports untouched',async()=>{
 const root=mkdtempSync(join(tmpdir(),'sd-dev-port-test-'));
 const blocker=createServer();
 let child=null,output='',errors='';
 try{
  await new Promise((resolve,reject)=>{
   blocker.once('error',reject);
   blocker.listen({host:'0.0.0.0',port:0},resolve);
  });
  const port=blocker.address().port;
  const environment={...process.env,DATA_DIR:root,HOST:'127.0.0.1',PORT:String(port)};
  execFileSync(process.execPath,['scripts/init-admin.mjs'],{
   env:{...environment,SD_ADMIN_USER:'port-check',SD_ADMIN_PASSWORD:'local-isolated-test'},stdio:'pipe'
  });
  child=spawn(process.execPath,['scripts/dev-start.mjs'],{
   env:environment,stdio:['ignore','pipe','pipe']
  });
  child.stdout.on('data',data=>{output+=data.toString()});
  child.stderr.on('data',data=>{errors+=data.toString()});
  let actual=null;
  for(let i=0;i<80;i++){
   const candidate=output.match(/本机访问：http:\/\/127\.0\.0\.1:(\d+)/)?.[1];
   if(candidate){
    try{
     const response=await fetch('http://127.0.0.1:'+candidate+'/api/health',{
      signal:AbortSignal.timeout(350)
     });
     if(response.ok){actual=Number(candidate);const data=await response.json();assert.equal(data.schema,version);break}
    }catch{}
   }
   if(child.exitCode!==null)break;
   await delay(100);
  }
  assert.ok(actual,'new service must start '+output+' '+errors);
  assert.notEqual(actual,port,'occupied port must never be reused');
  assert.match(output,/已被占用/);
  assert.equal(blocker.listening,true,'original listener must be preserved');
 }finally{
  if(child){
   if(child.exitCode===null){
    child.kill('SIGTERM');
    await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(1200)]);
   }
  }
  if(blocker.listening)await new Promise(resolve=>blocker.close(resolve));
  rmSync(root,{recursive:true,force:true});
 }
});

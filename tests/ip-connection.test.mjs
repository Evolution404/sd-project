import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { once } from 'node:events';

const root = mkdtempSync(join(tmpdir(), 'sd-project-tcp-reset-'));
process.env.DATA_DIR = root;
process.env.SD_DISABLE_LISTEN = '1';
const {db,exec,uid,now} = await import('../server/db.mjs');
const {app} = await import('../server/server.mjs');

function sendHttp(host,port) {
 return new Promise((resolve,reject)=>{
  const socket = net.connect({host,port});
  const data = [];
  const timeout = setTimeout(()=>socket.destroy(new Error('TCP probe timeout')),4000);
  let settled = false;
  const finish=(error)=>{
   if(settled)return;
   settled=true;clearTimeout(timeout);socket.destroy();
   if(error)reject(error);
   else resolve(Buffer.concat(data).toString('utf8'));
  };
  socket.on('connect',()=>{
   socket.write('GET /api/health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
  });
  socket.on('data',chunk=>data.push(chunk));
  socket.on('end',()=>finish());
  socket.on('error',error=>{
   // A reset can race the first write: both errors mean the peer closed
   // the connection. Callers still assert zero bytes (deny) or HTTP 200 (allow).
   if(error.code==='ECONNRESET'||error.code==='EPIPE')finish();
   else finish(error);
  });
  socket.on('close',()=>finish());
 });
}

test('TCP deny before HTTP response and immediately re-evaluate exact-IP allowlist',async t=>{
 const interfaces = networkInterfaces();
 const address=Object.entries(interfaces)
  .filter(([name])=>/^(?:en\d+|eth\d+|wlan\d+)$/.test(name))
  .flatMap(([,addresses])=>addresses||[])
  .find(x=>x.family==='IPv4'&&!x.internal)?.address;
 app.listen(0,'0.0.0.0');
 await once(app,'listening');
 const port=app.address().port;
 try{
  const local=await sendHttp('127.0.0.1',port);
  assert.match(local,/^HTTP\/1\.1 200 OK/);
  if(!address){t.diagnostic('No non-loopback network interface: skipping external-source TCP part');return}
  const deny=await sendHttp(address,port);
  assert.equal(deny,'','unknown IP must receive zero HTTP bytes (TCP RST)');
  const user=uid(),created=now();
  exec('INSERT INTO users VALUES(?,?,?,?,?,?)',user,'tcp-test','unused','admin','active',created);
  const id=uid();
  exec('INSERT INTO allowed_ips VALUES(?,?,?,?,?)',id,address,'network test',user,created);
  const accepted=await sendHttp(address,port);
  assert.match(accepted,/^HTTP\/1\.1 200 OK/, 'allowlist takes effect on new TCP connection');
  exec('DELETE FROM allowed_ips WHERE id=?',id);
  const revoked=await sendHttp(address,port);
  assert.equal(revoked,'','revocation must yield zero HTTP bytes on new connections');
 }finally{
  await new Promise(resolve=>app.close(resolve));
  db.close();
  rmSync(root,{recursive:true,force:true});
 }
});

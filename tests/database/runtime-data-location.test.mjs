import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync,existsSync,mkdtempSync,readFileSync,realpathSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';

const project=resolve(import.meta.dirname,'..','..');
const read=path=>readFileSync(join(project,path),'utf8');

test('runtime default data directory is deployment-root data (not user profile)',()=>{
 const shadow=mkdtempSync(join(tmpdir(),'sd-data-root-'));
 try{
  const server=join(shadow,'server');
  cpSync(join(project,'server','database'),join(server,'database'),{recursive:true});
  const env={...process.env};delete env.DATA_DIR;
  const run=()=>spawnSync(process.execPath,['--input-type=module','-e',
   "import {db,dataRoot} from './server/database/index.mjs'; console.log(dataRoot); db.close();"],
   {cwd:shadow,env,encoding:'utf8'});
  const first=run();
  assert.equal(first.status,0,first.stderr);
  assert.equal(first.stdout.trim(),join(realpathSync(shadow),'data'));
  assert.ok(existsSync(join(shadow,'data','business.sqlite')));
  assert.ok(existsSync(join(shadow,'data','attachments')));
  assert.ok(existsSync(join(shadow,'data','backups')));
  const second=run();
  assert.equal(second.status,0,second.stderr);
  assert.equal(second.stdout.trim(),join(realpathSync(shadow),'data'));
 }finally{rmSync(shadow,{recursive:true,force:true})}
});

test('Windows launch, first-run and backup all target deployment-root data',()=>{
 assert.match(read('scripts/windows/启动服务.cmd'),/set "DATA_DIR=%~dp0data"/);
 assert.match(read('scripts/windows/备份数据库.cmd'),/set "DATA_DIR=%~dp0data"/);
 const firstRun=readFileSync(join(project,'scripts/first-run.ps1'));
 assert.equal(firstRun.subarray(0,3).toString('hex'),'efbbbf');
 assert.match(firstRun.toString('utf8'),/\$env:DATA_DIR = Join-Path \$root 'data'/);
 const pkg=JSON.parse(read('package.json'));
 assert.ok(pkg.scripts['package:win']);
 const publisher=read('scripts/release/package-win10.mjs');
 assert.match(publisher,/const work=join\(root,'dist'\)/);
 assert.match(publisher,/data_location:'\.\/data'/);
 assert.match(publisher,/ZIP must not contain runtime data/);
});

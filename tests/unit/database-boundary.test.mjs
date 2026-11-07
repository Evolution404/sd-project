import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('database module is the sole SQL owner across the entire HTTP/Application/Domain backend',()=>{
 const checked=spawnSync(process.execPath,['scripts/check-database-boundary.mjs'],
  {cwd:process.cwd(),encoding:'utf8'});
 assert.equal(checked.status,0,checked.stderr||checked.stdout);
 assert.match(checked.stdout,/DATABASE_BOUNDARY_OK/);
});

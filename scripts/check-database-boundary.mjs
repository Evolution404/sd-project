import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const protectedDirectories=[
 'server/http','server/domain','server/infrastructure','server/application','server/exchange'
];
function filesUnder(dir){
 const result=[];
 if(!existsSync(join(root,dir)))return result;
 for(const entry of readdirSync(join(root,dir),{withFileTypes:true})){
  const path=join(dir,entry.name);
  if(entry.isDirectory())result.push(...filesUnder(path));
  else if(entry.name.endsWith('.mjs'))result.push(path);
 }
 return result;
}
const protectedScripts=['scripts/init-admin.mjs','scripts/backup.mjs'];
const sources=[...protectedDirectories.flatMap(filesUnder),...protectedScripts,'server/main.mjs'];
const violations=[];
for(const source of sources){
 const code=readFileSync(join(root,source),'utf8');
 const banned=[
  [/from\s*['"]node:sqlite['"]/g,'import node:sqlite'],
  [/\b(?:db\.prepare|db\.exec|new DatabaseSync)\s*\(/g,'raw driver'],
  [/\b(?:one|all|exec)\s*\(\s*(?:['"`])/g,'embedded SQL call']
 ];
 for(const [pattern,label] of banned)
  if(pattern.test(code))violations.push(source+': '+label);
 const imports=code.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"][^'"]*database\/index\.mjs['"]/g);
 for(const match of imports){
  const symbols=match[1].split(',').map(s=>s.trim().split(/\s+as\s+/)[0]);
  for(const symbol of symbols)if(['db','one','all','exec'].includes(symbol))
   violations.push(source+': forbidden DB import '+symbol);
 }
}
if(violations.length){
 for(const violation of violations)console.error(violation);
 process.exitCode=1;
}else console.log('DATABASE_BOUNDARY_OK',sources.length,'protected source files, HTTP/Application/Domain/Infrastructure and runtime scripts have no SQL');

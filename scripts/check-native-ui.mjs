import {readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve,relative,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from '@vue/compiler-sfc';

// Count interactive UI elements via the Vue SFC template AST, not regex over
// script strings or CSS. Ordinary semantic layout elements remain permitted.
export const NATIVE_UI_TAGS=Object.freeze([
 'button','input','select','textarea','form','table','details','summary',
 'datalist','dialog','progress','meter','a'
]);
const prohibited=new Set(NATIVE_UI_TAGS);
export function findNativeUi(source,filename='component.vue'){
 const {descriptor,errors}=parse(source,{filename});
 if(errors.length)throw Error(filename+' SFC parsing failed: '+errors.map(e=>e.message||e).join('; '));
 const counts=Object.create(null);
 function visit(node){
  if(!node||typeof node!=='object')return;
  if(node.type===1&&node.tagType===0&&prohibited.has(node.tag)){
   counts[node.tag]=(counts[node.tag]||0)+1;
  }
  if(Array.isArray(node.children))for(const child of node.children)visit(child);
  if(Array.isArray(node.branches))for(const branch of node.branches)visit(branch);
 }
 if(descriptor.template)visit(descriptor.template.ast);
 return counts;
}
function getComponents(dir){
 if(!existsSync(dir))return [];
 return readdirSync(dir,{withFileTypes:true}).flatMap(item=>{
  const path=join(dir,item.name);
  return item.isDirectory()?getComponents(path):item.isFile()&&item.name.endsWith('.vue')?[path]:[];
 });
}
export function currentNativeUi(root){
 const result=Object.create(null);
 for(const file of getComponents(join(root,'web','src'))){
  const counts=findNativeUi(readFileSync(file,'utf8'),file);
  const total=Object.values(counts).reduce((a,b)=>a+b,0);
  if(total>0)result[relative(root,file).replaceAll('\\','/')]={total,tags:counts};
 }
 return result;
}
const sum=values=>Object.values(values).reduce((a,b)=>a+b.total,0);
function check(){
 const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
 const snapshot=resolve(root,'scripts/native-ui-baseline.json');
 const current=currentNativeUi(root);
 const isBaseline=process.argv.includes('--write-baseline');
 const strict=process.argv.includes('--strict');
 if(isBaseline){
  if(strict)throw Error('Cannot use --strict with --write-baseline');
  const result={version:1,scope:'Vue SFC template native interactive UI elements',files:current};
  writeFileSync(snapshot,JSON.stringify(result,null,2)+'\n');
  console.log('Recorded native UI baseline:',sum(current),'in',Object.keys(current).length,'files');
  return;
 }
 let violations=0;
 const baseline=existsSync(snapshot)?JSON.parse(readFileSync(snapshot,'utf8')).files:{};
 if(!strict&&!existsSync(snapshot))throw Error('Baseline missing; initial snapshot requires --write-baseline');
 for(const [file,entry] of Object.entries(current)){
  const limit=strict?0:baseline[file]?.total||0;
  if(entry.total>limit){
   console.error('NATIVE_UI_VIOLATION',file,'current',entry.total,'limit',limit,JSON.stringify(entry.tags));
   violations++;
  }
 }
 if(!strict)for(const [file,old]of Object.entries(baseline)){
  const currentTotal=current[file]?.total||0;
  if(currentTotal<old.total)console.log('UI debt reduced:',file,old.total,'->',currentTotal);
 }
 console.log('Native UI:',sum(current),'remaining /',sum(baseline),'baseline;',
  Object.keys(current).length,'files;',strict?'strict zero mode':'ratchet mode');
 if(violations)process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))check();

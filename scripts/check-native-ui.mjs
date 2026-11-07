import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve,relative,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from '@vue/compiler-sfc';
import {currentUiContract} from './ui-contract.mjs';

// Count interactive UI elements via the Vue SFC template AST, not regex over
// script strings or CSS. Ordinary semantic layout elements remain permitted.
export const NATIVE_UI_TAGS=Object.freeze([
 'button','input','select','textarea','form','table','details','summary',
 'datalist','dialog','progress','meter','a','option','optgroup'
]);
const prohibited=new Set(NATIVE_UI_TAGS);
export function findNativeUi(source,filename='component.vue'){
 const {descriptor,errors}=parse(source,{filename});
 if(errors.length)throw Error(filename+' SFC parsing failed: '+errors.map(e=>e.message||e).join('; '));
 const counts=Object.create(null);
 function visit(node){
  if(!node||typeof node!=='object')return;
  if(node.type===1&&prohibited.has(node.tag.toLowerCase())){
   const tag=node.tag.toLowerCase();counts[tag]=(counts[tag]||0)+1;
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
 const current=currentNativeUi(root);
 const contractIssues=currentUiContract(root);
 // All native UI exceptions were eliminated. No baselines or ratcheting.
 if(process.argv.includes('--write-baseline')){
  throw Error('原生 UI 已实行严格零容忍，不再允许创建或提高历史基线');
 }
 let violations=0;
 for(const issue of contractIssues){console.error('UI_CONTRACT_VIOLATION',issue.file+(issue.line?':'+issue.line:''),issue.rule,issue.message);violations++}
 for(const [file,entry] of Object.entries(current)){
  const limit=0;
  if(entry.total>limit){
   console.error('NATIVE_UI_VIOLATION',file,'current',entry.total,'limit',limit,JSON.stringify(entry.tags));
   violations++;
  }
 }
 console.log('Native UI:',sum(current),'remaining;',Object.keys(current).length,'files; strict zero mode');
 console.log('UI contract:',contractIssues.length,'violations (widget types, styles, forms, scripts)');
 if(violations)process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))check();

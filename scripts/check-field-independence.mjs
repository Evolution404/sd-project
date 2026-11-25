import {readdirSync,readFileSync} from "node:fs";
import {join,resolve,relative} from "node:path";
const root=resolve(import.meta.dirname,"..");
const extensions=/\.(?:vue|ts|tsx|js|mjs|cjs|css|scss|sql|json|html)$/i;
// Only active runtime and build sources; historical fixtures/documentation are not served.
const roots=["web/src","server","scripts"];
const forbidden=/\u00b7|\\u00b7|\\u\{0*b7\}|\\xb7|&middot;|&#0*183;|&#x0*b7;/i;
const violations=[];
function visit(path){
 for(const entry of readdirSync(path,{withFileTypes:true})){
  const file=join(path,entry.name);
  if(entry.isDirectory())visit(file);
  else if(entry.isFile()&&extensions.test(entry.name)&&file!==join(root,"scripts/check-field-independence.mjs")){
   readFileSync(file,"utf8").split("\n").forEach((line,index)=>{
    if(forbidden.test(line))violations.push(relative(root,file)+":"+(index+1));
   });
  }
 }
}
for(const folder of roots)visit(join(root,folder));
if(violations.length){console.error("FIELD_INDEPENDENCE_VIOLATIONS",violations.join("\n"));process.exitCode=1}
else console.log("FIELD_INDEPENDENCE_OK active runtime and build sources, no middle-dot separators");

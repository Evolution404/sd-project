import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const files=[];
function walk(folder){
  for(const item of readdirSync(folder,{withFileTypes:true})){
    const file=join(folder,item.name);
    if(item.isDirectory()) walk(file);
    else if(file.endsWith(".vue")) files.push(file);
  }
}
walk("tests/fixtures/legacy-frontend/web/src");
const violations=[];
let count=0;
for(const file of files){
  const source=readFileSync(file,"utf8");
  for(let offset=source.indexOf("<BusinessTable");offset>=0;offset=source.indexOf("<BusinessTable",offset+14)){
    let i=offset, quote="";
    for(;i<source.length;i++){
      const c=source[i];
      if(quote){if(c===quote)quote="";continue;}
      if(c==='"'||c==="'"){quote=c;continue;}
      if(c==='>')break;
    }
    const tag=source.slice(offset,i+1), line=source.slice(0,offset).split("\n").length;
    count++;
    const client=/\bclient-side\b|\bclientSide\b/.test(tag);
    const sortingOff=/\bsort-mode\s*=\s*["']off["']/.test(tag);
    const filteringOff=/\bfilter-mode\s*=\s*["']off["']/.test(tag);
    const sortHandler=tag.includes("@sort-change=");
    const filterHandler=tag.includes("@filter-change=");
    if(!client&&!sortingOff&&!sortHandler)
      violations.push(file+":"+line+" non-client table exposes sorting but lacks @sort-change or sort-mode=off");
    if(!client&&!filteringOff&&!filterHandler)
      violations.push(file+":"+line+" non-client table exposes filtering but lacks @filter-change or filter-mode=off");
    if(/sort-mode=["']remote["']/.test(tag)&&!sortHandler)
      violations.push(file+":"+line+" remote sorting requires @sort-change");
    if(/filter-mode=["']remote["']/.test(tag)&&!filterHandler)
      violations.push(file+":"+line+" remote filtering requires @filter-change");
  }
}
const picker=readFileSync("tests/fixtures/legacy-frontend/web/src/modules/demands/components/DemandLocationPicker.vue","utf8");
if(/key:\s*["']label["'],\s*label:\s*["']作业设备["']/.test(picker))
  violations.push("DemandLocationPicker uses composite operation identity column");
if(/["']杆号或档距["']/.test(picker))
  violations.push("DemandLocationPicker mixes tower number and span");
if(/const columns\s*=\s*\[\s*\{/.test(picker))
  violations.push("DemandLocationPicker must use entity-dependent column schema");
if(violations.length){
  console.error("BUSINESS_TABLE_CONTRACT_VIOLATIONS count="+violations.length+" total="+count);
  for(const item of violations) console.error("- "+item);
  process.exitCode=1;
}else console.log("BUSINESS_TABLE_CONTRACTS_OK instances="+count+" dynamic entity schema and explicit sort/filter modes");

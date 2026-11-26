import { createRequire } from "node:module";
import { readFileSync,writeFileSync,mkdirSync,existsSync,rmSync } from "node:fs";
import { resolve,join,dirname,basename } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { seedCommonDefinitions } from "../seed/common.mjs";
import { createSystem } from "../../dist/server/bootstrap.js";
import { readLineImportAudit } from "../../dist/server/database/queries/line-import-audit.js";

const [sourcePath,targetPath]=process.argv.slice(2);
if(!sourcePath||!targetPath||!process.env.SD_ADMIN_PASSWORD)throw Error("需要源备份、全新输出目录和 SD_ADMIN_PASSWORD");
const source=resolve(sourcePath), target=resolve(targetPath), password=process.env.SD_ADMIN_PASSWORD;
assert(!existsSync(target),"输出目录必须不存在");
const raw=readFileSync(source),backup=JSON.parse(raw),data=backup.data;
assert(backup.schemaVersion===1&&Array.isArray(data.lines)&&Array.isArray(data.poles)&&Array.isArray(data.spans),"源备份格式不符");
const corePath=join(dirname(source),".src/core.js");
const core=createRequire(import.meta.url)(corePath),analysis=core.analyze(data);
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const report={source_file:basename(source),source_sha256:hash(raw),source_core_sha256:hash(readFileSync(corePath)),source_revision:data.meta?.revision,source_exported_at:backup.exportedAt,source_counts:{lines:data.lines.length,logical_towers:data.poles.length,spans:data.spans.length},imported:{},excluded:{poles:[],spans:[]},review:[],maps:{lines:[],physical:[],logical:[],spans:[]}};
const lines=new Map(),poles=new Map(),physical=new Map(),voltages=new Map(),material=new Map(),nature=new Map();
const distinct=(rows,key)=>[...new Set(rows.map(p=>p[key]).filter(v=>v!==null&&v!==undefined&&v!==""))];
const collator=new Intl.Collator("zh-CN",{numeric:true,sensitivity:"base"});
mkdirSync(target,{recursive:true,mode:0o700});
let sys;
try{
 sys=createSystem(join(target,"data"));
 const account=process.env.SD_SEED_ACCOUNT||"admin";
 sys.auth.initialize(account,password);
 const login=sys.auth.login(account,password),actor=login.user;
 report.common_definitions=seedCommonDefinitions(sys,actor);
 const add=(kind,body)=>sys.catalog.save(actor,kind,body);
 sys.database.transaction(()=>{
  for(const row of sys.catalog.list("tower_materials"))material.set(row.name,row.id);
  for(const row of sys.catalog.list("tower_natures"))nature.set(row.name,row.id);
  for(const name of distinct(data.poles,"towerStructure"))if(!material.has(name))material.set(name,add("tower_materials",{name}).id);
  for(const name of distinct(data.poles,"towerFunction"))if(!nature.has(name))nature.set(name,add("tower_natures",{name}).id);
  for(const row of sys.catalog.list("voltages"))voltages.set(row.name,row.id);
  for(const name of new Set(data.lines.map(l=>core.voltage(l.voltage))))if(!voltages.has(name))voltages.set(name,add("voltages",{name}).id);
  for(const l of data.lines){
   assert(l.enabled!==false,"停用线路需核对");
   const row=add("lines",{name:l.name,voltage_level_id:voltages.get(core.voltage(l.voltage)),line_kind:"main",status:"active"});
   lines.set(l.id,row);report.maps.lines.push({source_id:l.id,id:row.id,source_line_class:l.lineClass??null});
  }
  for(const group of analysis.towers.values()){
   const ms=group.members.filter(p=>p.active);
   if(!ms.length)continue;
   const materials=distinct(ms,"towerStructure"),natures=distinct(ms,"towerFunction");
   const coordinates=[...new Set(ms.filter(p=>Number.isFinite(p.lon)&&Number.isFinite(p.lat)).map(p=>JSON.stringify([p.lon,p.lat])))];
   if(materials.length>1||natures.length>1||coordinates.length>1||ms.length>group.lineIds.size)report.review.push({kind:"physical_group",source_ids:ms.map(p=>p.id),material_conflict:materials.length>1,nature_conflict:natures.length>1,coordinate_conflict:coordinates.length>1,same_line_multiple:ms.length>group.lineIds.size});
   const xy=coordinates.length===1?JSON.parse(coordinates[0]):null;
   const row=add("physical",{tower_material:materials.length===1?material.get(materials[0]):null,tower_nature:natures.length===1?nature.get(natures[0]):null,longitude:xy?.[0]??null,latitude:xy?.[1]??null,status:"active"});
   physical.set(group.key,row);report.maps.physical.push({id:row.id,source_ids:ms.map(p=>p.id)});
  }
  for(const l of data.lines){
   const rows=analysis.poles.filter(p=>p.lineId===l.id).sort((a,b)=>collator.compare(core.numberKey(a.number||a.name,l.name),core.numberKey(b.number||b.name,l.name)));
   let rank=0;
   for(const p of rows){
    if(!p.active||!physical.has(p.physicalKey)){report.excluded.poles.push({source_id:p.id,line_id:p.lineId,tower_no:p.number,reason:!p.active?"源排除或停用":"缺少可靠物理归组依据"});continue;}
    const status=p.rawStatus==="30"?"draft":"active";
    const row=add("towers",{line_id:lines.get(l.id).id,physical_tower_id:physical.get(p.physicalKey).id,tower_no:String(p.number||p.name).trim(),sort_rank:++rank,operations_team:l.group||"",status});
    poles.set(p.id,row);report.maps.logical.push({source_id:p.id,id:row.id,equipment_code:p.equipmentCode??null,physical_id:row.physical_tower_id,status});
    if(status==="draft")report.review.push({kind:"pole_status_conflict",source_id:p.id,logical_id:row.id});
   }
  }
  for(const s of analysis.spans){
   const a=poles.get(s.startPole?.id),b=poles.get(s.endPole?.id);
   if(!s.active||!a||!b||a.id===b.id){report.excluded.spans.push({source_id:s.id,line_id:s.lineId,start_number:s.startNumber,end_number:s.endNumber,managed_length_m:s.managedLengthM??null,reason:!s.active?s.exclusionReason||"源排除或退役":s.boundaryStart||s.boundaryEnd?"逻辑分界点或T接点，当前Schema无法表达":"起终点未唯一匹配"});continue;}
   const mm=s.managedLengthM==null?null:Math.round(s.managedLengthM*1000);
   assert(mm===null||Number.isSafeInteger(mm)&&mm>=0,"非法管辖长度");
   const status=a.status!=="active"||b.status!=="active"||a.physical_tower_id===b.physical_tower_id?"draft":"active";
   const [start, end] = a.line_id === b.line_id && a.sort_rank > b.sort_rank ? [b, a] : [a, b];
   const row=add("spans",{line_id:lines.get(s.lineId).id,start_tower_id:start.id,end_tower_id:end.id,transmission_center_length_mm:mm,status});
   report.maps.spans.push({source_id:s.id,id:row.id,start_id:start.id,end_id:end.id,managed_length_mm:mm,status});
   if(status==="draft")report.review.push({kind:"span_topology",source_id:s.id,span_id:row.id,reason:"端点待核或同一实物"});
  }
 });
 const {line_versions,physical_tower_versions,logical_tower_versions,span_versions,...counts}=readLineImportAudit(sys.database);
 report.imported={
  ...counts,units:sys.catalog.list("units").length,
  tower_materials:sys.catalog.list("tower_materials").length,
  tower_natures:sys.catalog.list("tower_natures").length,
 };
 assert.equal(report.imported.lines,data.lines.length);
 assert.equal(report.imported.logical_towers+report.excluded.poles.length,data.poles.length);
 assert.equal(report.imported.spans+report.excluded.spans.length,data.spans.length);
 assert.equal(report.imported.demands,0);assert.equal(report.imported.projects,0);assert.equal(report.imported.users,1);
 assert.equal(report.imported.managed_length_mm,report.maps.spans.reduce((n,s)=>n+(s.managed_length_mm??0),0));
 assert.equal(counts.lines,line_versions);
 assert.equal(counts.physical_towers,physical_tower_versions);
 assert.equal(counts.logical_towers,logical_tower_versions);
 assert.equal(counts.spans,span_versions);
 assert(sys.database.verifyIntegrity(),"数据库完整性检查失败");
 assert(sys.management.accessPolicy(actor).ip_restriction_enabled,"真实数据必须保留IP访问限制");
 sys.auth.logout(login.token);
 sys.database.checkpoint();
 sys.close();sys=undefined;
 report.quality_summary=analysis.quality.reduce((acc,item)=>(acc[item.code]=(acc[item.code]||0)+1,acc),{});
 report.excluded_counts={poles:report.excluded.poles.length,spans:report.excluded.spans.length,boundary_spans:report.excluded.spans.filter(s=>s.reason==="逻辑分界点或T接点，当前Schema无法表达").length,excluded_managed_m:report.excluded.spans.reduce((n,s)=>n+(s.managed_length_m??0),0)};
 writeFileSync(join(target,"IMPORT-RECEIPT.json"),JSON.stringify(report,null,2)+"\n",{mode:0o600});
 console.log("LINE_STATISTICS_IMPORTED",JSON.stringify({source:report.source_counts,imported:report.imported,excluded:report.excluded_counts,quality:report.quality_summary}));
}catch(error){sys?.close();rmSync(target,{recursive:true,force:true});throw error}

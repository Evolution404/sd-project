import {readFileSync,readdirSync,writeFileSync} from "node:fs";
import {parse as parseSfc} from "@vue/compiler-sfc";
import {baseParse} from "@vue/compiler-core";
function files(folder){
  return readdirSync(folder,{withFileTypes:true}).flatMap(entry=>{
    const p=folder+"/"+entry.name;
    return entry.isDirectory()?files(p):entry.isFile()&&entry.name.endsWith(".vue")?[p]:[];
  });
}
const components=new Set(["ElButton","ElDropdownItem","ElSwitch","ElCheckbox","ElTabPane","ElUpload","RowActions"]);
const critical=/新建|新增|添加|更正|修订|编辑|修改|删除|撤销|移除|审核|批准|确认|提交|结算|核定|核对|入库|结项|保存|上传|导入|导出|预检|重置|变更|密码|权限|发布|绑定|解绑|关联|移动|资金|替换|更换|承接|退回|停用|启用|创建|补充|应用/;
const controls=[];
for(const file of files("web/src/modules")){
  const {descriptor}=parseSfc(readFileSync(file,"utf8"));
  if(!descriptor.template)continue;
  const ast=baseParse(descriptor.template.content);
  function walk(node){
    if(node.type===1 && components.has(node.tag)){
      const marker=node.props.find(prop=>prop.type===6
        ? prop.name==="data-guide-action"
        : prop.arg?.content==="data-guide-action");
      const label=node.children.filter(c=>c.type===2).map(c=>c.content.trim())
        .join(" ").replace(/\s+/g," ").slice(0,90);
      const source=node.loc.source.slice(0,600);
      const linked=node.tag==="RowActions" && /guideActionId:/.test(source);
      controls.push({
        file,line:node.loc.start.line+descriptor.template.loc.start.line-1,
        tag:node.tag,label,
        state:marker?"marked":linked?"delegated":critical.test(label)?"review-high":"review-auxiliary",
        marker:marker?marker.type===6?marker.value?.content||"":marker.exp?.content||"":"",
      });
    }
    for(const child of node.children||[])walk(child);
    for(const branch of node.branches||[])walk(branch);
  }
  walk(ast);
}
const counts=Object.groupBy(controls,item=>item.state);
const cell=value=>String(value||"").replaceAll("|","/").replaceAll("\n"," ");
const rows=[
 "# P10 - Actual UI control source census",
 "",
 "> AST-generated from all current Vue business modules. Entries represent source occurrences, not actual rendered instances. Role/state coverage, dynamic menus, multiple rows and modal interactions require real browser tests. No exemption is automatically granted.",
 "",
 "- Source UI control occurrences: "+controls.length,
 "- Direct semantic markers: "+(counts.marked||[]).length,
 "- RowActions components using delegated markers: "+(counts.delegated||[]).length,
 "- Unmarked high-priority controls needing review: "+(counts["review-high"]||[]).length,
 "- Unmarked auxiliary controls needing review: "+(counts["review-auxiliary"]||[]).length,
 "",
 "|Source|Line|Control|Text|Status|Declared marker|",
 "|---|---:|---|---|---|---|",
 ...controls.map(x=>"|"+[x.file,x.line,x.tag,x.label,x.state,x.marker].map(cell).join("|")+"|"),
 "",
 "## Review criteria",
 "",
 "- marked/delegated is only a source declaration, not live-target proof.",
 "- review-high requires explicit registration, a verified shared semantic instruction or evidence-based written exception.",
 "- review-auxiliary includes basic save/cancel/search/refresh/tab operations which still require review.",
 "- RowActions repeated records and permissions must be checked using a live browser and multiple business states.",
 "",
];
writeFileSync("docs/implementation/P10_真实控件源码盘点.md",rows.join("\n"));
console.log("P10_CONTROL_CENSUS",JSON.stringify(Object.fromEntries(Object.entries(counts).map(([k,v])=>[k,v.length]))),"total",controls.length);

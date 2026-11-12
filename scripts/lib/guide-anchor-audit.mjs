import {readFileSync,readdirSync} from "node:fs";

/**
 * Static declaration audit, NOT live-browser evidence. Source literal markers in
 * row-action definitions only count when the shared renderer binds those IDs to
 * the actual buttons/menu items. Workflow action keys must be mapped explicitly.
 */
function sourceFiles(folder){
  return readdirSync(folder,{withFileTypes:true}).flatMap(entry=>{
    const path=folder+"/"+entry.name;
    return entry.isDirectory()?sourceFiles(path):entry.isFile()&&path.endsWith(".vue")?[path]:[];
  });
}
const rowRenderer=readFileSync("web/src/shared/ui/RowActions.vue","utf8");
if(!rowRenderer.includes(':data-guide-action="primary.guideActionId"') ||
   !rowRenderer.includes(':data-guide-action="action.guideActionId"'))
  throw Error("RowActions must propagate help identifiers for primary and secondary controls");
const direct=new Set(), delegated=new Set();
for(const file of sourceFiles("web/src/modules")){
  const source=readFileSync(file,"utf8");
  for(const [,value] of source.matchAll(/\bdata-guide-action\s*=\s*"([^"]+)"/g)){
    if(/^[a-z][a-z0-9-]+\.[a-z][a-z0-9-]+$/.test(value)) direct.add(value);
    else for(const [,id] of value.matchAll(/['"]([a-z][a-z0-9-]+\.[a-z][a-z0-9-]+)['"]/g))
      direct.add(id);
  }
  if(source.includes("<RowActions"))
    for(const [,expression] of source.matchAll(/\bguideActionId:\s*([^\n,}]{1,180})/g))
      for(const [,id] of expression.matchAll(/['"]([a-z][a-z0-9-]+\.[a-z][a-z0-9-]+)['"]/g))
        delegated.add(id);
  if(file.endsWith("ProjectWorkflowHeader.vue") &&
     source.includes(':data-guide-action="workflowGuideId('))
    for(const [,id] of source.matchAll(/case\s+"[a-z-]+":\s*return\s+"([a-z][a-z0-9-]+\.[a-z][a-z0-9-]+)"/g))
      delegated.add(id);
}
export const guideAnchorDeclarations={direct,delegated,all:new Set([...direct,...delegated])};

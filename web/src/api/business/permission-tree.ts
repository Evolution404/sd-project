import type { MenuItem } from "@/api/system/menu/types";
interface PermissionDefinition {code:string;title:string;module:string;kind:"menu"|"action"}
interface PermissionCatalog {definitions:PermissionDefinition[]}
const categoryNames:Record<string,string>={
  core:"基础业务访问",system:"系统管理",projects:"子项目管理",
  finance:"费用与结算",demands:"专业需求",
};
/** Map the actual server action registry into the upstream role permission tree UI. */
export async function getPermissionTree():Promise<MenuItem[]> {
  const response=await fetch("/api/permissions",{credentials:"same-origin"});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data?.message||"权限定义读取失败");
  const catalog=data as PermissionCatalog;
  const groups=new Map<string,PermissionDefinition[]>();
  for(const perm of catalog.definitions) {
    if(!groups.has(perm.module))groups.set(perm.module,[]);
    groups.get(perm.module)!.push(perm);
  }
  return [...groups].map(([module,definitions])=>({
    id:`group:${module}`,name:categoryNames[module]||module,type:"C",children:
      definitions.map(permission=>({
        id:permission.code,name:permission.title,perm:permission.code,type:"B"
      })),
  }));
}

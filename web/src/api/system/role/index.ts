import { randomRequestId } from "@/utils/business/request-id";
import { organizationTree } from "@/api/business/organizations";
import type { RoleQuery, RoleItem, RoleForm, RoleDataScope } from "./types";
import type { OptionItem, PageResult } from "@/api/common";
interface ServerRole {
  code:string; name:string; status:"active"|"disabled";
  sort_order:number; version:number; system_seed:number;
  auto_grant_new_permissions:number; permissions:string[];
  member_count:number;
  data_scopes:RoleDataScope[];
}
interface RawPage<T> {items:T[];total:number}
async function call<T>(path:string,method="GET",data?:unknown):Promise<T> {
  const response=await fetch(path,{
    method,credentials:"same-origin",
    ...(method==="GET"?{}:{headers:{"Content-Type":"application/json",
      "Idempotency-Key":randomRequestId()},body:JSON.stringify(data??{})}),
  });
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(body?.message||`HTTP ${response.status}`);
  return body as T;
}
function listItem(item:ServerRole):RoleItem {
  return {id:item.code,code:item.code,name:item.name,sort:item.sort_order,
    status:item.status==="active"?1:0,version:item.version,systemSeed:Boolean(item.system_seed),dataScope:1};
}
const RoleAPI={
  async getPage(queryParams?:RoleQuery):Promise<PageResult<RoleItem>> {
    const page=await call<RawPage<ServerRole>>("/api/roles?page_size=200");
    const word=(queryParams?.keywords||"").trim().toLowerCase();
    const filtered=page.items.filter(x=>!word||x.name.toLowerCase().includes(word)||x.code.includes(word));
    const from=((queryParams?.pageNum||1)-1)*(queryParams?.pageSize||20);
    return {list:filtered.slice(from,from+(queryParams?.pageSize||20)).map(listItem),total:filtered.length};
  },
  async getOptions():Promise<OptionItem[]> {
    const page=await call<RawPage<ServerRole>>("/api/roles?page_size=200");
    return page.items.filter(x=>x.status==="active").map(x=>({label:x.name,value:x.code}));
  },
  async getCodeOptions():Promise<OptionItem[]> {return this.getOptions();},
  getPermissionConfiguration(roleId:string) {
    return call<ServerRole>(`/api/roles/${encodeURIComponent(roleId)}`);
  },
  async scopeOrganizations(): Promise<OptionItem[]> {
    const entries = await organizationTree();
    return entries.filter(entry => entry.status === "active" && !entry.deleted)
      .map(entry => ({ value: entry.id, label: entry.name }));
  },
  async getPermissionPreview(roleId:string,permissions:string[],expectedVersion?:number) {
    const role=await call<ServerRole>(`/api/roles/${encodeURIComponent(roleId)}`);
    if(role.version!==expectedVersion)throw Error("角色权限版本已变化，请重新载入");
    const before=new Set(role.permissions),after=new Set(permissions);
    return { memberCount:role.member_count,added:permissions.filter(code=>!before.has(code)),
      removed:role.permissions.filter(code=>!after.has(code)) };
  },
  async updateRoleMenus(roleId:string,permissions:string[],dataScopes:RoleDataScope[],expectedVersion?:number) {
    if(typeof expectedVersion!=="number")throw Error("请刷新角色版本后再保存");
    return call<ServerRole>(`/api/roles/${encodeURIComponent(roleId)}/permissions`,"PUT",{
      expected_version:expectedVersion,permissions,data_scopes:dataScopes,
    });
  },
  async getFormData(id:string):Promise<RoleForm> {
    const data=await call<ServerRole>(`/api/roles/${encodeURIComponent(id)}`);
    return {id:data.code,code:data.code,name:data.name,sort:data.sort_order,version:data.version,
      autoGrantNewPermissions:Boolean(data.auto_grant_new_permissions),
      status:data.status==="active"?1:0,dataScope:1};
  },
  async getRoleDeptIds(_roleId:string):Promise<string[]> {return [];},
  async create(data:RoleForm) {
    return call("/api/roles","POST",{code:data.code,name:data.name,
      sort_order:data.sort??100,status:data.status===0?"disabled":"active",
      auto_grant_new_permissions:Boolean(data.autoGrantNewPermissions)});
  },
  async update(id:string,data:RoleForm) {
    return call(`/api/roles/${encodeURIComponent(id)}`,"PUT",{
      expected_version:data.version,name:data.name,sort_order:data.sort??100,
      status:data.status===0?"disabled":"active",
      auto_grant_new_permissions:Boolean(data.autoGrantNewPermissions)
    });
  },
  async deleteByIds(id:string) {
    const current=await call<ServerRole>(`/api/roles/${encodeURIComponent(id)}`);
    return call(`/api/roles/${encodeURIComponent(id)}`,"DELETE",{expected_version:current.version});
  },
};
export default RoleAPI;
export * from "./types";

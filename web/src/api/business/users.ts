import { applyNativeListQuery, type NativeListOptions } from "@/utils/business/native-list-query";
import { randomRequestId } from "@/utils/business/request-id";
/** Y2 user-administration DTO adapter; upstream CrudPage keeps its own native UI. */
export interface UserRow {
  id:string;username:string;display_name:string;role:string;role_codes:string[];
  employee_no:string|null;primary_org_id:string|null;organization_ids:string[];status:"active"|"disabled";
  version:number;created_at:string;updated_at:string;
}
export interface UserFormData {
  id?:string;username:string;display_name:string;password?:string;role_codes:string[];
  employee_no?:string|null;primary_org_id?:string|null;organization_ids?:string[];
  status:"active"|"disabled";version?:number;
}
interface Page<T>{items:T[];total:number;page:number;page_size:number}
async function request<T>(path:string,method="GET",data?:unknown):Promise<T>{
  const response=await fetch(path,{method,credentials:"same-origin",
    ...(method==="GET"?{}:{headers:{"Content-Type":"application/json",
      "Idempotency-Key":randomRequestId()},body:JSON.stringify(data??{})})
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(result?.message||`HTTP ${response.status}`);
  return result as T;
}
export async function listUsers(page=1,size=20,keyword="", options: NativeListOptions & { status?: string } = {}) {
  const q=new URLSearchParams({page:String(page),page_size:String(size),q:keyword});
  if (options.status) q.set("filters", JSON.stringify({status: options.status}));
  applyNativeListQuery(q, options);
  return request<Page<UserRow>>(`/api/users?${q}`);
}
export async function loadUser(id:string):Promise<UserRow>{
  return request(`/api/users/${encodeURIComponent(id)}`);
}
export async function saveUser(data:UserFormData,id?:string){
  const roles=data.role_codes;
  if(!Array.isArray(roles)||roles.length===0)throw Error("至少选择一个角色");
  const primary=roles.find(code=>["admin","editor","verifier","viewer"].includes(code))||"viewer";
  const input={username:data.username.trim(),display_name:data.display_name.trim(),
    password:data.password || undefined,role_codes:roles,role:primary,
    status:data.status||"active",employee_no:data.employee_no||null,
    primary_org_id:data.primary_org_id||null,organization_ids:data.organization_ids||[],
    // New records have no version; the upstream input-number field defaults to 0.
    // Never send it on create, but require an exact version on edits.
    ...(id ? { expected_version:data.version } : {})};
  return request<UserRow>(id?`/api/users/${encodeURIComponent(id)}`:"/api/users",
    id?"PUT":"POST",input);
}
export async function disableUser(id:string) {
  const original=await loadUser(id);
  return request<UserRow>(`/api/users/${encodeURIComponent(id)}`,"DELETE",{expected_version:original.version});
}

/** Browser-only preferences. Never persist rows, authorization, or business drafts. */
export type FilterValue = string | number | boolean;
export interface ListState {
  query: Record<string, unknown>;
  sort?: { prop: string; order: "ascending" | "descending" };
  filters: Record<string, FilterValue[]>;
  page: number;
  size: number;
  scroll: { top: number; left: number };
}
export interface ColumnPreference { visible?: boolean; width?: number }
const prefix = "sd-crud-v1:";
export function listStateKey(account: unknown, list: string | undefined) {
  return typeof account === "string" && account && list ? prefix + encodeURIComponent(account) + ":" + encodeURIComponent(list) : undefined;
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function read(storage: Storage, key: string | undefined): Record<string, unknown> {
  if (!key) return {};
  try { const value: unknown=JSON.parse(storage.getItem(key)||"null"); return object(value)?value:{}; } catch { return {}; }
}
function write(storage: Storage, key: string | undefined, value: unknown) {
  if(!key)return;
  try { storage.setItem(key,JSON.stringify(value)); } catch { /* optional browser preferences */ }
}
function normalizeListState(raw:Record<string,unknown>):ListState {
  const scroll=object(raw.scroll)?raw.scroll:{};
  const sort=object(raw.sort)&&typeof raw.sort.prop==="string"&&
    (raw.sort.order==="ascending"||raw.sort.order==="descending")
    ? {prop:raw.sort.prop,order:raw.sort.order as "ascending"|"descending"}:undefined;
  const filters:ListState["filters"]={};
  if(object(raw.filters))for(const [k,v] of Object.entries(raw.filters))
    if(/^[a-zA-Z][a-zA-Z0-9_-]{0,80}$/.test(k)&&!["constructor","prototype"].includes(k)&&Array.isArray(v)&&v.length<=256&&v.every(x=>["string","number","boolean"].includes(typeof x))) filters[k]=v;
  const positive=(n:unknown,fallback:number,max:number)=>typeof n==="number"&&Number.isSafeInteger(n)&&n>0&&n<=max?n:fallback;
  const offset=(n:unknown)=>typeof n==="number"&&Number.isFinite(n)&&n>=0?Math.min(n,10000000):0;
  return {query:object(raw.query)?raw.query:{},sort,filters,page:positive(raw.page,1,1000000),size:positive(raw.size,20,200),
    scroll:{top:offset(scroll.top),left:offset(scroll.left)}};
}
export function readListState(storage: Storage,key:string|undefined){return normalizeListState(read(storage,key))}
export function writeListState(storage: Storage,key:string|undefined,value:ListState){write(storage,key,value)}
export const LIST_QUERY_KEY="_list";
export function listRouteIdentity(fullPath:string):string {
  const index=fullPath.indexOf("?");
  if(index<0)return fullPath;
  const path=fullPath.slice(0,index), rest=fullPath.slice(index+1);
  const hashIndex=rest.indexOf("#");
  const query=hashIndex<0?rest:rest.slice(0,hashIndex);
  const hash=hashIndex<0?"":rest.slice(hashIndex);
  const kept=query.split("&").filter(part=>part.split("=")[0]!==LIST_QUERY_KEY).join("&");
  return path+(kept?"?"+kept:"")+hash;
}
export function encodeListUrl(list:string|undefined,state:ListState):string|undefined {
  if(!list)return;
  const query:Record<string,unknown>={};
  for(const [key,value] of Object.entries(state.query)){
    if(!/^[a-zA-Z][a-zA-Z0-9_-]{0,80}$/.test(key)||["constructor","prototype"].includes(key))continue;
    if(value===null||value===""||value===undefined||Array.isArray(value)&&!value.length)continue;
    query[key]=value;
  }
  const payload=JSON.stringify({v:1,list,query,sort:state.sort,filters:state.filters,page:state.page,size:state.size});
  return payload.length<=4000?payload:undefined;
}
export function decodeListUrl(raw:unknown,list:string|undefined):ListState|undefined{
  if(typeof raw!=="string"||raw.length>4000||!list)return;
  try{
    const value:unknown=JSON.parse(raw);
    if(!object(value)||value.v!==1||value.list!==list)return;
    // URL never supplies stored row snapshots or scroll offset.
    return normalizeListState({...value,scroll:{}});
  }catch{return undefined}
}

export function readColumnPreferences(storage:Storage,key:string|undefined):Record<string,ColumnPreference>{
  const result:Record<string,ColumnPreference>={};
  for(const [name,value] of Object.entries(read(storage,key&&key+":columns"))){
    if(!object(value))continue;
    result[name]={visible:typeof value.visible==="boolean"?value.visible:undefined,
      width:typeof value.width==="number"&&Number.isFinite(value.width)&&value.width>=64&&value.width<=800?value.width:undefined};
  }
  return result;
}
export function writeColumnPreferences(storage:Storage,key:string|undefined,value:Record<string,ColumnPreference>){write(storage,key&&key+":columns",value)}

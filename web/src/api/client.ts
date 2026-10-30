export interface ApiProblem extends Error {
 status?:number;
 details?:Array<{row?:number;message?:string}>;
}
export async function requestApi<T=any>(path:string,method='GET',body?:unknown):Promise<T>{
 if(!path.startsWith('/'))throw Error('API 请求路径必须以 / 开始');
 const response=await fetch('/api'+path,{
  method,credentials:'same-origin',
  headers:body===undefined?{}:{'Content-Type':'application/json'},
  body:body===undefined?undefined:JSON.stringify(body)
 });
 let data:any;
 try{data=await response.json()}catch{throw Error('无法解析服务端返回的数据')}
 if(!response.ok){
  const detail=Array.isArray(data?.details)?data.details.map((x:any)=>'第'+(x.row??'?')+'行 '+(x.message||'无效')).join('；'):'';
  const message=String(data?.error||'业务操作失败')+(detail?'：'+detail:'');
  throw Object.assign(new Error(message),{status:response.status,details:data?.details} as Partial<ApiProblem>);
 }
 return data as T;
}

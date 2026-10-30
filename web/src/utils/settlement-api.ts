export async function settlementApi(path:string,method='GET',body?:Record<string,any>){
 const response=await fetch('/api'+path,{method,credentials:'same-origin',
  headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
 const data=await response.json();
 if(!response.ok)throw Error(data.error||'结算操作失败');
 return data;
}

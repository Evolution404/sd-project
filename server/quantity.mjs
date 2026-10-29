export const QUANTITY_SCALE=10000;
export function quantityToScaled(value){
 const raw=String(value??'').trim();
 if(!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,4})?$/.test(raw))throw Object.assign(new Error('工作量为正数且最多四位小数'),{status:422});
 const [integer,frac='']=raw.split('.');
 const n=Number(integer)*QUANTITY_SCALE+Number(frac.padEnd(4,'0'));
 if(n<=0||!Number.isSafeInteger(n))throw Object.assign(new Error('工作量必须大于零且在有效范围内'),{status:422});
 return n;
}

// Quantities use four decimal places. Aggregate integer units with BigInt so a
// 5000-row preview cannot lose precision when the sum exceeds Number's limit.
export function quantityScaled(value:unknown):bigint|null{
 const raw=String(value??'').trim();
 if(!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,4})?$/.test(raw))return null;
 const [whole,fraction='']=raw.split('.');
 const scaled=BigInt(whole)*10000n+BigInt(fraction.padEnd(4,'0'));
 return scaled>0n?scaled:null;
}
export function displayScaledQuantity(value:bigint):string{
 const fraction=String(value%10000n).padStart(4,'0').replace(/0+$/,'');
 return String(value/10000n)+(fraction?'.'+fraction:'');
}
export function sumQuantities(values:unknown[]):string{
 return displayScaledQuantity(values.reduce<bigint>((total,value)=>total+(quantityScaled(value)??0n),0n));
}

/** Integer cents and fixed 1/10000 unit quantities, shared by all budget and settlement paths. */
const invalid=(message)=>{const error=new Error(message);error.status=422;throw error};
export function yuanToFen(value,label='金额'){
 const raw=String(value??'').trim();
 if(!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(raw))invalid(label+'格式无效，最多两位小数');
 const [integer,fraction='']=raw.split('.');
 const amount=BigInt(integer)*100n+BigInt(fraction.padEnd(2,'0'));
 if(amount>BigInt(Number.MAX_SAFE_INTEGER))invalid(label+'超出有效范围');
 return Number(amount);
}
export function amountFen(quantityScaled,unitPriceFen){
 if(!Number.isSafeInteger(quantityScaled)||quantityScaled<0||
    !Number.isSafeInteger(unitPriceFen)||unitPriceFen<0)invalid('金额计算所需数量或单价无效');
 const value=(BigInt(quantityScaled)*BigInt(unitPriceFen)+5000n)/10000n;
 if(value>BigInt(Number.MAX_SAFE_INTEGER))invalid('明细金额超过允许范围');
 return Number(value);
}
export function sumFen(values){
 const total=values.reduce((acc,value)=>{
  if(!Number.isSafeInteger(value)||value<0)invalid('预算明细金额无效');
  return acc+BigInt(value);
 },0n);
 if(total>BigInt(Number.MAX_SAFE_INTEGER))invalid('预算合计金额超出有效范围');
 return Number(total);
}

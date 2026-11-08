import { requireValue,integer } from './errors.mjs';
export function scaledDecimal(value,places,label){
 const text=String(value).trim(),match=/^(\d+)(?:\.(\d+))?$/.exec(text);
 requireValue(match&&(!match[2]||match[2].length<=places),`${label}最多保留${places}位小数`);
 const number=BigInt(match[1])*10n**BigInt(places)+BigInt((match[2]||'').padEnd(places,'0'));
 requireValue(number<=BigInt(Number.MAX_SAFE_INTEGER),`${label}超出安全整数范围`);return integer(Number(number),label);
}
export function decimalText(value,places){
 const number=BigInt(value),factor=10n**BigInt(places);
 return `${number/factor}.${(number%factor).toString().padStart(places,'0')}`;
}

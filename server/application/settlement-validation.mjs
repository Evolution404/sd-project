import {settlementNumberInUse} from '../database/queries/settlement-facts.mjs';
export const settlementFail=(status,message)=>{throw Object.assign(new Error(message),{status})};
export function validateSettlementDate(date,label='结算日期'){
 if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||
  !Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)
  settlementFail(422,label+'无效，请填写真实的年月日');
}
export function ensureSettlementNumber(number,entryId=''){
 // Reserve all historical official numbers, including corrected/voided ones.
 if(settlementNumberInUse(number,entryId))
  settlementFail(409,'该凭证编号已被其他凭证或其历史版本使用');
}

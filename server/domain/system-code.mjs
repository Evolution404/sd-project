import {randomUUID} from 'node:crypto';

// Codes identify records internally. Explicit codes remain accepted for imports
// and existing integrations; ordinary creation forms only need business facts.
export function systemCode(value,prefix){
 if(value==null||typeof value==='string'&&!value.trim())return prefix+'-'+randomUUID().replaceAll('-','');
 if(typeof value!=='string')throw Object.assign(new Error('编号必须为文本'),{status:422});
 return value.trim();
}

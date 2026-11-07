import {uid,now,transaction,audit} from '../database/index.mjs';
import {replacementSource,replacementCircuits,replaceTowerBindings} from '../database/repositories/tower-replacements.mjs';
const invalid=(status,message)=>{const e=new Error(message);e.status=status;throw e};
const linked=replacementCircuits;
const oldTower=id=>replacementSource(id)||invalid(404,'原物理杆塔不存在');

/** Read-only impact preview for a whole physical tower replacement. */
export function previewWholeTowerReplacement(id){
 const source=oldTower(id);
 return {source,affected:linked(id),required_confirmations:linked(id).length};
}

/**
 * A genuine physical tower replacement is a single atomic operation across
 * all active logical circuits. The operator must confirm the exact current
 * circuit/version set, not just one chosen circuit.
 */
export function replaceWholeTower(id,body,user){
 return transaction(()=>{
  const source=oldTower(id);
  if(source.version!==body.source_version)invalid(409,'原实体塔版本已变化，请重新预览');
  if(source.status!=='active')invalid(409,'原实体塔不是在用状态');
  const target=replacementSource(body.target_physical_tower_id);
  if(!target||target.status!=='active'||target.id===id)invalid(422,'请选择另一座在用实体塔');
  const reason=typeof body.reason==='string'?body.reason.trim():'';
  if(!reason)invalid(422,'必须填写实际换塔依据');
  const current=linked(id),expected=body.confirmed_towers;
  if(!current.length)invalid(409,'原实体塔没有在用回路，请检查台账');
  if(!Array.isArray(expected)||expected.length!==current.length||new Set(expected.map(x=>x?.id)).size!==current.length)
    invalid(409,'必须核对并确认全部共塔逻辑回路，不可遗漏');
  const byId=new Map(expected.map(x=>[x.id,x]));
  if(current.some(x=>byId.get(x.id)?.version!==x.version))
    invalid(409,'共塔线路关联或版本已变化，请重新预览');
  const stamp=now();
  replaceTowerBindings(id,target.id,current,user.id,reason,stamp,current.map(()=>uid()));
  const result={from_physical_tower_id:id,to_physical_tower_id:target.id,
   affected:current.map(({id,line_id,tower_no,version})=>({id,line_id,tower_no,previous_version:version,new_version:version+1})),
   reason,actor_id:user.id,changed_at:stamp};
  audit(user.id,'whole_tower_replacement',id,'replace',source,result,reason);
  return result;
 });
}

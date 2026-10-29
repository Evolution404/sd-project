import {all,one,exec,uid,now,transaction,audit} from './db.mjs';
const invalid=(status,message)=>{const e=new Error(message);e.status=status;throw e};
const linked=id=>all(`SELECT t.id,t.line_id,t.physical_tower_id,t.version,t.tower_no,t.status,
 l.name AS line_name,l.setup_status AS line_setup_status FROM logical_towers t
 JOIN transmission_lines l ON l.id=t.line_id
 WHERE t.physical_tower_id=? AND t.status='active' ORDER BY l.name,t.tower_no,t.id`,id);
const oldTower=id=>one('SELECT * FROM physical_towers WHERE id=?',id)||invalid(404,'原物理杆塔不存在');

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
  const target=one('SELECT * FROM physical_towers WHERE id=?',body.target_physical_tower_id);
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
  const stamp=now(),lineIds=[...new Set(current.map(x=>x.line_id))];
  for(const tower of current){
   exec('UPDATE logical_tower_physical_history SET valid_to=? WHERE logical_tower_id=? AND valid_to IS NULL',stamp,tower.id);
   exec(`INSERT INTO logical_tower_physical_history
     (id,logical_tower_id,physical_tower_id,valid_from,valid_to,change_kind,changed_by,reason)
     VALUES(?,?,?,?,NULL,?,?,?)`,uid(),tower.id,target.id,stamp,'replacement',user.id,reason);
   exec('UPDATE logical_towers SET physical_tower_id=?,version=version+1,updated_at=? WHERE id=?',target.id,stamp,tower.id);
  }
  for(const lineId of lineIds)exec('UPDATE transmission_lines SET version=version+1,updated_at=? WHERE id=?',stamp,lineId);
  exec('UPDATE physical_towers SET version=version+1,updated_at=? WHERE id IN (?,?)',stamp,id,target.id);
  const result={from_physical_tower_id:id,to_physical_tower_id:target.id,
   affected:current.map(({id,line_id,tower_no,version})=>({id,line_id,tower_no,previous_version:version,new_version:version+1})),
   reason,actor_id:user.id,changed_at:stamp};
  audit(user.id,'whole_tower_replacement',id,'replace',source,result,reason);
  return result;
 });
}
